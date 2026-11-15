import assert from "node:assert/strict";
import test from "node:test";

import { QwenSpeechProvider, createSpeechProvider } from "../../../../../src/infrastructure/speech/embodiment/speech-adapter.js";

test("Embodiment speech factory permits only the real Qwen provider", () => {
  const provider = createSpeechProvider("qwen", "test-api-key");

  assert.ok(provider instanceof QwenSpeechProvider);
  assert.throws(
    () => createSpeechProvider("fake", "test-api-key"),
    /no fake speech fallback/u,
  );
});

test("Embodiment speech factory fails fast without a DashScope credential", () => {
  assert.throws(
    () => createSpeechProvider("qwen", ""),
    /DASHSCOPE_API_KEY is required/u,
  );
});

test("Qwen speech provider parses real TTS and ASR response shapes", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const provider = new QwenSpeechProvider(
    "test-api-key",
    "https://speech.example/api/v1",
    "qwen3-tts-flash",
    "qwen3-asr-flash",
    async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      if (request.model === "qwen3-tts-flash") {
        return new Response(JSON.stringify({ output: { audio: { data: Buffer.from(wav({ pcm: new Uint8Array([0, 1]) })).toString("base64") } } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        output: {
          choices: [{ message: { content: [{ text: "真实转写" }] } }],
        },
      }), { status: 200 });
    },
  );

  assert.deepEqual(await provider.synthesize("请说话"), new Uint8Array([0, 1]));
  assert.equal(await provider.transcribe(new Uint8Array([0, 0])), "真实转写");
  assert.equal(requests[0]?.model, "qwen3-tts-flash");
  assert.equal(requests[1]?.model, "qwen3-asr-flash");
});

test("Qwen speech provider rejects an empty TTS audio response", async () => {
  const provider = new QwenSpeechProvider(
    "test-api-key",
    "https://speech.example/api/v1",
    "qwen3-tts-flash",
    "qwen3-asr-flash",
    async () => new Response(JSON.stringify({ output: { audio: { data: "" } } }), { status: 200 }),
  );

  await assert.rejects(() => provider.synthesize("请说话"), /no audio/u);
});

test("Qwen speech provider downloads a non-streaming TTS audio URL when data is empty", async () => {
  const provider = new QwenSpeechProvider(
    "test-api-key",
    "https://speech.example/api/v1",
    "qwen3-tts-flash",
    "qwen3-asr-flash",
    async (input) => {
      if (String(input) === "https://speech.example/audio.wav") return new Response(wav({ pcm: new Uint8Array([0, 1]) }));
      return new Response(JSON.stringify({ output: { audio: { data: "", url: "https://speech.example/audio.wav" } } }), { status: 200 });
    },
  );

  assert.deepEqual(await provider.synthesize("请说话"), new Uint8Array([0, 1]));
});

test("Qwen speech provider parses RIFF chunks and resamples Qwen 24 kHz WAV to terminal 16 kHz", async () => {
  const source = pcm16([-12_000, -8_000, -4_000, 0, 4_000, 8_000, 12_000, 8_000, 4_000, 0, -4_000, -8_000]);
  const provider = ttsProvider(wav({ sampleRateHz: 24_000, pcm: source, chunks: [{ id: "JUNK", data: new Uint8Array([1, 2, 3]) }] }));

  const pcm = await provider.synthesize("请说话");

  assert.equal(pcm.byteLength, 16);
  assert.ok(pcm16Values(pcm).some((sample) => sample !== 0));
});

test("Qwen speech provider rejects audio without trustworthy terminal PCM metadata", async () => {
  const rawProvider = new QwenSpeechProvider(
    "test-api-key",
    "https://speech.example/api/v1",
    "qwen3-tts-flash",
    "qwen3-asr-flash",
    async () => new Response(JSON.stringify({ output: { audio: { data: "AAE=" } } }), { status: 200 }),
  );

  await assert.rejects(() => rawProvider.synthesize("请说话"), /PCM WAV/u);
  await assert.rejects(() => ttsProvider(wav({ sampleRateHz: 48_000, pcm: pcm16([0, 1]) })).synthesize("请说话"), /Unsupported.*sample rate/u);
  await assert.rejects(() => ttsProvider(wav({ channels: 2, pcm: new Uint8Array([0, 0, 0, 0]) })).synthesize("请说话"), /mono 16-bit PCM/u);
});

function ttsProvider(audio: Uint8Array): QwenSpeechProvider {
  return new QwenSpeechProvider(
    "test-api-key",
    "https://speech.example/api/v1",
    "qwen3-tts-flash",
    "qwen3-asr-flash",
    async (input) => {
      if (String(input) === "https://speech.example/audio.wav") return new Response(audio);
      return new Response(JSON.stringify({ output: { audio: { data: "", url: "https://speech.example/audio.wav" } } }), { status: 200 });
    },
  );
}

function wav({ sampleRateHz = 16_000, pcm, channels = 1, chunks = [] }: { sampleRateHz?: number; pcm: Uint8Array; channels?: number; chunks?: Array<{ id: string; data: Uint8Array }> }): Uint8Array {
  const format = new Uint8Array(16);
  const formatView = new DataView(format.buffer);
  formatView.setUint16(0, 1, true);
  formatView.setUint16(2, channels, true);
  formatView.setUint32(4, sampleRateHz, true);
  formatView.setUint32(8, sampleRateHz * channels * 2, true);
  formatView.setUint16(12, channels * 2, true);
  formatView.setUint16(14, 16, true);
  const wavChunks = [chunk("fmt ", format), ...chunks.map(({ id, data }) => chunk(id, data)), chunk("data", pcm)];
  const output = new Uint8Array(12 + wavChunks.reduce((total, current) => total + current.byteLength, 0));
  writeAscii(output, 0, "RIFF");
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);
  writeAscii(output, 8, "WAVE");
  let offset = 12;
  for (const current of wavChunks) { output.set(current, offset); offset += current.byteLength; }
  return output;
}

function chunk(id: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + data.byteLength + (data.byteLength % 2));
  writeAscii(output, 0, id);
  new DataView(output.buffer).setUint32(4, data.byteLength, true);
  output.set(data, 8);
  return output;
}

function pcm16(samples: readonly number[]): Uint8Array {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return output;
}

function pcm16Values(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true));
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
}
