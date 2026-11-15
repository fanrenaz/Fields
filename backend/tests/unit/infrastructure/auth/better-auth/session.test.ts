import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthCredentialError,
  betterAuthHeadersFromWebSocket,
  traceparentFromConnectionParams,
} from "../../../../../src/infrastructure/auth/better-auth/session.js";

const webOrigin = "http://127.0.0.1:3102";
const sessionCookie = "better-auth.session_token=signed-token";

test("web WebSockets require an explicitly trusted Origin and handshake Cookie", () => {
  const headers = betterAuthHeadersFromWebSocket(
    { origin: webOrigin, cookie: sessionCookie },
    undefined,
    [webOrigin],
  );
  assert.equal(headers.get("cookie"), sessionCookie);

  assert.throws(
    () => betterAuthHeadersFromWebSocket({ cookie: sessionCookie }, undefined, [webOrigin]),
    AuthCredentialError,
  );
  assert.throws(
    () => betterAuthHeadersFromWebSocket(
      { origin: "https://attacker.example", cookie: sessionCookie },
      undefined,
      [webOrigin],
    ),
    AuthCredentialError,
  );
});

test("WebSocket connection parameters cannot carry authentication credentials", () => {
  assert.throws(
    () => betterAuthHeadersFromWebSocket(
      { origin: webOrigin, cookie: sessionCookie },
      { cookie: sessionCookie },
      [webOrigin],
    ),
    AuthCredentialError,
  );
  assert.throws(
    () => betterAuthHeadersFromWebSocket(
      { origin: webOrigin },
      { extra: true },
      [webOrigin],
    ),
    AuthCredentialError,
  );
});

test("legacy Actor and Company connection parameters are always rejected", () => {
  assert.throws(
    () => betterAuthHeadersFromWebSocket(
      { origin: webOrigin },
      { actor_id: "actor_forged", company_id: "company_forged" },
      [webOrigin],
    ),
    AuthCredentialError,
  );
});

test("WebSocket accepts only a valid W3C traceparent as propagation metadata", () => {
  const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
  const headers = betterAuthHeadersFromWebSocket(
    { origin: webOrigin, cookie: sessionCookie },
    { traceparent },
    [webOrigin],
  );

  assert.equal(headers.get("cookie"), sessionCookie);
  assert.equal(traceparentFromConnectionParams({ traceparent }), traceparent);
  assert.throws(
    () => betterAuthHeadersFromWebSocket(
      { origin: webOrigin, cookie: sessionCookie },
      { traceparent: "not-a-traceparent" },
      [webOrigin],
    ),
    AuthCredentialError,
  );
});
