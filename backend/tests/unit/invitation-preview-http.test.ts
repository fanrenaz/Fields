import assert from "node:assert/strict";
import test from "node:test";

import {
  HumanInvitationAdmissionError,
  type HumanInvitationAdmissionPolicyUseCase,
} from "../../src/application/actor/index.js";
import type { BackendDatabase, BackendDatabaseService } from "../../src/infrastructure/persistence/postgres/database-service.js";
import { createApp } from "../../src/index.js";
import type { FieldsAuth } from "../../src/infrastructure/auth/better-auth/fields-auth.js";
import { resolveInvitationPreviewHttpRequest } from "../../src/interface/http/invitation-preview.js";

const invitationId = "invitation_preview_bearer_secret";
const invitationEmail = "invited@example.test";
const companyName = "Fields Company";
const requestHeaders = { "x-fields-invitation-id": invitationId };
const invalidInvitationBody = {
  code: "FIELDS_INVITATION_INVALID",
  message: "A valid pending Fields invitation is required.",
};

test("invitation preview returns only the current Company name", async () => {
  const output = await previewWith();

  assert.deepEqual(output, {
    statusCode: 200,
    body: { company_name: companyName },
  });
  assert.deepEqual(Object.keys(output.body), ["company_name"]);
  assert.equal(JSON.stringify(output).includes(invitationEmail), false);
  assert.equal(JSON.stringify(output).includes(invitationId), false);
});

test("POST invitation preview reads the bearer from X-Fields-Invitation-Id", async () => {
  const invitationPolicy = previewPolicy();
  const app = createApp({
    auth: {} as FieldsAuth,
    invitationPolicy,
    authBaseURL: "http://127.0.0.1:4102",
    authTrustedOrigins: ["http://127.0.0.1:3102"],
    databaseService: fakeDatabaseService(),
    clientOrigins: ["http://127.0.0.1:3102"],
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/invitation/preview",
      headers: { "X-Fields-Invitation-Id": invitationId },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { company_name: companyName });
  } finally {
    await app.close();
  }
});

test("legacy one-time bootstrap endpoints are not exposed", async () => {
  const app = createApp({
    auth: {} as FieldsAuth,
    invitationPolicy: previewPolicy(),
    authBaseURL: "http://127.0.0.1:4102",
    authTrustedOrigins: ["http://127.0.0.1:3102"],
    databaseService: fakeDatabaseService(),
    clientOrigins: ["http://127.0.0.1:3102"],
  });
  try {
    const status = await app.inject({ method: "GET", url: "/api/v1/auth/bootstrap/status" });
    const create = await app.inject({ method: "POST", url: "/api/v1/auth/bootstrap", payload: {} });
    assert.equal(status.statusCode, 404);
    assert.equal(create.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("batched tRPC procedure paths are not rejected by Fastify's default parameter limit", async () => {
  const app = createApp({
    auth: {} as FieldsAuth,
    invitationPolicy: previewPolicy(),
    authBaseURL: "http://127.0.0.1:4102",
    authTrustedOrigins: ["http://127.0.0.1:3102"],
    databaseService: fakeDatabaseService(),
    clientOrigins: ["http://127.0.0.1:3102"],
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/trpc/member.executor.current,member.executor.options,account.executors.list,member.executor.current,room.list?batch=1&input=%7B%224%22%3A%7B%22limit%22%3A50%7D%7D",
    });
    assert.notEqual(response.statusCode, 414);
    assert.notEqual(response.json().code, "FST_ERR_MAX_PARAM_LENGTH");
  } finally {
    await app.close();
  }
});

test("invalid invitation previews share one safe error", async () => {
  const output = await previewWith({ failure: HumanInvitationAdmissionError.invalid() });

  assert.deepEqual(output, {
    statusCode: 403,
    body: invalidInvitationBody,
  });
  assert.equal(JSON.stringify(output).includes(invitationEmail), false);
  assert.equal(JSON.stringify(output).includes(invitationId), false);
});

test("missing or repeated invitation headers use the same safe error", async () => {
  for (const headers of [{}, { "x-fields-invitation-id": [invitationId, "other"] }]) {
    const output = await resolveInvitationPreviewHttpRequest(previewPolicy(), headers);
    assert.deepEqual(output, {
      statusCode: 403,
      body: invalidInvitationBody,
    });
  }
});

test("policy failures cannot leak the invitation credential or cause", async () => {
  const output = await previewWith({
    failure: new Error(`query failed for ${invitationId}`, {
      cause: new Error(`database cause contains ${invitationEmail}`),
    }),
  });

  assert.deepEqual(output, {
    statusCode: 500,
    body: {
      code: "FIELDS_INVITATION_PREVIEW_UNAVAILABLE",
      message: "Invitation preview is temporarily unavailable.",
    },
  });
  assert.equal(JSON.stringify(output).includes(invitationId), false);
  assert.equal(JSON.stringify(output).includes(invitationEmail), false);
});

type PreviewFixture = {
  failure?: Error;
};

async function previewWith(fixture: PreviewFixture = {}) {
  return resolveInvitationPreviewHttpRequest(previewPolicy(fixture), requestHeaders);
}

function previewPolicy(fixture: PreviewFixture = {}): HumanInvitationAdmissionPolicyUseCase {
  return {
    async assertEmailSignUpAllowed() {},
    async previewInvitation(credential) {
      if (fixture.failure) throw fixture.failure;
      if (credential !== invitationId) throw HumanInvitationAdmissionError.invalid();
      return { company_name: companyName };
    },
    async assertInvitationCreationAllowed() {},
    async assertInvitationAcceptanceAllowed() {},
    async assertMappedOrganization() {},
  };
}

function fakeDatabaseService(): BackendDatabaseService {
  return {
    db: {} as BackendDatabase,
    pool: {} as BackendDatabaseService["pool"],
    async close() {},
  };
}
