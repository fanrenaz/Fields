/** Embodiment Runtime speech boundary. No provider payload is returned outside Runtime. */
export interface SpeechProvider {
  synthesize(text: string): Promise<Uint8Array>;
  transcribe(pcm16le: Uint8Array): Promise<string | null>;
}

/** Minimal DashScope adapter for the published Qwen TTS/ASR endpoints. */
export class QwenSpeechProvider implements SpeechProvider {
  constructor(
    private readonly apiKey = process.env.DASHSCOPE_API_KEY,
    private readonly baseUrl = (process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/api/v1").replace(/\/$/u, ""),
    private readonly ttsModel = process.env.QWEN_TTS_MODEL ?? "qwen3-tts-flash",
    private readonly sttModel = process.env.QWEN_STT_MODEL ?? "qwen3-asr-flash",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(text: string): Promise<Uint8Array> {
    const payload = await this.request({ model: this.ttsModel, input: { text, voice: process.env.QWEN_TTS_VOICE ?? "Cherry", language_type: process.env.QWEN_TTS_LANGUAGE ?? "Auto" } });
    const audio = object(object(payload.output).audio);
    if (typeof audio.data === "string" && audio.data.length > 0) return requirePcm(new Uint8Array(Buffer.from(audio.data.replace(/^data:[^,]*,/u, ""), "base64")));
    if (typeof audio.url === "string" && audio.url.length > 0) {
      const response = await this.fetchImpl(audio.url);
      if (!response.ok) throw new Error("Qwen TTS audio download failed.");
      return requirePcm(new Uint8Array(await response.arrayBuffer()));
    }
    throw new Error("Qwen TTS response has no audio.");
  }

  async transcribe(pcm16le: Uint8Array): Promise<string | null> {
    const data = `data:audio/wav;base64,${Buffer.from(pcmToWav(pcm16le)).toString("base64")}`;
    const payload = await this.request({ model: this.sttModel, input: { messages: [{ role: "user", content: [{ audio: data }] }] }, parameters: { asr_options: { enable_itn: false } } });
    const output = object(payload.output);
    const choices = Array.isArray(output.choices) ? output.choices : [];
    const choice = object(choices[0]);
    const message = object(choice.message);
    const content = Array.isArray(message.content) ? message.content : [];
    const recognized = object(content[0]);
    const sentence = object(object(output.output).sentence);
    const text = recognized.text ?? sentence.text ?? object(output.output).text ?? output.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  }

  private async request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.apiKey) throw new Error("DASHSCOPE_API_KEY is required for Qwen speech.");
    const response = await this.fetchImpl(`${this.baseUrl}/services/aigc/multimodal-generation/generation`, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as unknown;
    if (!response.ok) throw new Error("Qwen speech request failed.");
    return object(payload);
  }
}

export function createSpeechProvider(
  kind = process.env.FIELDS_EMBODIMENT_SPEECH_PROVIDER ?? "qwen",
  apiKey = process.env.DASHSCOPE_API_KEY,
): SpeechProvider {
  if (kind !== "qwen") throw new Error('FIELDS_EMBODIMENT_SPEECH_PROVIDER must be "qwen". Embodiment has no fake speech fallback.');
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required for Embodiment speech.");
  return new QwenSpeechProvider(apiKey);
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const TERMINAL_SAMPLE_RATE_HZ = 16_000;
const QWEN_SAMPLE_RATE_HZ = 24_000;
const RESAMPLER_HALF_TAPS = 31;

function normalizeAudio(bytes: Uint8Array): Uint8Array {
  const wav = parsePcmWav(bytes);
  if (wav.sampleRateHz === TERMINAL_SAMPLE_RATE_HZ) return wav.pcm;
  if (wav.sampleRateHz === QWEN_SAMPLE_RATE_HZ) return resample24kTo16k(wav.pcm);
  throw new Error(`Unsupported Qwen TTS WAV sample rate: ${wav.sampleRateHz} Hz.`);
}

function parsePcmWav(bytes: Uint8Array): { sampleRateHz: number; pcm: Uint8Array } {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("Qwen TTS audio must be a PCM WAV file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRateHz: number; byteRate: number; blockAlign: number; bitsPerSample: number } | null = null;
  let pcm: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkLength;
    if (dataEnd > bytes.byteLength) throw new Error("Qwen TTS WAV chunk is truncated.");
    if (chunkId === "fmt ") {
      if (chunkLength < 16) throw new Error("Qwen TTS WAV format chunk is invalid.");
      format = {
        audioFormat: view.getUint16(dataOffset, true),
        channels: view.getUint16(dataOffset + 2, true),
        sampleRateHz: view.getUint32(dataOffset + 4, true),
        byteRate: view.getUint32(dataOffset + 8, true),
        blockAlign: view.getUint16(dataOffset + 12, true),
        bitsPerSample: view.getUint16(dataOffset + 14, true),
      };
    } else if (chunkId === "data" && pcm === null) {
      pcm = bytes.slice(dataOffset, dataEnd);
    }
    offset = dataEnd + (chunkLength % 2);
  }
  if (!format || !pcm) throw new Error("Qwen TTS WAV must contain fmt and data chunks.");
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error("Qwen TTS WAV must be mono 16-bit PCM.");
  }
  if (format.blockAlign !== 2 || format.byteRate !== format.sampleRateHz * format.blockAlign || pcm.byteLength % format.blockAlign !== 0) {
    throw new Error("Qwen TTS WAV PCM layout is invalid.");
  }
  return { sampleRateHz: format.sampleRateHz, pcm };
}

function resample24kTo16k(pcm: Uint8Array): Uint8Array {
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const outputSamples = Math.floor(((input.length - 1) * TERMINAL_SAMPLE_RATE_HZ) / QWEN_SAMPLE_RATE_HZ) + 1;
  const output = new Uint8Array(outputSamples * 2);
  const outputView = new DataView(output.buffer);
  const cutoff = TERMINAL_SAMPLE_RATE_HZ / (2 * QWEN_SAMPLE_RATE_HZ);
  for (let outputIndex = 0; outputIndex < outputSamples; outputIndex += 1) {
    const center = (outputIndex * QWEN_SAMPLE_RATE_HZ) / TERMINAL_SAMPLE_RATE_HZ;
    let weightedSum = 0;
    let totalWeight = 0;
    for (let inputIndex = Math.ceil(center - RESAMPLER_HALF_TAPS); inputIndex <= Math.floor(center + RESAMPLER_HALF_TAPS); inputIndex += 1) {
      if (inputIndex < 0 || inputIndex >= input.length) continue;
      const distance = inputIndex - center;
      const normalizedDistance = distance / RESAMPLER_HALF_TAPS;
      const blackman = 0.42 + 0.5 * Math.cos(Math.PI * normalizedDistance) + 0.08 * Math.cos(2 * Math.PI * normalizedDistance);
      const sincArgument = 2 * cutoff * distance;
      const sinc = sincArgument === 0 ? 1 : Math.sin(Math.PI * sincArgument) / (Math.PI * sincArgument);
      const weight = 2 * cutoff * sinc * blackman;
      weightedSum += input[inputIndex]! * weight;
      totalWeight += weight;
    }
    const sample = totalWeight === 0 ? 0 : Math.max(-32_768, Math.min(32_767, Math.round(weightedSum / totalWeight)));
    outputView.setInt16(outputIndex * 2, sample, true);
  }
  return output;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString("ascii");
}
function requirePcm(bytes: Uint8Array): Uint8Array {
  const pcm = normalizeAudio(bytes);
  if (pcm.byteLength === 0) throw new Error("Qwen TTS response has empty audio.");
  return pcm;
}
function pcmToWav(pcm: Uint8Array): Uint8Array {
  if (pcm.byteLength % 2 !== 0) throw new Error("PCM must contain an even number of bytes.");
  const output = new Uint8Array(44 + pcm.byteLength); const view = new DataView(output.buffer); const write = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) output[offset + index] = text.charCodeAt(index); };
  write(0, "RIFF"); view.setUint32(4, 36 + pcm.byteLength, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, pcm.byteLength, true); output.set(pcm, 44); return output;
}
