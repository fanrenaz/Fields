#include "terminal_view_model.h"

#include <algorithm>
#include <sstream>

namespace fields {
namespace terminal {
namespace ui {

RuntimeStatus::RuntimeStatus()
    : wifi_connected(false), tls_clock_ready(true), recording_elapsed_ms(0), audio_level(0) {}

ViewModel::ViewModel() : online(false), pairing(true), recording(false), audio_level(0), title("语音通话") {}

namespace {

const char* call_state_label(CallState state) {
  switch (state) {
    case CallState::Idle: return "空闲";
    case CallState::Ringing: return "来电";
    case CallState::ConnectedIdle: return "已接通";
    case CallState::Playing: return "播放中";
    case CallState::Waiting: return "等待说话";
    case CallState::Recording: return "录音中";
    case CallState::Ending: return "正在挂断";
  }
  return "未知";
}

const char* button_hint(CallState state) {
  switch (state) {
    case CallState::Ringing: return "按左键接听   按右键拒接";
    case CallState::Waiting: return "按左键说话   按右键挂断";
    case CallState::Recording: return "按左键停止   按右键挂断";
    case CallState::Playing: return "按右键挂断";
    case CallState::ConnectedIdle: return "按右键挂断";
    case CallState::Ending: return "请稍候";
    case CallState::Idle: return "等待来电";
  }
  return "";
}

}  // namespace

ViewModel make_view_model(const Snapshot& snapshot, const RuntimeStatus& runtime) {
  ViewModel view;
  view.online = snapshot.terminal_ready;
  view.pairing = snapshot.pairing_mode;
  view.recording = snapshot.call_state == CallState::Recording;
  view.audio_level = std::max(snapshot.audio_level, runtime.audio_level);
  view.state_label = call_state_label(snapshot.call_state);
  view.agent_label = snapshot.active_agent_label.empty() ? "智能体 Fields" : "智能体 " + snapshot.active_agent_label;
  view.notice = runtime.notice;

  if (!runtime.wifi_connected) {
    view.connection_label = "正在连接网络";
  } else if (!runtime.tls_clock_ready) {
    view.connection_label = "正在校准时间";
  } else if (snapshot.pairing_mode) {
    view.connection_label = snapshot.pairing_code.empty() ? "正在请求配对码" : "等待 Owner 认领";
  } else if (snapshot.terminal_ready) {
    view.connection_label = "服务在线";
  } else if (snapshot.transport_open || snapshot.connecting) {
    view.connection_label = "正在连接服务";
  } else {
    view.connection_label = "服务离线";
  }

  if (snapshot.pairing_mode) {
    view.detail_label = "在 Owner 控制台输入配对码";
    view.primary_label = snapshot.pairing_code.empty() ? "------" : snapshot.pairing_code;
  } else if (view.recording) {
    std::ostringstream elapsed;
    elapsed << "录音 " << std::min<uint32_t>(runtime.recording_elapsed_ms, kAudioMaxRecordingMs) / 1000
            << " / " << kAudioMaxRecordingMs / 1000 << " 秒";
    view.detail_label = elapsed.str();
    view.primary_label = button_hint(snapshot.call_state);
  } else if (snapshot.call_state == CallState::Playing) {
    view.detail_label = "正在播放语音";
    view.primary_label = button_hint(snapshot.call_state);
  } else {
    view.detail_label = "音频就绪";
    view.primary_label = button_hint(snapshot.call_state);
  }
  return view;
}

}  // namespace ui
}  // namespace terminal
}  // namespace fields
