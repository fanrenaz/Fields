import assert from "node:assert/strict";
import test from "node:test";

import { messageFromError, UiMessageError } from "../../../../shared/i18n/message";

test("maps public product error codes to localized message keys", () => {
  assert.deepEqual(
    messageFromError(new Error("MEMBER_EXECUTOR_SWITCH_IN_PROGRESS"), "common.unexpectedError"),
    { key: "productErrors.MEMBER_EXECUTOR_SWITCH_IN_PROGRESS" },
  );
  assert.deepEqual(
    messageFromError(new Error("TRIGGER_POLICY_VERSION_CONFLICT"), "common.unexpectedError"),
    { key: "productErrors.TRIGGER_POLICY_VERSION_CONFLICT" },
  );
  assert.deepEqual(
    messageFromError(new Error("AGENT_NOT_READY_FOR_ROOM"), "room.memberAddFailed"),
    { key: "productErrors.AGENT_NOT_READY_FOR_ROOM" },
  );
  assert.deepEqual(
    messageFromError(new Error("MESSAGE_REPLY_TARGET_INVALID"), "common.unexpectedError"),
    { key: "productErrors.MESSAGE_REPLY_TARGET_INVALID" },
  );
});

test("does not render unknown or provider error text", () => {
  assert.deepEqual(
    messageFromError(new Error("raw provider failure"), "common.unexpectedError"),
    { key: "common.unexpectedError" },
  );
});

test("preserves explicit desktop message descriptors", () => {
  assert.deepEqual(
    messageFromError(new UiMessageError("auth.loginFailed"), "common.unexpectedError"),
    { key: "auth.loginFailed" },
  );
});
