import assert from "node:assert/strict";
import test from "node:test";

import {
  handleBetterAuthHttpRoute,
} from "../../../../src/interface/http/better-auth-route.js";

test("raw Better Auth list-invitations remains hidden behind a 404", async () => {
  let dispatchCalls = 0;
  const response = new RecordingReply();
  await handleBetterAuthHttpRoute({
    async dispatch() {
      dispatchCalls += 1;
      return {
        statusCode: 200,
        headers: [],
        setCookie: [],
        body: "sensitive invitation list",
      };
    },
  }, "http://127.0.0.1:4102", {
    method: "GET",
    url: "/api/auth/organization/list-invitations",
    headers: {},
    body: undefined,
  } as never, response as never);

  assert.equal(dispatchCalls, 0);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    code: "NOT_FOUND",
    message: "Not found.",
  });
});

class RecordingReply {
  statusCode = 200;
  body: unknown;

  code(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  send(body: unknown) {
    this.body = body;
    return body;
  }

  header() {
    return this;
  }
}
