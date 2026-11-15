#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/json.hpp>
#include <openssl/ssl.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <deque>
#include <fcntl.h>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <signal.h>
#include <sstream>
#include <string>
#include <thread>
#include <unistd.h>
#include <sys/stat.h>

#include "firmware_application.h"
#include "framebuffer.h"
#include "arduino_json_protocol.h"
#include "terminal_core.h"
#include "terminal_view_model.h"
#include "test_faults.h"

namespace net = boost::asio;
namespace ssl = boost::asio::ssl;
namespace beast = boost::beast;
namespace websocket = beast::websocket;
namespace http = beast::http;
namespace json = boost::json;
using tcp = net::ip::tcp;
using fields::terminal::Button;
using fields::terminal::Config;
using fields::terminal::Credentials;
using fields::terminal::FirmwareApplication;
using fields::terminal::InboundMessage;
using fields::terminal::InboundType;
using fields::terminal::OutboundMessage;
using fields::terminal::OutboundType;
using fields::terminal::Ports;
using fields::terminal::Snapshot;
using fields::terminal::TransportCloseReason;
using fields::sticks3::FramebufferRenderer;
using fields::sticks3::TestFaultScenario;

namespace {

const size_t kMaxIpcLineBytes = 65536;
const size_t kMaxPcmIpcBytes = 32768;

struct Url {
  bool tls;
  std::string host;
  std::string port;
  std::string target;
};

bool parse_url(const std::string& value, Url* url) {
  const std::string ws = "ws://";
  const std::string wss = "wss://";
  size_t offset = 0;
  if (value.compare(0, ws.size(), ws) == 0) { url->tls = false; offset = ws.size(); }
  else if (value.compare(0, wss.size(), wss) == 0) { url->tls = true; offset = wss.size(); }
  else return false;
  const size_t slash = value.find('/', offset);
  const std::string authority = value.substr(offset, slash == std::string::npos ? std::string::npos : slash - offset);
  if (authority.empty()) return false;
  const size_t colon = authority.rfind(':');
  if (colon != std::string::npos && authority.find(']') == std::string::npos) {
    url->host = authority.substr(0, colon);
    url->port = authority.substr(colon + 1);
  } else {
    url->host = authority;
    url->port = url->tls ? "443" : "80";
  }
  if (url->host.empty() || url->port.empty()) return false;
  url->target = slash == std::string::npos ? "/" : value.substr(slash);
  return true;
}

std::string environment(const char* name, const std::string& fallback = std::string()) {
  const char* value = std::getenv(name);
  return value == 0 ? fallback : std::string(value);
}

uint32_t now_ms() {
  return static_cast<uint32_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());
}

uint32_t random_u32() {
  uint32_t value = 0;
  std::ifstream random("/dev/urandom", std::ios::binary);
  if (random.good()) random.read(reinterpret_cast<char*>(&value), sizeof(value));
  if (value == 0) value = static_cast<uint32_t>(std::rand()) ^ now_ms();
  return value;
}

std::string b64_encode(const uint8_t* bytes, size_t size) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string encoded;
  encoded.reserve(((size + 2) / 3) * 4);
  for (size_t index = 0; index < size; index += 3) {
    const uint32_t first = bytes[index];
    const uint32_t second = index + 1 < size ? bytes[index + 1] : 0;
    const uint32_t third = index + 2 < size ? bytes[index + 2] : 0;
    const uint32_t triple = (first << 16) | (second << 8) | third;
    encoded.push_back(alphabet[(triple >> 18) & 63]);
    encoded.push_back(alphabet[(triple >> 12) & 63]);
    encoded.push_back(index + 1 < size ? alphabet[(triple >> 6) & 63] : '=');
    encoded.push_back(index + 2 < size ? alphabet[triple & 63] : '=');
  }
  return encoded;
}

int b64_value(char character) {
  if (character >= 'A' && character <= 'Z') return character - 'A';
  if (character >= 'a' && character <= 'z') return character - 'a' + 26;
  if (character >= '0' && character <= '9') return character - '0' + 52;
  if (character == '+') return 62;
  if (character == '/') return 63;
  return -1;
}

bool b64_decode(const std::string& encoded, std::vector<uint8_t>* output) {
  if (!output || encoded.empty() || encoded.size() % 4 != 0) return false;
  output->clear();
  output->reserve((encoded.size() / 4) * 3);
  for (size_t index = 0; index < encoded.size(); index += 4) {
    const int a = b64_value(encoded[index]);
    const int b = b64_value(encoded[index + 1]);
    const int c = encoded[index + 2] == '=' ? -2 : b64_value(encoded[index + 2]);
    const int d = encoded[index + 3] == '=' ? -2 : b64_value(encoded[index + 3]);
    if (a < 0 || b < 0 || c == -1 || d == -1 || (c == -2 && d != -2) ||
        ((c == -2 || d == -2) && index + 4 != encoded.size())) return false;
    output->push_back(static_cast<uint8_t>((a << 2) | (b >> 4)));
    if (c != -2) output->push_back(static_cast<uint8_t>(((b & 15) << 4) | (c >> 2)));
    if (d != -2) output->push_back(static_cast<uint8_t>(((c & 3) << 6) | d));
  }
  return true;
}

std::string field_string(const json::object& object, const char* name) {
  json::object::const_iterator found = object.find(name);
  if (found == object.end() || !found->value().is_string()) return std::string();
  return std::string(found->value().as_string().c_str());
}

uint32_t field_u32(const json::object& object, const char* name) {
  json::object::const_iterator found = object.find(name);
  if (found == object.end()) return 0;
  if (found->value().is_uint64()) return static_cast<uint32_t>(found->value().as_uint64());
  if (found->value().is_int64() && found->value().as_int64() >= 0) return static_cast<uint32_t>(found->value().as_int64());
  return 0;
}

void put_string(json::object* object, const char* name, const std::string& value) {
  if (!value.empty()) (*object)[name] = value;
}

class Transport {
 public:
  virtual ~Transport() {}
  virtual bool connect(const Url& url, const Credentials* credentials, std::string* error) = 0;
  virtual bool write_text(const std::string& text, std::string* error) = 0;
  virtual bool write_binary(const uint8_t* bytes, size_t size, std::string* error) = 0;
  virtual bool poll(bool* text, std::vector<uint8_t>* data, bool* closed, std::string* close_reason, std::string* error) = 0;
  virtual void close() = 0;
  virtual bool open() const = 0;
};

template <typename Stream>
class SocketTransport : public Transport {
 public:
  SocketTransport()
      : resolver_(ioc_), read_pending_(false), read_result_ready_(false),
        read_text_(false), read_closed_(false) {}

  bool write_text(const std::string& text, std::string* error) override {
    if (!stream_ || !stream_->is_open()) return false;
    beast::error_code code;
    stream_->text(true);
    stream_->write(net::buffer(text), code);
    if (code) { if (error) *error = code.message(); return false; }
    return true;
  }

  bool write_binary(const uint8_t* bytes, size_t size, std::string* error) override {
    if (!stream_ || !stream_->is_open()) return false;
    beast::error_code code;
    stream_->binary(true);
    stream_->write(net::buffer(bytes, size), code);
    if (code) { if (error) *error = code.message(); return false; }
    return true;
  }

  bool poll(bool* text, std::vector<uint8_t>* data, bool* closed, std::string* close_reason, std::string* error) override {
    if (closed) *closed = false;
    if (read_result_ready_) return consume_read_result(text, data, closed, close_reason, error);
    if (!stream_ || !stream_->is_open()) return false;
    if (!read_pending_) begin_read();
    ioc_.poll();
    return read_result_ready_
        ? consume_read_result(text, data, closed, close_reason, error)
        : false;
  }

  void close() override {
    if (!stream_) return;
    // A core-initiated reconnect may happen while an async read is waiting.
    // Cancel at the TCP layer instead of racing a synchronous WebSocket close
    // against that read; the transport object is discarded immediately after.
    beast::error_code code;
    beast::get_lowest_layer(*stream_).socket().shutdown(tcp::socket::shutdown_both, code);
    beast::get_lowest_layer(*stream_).socket().close(code);
  }

  bool open() const override { return stream_ && stream_->is_open(); }

 protected:
  net::io_context ioc_;
  tcp::resolver resolver_;
  std::unique_ptr<websocket::stream<Stream> > stream_;
  beast::flat_buffer read_buffer_;
  bool read_pending_;
  bool read_result_ready_;
  bool read_text_;
  bool read_closed_;
  std::string read_close_reason_;
  std::string read_error_;
  std::vector<uint8_t> read_data_;

  void begin_read() {
    if (!stream_ || !stream_->is_open() || read_pending_) return;
    read_pending_ = true;
    ioc_.restart();
    stream_->async_read(read_buffer_, [this](beast::error_code code, std::size_t) {
      read_pending_ = false;
      read_result_ready_ = true;
      read_closed_ = code == websocket::error::closed;
      read_close_reason_.clear();
      read_error_.clear();
      read_data_.clear();
      if (read_closed_) {
        read_close_reason_ = stream_->reason().reason.c_str();
        return;
      }
      if (code) {
        read_error_ = code.message();
        return;
      }
      read_text_ = stream_->got_text();
      const std::string payload = beast::buffers_to_string(read_buffer_.data());
      read_data_.assign(payload.begin(), payload.end());
      read_buffer_.consume(read_buffer_.size());
    });
  }

  bool consume_read_result(bool* text, std::vector<uint8_t>* data, bool* closed,
                           std::string* close_reason, std::string* error) {
    read_result_ready_ = false;
    if (read_closed_) {
      if (closed) *closed = true;
      if (close_reason) *close_reason = read_close_reason_;
      return false;
    }
    if (!read_error_.empty()) {
      if (error) *error = read_error_;
      return false;
    }
    if (text) *text = read_text_;
    if (data) data->swap(read_data_);
    return true;
  }

  void decorate(const Credentials* credentials) {
    stream_->set_option(websocket::stream_base::decorator(
        [credentials](websocket::request_type& request) {
          request.set(http::field::user_agent, "Fields-StickS3-PC-Runner/1");
          if (credentials != 0) {
            request.set("X-Terminal-Id", credentials->terminal_id);
            request.set("X-Terminal-Token", credentials->terminal_token);
          }
        }));
  }
};

class PlainTransport final : public SocketTransport<beast::tcp_stream> {
 public:
  bool connect(const Url& url, const Credentials* credentials, std::string* error) override {
    beast::error_code code;
    this->stream_.reset(new websocket::stream<beast::tcp_stream>(this->ioc_));
    this->decorate(credentials);
    const tcp::resolver::results_type results = this->resolver_.resolve(url.host, url.port, code);
    if (code) { if (error) *error = code.message(); return false; }
    beast::get_lowest_layer(*this->stream_).connect(results, code);
    if (code) { if (error) *error = code.message(); return false; }
    this->stream_->handshake(url.host, url.target, code);
    if (code) { if (error) *error = code.message(); return false; }
    return true;
  }
};

class TlsTransport final : public SocketTransport<beast::ssl_stream<beast::tcp_stream> > {
 public:
  TlsTransport() : context_(ssl::context::tls_client) {
    context_.set_default_verify_paths();
  }

  bool connect(const Url& url, const Credentials* credentials, std::string* error) override {
    beast::error_code code;
    this->stream_.reset(new websocket::stream<beast::ssl_stream<beast::tcp_stream> >(this->ioc_, context_));
    this->decorate(credentials);
    if (!SSL_set_tlsext_host_name(this->stream_->next_layer().native_handle(), url.host.c_str())) {
      if (error) *error = "tls_sni_failed";
      return false;
    }
    this->stream_->next_layer().set_verify_mode(ssl::verify_peer);
    this->stream_->next_layer().set_verify_callback(ssl::host_name_verification(url.host));
    const tcp::resolver::results_type results = this->resolver_.resolve(url.host, url.port, code);
    if (code) { if (error) *error = code.message(); return false; }
    beast::get_lowest_layer(*this->stream_).connect(results, code);
    if (code) { if (error) *error = code.message(); return false; }
    this->stream_->next_layer().handshake(ssl::stream_base::client, code);
    if (code) { if (error) *error = code.message(); return false; }
    this->stream_->handshake(url.host, url.target, code);
    if (code) { if (error) *error = code.message(); return false; }
    return true;
  }

 private:
  ssl::context context_;
};

class CredentialStore {
 public:
  CredentialStore() {
    const std::string configured = environment("STICKS3_PC_CREDENTIAL_FILE");
    if (!configured.empty()) path_ = configured;
    else path_ = environment("HOME", "/home/node") + "/.fields/sticks3-call/pc-terminal.json";
  }

  bool load(Credentials* credentials) const {
    std::ifstream file(path_.c_str(), std::ios::in | std::ios::binary);
    if (!file.good()) return false;
    std::stringstream content; content << file.rdbuf();
    json::error_code code;
    const json::value parsed = json::parse(content.str(), code);
    if (code || !parsed.is_object()) return false;
    const json::object& object = parsed.as_object();
    if (field_u32(object, "version") != 2) return false;
    credentials->terminal_id = field_string(object, "terminal_id");
    credentials->terminal_token = field_string(object, "terminal_token");
    credentials->terminal_token_version = field_u32(object, "terminal_token_version");
    return credentials->valid();
  }

  bool save(const Credentials& credentials) const {
    if (!credentials.valid()) return false;
    const size_t slash = path_.rfind('/');
    if (slash == std::string::npos) return false;
    const std::string directory = path_.substr(0, slash);
    if (!ensure_directory(directory)) return false;
    json::object object;
    object["version"] = 2;
    object["terminal_id"] = credentials.terminal_id;
    object["terminal_token"] = credentials.terminal_token;
    object["terminal_token_version"] = credentials.terminal_token_version;
    const std::string body = json::serialize(object);
    const std::string temporary = path_ + "." + std::to_string(static_cast<unsigned long>(::getpid())) + ".tmp";
    const int file = ::open(temporary.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (file < 0) return false;
    const ssize_t written = ::write(file, body.data(), body.size());
    const bool flushed = written == static_cast<ssize_t>(body.size()) && ::fsync(file) == 0;
    const bool closed = ::close(file) == 0;
    const bool ok = flushed && closed && ::rename(temporary.c_str(), path_.c_str()) == 0 && fsync_directory(directory);
    if (!ok) ::unlink(temporary.c_str());
    return ok;
  }

  void clear() const { ::unlink(path_.c_str()); }

 private:
  std::string path_;

  static bool ensure_directory(const std::string& directory) {
    std::string current;
    for (size_t index = 0; index < directory.size(); ++index) {
      current += directory[index];
      if (directory[index] != '/' || current.size() == 1) continue;
      ::mkdir(current.c_str(), 0700);
    }
    if (::mkdir(directory.c_str(), 0700) != 0 && errno != EEXIST) return false;
    ::chmod(directory.c_str(), 0700);
    return true;
  }

  static bool fsync_directory(const std::string& directory) {
    const int descriptor = ::open(directory.c_str(), O_RDONLY | O_DIRECTORY);
    if (descriptor < 0) return false;
    const bool ok = ::fsync(descriptor) == 0;
    ::close(descriptor);
    return ok;
  }
};

class Runner final : public Ports {
 public:
  Runner()
      : url_(environment("STICKS3_TERMINAL_WS_URL", "ws://127.0.0.1:4105/embodiment/ws")),
        audio_stream_id_(0), stop_(false), fault_(TestFaultScenario::None),
        virtual_transport_open_(false), virtual_pair_code_sent_(false),
        virtual_credentials_sent_(false), virtual_json_sent_(false),
        virtual_close_at_ms_(0), virtual_next_event_at_ms_(0),
        wifi_connected_(true), tls_clock_ready_(true), frame_pipe_open_(false),
        frame_descriptor_(-1) {
    Config config;
    config.endpoint = url_;
    config.pairing_label = environment("STICKS3_PC_PAIRING_LABEL", "PC soft terminal");
    config.fallback_credentials.terminal_id = environment("STICKS3_TERMINAL_ID");
    config.fallback_credentials.terminal_token = environment("STICKS3_TERMINAL_TOKEN");
    config.fallback_credentials.terminal_token_version = 1;
    application_.reset(new FirmwareApplication(*this, config));
  }

  int run() {
    std::string fault_error;
    if (!fields::sticks3::parse_test_fault_scenario(
            environment("STICKS3_PC_TEST_MODE"),
            environment("STICKS3_PC_TEST_FAULT_SCENARIO"), &fault_, &fault_error)) {
      emit_named_error("invalid_test_fault_configuration", fault_error);
      return 2;
    }
    if (!parse_url(url_, &parsed_url_)) { emit_error("invalid_runner_url"); return 1; }
    std::signal(SIGPIPE, SIG_IGN);
    wifi_connected_ = fault_ != TestFaultScenario::WifiOffline;
    tls_clock_ready_ = fault_ != TestFaultScenario::NtpUnready;
    if (::fcntl(3, F_GETFD) != -1) {
      frame_descriptor_ = 3;
      frame_pipe_open_ = true;
    }
    application_->start();
    std::thread([this]() { read_input(); }).detach();
    while (!stop_) {
      process_commands();
      poll_transport();
      application_->tick();
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    if (transport_) transport_->close();
    return 0;
  }

  uint32_t now_ms() const override { return ::now_ms(); }
  uint32_t random_u32() override {
    return fault_ == TestFaultScenario::None ? ::random_u32() : 7;
  }
  bool load_credentials(Credentials* credentials) override { return credentials && store_.load(credentials); }
  bool save_credentials(const Credentials& credentials) override {
    return fault_ != TestFaultScenario::NvsSaveFailure && store_.save(credentials);
  }
  void clear_credentials() override { store_.clear(); }

  void request_connect(const std::string&, const Credentials* credentials) override {
    if (fields::sticks3::test_fault_fails_connect(fault_)) {
      runtime_notice_ = fault_ == TestFaultScenario::WifiOffline ? "Wi-Fi unavailable" :
          (fault_ == TestFaultScenario::NtpUnready ? "Secure clock unavailable" : "TLS handshake failed");
      emit_error("bridge_unavailable");
      application_->on_transport_closed(TransportCloseReason::Network);
      return;
    }
    if (fields::sticks3::test_fault_uses_virtual_transport(fault_)) {
      virtual_transport_open_ = true;
      virtual_pair_code_sent_ = false;
      virtual_credentials_sent_ = false;
      virtual_json_sent_ = false;
      virtual_next_event_at_ms_ = now_ms() + 10;
      virtual_close_at_ms_ = fault_ == TestFaultScenario::WebSocketClose ? now_ms() + 30 : 0;
      runtime_notice_.clear();
      application_->on_transport_open();
      return;
    }
    transport_.reset(parsed_url_.tls ? static_cast<Transport*>(new TlsTransport()) : static_cast<Transport*>(new PlainTransport()));
    std::string ignored;
    if (transport_->connect(parsed_url_, credentials, &ignored)) {
      runtime_notice_.clear();
      application_->on_transport_open();
    } else {
      transport_.reset();
      emit_error("bridge_unavailable");
      application_->on_transport_closed(TransportCloseReason::Network);
    }
  }

  void disconnect_transport() override {
    if (virtual_transport_open_) {
      virtual_transport_open_ = false;
      application_->on_transport_closed(TransportCloseReason::LocalDisconnect);
      return;
    }
    if (transport_) transport_->close();
    transport_.reset();
    application_->on_transport_closed(TransportCloseReason::LocalDisconnect);
  }

  bool enqueue_text(const OutboundMessage& message) override {
    JsonDocument document;
    if (!fields::terminal::arduino_json::encode_outbound(message, &document)) {
      emit_error("invalid_outbound_message");
      return false;
    }
    std::string serialized;
    if (serializeJson(document, serialized) == 0) {
      emit_error("serialize_outbound_message_failed");
      return false;
    }
    std::string ignored;
    if (virtual_transport_open_) return true;
    if (!transport_ || !transport_->write_text(serialized, &ignored)) { emit_error("transport_write_failed"); return false; }
    return true;
  }

  bool enqueue_binary(const uint8_t* bytes, size_t length) override {
    std::string ignored;
    if (virtual_transport_open_) return true;
    if (!transport_ || !transport_->write_binary(bytes, length, &ignored)) { emit_error("transport_write_failed"); return false; }
    return true;
  }

  void set_capture_enabled(bool) override {}
  void stop_playback() override {}
  void begin_downlink_audio(uint32_t stream_id) override {
    audio_stream_id_ = stream_id;
    emit({{"type", "downlink.start"}, {"stream_id", stream_id}, {"byte_length", 0}, {"sample_rate_hz", 16000}});
  }
  bool downlink_output_busy() const override { return false; }
  void enqueue_downlink_pcm(const int16_t* samples, size_t count) override {
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(samples);
    emit({{"type", "downlink.pcm"}, {"stream_id", audio_stream_id_},
          {"pcm16le_b64", b64_encode(bytes, count * sizeof(int16_t))}});
  }
  void end_downlink_audio(uint32_t stream_id) override {
    emit({{"type", "downlink.end"}, {"stream_id", stream_id}});
  }
  void publish_snapshot(const Snapshot& snapshot) override {
    std::string terminal_id = application_->credentials().terminal_id;
    if (terminal_id.empty()) terminal_id = environment("STICKS3_TERMINAL_ID", "pc-simulator-unpaired");
    const char* state = "offline";
    switch (snapshot.call_state) {
      case fields::terminal::CallState::Idle: state = snapshot.transport_open ? "idle" : "offline"; break;
      case fields::terminal::CallState::Ringing: state = "ringing"; break;
      case fields::terminal::CallState::ConnectedIdle: state = "connected"; break;
      case fields::terminal::CallState::Playing: state = "playing"; break;
      case fields::terminal::CallState::Waiting: state = "waiting"; break;
      case fields::terminal::CallState::Recording: state = "recording"; break;
      case fields::terminal::CallState::Ending: state = "ended"; break;
    }
    const char* controller = snapshot.pairing_mode ? "pairing" : (snapshot.terminal_ready ? "connected" : "connecting");
    const char* pairing = snapshot.pairing_mode ? (snapshot.pairing_code.empty() ? "unpaired" : "code") : (snapshot.terminal_ready ? "paired" : "reconnecting");
    json::value call = nullptr;
    if (!snapshot.active_call_id.empty()) {
      json::object call_object;
      call_object["call_id"] = snapshot.active_call_id; call_object["caller_label"] = snapshot.active_agent_label;
      call_object["purpose"] = snapshot.active_purpose.empty() ? json::value(nullptr) : json::value(snapshot.active_purpose);
      call = call_object;
    }
    emit({{"type", "snapshot"}, {"controller_state", controller}, {"terminal_state", state}, {"terminal_id", terminal_id},
          {"pairing", {{"state", pairing}, {"code", snapshot.pairing_code.empty() ? json::value(nullptr) : json::value(snapshot.pairing_code)},
                       {"expires_at_ms", snapshot.pairing_expires_at_ms == 0 ? json::value(nullptr) : json::value(snapshot.pairing_expires_at_ms)}}},
          {"call", call}});
    fields::terminal::ui::RuntimeStatus runtime;
    runtime.wifi_connected = wifi_connected_;
    runtime.tls_clock_ready = tls_clock_ready_;
    runtime.audio_level = snapshot.audio_level;
    runtime.notice = runtime_notice_;
    std::vector<uint8_t> frame;
    if (frame_pipe_open_ && framebuffer_.make_view_record(
            fields::terminal::ui::make_view_model(snapshot, runtime), &frame) &&
        !fields::sticks3::write_frame_record(frame_descriptor_, frame)) {
      frame_pipe_open_ = false;
    }
  }
  void publish_safe_event(const char* name, const char* detail) override {
    if (std::string(name) == "recording.limit") emit({{"type", "recording.limit"}, {"max_duration_ms", 60000}});
    else if (std::string(name) == "pairing.code") emit({{"type", "pairing.status"}, {"pairing", {{"state", "code"}, {"code", detail}, {"expires_at_ms", nullptr}}}});
  }

 private:
  CredentialStore store_;
  std::string url_;
  Url parsed_url_;
  std::unique_ptr<Transport> transport_;
  std::unique_ptr<FirmwareApplication> application_;
  std::deque<std::string> commands_;
  std::mutex commands_mutex_;
  std::mutex output_mutex_;
  uint32_t audio_stream_id_;
  std::atomic<bool> stop_;
  TestFaultScenario fault_;
  bool virtual_transport_open_;
  bool virtual_pair_code_sent_;
  bool virtual_credentials_sent_;
  bool virtual_json_sent_;
  uint32_t virtual_close_at_ms_;
  uint32_t virtual_next_event_at_ms_;
  bool wifi_connected_;
  bool tls_clock_ready_;
  std::string runtime_notice_;
  FramebufferRenderer framebuffer_;
  bool frame_pipe_open_;
  int frame_descriptor_;

  void emit(const json::object& message) {
    std::lock_guard<std::mutex> lock(output_mutex_);
    std::cout << json::serialize(message) << std::endl;
  }
  void emit_error(const char* code) { emit({{"type", "error"}, {"code", code}, {"message", "PC terminal transport failed."}, {"recoverable", true}}); }
  void emit_named_error(const char* code, const std::string& message) {
    emit({{"type", "error"}, {"code", code}, {"message", message}, {"recoverable", true}});
  }

  void read_input() {
    std::string line;
    while (std::getline(std::cin, line)) {
      if (line.size() > kMaxIpcLineBytes) continue;
      std::lock_guard<std::mutex> lock(commands_mutex_);
      commands_.push_back(line);
    }
    stop_ = true;
  }

  void process_commands() {
    std::deque<std::string> pending;
    { std::lock_guard<std::mutex> lock(commands_mutex_); pending.swap(commands_); }
    while (!pending.empty()) {
      json::error_code code;
      const json::value parsed = json::parse(pending.front(), code); pending.pop_front();
      if (code || !parsed.is_object()) { emit_error("invalid_runner_command"); continue; }
      const json::object& command = parsed.as_object();
      const std::string type = field_string(command, "type");
      if (type == "shutdown") { stop_ = true; continue; }
      if (type == "activate") { continue; }
      if (type == "button.a") { application_->on_button(Button::A); continue; }
      if (type == "button.b") { application_->on_button(Button::B); continue; }
      if (type == "uplink.pcm") {
        const std::string encoded = field_string(command, "pcm16le_b64");
        std::vector<uint8_t> bytes;
        if (!b64_decode(encoded, &bytes) || bytes.empty() || bytes.size() > kMaxPcmIpcBytes || (bytes.size() & 1) != 0) {
          emit_error("invalid_pcm"); continue;
        }
        application_->on_uplink_pcm(reinterpret_cast<const int16_t*>(&bytes[0]), bytes.size() / 2);
        continue;
      }
      if (type == "playback.complete") {
        const std::string status = field_string(command, "status");
        application_->on_playback_complete(status != "failed");
        continue;
      }
      emit_error("invalid_runner_command");
    }
  }

  void poll_transport() {
    if (virtual_transport_open_) {
      poll_virtual_transport();
      return;
    }
    if (!transport_ || !transport_->open()) return;
    bool text = false; bool closed = false; std::vector<uint8_t> data; std::string close_reason; std::string error;
    if (!transport_->poll(&text, &data, &closed, &close_reason, &error)) {
      if (closed || !error.empty()) {
        const TransportCloseReason reason = close_reason == "credential invalid" ? TransportCloseReason::CredentialInvalid :
            (close_reason == "credential revoked" ? TransportCloseReason::CredentialRevoked : TransportCloseReason::Network);
        transport_.reset(); application_->on_transport_closed(reason);
      }
      return;
    }
    if (text) handle_transport_text(std::string(data.begin(), data.end()));
    else if (!data.empty()) application_->on_binary(&data[0], data.size());
  }

  void poll_virtual_transport() {
    const uint32_t now = now_ms();
    if (fault_ == TestFaultScenario::WebSocketClose &&
        virtual_close_at_ms_ != 0 &&
        static_cast<int32_t>(now - virtual_close_at_ms_) >= 0) {
      virtual_transport_open_ = false;
      runtime_notice_ = "WebSocket disconnected";
      application_->on_transport_closed(TransportCloseReason::Network);
      return;
    }
    if (static_cast<int32_t>(now - virtual_next_event_at_ms_) < 0) return;
    if (fault_ == TestFaultScenario::InvalidJson && !virtual_json_sent_) {
      virtual_json_sent_ = true;
      handle_transport_text("{invalid-json");
      return;
    }
    if (fault_ != TestFaultScenario::NvsSaveFailure) return;
    if (!virtual_pair_code_sent_) {
      virtual_pair_code_sent_ = true;
      handle_transport_text(
          "{\"schema_version\":2,\"type\":\"pairing.code\",\"pairing_session_id\":\"test-session-0001\",\"code\":\"AB12CD\",\"expires_at_ms\":4294967295}");
    }
    if (!virtual_credentials_sent_) {
      virtual_credentials_sent_ = true;
      handle_transport_text(
          "{\"schema_version\":2,\"type\":\"pairing.credentials\",\"terminal_id\":\"test-terminal\",\"terminal_token\":\"tttttttttttttttttttttttttttttttt\",\"terminal_token_version\":1}");
    }
  }

  void handle_transport_text(const std::string& raw) {
    InboundMessage message;
    if (!fields::terminal::arduino_json::decode_inbound(
            reinterpret_cast<const uint8_t*>(raw.data()), raw.size(), &message)) {
      emit_error("invalid_runtime_message");
      return;
    }
    application_->on_message(message);
  }
};

}  // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--help") {
    std::cout << "Fields StickS3 C++11 PC terminal runner" << std::endl;
    return 0;
  }
  Runner runner;
  return runner.run();
}
