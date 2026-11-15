import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError, isApplicationError } from "../../../../src/application/platform/errors.js";

test("ApplicationError exposes only its stable code and retryability", () => {
  const error = new ApplicationError("DEPENDENCY_UNAVAILABLE", true);
  assert.equal(error.code, "DEPENDENCY_UNAVAILABLE");
  assert.equal(error.retryable, true);
  assert.equal(error.message, "DEPENDENCY_UNAVAILABLE");
  assert.equal(isApplicationError(error), true);
  assert.equal(isApplicationError(new Error("provider detail")), false);
});
