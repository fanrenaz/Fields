#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { createEmbodimentRuntime } from "./index.js";
import { embodimentInternalControlTokenMatches } from "../../infrastructure/runtime/embodiment/internal-auth.js";
import { createSpeechProvider } from "../../infrastructure/speech/embodiment/speech-adapter.js";
import { emitObservabilityLog } from "../../observability/events.js";

export async function main(): Promise<number> {
  const controlTokenFile = process.env.FIELDS_INTERNAL_CONTROL_TOKEN_FILE ?? "";
  const runtime = createEmbodimentRuntime({
    controlTokenFile,
    internalAuthorization: {
      matches: (authorization) => embodimentInternalControlTokenMatches(authorization, controlTokenFile),
    },
    speech: createSpeechProvider(),
  });
  const serverClosed = new Promise<void>((resolve) => { runtime.app.server.once("close", resolve); });
  let started = false;
  let closeRequested = false;
  let closePromise: Promise<void> | null = null;
  const close = () => {
    closeRequested = true;
    if (!started) return;
    closePromise ??= runtime.stop();
    void closePromise.catch(() => undefined);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try {
    await runtime.start();
    started = true;
    if (closeRequested) close();
    await serverClosed;
    if (closePromise) await closePromise;
    return 0;
  } finally {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    emitObservabilityLog("embodiment.process.failed", { code: "embodiment_start_failed", retryable: false });
    process.stderr.write("embodiment start failed\n");
    process.exitCode = 1;
  });
}
