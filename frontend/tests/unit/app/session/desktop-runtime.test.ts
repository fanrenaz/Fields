import assert from "node:assert/strict";
import test from "node:test";

import { desktopConnectionMessageKey, desktopRuntimeInfo, isDesktopConnectionFailure } from "../../../../app/session/desktop-runtime";

test("desktop runtime uses the packaged version and a stable development fallback", () => {
  assert.deepEqual(desktopRuntimeInfo(" 1.2.3 "), { version: "1.2.3" });
  assert.deepEqual(desktopRuntimeInfo(""), { version: "dev" });
  assert.deepEqual(desktopRuntimeInfo(undefined), { version: "dev" });
});

test("desktop connection copy distinguishes device offline from service failure", () => {
  assert.equal(desktopConnectionMessageKey(false), "auth.desktopOffline");
  assert.equal(desktopConnectionMessageKey(true), "auth.desktopBackendUnavailable");
});

test("desktop connection surface preserves explicit product and auth errors while online", () => {
  assert.equal(isDesktopConnectionFailure({ key: "auth.authenticationUnavailable" }, true), true);
  assert.equal(isDesktopConnectionFailure({ key: "auth.activeCompanyUnavailable" }, true), false);
  assert.equal(isDesktopConnectionFailure({ key: "auth.sessionUnavailable" }, true), false);
  assert.equal(isDesktopConnectionFailure({ key: "auth.logoutFailed" }, true), false);
  assert.equal(isDesktopConnectionFailure({ key: "auth.logoutFailed" }, false), true);
});
