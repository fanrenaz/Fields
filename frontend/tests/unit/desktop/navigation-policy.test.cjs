const assert = require("node:assert/strict");
const test = require("node:test");

const { PRODUCTION_ORIGIN, navigationAction } = require("../../../desktop/navigation-policy.cjs");

test("allows only the production origin in the Electron window", () => {
  assert.equal(navigationAction(`${PRODUCTION_ORIGIN}/`), "allow-in-app");
  assert.equal(navigationAction(`${PRODUCTION_ORIGIN}/room/team-a?tab=activity`), "allow-in-app");
  assert.equal(navigationAction("https://www.fields.example.com/"), "open-external");
  assert.equal(navigationAction("https://example.com/"), "open-external");
});

test("opens only exact immutable desktop installers in the system browser", () => {
  assert.equal(
    navigationAction(`${PRODUCTION_ORIGIN}/desktop/releases/1.2.3/Fields-1.2.3-Setup.exe`),
    "open-external",
  );
  assert.equal(
    navigationAction(`${PRODUCTION_ORIGIN}/desktop/releases/1.2.3/Fields-1.2.4-Setup.exe`),
    "allow-in-app",
  );
  assert.equal(
    navigationAction(`${PRODUCTION_ORIGIN}/desktop/releases/1.2.3/Fields-1.2.3-Setup.exe?source=desktop`),
    "allow-in-app",
  );
  assert.equal(
    navigationAction(`${PRODUCTION_ORIGIN}/desktop/download/FieldsSetup.exe`),
    "allow-in-app",
  );
});

test("denies malformed and non-HTTPS navigation targets", () => {
  assert.equal(navigationAction("http://fields.example.com/"), "deny");
  assert.equal(navigationAction("mailto:hello@fields.example.com"), "deny");
  assert.equal(navigationAction("javascript:alert('unsafe')"), "deny");
  assert.equal(navigationAction("not a URL"), "deny");
});
