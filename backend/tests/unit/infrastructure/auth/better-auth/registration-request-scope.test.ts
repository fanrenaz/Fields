import assert from "node:assert/strict";
import test from "node:test";

import {
  bindRegistrationGrant,
  currentRegistrationGrant,
  runInRegistrationRequestScope,
} from "../../../../../src/infrastructure/auth/better-auth/registration-request-scope.js";

test("registration grants are unavailable outside a request scope", () => {
  assert.equal(currentRegistrationGrant(), null);
  assert.throws(
    () => bindRegistrationGrant("registration_grant_outside_scope"),
    /scope is unavailable/u,
  );
});

test("registration request scopes bind and clear their grant", async () => {
  assert.equal(currentRegistrationGrant(), null);

  await runInRegistrationRequestScope(async () => {
    assert.equal(currentRegistrationGrant(), null);
    bindRegistrationGrant("registration_grant_bound");
    await Promise.resolve();
    assert.equal(currentRegistrationGrant(), "registration_grant_bound");
  });

  assert.equal(currentRegistrationGrant(), null);
});

test("concurrent registration request scopes remain isolated", async () => {
  const observations = await Promise.all([
    runInRegistrationRequestScope(async () => {
      bindRegistrationGrant("registration_grant_first");
      await new Promise((resolve) => setImmediate(resolve));
      return currentRegistrationGrant();
    }),
    runInRegistrationRequestScope(async () => {
      bindRegistrationGrant("registration_grant_second");
      await Promise.resolve();
      return currentRegistrationGrant();
    }),
  ]);

  assert.deepEqual(observations, [
    "registration_grant_first",
    "registration_grant_second",
  ]);
});
