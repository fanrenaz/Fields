import assert from "node:assert/strict";
import test from "node:test";

import { registrationCodeFromWebUrl } from "../../../../data/auth/registration-runtime";

test("registration links accept exactly one well-formed code", () => {
  assert.equal(
    registrationCodeFromWebUrl("https://app.fields.example/?registration=abcdefghijklmnop"),
    "abcdefghijklmnop",
  );
  assert.equal(
    registrationCodeFromWebUrl("https://app.fields.example/?registration=abc_def-012345678"),
    "abc_def-012345678",
  );
});

test("registration links reject ambiguous or malformed codes", () => {
  assert.equal(registrationCodeFromWebUrl("not a url"), null);
  assert.equal(registrationCodeFromWebUrl("https://app.fields.example/"), null);
  assert.equal(
    registrationCodeFromWebUrl("https://app.fields.example/?registration=short"),
    null,
  );
  assert.equal(
    registrationCodeFromWebUrl("https://app.fields.example/?registration=abcdefghijklmnop&registration=qrstuvwxyzABCDEF"),
    null,
  );
  assert.equal(
    registrationCodeFromWebUrl("https://app.fields.example/?registration=abcdefghijklmn%2B%2F"),
    null,
  );
});
