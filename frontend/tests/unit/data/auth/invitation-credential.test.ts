import assert from "node:assert/strict";
import test from "node:test";

import { buildInvitationLink, invitationIdFromUrl } from "../../../../data/auth/invitation-credential";

test("web invitation credentials round-trip only through the fragment", () => {
  const link = buildInvitationLink("opaque/id+value", "https://fields.example/");

  assert.equal(link, "https://fields.example/#invitation=opaque%2Fid%2Bvalue");
  assert.equal(invitationIdFromUrl(link), "opaque/id+value");
  assert.equal(invitationIdFromUrl("https://fields.example/?invitation=secret"), null);
});

test("invitation parsing rejects duplicates, whitespace, and empty values", () => {
  assert.equal(invitationIdFromUrl("https://fields.example/#invitation="), null);
  assert.equal(invitationIdFromUrl("https://fields.example/#invitation=a&invitation=b"), null);
  assert.equal(invitationIdFromUrl("https://fields.example/#invitation=has%20space"), null);
});
