import assert from "node:assert/strict";
import test from "node:test";

import { TRPCError } from "@trpc/server";

import { ApplicationError } from "../../src/application/platform/errors.js";
import { publicError } from "../../src/interface/trpc/core.js";

const cases = [
  ["ROOM_MESSAGE_ACCESS_DENIED", false, "FORBIDDEN"],
  ["ROOM_MESSAGE_NOT_FOUND", false, "NOT_FOUND"],
  ["MEMBER_EXECUTOR_SWITCH_CONFLICT", false, "CONFLICT"],
  ["ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE", true, "SERVICE_UNAVAILABLE"],
] as const;

test("public tRPC boundary maps product failures without exposing internal causes", () => {
  for (const [code, retryable, expected] of cases) {
    assert.throws(
      () => publicError(new ApplicationError(code, retryable)),
      (error) => (
        error instanceof TRPCError
        && error.code === expected
        && error.message === code
        && error.cause === undefined
      ),
    );
  }
  const raw = new Error("postgres password=secret provider response");
  assert.throws(
    () => publicError(raw),
    (error) => (
      error instanceof TRPCError
      && error.code === "INTERNAL_SERVER_ERROR"
      && error.message === "The request could not be completed."
      && !JSON.stringify(error).includes("secret")
    ),
  );
  assert.throws(
    () => publicError(new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: new ApplicationError("MEMBER_EXECUTOR_NOT_FOUND", false),
    })),
    (error) => (
      error instanceof TRPCError
      && error.code === "NOT_FOUND"
      && error.message === "MEMBER_EXECUTOR_NOT_FOUND"
      && error.cause === undefined
    ),
  );
});
