import assert from "node:assert/strict";
import test from "node:test";

import { isPhoneClient } from "../../../../shared/platform/device-class";

test("phone routing matches the landing page UA predicate without depending on viewport", () => {
  assert.equal(isPhoneClient({ desktopBridge: false, mobileHint: true, userAgent: "Desktop" }), true);
  assert.equal(isPhoneClient({ desktopBridge: true, mobileHint: true, userAgent: "iPhone" }), false);
  assert.equal(isPhoneClient({ desktopBridge: false, mobileHint: false, userAgent: "iPhone" }), false);
  assert.equal(isPhoneClient({ desktopBridge: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }), true);
  assert.equal(isPhoneClient({ desktopBridge: false, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), false);
});
