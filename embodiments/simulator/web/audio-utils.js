export class Pcm16Resampler {
  constructor(inputRate, outputRate = 16000) {
    if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) {
      throw new Error("sample rates must be positive numbers");
    }
    this.ratio = inputRate / outputRate;
    this.pending = new Float32Array();
    this.position = 0;
  }

  push(input) {
    if (!(input instanceof Float32Array)) throw new Error("audio input must be Float32Array");
    if (input.length === 0) return new Float32Array();
    const joined = new Float32Array(this.pending.length + input.length);
    joined.set(this.pending);
    joined.set(input, this.pending.length);
    const output = [];
    while (this.position < joined.length - 1) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      output.push(joined[left] + (joined[left + 1] - joined[left]) * fraction);
      this.position += this.ratio;
    }
    const consumed = Math.min(Math.floor(this.position), joined.length - 1);
    this.pending = joined.slice(consumed);
    this.position -= consumed;
    return Float32Array.from(output);
  }

  flush() {
    if (this.pending.length === 0) return new Float32Array();
    const sample = this.pending[Math.min(Math.floor(this.position), this.pending.length - 1)];
    this.pending = new Float32Array();
    this.position = 0;
    return Float32Array.of(sample);
  }

  reset() {
    this.pending = new Float32Array();
    this.position = 0;
  }
}

export function floatToPcm16(input) {
  if (!(input instanceof Float32Array)) throw new Error("audio input must be Float32Array");
  const output = new Uint8Array(input.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < input.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, input[index]));
    const value = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(index * 2, value, true);
  }
  return output;
}
