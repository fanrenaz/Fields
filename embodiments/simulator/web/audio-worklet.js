import { Pcm16Resampler, floatToPcm16 } from "./audio-utils.js";

class StickS3CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.levelTick = 0;
    this.resampler = new Pcm16Resampler(sampleRate, 16000);
    this.port.onmessage = (event) => {
      if (event.data?.type === "start") {
        this.resampler.reset();
        this.recording = true;
      } else if (event.data?.type === "stop") {
        const tail = floatToPcm16(this.resampler.flush());
        if (tail.byteLength > 0) this.port.postMessage({ type: "pcm", buffer: tail.buffer }, [tail.buffer]);
        this.recording = false;
        this.port.postMessage({ type: "stopped" });
      } else if (event.data?.type === "stop.local") {
        this.recording = false;
        this.resampler.reset();
      }
    };
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    if (this.levelTick++ % 4 === 0) {
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      this.port.postMessage({ type: "level", value: peak });
    }
    if (this.recording) {
      const pcm = floatToPcm16(this.resampler.push(samples));
      if (pcm.byteLength > 0) this.port.postMessage({ type: "pcm", buffer: pcm.buffer }, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("sticks3-capture", StickS3CaptureProcessor);
