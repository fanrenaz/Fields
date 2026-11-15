const PC_BINARY_FRAME = 0x01;
const PC_BINARY_DOWNLINK_PCM = 0x02;
const FRAME_HEADER_BYTES = 20;
const FRAME_FORMAT_RGB565LE = 1;
const FRAME_FORMAT_RGBA8888 = 2;
const FRAME_MAX_WIDTH = 320;
const FRAME_MAX_HEIGHT = 320;

const nonce = document.querySelector('meta[name="pc-session-nonce"]')?.content ?? "";
const basePath = document.querySelector('meta[name="pc-base-path"]')?.content ?? "/";
const browserBaseUrl = new URL(basePath, location.origin);
const controlUrl = new URL("pc/ws", browserBaseUrl);
controlUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
controlUrl.searchParams.set("nonce", nonce);

const socket = new WebSocket(controlUrl);
socket.binaryType = "arraybuffer";
const controlKeepalive = setInterval(() => send({ type: "keepalive" }), 20_000);

const screen = document.getElementById("device-screen");
const context = screen.getContext("2d", { alpha: false });
context.imageSmoothingEnabled = false;
const overlay = document.getElementById("activation-overlay");
const activateButton = document.getElementById("activate-button");
const activationError = document.getElementById("activation-error");
const accessibilityStatus = document.getElementById("accessibility-status");

let snapshot = null;
let audioContext = null;
let mediaStream = null;
let captureNode = null;
let recording = false;
let recordingStopping = false;
let pendingButton = null;
let downlink = null;
let ringtoneTimer = null;
let activeSource = null;

socket.addEventListener("open", () => setAccessibilityStatus("PC 终端控制已连接。"));
socket.addEventListener("close", (event) => {
  clearInterval(controlKeepalive);
  stopRingtone();
  stopCaptureLocal();
  showActivationError(event.reason === "controller_busy" ? "此终端正在被另一个页面控制。" : "PC 控制服务已断开。", true);
});
socket.addEventListener("error", () => showActivationError("无法连接 PC 控制服务。", true));
socket.addEventListener("message", (event) => {
  if (event.data instanceof ArrayBuffer) {
    handleBinary(new Uint8Array(event.data));
    return;
  }
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "snapshot") applySnapshot(message);
  else if (message.type === "downlink.start") downlink = { streamId: message.stream_id, chunks: [] };
  else if (message.type === "downlink.end") void playDownlink(message.stream_id);
  else if (message.type === "recording.limit") {
    stopCaptureLocal();
    setAccessibilityStatus("录音达到时长上限，设备正在提交回答。");
  } else if (message.type === "error") setAccessibilityStatus(message.message);
});

activateButton.addEventListener("click", async () => {
  activateButton.disabled = true;
  clearActivationError();
  try {
    await enableAudio();
    send({ type: "activate" });
    overlay.hidden = true;
    screen.focus();
  } catch (error) {
    activateButton.disabled = false;
    showActivationError(audioSetupError(error), false);
  }
});

screen.addEventListener("pointerup", (event) => {
  if (!audioContext || event.button !== 0) return;
  const bounds = screen.getBoundingClientRect();
  pressButton(event.clientX - bounds.left < bounds.width / 2 ? "button.a" : "button.b");
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "a") pressButton("button.a");
  else if (key === "b") pressButton("button.b");
});

function handleBinary(bytes) {
  if (bytes.byteLength < 1) return;
  if (bytes[0] === PC_BINARY_FRAME) drawFrame(bytes.subarray(1));
  else if (bytes[0] === PC_BINARY_DOWNLINK_PCM && downlink) downlink.chunks.push(bytes.slice(1));
}

function drawFrame(frame) {
  if (frame.byteLength < FRAME_HEADER_BYTES || frame[0] !== 0x53 || frame[1] !== 0x33 || frame[2] !== 0x46 || frame[3] !== 0x52 ||
      frame[4] !== 1 || new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(6, true) !== FRAME_HEADER_BYTES) return;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const format = frame[5];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const payloadBytes = view.getUint32(16, true);
  const bytesPerPixel = format === FRAME_FORMAT_RGB565LE ? 2 : format === FRAME_FORMAT_RGBA8888 ? 4 : 0;
  if (bytesPerPixel === 0 || width === 0 || height === 0 || width > FRAME_MAX_WIDTH || height > FRAME_MAX_HEIGHT ||
      payloadBytes !== width * height * bytesPerPixel || frame.byteLength !== FRAME_HEADER_BYTES + payloadBytes) return;
  if (screen.width !== width || screen.height !== height) {
    screen.width = width;
    screen.height = height;
    context.imageSmoothingEnabled = false;
  }
  const payload = frame.subarray(FRAME_HEADER_BYTES);
  const image = context.createImageData(width, height);
  if (format === FRAME_FORMAT_RGBA8888) {
    image.data.set(payload);
  } else {
    for (let pixel = 0, offset = 0; pixel < width * height; pixel += 1, offset += 2) {
      const rgb = payload[offset] | (payload[offset + 1] << 8);
      const output = pixel * 4;
      image.data[output] = ((rgb >>> 11) & 0x1f) * 255 / 31;
      image.data[output + 1] = ((rgb >>> 5) & 0x3f) * 255 / 63;
      image.data[output + 2] = (rgb & 0x1f) * 255 / 31;
      image.data[output + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

async function enableAudio() {
  if (!isAudioSecure()) throw new Error("麦克风需要 HTTPS。请使用 HTTPS 地址打开终端。");
  audioContext = new AudioContext({ latencyHint: "interactive" });
  await audioContext.audioWorklet.addModule(new URL("audio-worklet.js", browserBaseUrl));
  await audioContext.resume();
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const source = audioContext.createMediaStreamSource(mediaStream);
  captureNode = new AudioWorkletNode(audioContext, "sticks3-capture");
  const silence = audioContext.createGain();
  silence.gain.value = 0;
  source.connect(captureNode).connect(silence).connect(audioContext.destination);
  captureNode.port.onmessage = handleCaptureMessage;
}

function pressButton(button) {
  if (socket.readyState !== WebSocket.OPEN || !snapshot || recordingStopping) return;
  if (snapshot.terminal_state === "recording" && recording) {
    pendingButton = button;
    recordingStopping = true;
    captureNode?.port.postMessage({ type: "stop" });
    return;
  }
  send({ type: button });
}

function handleCaptureMessage(event) {
  if (event.data?.type === "pcm" && (recording || recordingStopping) && socket.readyState === WebSocket.OPEN) {
    socket.send(event.data.buffer);
  } else if (event.data?.type === "stopped") {
    recording = false;
    recordingStopping = false;
    const button = pendingButton;
    pendingButton = null;
    if (button) send({ type: button });
  }
}

function applySnapshot(next) {
  const wasRecording = recording;
  snapshot = next;
  if (next.terminal_state === "ringing") startRingtone(); else stopRingtone();
  if (next.terminal_state === "recording" && !recording && !recordingStopping) startCapture();
  if (next.terminal_state !== "recording" && (wasRecording || recordingStopping)) stopCaptureLocal();
  if (next.terminal_state === "ended" || next.terminal_state === "offline") cancelPlayback();
  setAccessibilityStatus(`设备状态：${next.terminal_state}。`);
}

function startCapture() {
  if (!captureNode) return;
  captureNode.port.postMessage({ type: "start" });
  recording = true;
  recordingStopping = false;
}

function stopCaptureLocal() {
  recording = false;
  recordingStopping = false;
  pendingButton = null;
  captureNode?.port.postMessage({ type: "stop.local" });
}

async function playDownlink(streamId) {
  const current = downlink;
  downlink = null;
  if (!current || current.streamId !== streamId || !audioContext) {
    send({ type: "playback.complete", stream_id: streamId, status: "failed" });
    return;
  }
  try {
    await audioContext.resume();
    const pcm = concatBytes(current.chunks);
    const samples = new Float32Array(pcm.byteLength / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(index * 2, true) / 0x8000;
    const buffer = audioContext.createBuffer(1, samples.length, 16_000);
    buffer.copyToChannel(samples, 0);
    activeSource = audioContext.createBufferSource();
    activeSource.buffer = buffer;
    activeSource.connect(audioContext.destination);
    activeSource.onended = () => {
      activeSource = null;
      send({ type: "playback.complete", stream_id: streamId, status: "played" });
    };
    activeSource.start();
  } catch {
    send({ type: "playback.complete", stream_id: streamId, status: "failed" });
  }
}

function cancelPlayback() {
  if (!activeSource) return;
  activeSource.onended = null;
  try { activeSource.stop(); } catch { /* already stopped */ }
  activeSource = null;
}

function startRingtone() {
  if (ringtoneTimer || !audioContext) return;
  const ring = () => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.28);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  };
  ring();
  ringtoneTimer = setInterval(ring, 1100);
}

function stopRingtone() {
  if (ringtoneTimer) clearInterval(ringtoneTimer);
  ringtoneTimer = null;
}

function send(message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function showActivationError(message, reopen) {
  if (reopen) overlay.hidden = false;
  activationError.hidden = false;
  activationError.textContent = message;
}

function clearActivationError() {
  activationError.hidden = true;
  activationError.textContent = "";
}

function setAccessibilityStatus(message) { accessibilityStatus.textContent = message; }

function concatBytes(chunks) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function isAudioSecure() {
  return window.isSecureContext || ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
}

function audioSetupError(error) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "麦克风权限被拒绝。请在浏览器站点设置中允许麦克风后重试。";
  if (error instanceof DOMException && error.name === "NotFoundError") return "未检测到可用麦克风。";
  if (error instanceof DOMException && error.name === "NotReadableError") return "麦克风正被其他程序占用。";
  return error instanceof Error ? error.message : String(error);
}

window.addEventListener("beforeunload", () => {
  mediaStream?.getTracks().forEach((track) => track.stop());
  socket.close(1000, "page_closed");
});
