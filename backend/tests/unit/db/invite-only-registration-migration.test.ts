import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(import.meta.dirname, "../../../drizzle/0029_invite_only_registration.sql"), "utf8");

test("invite-only registration persists one Company setting and hashed signup grants", () => {
  assert.match(migration, /create table "company_registration_settings"/iu);
  assert.match(migration, /"company_id" varchar\(128\) primary key/iu);
  assert.match(migration, /"code" varchar\(128\) not null/iu);
  assert.match(migration, /create table "registration_signup_grants"/iu);
  assert.match(migration, /"credential_hash" varchar\(128\) not null/iu);
  assert.match(migration, /"registration_grant_id" varchar\(128\)/iu);
  assert.match(migration, /user_registration_grant_id_unique/iu);
  assert.doesNotMatch(migration, /registration_signup_grants[^;]*\n[^;]*"code"/iu);
});
