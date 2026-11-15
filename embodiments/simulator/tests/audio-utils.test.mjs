import assert from "node:assert/strict";
import test from "node:test";
import { Pcm16Resampler, floatToPcm16 } from "../web/audio-utils.js";

for (const inputRate of [48_000, 44_100, 16_000]) {
  test(`resampler converts ${inputRate} Hz input to 16 kHz`, () => {
    const durationSeconds = 0.1;
    const input = new Float32Array(Math.round(inputRate * durationSeconds));
    for (let index = 0; index < input.length; index += 1) input[index] = Math.sin(index / 13) * 0.5;
    const resampler = new Pcm16Resampler(inputRate, 16_000);
    const first = resampler.push(input.slice(0, Math.floor(input.length / 2)));
    const second = resampler.push(input.slice(Math.floor(input.length / 2)));
    const tail = resampler.flush();
    assert.ok(Math.abs(first.length + second.length + tail.length - 1_600) <= 1);
  });
}

test("floatToPcm16 preserves silence and clamps both extremes", () => {
  const pcm = floatToPcm16(Float32Array.from([-2, -1, 0, 1, 2]));
  const view = new DataView(pcm.buffer);
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => view.getInt16(index * 2, true)), [
    -32_768, -32_768, 0, 32_767, 32_767,
  ]);
});

