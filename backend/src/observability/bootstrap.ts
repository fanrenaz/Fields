import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { SanitizingSpanProcessor } from "./sanitizing-span-processor.js";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

/** Loaded through node --import before any application dependency. */
if (endpoint && process.env.OTEL_SDK_DISABLED !== "true") {
  const sdk = new NodeSDK({
    spanProcessors: [new SanitizingSpanProcessor()],
    instrumentations: [getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
    })],
  });
  sdk.start();
  const shutdown = () => { void sdk.shutdown(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
