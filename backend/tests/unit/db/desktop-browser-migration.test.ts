import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(import.meta.dirname, "../../../drizzle/0028_desktop_browser.sql"), "utf8");

test("Desktop browser is independently persisted and defaults on", () => {
  assert.match(migration, /desktop_browser_enabled[^;]*default true not null/iu);
  assert.match(migration, /desktop_browser_updated_at_ms/iu);
  assert.doesNotMatch(migration, /company_proxy/iu);
});
