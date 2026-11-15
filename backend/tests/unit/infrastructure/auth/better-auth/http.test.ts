import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  createFieldsAuth,
  type FieldsAuth,
} from "../../../../../src/infrastructure/auth/better-auth/fields-auth.js";
import type {
  CommittedMembershipActorProjection,
  HumanInvitationAdmissionPolicyUseCase,
} from "../../../../../src/application/actor/index.js";
import { dispatchBetterAuthHttpRequest } from "../../../../../src/infrastructure/auth/better-auth/http.js";
import {
  bindInvitationRenewalExpectation,
  expectedInvitationRenewalCredential,
} from "../../../../../src/infrastructure/auth/better-auth/stable-invitation-renewal-adapter.js";

const invitationPolicy: HumanInvitationAdmissionPolicyUseCase = {
  async assertEmailSignUpAllowed() {},
  async previewInvitation() {
    return { company_name: "Fields" };
  },
  async assertInvitationCreationAllowed() {},
  async assertInvitationAcceptanceAllowed() {},
  async assertMappedOrganization() {},
};

const committedMembershipProjection: CommittedMembershipActorProjection = {
  async reconcileAcceptedMembership() {},
  async reconcileRemovedMembership() {},
};

test("Better Auth rethrows unknown router errors to the sanitized HTTP boundary", () => {
  const auth = createFieldsAuth({
    database: {} as never,
    secret: randomBytes(32).toString("base64url"),
    baseURL: "http://127.0.0.1:4102",
    trustedOrigins: ["http://127.0.0.1:3102"],
    invitationPolicy,
    registrationAdmission: {
      validateSignupCredential: async () => "registration_grant_test",
    },
    committedMembershipProjection,
  });

  assert.equal(auth.options.onAPIError?.throw, true);
  assert.equal(auth.options.logger?.disabled, true);
  assert.equal(auth.options.emailAndPassword?.minPasswordLength, 8);
  assert.equal(auth.options.emailAndPassword?.maxPasswordLength, 128);
});

test("the HTTP boundary drops an unknown auth error and all bearer-bearing causes", async () => {
  const invitationId = "invitation_bearer_must_not_escape";
  const auth = {
    handler: async () => {
      throw new Error(`Failed query params: ${invitationId}`, {
        cause: new Error(`adapter cause: ${invitationId}`),
      });
    },
  } as unknown as FieldsAuth;

  const response = await dispatchBetterAuthHttpRequest(auth, {
    method: "POST",
    url: "/api/auth/organization/accept-invitation",
    origin: "http://127.0.0.1:4102",
    headers: { "content-type": "application/json" },
    body: { invitationId },
  });
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(body.includes(invitationId), false);
  assert.deepEqual(JSON.parse(body), {
    code: "AUTHENTICATION_UNAVAILABLE",
    message: "Authentication is temporarily unavailable.",
  });
});

test("the HTTP boundary isolates invitation renewal expectations per request", async () => {
  const observed: Array<string | null> = [];
  const auth = {
    handler: async () => {
      observed.push(expectedInvitationRenewalCredential());
      bindInvitationRenewalExpectation("invitation-request-bound");
      observed.push(expectedInvitationRenewalCredential());
      return new Response(null, { status: 204 });
    },
  } as unknown as FieldsAuth;

  await dispatchBetterAuthHttpRequest(auth, {
    method: "POST",
    url: "/api/auth/organization/invite-member",
    origin: "http://127.0.0.1:4102",
    headers: { "content-type": "application/json" },
    body: { resend: true },
  });
  assert.equal(expectedInvitationRenewalCredential(), null);
  await dispatchBetterAuthHttpRequest(auth, {
    method: "POST",
    url: "/api/auth/organization/invite-member",
    origin: "http://127.0.0.1:4102",
    headers: { "content-type": "application/json" },
    body: { resend: true },
  });

  assert.deepEqual(observed, [
    null,
    "invitation-request-bound",
    null,
    "invitation-request-bound",
  ]);
});

test("concurrent HTTP requests retain distinct invitation renewal expectations", async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstBound = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondBound = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const observed = new Map<string, string | null>();
  const auth = {
    handler: async (request: Request) => {
      const credential = request.headers.get("x-fields-invitation-id")!;
      bindInvitationRenewalExpectation(credential);
      if (credential === "invitation-first") {
        releaseFirst();
        await secondBound;
      } else {
        releaseSecond();
        await firstBound;
      }
      observed.set(credential, expectedInvitationRenewalCredential());
      return new Response(null, { status: 204 });
    },
  } as unknown as FieldsAuth;
  const request = (credential: string) => dispatchBetterAuthHttpRequest(auth, {
    method: "POST",
    url: "/api/auth/organization/invite-member",
    origin: "http://127.0.0.1:4102",
    headers: {
      "content-type": "application/json",
      "x-fields-invitation-id": credential,
    },
    body: { resend: true },
  });

  await Promise.all([
    request("invitation-first"),
    request("invitation-second"),
  ]);

  assert.equal(observed.get("invitation-first"), "invitation-first");
  assert.equal(observed.get("invitation-second"), "invitation-second");
  assert.equal(expectedInvitationRenewalCredential(), null);
});
