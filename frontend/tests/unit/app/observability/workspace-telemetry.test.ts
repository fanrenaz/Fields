import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const telemetry = readFileSync(new URL("../../../../data/observability/workspace-telemetry.ts", import.meta.url), "utf8");
const boundary = readFileSync(new URL("../../../../app/session/AuthBoundary.tsx", import.meta.url), "utf8");

test("web telemetry is enabled only for an active ProductSession workspace and stopped on exit", () => {
  assert.match(boundary, /if \(view\.kind !== "workspace"\) \{\s+workspaceTelemetry\.stop\(\)/u);
  assert.match(boundary, /workspaceTelemetry\.start\(view\.session\)/u);
  assert.match(boundary, /return \(\) => workspaceTelemetry\.stop\(\)/u);
});

test("browser relay requests are excluded from fetch and XHR instrumentation", () => {
  assert.match(telemetry, /const RELAY_URL_PATTERN = .*observability/u);
  assert.match(telemetry, /ignoreUrls: \[RELAY_URL_PATTERN\]/u);
  assert.match(telemetry, /fieldsDesktop\?\.telemetry\.authenticated\(true\)/u);
  assert.match(telemetry, /fieldsDesktop\?\.telemetry\.authenticated\(false\)/u);
  assert.match(telemetry, /credentials: "include"/u);
  assert.doesNotMatch(telemetry, /OTEL_EXPORTER_OTLP_ENDPOINT/u);
});

test("browser telemetry emits only controlled route and event fields", () => {
  assert.match(telemetry, /name: event,/u);
  assert.match(telemetry, /error_class: errorClass\(span\.attributes\)/u);
  assert.match(telemetry, /route: controlledRoute\(span\.attributes\)/u);
  assert.match(telemetry, /"browser_extension"/u);
  assert.match(telemetry, /"first_party_script"/u);
  assert.match(telemetry, /"resource_load"/u);
  assert.match(telemetry, /"unhandled_promise"/u);
  assert.doesNotMatch(telemetry, /JSON\.stringify\(span\.attributes\)/u);
  assert.doesNotMatch(telemetry, /exception\.message/u);
  assert.doesNotMatch(telemetry, /event\.message/u);
  assert.doesNotMatch(telemetry, /event\.error\.(?:message|stack)/u);
});

test("web-vital observation uses supported entry types and filters paint to FCP", () => {
  assert.match(telemetry, /PerformanceObserver\.supportedEntryTypes/u);
  assert.match(telemetry, /"largest-contentful-paint", "paint", "layout-shift", "event"/u);
  assert.match(telemetry, /entry\.entryType === "paint" && entry\.name !== "first-contentful-paint"/u);
  assert.match(telemetry, /entry\.entryType === "paint" \|\| entry\.entryType === "largest-contentful-paint"\s+\? entry\.startTime/u);
  assert.doesNotMatch(telemetry, /\["largest-contentful-paint", "first-contentful-paint"/u);
});
