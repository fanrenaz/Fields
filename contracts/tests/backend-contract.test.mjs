import assert from "node:assert/strict";
import test from "node:test";

import {
  agentRoomErrorCodeSchema,
  agentRoomTriggerPolicySchema,
  roomAgentTriggerPolicySetInputSchema,
} from "../dist/public/agent-room.js";
import {
  companyCreateResultSchema,
  companyInvitationSchema,
  companyRuntimeStatusResultSchema,
  companyRegistrationSettingsSchema,
  registrationPrepareInputSchema,
  registrationPrepareResultSchema,
  productSessionSchema,
  sessionMeSchema,
} from "../dist/public/company.js";
import {
  roomInteractionErrorCodeSchema,
  roomMessageEventStreamSchema,
  roomMessageSendInputSchema,
  roomTimelineMessageSchema,
} from "../dist/public/room.js";
import {
  homeFilesystemEventStreamSchema,
  homeThreadForkInputSchema,
  homeThreadReadResultSchema,
  homeTurnSubmitInputSchema,
  homeTurnEventStreamSchema,
} from "../dist/public/home.js";

const image = {
  attachment_id: "image_one",
  kind: "image",
  name: "photo.png",
  mime_type: "image/png",
  size_bytes: 1024,
};

test("Home and Room image attachments are ordered, bounded, and allow image-only sends", () => {
  assert.equal(homeTurnSubmitInputSchema.parse({
    prompt: "",
    image_attachments: [{ ...image, storage: "member_workspace", path: "Uploads/photo.png" }],
  }).image_attachments.length, 1);
  assert.equal(roomMessageSendInputSchema.parse({
    room_id: "room_one",
    client_message_id: "client_one",
    markdown: "",
    image_attachments: [{ ...image, storage: "company_file_version", file_id: "file_one", version_id: "version_one" }],
  }).image_attachments.length, 1);
  rejected(homeTurnSubmitInputSchema, { prompt: "", image_attachments: [] });
  rejected(roomMessageSendInputSchema, {
    room_id: "room_one",
    client_message_id: "client_one",
    markdown: "",
  });
  rejected(homeTurnSubmitInputSchema, {
    prompt: "photo",
    image_attachments: Array.from({ length: 5 }, (_, index) => ({
      ...image,
      attachment_id: `image_${index}`,
      storage: "member_workspace",
      path: `Uploads/${index}.png`,
    })),
  });
  rejected(homeTurnSubmitInputSchema, {
    prompt: "photo",
    image_attachments: [{ ...image, storage: "member_workspace", path: "Uploads/photo.svg", mime_type: "image/svg+xml" }],
  });
});
import { roomSideChatTurnEventStreamSchema } from "../dist/public/room-side-chat.js";
import { roomAgentTurnEventStreamSchema } from "../dist/public/agent-activity.js";
import {
  globalSearchErrorCodeSchema,
  searchCoverageSchema,
  searchResultKindSchema,
} from "../dist/public/search.js";
import {
  memberAssetApplyInputSchema,
  memberAssetInstallationSchema,
  memberAssetOperationSchema,
} from "../dist/public/asset.js";
import {
  companyFileFolderSchema,
  companyFileShareResolveResultSchema,
  companyFileShareSchema,
  companyFileVersionSchema,
} from "../dist/public/company-file.js";
import { backendRouter } from "../dist/router/backend.js";
import {
  companyRuntimeCallbackErrorCodeSchema,
} from "../dist/internal/backend-runtime.js";
import { backendRuntimeRouter } from "../dist/internal/router/backend-runtime.js";
import {
  codexAgentRuntimeInteractionRequestSchema,
  codexAgentRuntimeEventStreamSchema,
  roomCodexAgentRuntimeActivityAcceptedSchema,
} from "../dist/internal/agent-runtime.js";
import { companyRuntimeRouter } from "../dist/internal/router/company-runtime.js";
import {
  agentRoomExecutionCompletionSchema,
  agentRoomExecutionDispatchSchema,
  agentRoomInteractionResponseAcceptedSchema,
  agentRoomInteractionResponseDispatchSchema,
  agentRoomThreadSchema,
} from "../dist/internal/agent-room.js";
import {
  companyRuntimeAgentActivityInputSchema,
  companyRuntimeAgentRoomInteractionRespondInputSchema,
  companyRuntimeHeartbeatInputSchema,
  companyRuntimeInitInputSchema,
  companyRuntimeMemberCleanupInputSchema,
  companyRuntimeMemberCleanupResultSchema,
  companyRuntimeRoomMessagesResourceSchema,
} from "../dist/internal/company-runtime.js";
import {
  runtimeMemberAssetOperationCompletedInputSchema,
} from "../dist/internal/asset.js";

function rejected(schema, value) {
  assert.equal(schema.safeParse(value).success, false);
}

test("authenticated Human session no longer exposes a paired Home Agent", () => {
  const session = {
    has_company: true,
    registration_pending: false,
    user_id: "user_one",
    actor_id: "human_one",
    company_id: "company_one",
    display_name: "Ada",
    actor_type: "human",
    company_role: "owner",
    company_status: "active",
  };
  assert.deepEqual(sessionMeSchema.parse(session), session);
  rejected(sessionMeSchema, { ...session, home_actor_id: "legacy_home" });
  assert.deepEqual(productSessionSchema.parse({
    actor_id: "human_one",
    company_id: "company_one",
    display_name: "Ada",
    actor_type: "human",
    company_role: "owner",
    company_status: "active",
  }).actor_id, "human_one");
});

test("Company onboarding and status describe the single Company Runtime", () => {
  const result = {
    company: { company_id: "company_one", name: "Fields", status: "provisioning" },
    runtime: { status: "provisioning", error: null },
    operation_id: "operation_one",
  };
  assert.deepEqual(companyCreateResultSchema.parse(result), result);
  rejected(companyCreateResultSchema, { ...result, home: { home_id: "legacy", status: "ready", error: null } });

  const status = {
    company_id: "company_one",
    status: "ready",
    member_app_servers: { running: 2, idle: 1, switching: 0, failed: 0 },
    active_execution_count: 1,
    last_seen_at_ms: 100,
    error: null,
  };
  assert.deepEqual(companyRuntimeStatusResultSchema.parse(status), status);
  rejected(companyRuntimeStatusResultSchema, { ...status, container_id: "secret" });
});

test("public Backend removes Room Sandbox lifecycle and exposes trigger policy", () => {
  const procedures = backendRouter._def.procedures;
  assert.equal(procedures["company.actors.remove"]?._def.type, "mutation");
  assert.equal(procedures["company.invitations.list"]?._def.type, "query");
  assert.equal(procedures["company.runtime.status"]?._def.type, "query");
  assert.equal(procedures["company.create"], undefined);
  assert.equal(procedures["registration.prepare"]?._def.type, "mutation");
  assert.equal(procedures["registration.claim"]?._def.type, "mutation");
  assert.equal(procedures["company.registration.get"]?._def.type, "query");
  assert.equal(procedures["company.registration.rotate"]?._def.type, "mutation");
  assert.equal(procedures["company.registration.setEnabled"]?._def.type, "mutation");
  assert.equal(procedures["company.files.shares.create"]?._def.type, "mutation");
  assert.equal(procedures["company.files.shares.list"]?._def.type, "query");
  assert.equal(procedures["company.files.shares.revoke"]?._def.type, "mutation");
  assert.equal(procedures["company.files.shares.resolve"]?._def.type, "query");
  assert.equal(procedures["room.agents.triggerPolicy.get"]?._def.type, "query");
  assert.equal(procedures["room.agents.triggerPolicy.set"]?._def.type, "mutation");
  assert.equal(procedures["room.agents.execution.get"]?._def.type, "query");
  assert.equal(procedures["room.agentActivity.watch"]?._def.type, "subscription");
  assert.equal(procedures["room.messages.edit"]?._def.type, "mutation");
  assert.equal(procedures["room.messages.softDelete"]?._def.type, "mutation");
  assert.equal(procedures["room.messages.regenerate"]?._def.type, "mutation");
  assert.equal(procedures["room.messages.selectVersion"]?._def.type, "mutation");
  assert.equal(procedures["home.thread.fork"]?._def.type, "mutation");
  assert.equal(procedures["home.thread.select"]?._def.type, "mutation");
  assert.equal(procedures["home.thread.delete"]?._def.type, "mutation");
  assert.equal(procedures["room.sandbox.wake"], undefined);
  assert.equal(procedures["room.sandbox.status"], undefined);
  assert.equal(procedures["room.sandbox.presence.touch"], undefined);
  assert.equal(procedures["room.session.start"], undefined);
  assert.equal(procedures["room.delete"], undefined);
  assert.equal(procedures["room.agentSessions.watch"], undefined);
});

test("registration contracts strictly separate shared codes from signup credentials", () => {
  const code = "A".repeat(43);
  assert.deepEqual(registrationPrepareInputSchema.parse({ email: "ada@example.com", code }), {
    email: "ada@example.com",
    code,
  });
  rejected(registrationPrepareInputSchema, { email: "ada@example.com", code, company_id: "secret" });
  assert.equal(registrationPrepareResultSchema.parse({
    signup_credential: "b".repeat(43),
    expires_at_ms: 100,
  }).expires_at_ms, 100);
  rejected(registrationPrepareResultSchema, { signup_credential: "short", expires_at_ms: 100 });
  assert.equal(companyRegistrationSettingsSchema.parse({
    enabled: true,
    code,
    code_version: 1,
    updated_at_ms: 100,
  }).code, code);
});

test("Company File projections expose safe uploader summaries and controlled shares", () => {
  const actor = { actor_id: "actor_one", display_name: "Ada", actor_type: "human" };
  const version = {
    version_id: "version_one",
    file_id: "file_one",
    version_number: 1,
    blob_sha256: "a".repeat(64),
    size_bytes: 12,
    mime_type: "text/plain",
    original_name: "notes.txt",
    created_by_actor_id: "actor_one",
    created_by: actor,
    created_at_ms: 100,
  };
  assert.deepEqual(companyFileVersionSchema.parse(version), version);
  assert.deepEqual(companyFileFolderSchema.parse({
    folder_id: "folder_one",
    parent_folder_id: null,
    name: "Notes",
    revision: 1,
    created_by: actor,
    created_at_ms: 100,
    updated_at_ms: 100,
  }).created_by, actor);
  rejected(companyFileVersionSchema, {
    ...version,
    created_by: { ...actor, email: "ada@example.com" },
  });

  assert.equal(companyFileShareSchema.parse({
    share_id: "share_one",
    file_id: "file_one",
    share_token: "share_one.signature",
    created_at_ms: 100,
    expires_at_ms: null,
    revoked_at_ms: null,
  }).share_id, "share_one");
  rejected(companyFileShareResolveResultSchema, {
    share_id: "share_one",
    name: "notes.txt",
    mime_type: "text/plain",
    size_bytes: 12,
    updated_at_ms: 100,
    preview_url: "https://files.example/preview",
    download_url: "https://files.example/download",
    content_expires_at_ms: 200,
    share_expires_at_ms: null,
    company_id: "company_secret",
  });
});

test("public and internal subscription route matrices stay complete", () => {
  const publicProcedures = backendRouter._def.procedures;
  const internalProcedures = companyRuntimeRouter._def.procedures;
  assert.equal(publicProcedures["room.files.list"], undefined);
  assert.equal(publicProcedures["room.files.add"], undefined);
  assert.equal(publicProcedures["room.files.remove"], undefined);
  const publicSubscriptions = new Map([
    ["home.filesystem.events", homeFilesystemEventStreamSchema],
    ["home.turn.events", homeTurnEventStreamSchema],
    ["room.agentActivity.watch", roomAgentTurnEventStreamSchema],
    ["room.messages.events", roomMessageEventStreamSchema],
    ["roomSideChat.turn.events", roomSideChatTurnEventStreamSchema],
  ]);
  const internalSubscriptions = new Map([
    ["home.filesystem.events", homeFilesystemEventStreamSchema],
    ["home.turn.events", codexAgentRuntimeEventStreamSchema],
    ["roomSideChat.turn.events", codexAgentRuntimeEventStreamSchema],
  ]);

  for (const [route, output] of publicSubscriptions) {
    assert.equal(publicProcedures[route]?._def.type, "subscription", route);
    assert.equal(publicProcedures[route]?._def.output, output, route);
  }
  for (const [route, output] of internalSubscriptions) {
    assert.equal(internalProcedures[route]?._def.type, "subscription", route);
    assert.equal(internalProcedures[route]?._def.output, output, route);
  }
});

test("Home subscription routers enforce the Runtime-to-Backend protocol boundary", async () => {
  const rawRuntimeEvent = {
    schema_version: 1,
    event_id: "runtime_home_event",
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "home",
      member_id: "member_one",
      thread_id: "thread_one",
    },
    turn_id: "turn_one",
    occurred_at_ms: 10,
    type: "agent_runtime.event",
    method: "turn/started",
    item_id: null,
    payload: {},
  };
  const rawStream = () => (async function* () {
    yield rawRuntimeEvent;
  })();
  const consume = async (schema, stream) => {
    const events = [];
    for await (const event of schema.parse(stream)) {
      events.push(event);
    }
    return events;
  };
  const internalProcedures = companyRuntimeRouter._def.procedures;
  const publicProcedures = backendRouter._def.procedures;

  for (const route of ["home.turn.events", "roomSideChat.turn.events"]) {
    assert.deepEqual(
      await consume(internalProcedures[route]._def.output, rawStream()),
      [rawRuntimeEvent],
      route,
    );
  }
  for (const route of ["home.turn.events", "roomSideChat.turn.events"]) {
    await assert.rejects(
      consume(publicProcedures[route]._def.output, rawStream()),
      undefined,
      route,
    );
  }
});

test("Member asset contracts pin versions and expose Human and Agent installation routes", () => {
  const procedures = backendRouter._def.procedures;
  assert.equal(procedures["company.members.assets.current"]?._def.type, "query");
  assert.equal(procedures["company.members.assets.options"]?._def.type, "query");
  assert.equal(procedures["company.members.assets.applyInstallation"]?._def.type, "mutation");
  assert.equal(procedures["company.members.assets.apply"], undefined);
  assert.equal(procedures["company.members.assets.operation"]?._def.type, "query");

  const backendRuntimeProcedures = backendRuntimeRouter._def.procedures;
  assert.equal(
    backendRuntimeProcedures["companyRuntime.assets.installations.current"]?._def.type,
    "query",
  );
  assert.equal(
    backendRuntimeProcedures["companyRuntime.assets.installations.applyInstallation"]?._def.type,
    "mutation",
  );
  assert.equal(backendRuntimeProcedures["companyRuntime.assets.installations.apply"], undefined);
  assert.equal(
    backendRuntimeProcedures["companyRuntime.assets.installationCompleted"]?._def.type,
    "mutation",
  );

  const runtimeProcedures = companyRuntimeRouter._def.procedures;
  assert.equal(runtimeProcedures["member.assets.applyInstallation"]?._def.type, "mutation");
  assert.equal(runtimeProcedures["member.assets.apply"], undefined);

  const apply = {
    member_id: "agent-one",
    expected_revision: 0,
    installations: [{ asset_id: "asset-one", version_id: "version-one" }],
    idempotency_key: "install-assets-one",
  };
  assert.deepEqual(memberAssetApplyInputSchema.parse(apply), apply);
  rejected(memberAssetApplyInputSchema, {
    ...apply,
    installations: [
      { asset_id: "asset-one", version_id: "version-one" },
      { asset_id: "asset-one", version_id: "version-two" },
    ],
  });
});

test("Member asset health and operation completion states are coherent", () => {
  const installation = {
    asset_id: "asset-one",
    version_id: "version-one",
    kind: "mcp",
    name: "Search MCP",
    slug: "search-mcp",
    version: "1.0.0",
    health: "degraded",
    issue_code: "member_asset_mcp_unavailable",
  };
  assert.deepEqual(memberAssetInstallationSchema.parse(installation), installation);
  rejected(memberAssetInstallationSchema, {
    ...installation,
    health: "ready",
  });

  const operation = {
    operation_id: "operation-one",
    status: "applying",
    requested_revision: 1,
    error_code: null,
    retryable: null,
    created_at_ms: 100,
    updated_at_ms: 101,
    completed_at_ms: null,
  };
  assert.deepEqual(memberAssetOperationSchema.parse(operation), operation);
  rejected(memberAssetOperationSchema, {
    ...operation,
    status: "failed",
  });

  rejected(runtimeMemberAssetOperationCompletedInputSchema, {
    identity: {
      company_id: "company-one",
    },
    member_id: "agent-one",
    operation_id: "operation-one",
    requested_revision: 1,
    status: "failed",
    installations: [],
    error_code: null,
    retryable: true,
    completed_at_ms: 200,
  });
});

test("Company invitation projections expose only the strict Owner directory fields", () => {
  const invitation = {
    status: "pending",
    invitation_credential: "invitation_one",
    email: "invitee@example.test",
    created_at_ms: 100,
    expires_at_ms: 200,
  };
  assert.deepEqual(companyInvitationSchema.parse(invitation), invitation);
  assert.equal(companyInvitationSchema.parse({
    ...invitation,
    status: "expired",
  }).status, "expired");
  rejected(companyInvitationSchema, { ...invitation, status: "accepted" });
  rejected(companyInvitationSchema, { ...invitation, created_at_ms: 1.5 });
  rejected(companyInvitationSchema, { ...invitation, expires_at_ms: 99 });
  rejected(companyInvitationSchema, { ...invitation, invitation_link: "secret" });
});

test("all six Agent-Room trigger policies are exact", () => {
  for (const policy of [
    "human_explicit",
    "member_explicit",
    "human_auto",
    "member_auto",
    "human_explicit_agent_auto",
    "agent_explicit_human_auto",
  ]) {
    assert.equal(agentRoomTriggerPolicySchema.parse(policy), policy);
  }
  rejected(agentRoomTriggerPolicySchema, "agent_auto");
  assert.deepEqual(roomAgentTriggerPolicySetInputSchema.parse({
    room_id: "room_one",
    agent_member_id: "agent_one",
    policy: "member_auto",
    expected_version: 2,
  }), {
    room_id: "room_one",
    agent_member_id: "agent_one",
    policy: "member_auto",
    expected_version: 2,
  });
});

test("Agent-Room errors expose the Agent readiness precondition", () => {
  assert.equal(
    agentRoomErrorCodeSchema.parse("AGENT_NOT_READY_FOR_ROOM"),
    "AGENT_NOT_READY_FOR_ROOM",
  );
});

test("Room messages are Backend-sequenced and carry execution/cascade provenance", () => {
  const message = {
    id: "message_one",
    sequence: 7,
    kind: "message",
    room_id: "room_one",
    occurred_at_ms: 1234,
    sender: {
      type: "agent",
      id: "agent_one",
      display_name: "Research Agent",
      mark: "RA",
      avatar_resource_id: null,
    },
    body: { format: "inline_markdown", markdown: "Done", plain_text: "Done" },
    revision: 1,
    edited_at_ms: null,
    deleted_at_ms: null,
    reply_to: null,
    interactions: [],
    thread_id: "thread_one",
    agent_turn: {
      trigger_message_id: "message_source",
      execution_id: "execution_one",
      cascade_id: "cascade_one",
      status: "completed",
      started_at_ms: 1000,
      completed_at_ms: 1234,
      duration_ms: 234,
    },
    agent_reply_version: {
      group_id: "version_group_one",
      version_number: 2,
      version_count: 2,
      selected: true,
      selection_revision: 3,
      latest_successful: true,
      source_execution_id: "execution_one",
    },
  };
  assert.deepEqual(roomTimelineMessageSchema.parse(message), message);
  rejected(roomTimelineMessageSchema, { ...message, sequence: undefined });
  rejected(roomTimelineMessageSchema, {
    ...message,
    agent_turn: { ...message.agent_turn, cascade_id: undefined },
  });
});

test("Home history is full, provider-neutral, and branch mutations are revisioned", () => {
  const snapshot = {
    turn_id: "turn_one",
    status: "completed",
    started_at_ms: 100,
    completed_at_ms: 200,
    duration_ms: 100,
    error: null,
    narrative_items: [{
      type: "assistant_message",
      id: "assistant_one",
      status: "completed",
      phase: "final_answer",
      content: [{ type: "markdown", markdown: "Done" }],
    }],
    activity_items: [{
      type: "tool_call",
      id: "tool_one",
      status: "completed",
      namespace: "files",
      name: "read",
      display_name: "Read",
      content: [{ type: "text", text: "safe result" }],
      progress: [],
      error: null,
      duration_ms: 10,
    }],
  };
  const result = {
    thread_id: "thread_child",
    root_thread_id: "thread_root",
    selected_thread_id: "thread_child",
    revision: 2,
    branches: [
      {
        thread_id: "thread_root",
        root_thread_id: "thread_root",
        source_thread_id: null,
        anchor_turn_id: null,
        kind: "root",
        selected: false,
        created_at_ms: 1,
      },
      {
        thread_id: "thread_child",
        root_thread_id: "thread_root",
        source_thread_id: "thread_root",
        anchor_turn_id: "turn_one",
        kind: "regenerated_assistant",
        selected: true,
        created_at_ms: 2,
      },
    ],
    turns: [
      { thread_id: "thread_root", turn_id: "turn_one", snapshot },
      { thread_id: "thread_child", turn_id: "turn_one", snapshot },
    ],
  };
  assert.deepEqual(homeThreadReadResultSchema.parse(result), result);
  rejected(homeThreadReadResultSchema, {
    ...result,
    messages: [],
  });
  rejected(homeThreadReadResultSchema, {
    ...result,
    thread: {
      thread_id: "thread_child",
      title: null,
      preview: null,
      created_at_ms: null,
      updated_at_ms: null,
      status: "idle",
    },
  });
  rejected(homeThreadReadResultSchema, {
    ...result,
    turns: [{
      ...result.turns[0],
      snapshot: { ...snapshot, provider_payload: { secret: true } },
    }],
  });
  assert.deepEqual(homeThreadForkInputSchema.parse({
    thread_id: "thread_root",
    anchor_turn_id: "turn_one",
    kind: "edited_user_message",
    prompt: "Replacement",
    expected_revision: 1,
    idempotency_key: "home-edit-one",
  }), {
    thread_id: "thread_root",
    anchor_turn_id: "turn_one",
    kind: "edited_user_message",
    prompt: "Replacement",
    expected_revision: 1,
    idempotency_key: "home-edit-one",
  });
  rejected(homeThreadForkInputSchema, {
    thread_id: "thread_root",
    anchor_turn_id: "turn_one",
    kind: "edited_user_message",
    expected_revision: 1,
    idempotency_key: "home-edit-one",
  });
  rejected(homeThreadForkInputSchema, {
    thread_id: "thread_root",
    anchor_turn_id: "turn_one",
    kind: "regenerated_assistant",
    prompt: "must reuse original input",
    expected_revision: 1,
    idempotency_key: "home-regenerate-one",
  });
});

test("Agent-Room dispatch orders a bounded prompt projection that contains the source", () => {
  const thread = {
    room_id: "room_one",
    agent_member_id: "agent_one",
    codex_thread_id: "thread_one",
    state: "active",
    last_consumed_sequence: 4,
    membership_version: 2,
    updated_at_ms: 100,
  };
  assert.deepEqual(agentRoomThreadSchema.parse(thread), thread);
  const sender = {
    type: "human",
    id: "human_one",
    display_name: "Ada",
    mark: "A",
    avatar_resource_id: null,
  };
  const message = (sequence) => ({
    message_id: `message_${sequence}`,
    sequence,
    occurred_at_ms: sequence,
    sender,
    body: { format: "inline_markdown", markdown: `m${sequence}`, plain_text: `m${sequence}` },
    reply_to: null,
    references: [],
  });
  const dispatch = {
    execution_id: "execution_one",
    idempotency_key: "outbox_one:agent_one",
    cascade_id: "cascade_one",
    company_id: "company_one",
    room_id: "room_one",
    agent_member_id: "agent_one",
    membership_version: 2,
    source_message_id: "message_6",
    source_message_sequence: 6,
    room_title: "Product",
    agent_display_name: "Lin",
    trigger: "mention",
    trigger_policy: "human_explicit",
    thread,
    prompt_messages: [message(5), message(6)],
    company_file_inputs: [],
  };
  assert.deepEqual(agentRoomExecutionDispatchSchema.parse(dispatch), dispatch);
  rejected(agentRoomExecutionDispatchSchema, { ...dispatch, prompt_messages: [message(6), message(5)] });
  rejected(agentRoomExecutionDispatchSchema, { ...dispatch, source_message_sequence: 7 });
  rejected(agentRoomExecutionDispatchSchema, {
    ...dispatch,
    prompt_messages: [{
      ...message(6),
      references: [{ type: "file", id: "file_one", room_id: "room_one" }],
    }],
  });
  rejected(agentRoomExecutionDispatchSchema, {
    ...dispatch,
    prompt_messages: Array.from({ length: 12 }, (_, index) => message(index + 1)),
  });
});

test("execution completion commits one cursor and explicit silence", () => {
  const completion = {
    execution_id: "execution_one",
    idempotency_key: "outbox_one:agent_one",
    cascade_id: "cascade_one",
    room_id: "room_one",
    agent_member_id: "agent_one",
    status: "succeeded",
    codex_thread_id: "thread_one",
    codex_turn_id: "turn_one",
    consumed_through_sequence: 6,
    error: null,
    completed_at_ms: 200,
  };
  assert.deepEqual(agentRoomExecutionCompletionSchema.parse(completion), completion);
  rejected(agentRoomExecutionCompletionSchema, {
    ...completion,
    status: "failed",
    error: null,
  });
  rejected(agentRoomExecutionCompletionSchema, {
    ...completion,
    status: "failed",
    final_answer_markdown: "must not publish",
    error: { code: "FAILED", retryable: false },
  });
});

test("internal routers expose only Company Runtime callbacks and one runtime topology", () => {
  const runtime = companyRuntimeRouter._def.procedures;
  assert.equal(runtime["runtime.init"], undefined);
  assert.equal(runtime["runtime.health"]?._def.type, "query");
  assert.equal(runtime["member.cleanup"]?._def.type, "mutation");
  assert.equal(runtime["member.appServer.switchExecutor"]?._def.type, "mutation");
  assert.equal(runtime["home.thread.search"]?._def.type, "query");
  assert.equal(runtime["home.thread.fork"]?._def.type, "mutation");
  assert.equal(runtime["home.thread.select"]?._def.type, "mutation");
  assert.equal(runtime["home.thread.delete"]?._def.type, "mutation");
  assert.equal(runtime["home.filesystem.search"]?._def.type, "query");
  assert.equal(runtime["room.filesystem.search"], undefined);
  assert.equal(runtime["room.agentExecution.execute"]?._def.type, "mutation");
  assert.equal(runtime["room.agentExecution.interaction.respond"]?._def.type, "mutation");
  assert.equal(runtime["room.cleanup"], undefined);
  assert.equal(runtime["roomSandbox.init"], undefined);
  assert.equal(runtime["homeSandbox.init"], undefined);

  const callbacks = backendRuntimeRouter._def.procedures;
  assert.equal(callbacks["companyRuntime.files.read"]?._def.type, "query");
  assert.equal(callbacks["companyRuntime.ready"]?._def.type, "mutation");
  assert.equal(callbacks["companyRuntime.heartbeat"]?._def.type, "mutation");
  assert.equal(callbacks["companyRuntime.agentExecution.activity"]?._def.type, "mutation");
  assert.equal(callbacks["companyRuntime.agentExecution.complete"]?._def.type, "mutation");
  assert.equal(callbacks["companyRuntime.roomMessages.read"]?._def.type, "query");
  assert.equal(callbacks["companyRuntime.search.query"]?._def.type, "query");
  assert.equal(callbacks["roomSandbox.ready"], undefined);
  assert.equal(callbacks["homeSandbox.ready"], undefined);
});

test("terminal Member cleanup is Runtime-identified and operation-idempotent", () => {
  const input = {
    company_id: "company_one",
    operation_id: "member_cleanup_one",
    member_id: "agent_one",
  };
  assert.deepEqual(companyRuntimeMemberCleanupInputSchema.parse(input), input);
  rejected(companyRuntimeMemberCleanupInputSchema, {
    ...input,
    operation_id: "",
  });
  rejected(companyRuntimeMemberCleanupInputSchema, {
    ...input,
    room_id: "room_one",
  });

  const accepted = {
    accepted: true,
    operation_id: "member_cleanup_one",
    member_id: "agent_one",
    duplicate: false,
  };
  assert.deepEqual(companyRuntimeMemberCleanupResultSchema.parse(accepted), accepted);
  assert.deepEqual(companyRuntimeMemberCleanupResultSchema.parse({
    ...accepted,
    duplicate: true,
  }).duplicate, true);
  rejected(companyRuntimeMemberCleanupResultSchema, {
    ...accepted,
    container_id: "runtime_container",
  });
});

test("raw Codex activity has an authenticated Runtime-to-Backend callback boundary", () => {
  const identity = {
    company_id: "company_one",
  };
  const event = {
    schema_version: 1,
    event_id: "runtime_event_one",
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "room",
      room_id: "room_one",
      agent_member_id: "agent_one",
      execution_id: "execution_one",
    },
    turn_id: "turn_one",
    occurred_at_ms: 20,
    type: "agent_runtime.event",
    method: "item/agentMessage/delta",
    item_id: "item_one",
    payload: { delta: "partial" },
  };
  assert.deepEqual(companyRuntimeAgentActivityInputSchema.parse({ ...identity, event }), {
    ...identity,
    event,
  });
  rejected(companyRuntimeAgentActivityInputSchema, {
    ...identity,
    event: {
      ...event,
      scope: { type: "home", member_id: "human_one", thread_id: "thread_one" },
    },
  });
  assert.equal(companyRuntimeCallbackErrorCodeSchema.safeParse("RUNTIME_CALLBACK_UNAUTHORIZED").success, true);
  assert.equal(companyRuntimeCallbackErrorCodeSchema.safeParse("EXECUTION_SCOPE_MISMATCH").success, true);
  assert.equal(companyRuntimeCallbackErrorCodeSchema.safeParse("provider_error").success, false);
});

test("interactive Runtime requests exchange a transient provider request id for a persisted interaction id", () => {
  const request = {
    schema_version: 1,
    event_id: "runtime_request_one",
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "room",
      room_id: "room_one",
      agent_member_id: "agent_one",
      execution_id: "execution_one",
    },
    turn_id: "turn_one",
    occurred_at_ms: 21,
    type: "agent_runtime.interaction_request",
    method: "item/commandExecution/requestApproval",
    request_id: 42,
    item_id: "item_one",
    payload: { command: "pnpm test" },
  };
  assert.deepEqual(codexAgentRuntimeInteractionRequestSchema.parse(request), request);
  rejected(codexAgentRuntimeInteractionRequestSchema, {
    ...request,
    method: "account/chatgptAuthTokens/refresh",
  });
  rejected(codexAgentRuntimeInteractionRequestSchema, {
    ...request,
    request_id: undefined,
  });

  const accepted = {
    accepted: true,
    event_id: "runtime_request_one",
    duplicate: false,
    interaction_id: "interaction_one",
  };
  assert.deepEqual(roomCodexAgentRuntimeActivityAcceptedSchema.parse(accepted), accepted);
  assert.deepEqual(roomCodexAgentRuntimeActivityAcceptedSchema.parse({
    accepted: true,
    event_id: "runtime_event_one",
    duplicate: false,
    interaction_id: null,
  }).interaction_id, null);
});

test("persisted interaction responses are dispatched idempotently to the active execution", () => {
  const interactionResponse = {
    persisted_response_id: "interaction_response_one",
    idempotency_key: "interaction_one:human_one:response_one",
    execution_id: "execution_one",
    room_id: "room_one",
    agent_member_id: "agent_one",
    message_id: "message_one",
    interaction_id: "interaction_one",
    responder_member_id: "human_one",
    response: "approve",
    responded_at_ms: 30,
  };
  assert.deepEqual(agentRoomInteractionResponseDispatchSchema.parse(interactionResponse), interactionResponse);
  const runtimeInput = {
    company_id: "company_one",
    interaction_response: interactionResponse,
  };
  assert.deepEqual(companyRuntimeAgentRoomInteractionRespondInputSchema.parse(runtimeInput), runtimeInput);
  const accepted = {
    accepted: true,
    persisted_response_id: "interaction_response_one",
    idempotency_key: "interaction_one:human_one:response_one",
    duplicate: false,
  };
  assert.deepEqual(agentRoomInteractionResponseAcceptedSchema.parse(accepted), accepted);
  rejected(agentRoomInteractionResponseDispatchSchema, {
    ...interactionResponse,
    response: "skip",
  });
  assert.equal(roomInteractionErrorCodeSchema.safeParse("INTERACTION_NOT_PENDING").success, true);
  assert.equal(roomInteractionErrorCodeSchema.safeParse("FORBIDDEN").success, true);
  assert.equal(roomInteractionErrorCodeSchema.safeParse("provider_error").success, false);
});

test("global search keeps seven public kinds and delegates Runtime-owned search scopes", () => {
  assert.deepEqual(searchResultKindSchema.options, [
    "room",
    "member",
    "home_thread",
    "message",
    "file",
    "asset",
    "email",
  ]);
  assert.equal(globalSearchErrorCodeSchema.safeParse("SEARCH_SCOPE_FORBIDDEN").success, true);
  assert.equal(globalSearchErrorCodeSchema.safeParse("COMPANY_RUNTIME_UNAVAILABLE").success, true);
  assert.equal(globalSearchErrorCodeSchema.safeParse("provider_error").success, false);
  const coverage = {
    visible_room_count: 2,
    searched_room_count: 1,
    failed_sources: [
      { target: { kind: "room", room_id: "room_one" }, code: "FAILED" },
      { target: { kind: "member" }, code: "FORBIDDEN" },
      { target: { kind: "home_thread" }, code: "NOT_FOUND" },
      { target: { kind: "message" }, code: "FAILED" },
      { target: { kind: "file", source: { type: "home" } }, code: "UNAVAILABLE" },
      {
        target: { kind: "file", source: { type: "company" } },
        code: "UNAVAILABLE",
      },
      {
        target: { kind: "email", mailbox_id: "mailbox_one" },
        code: "UNAVAILABLE",
      },
    ],
    email: {
      indexed_from_ms: 1_700_000_000_000,
      includes_remote_results: false,
      partial: true,
      failed_mailbox_ids: ["mailbox_one"],
    },
  };
  assert.deepEqual(searchCoverageSchema.parse(coverage), coverage);
  rejected(searchCoverageSchema, {
    ...coverage,
    failed_sources: [{ target: { kind: "room" }, code: "UNAVAILABLE" }],
  });
  rejected(searchCoverageSchema, {
    ...coverage,
    failed_sources: [{ target: { kind: "file", source: { type: "company", room_id: "room_one" } }, code: "UNAVAILABLE" }],
  });
  rejected(searchCoverageSchema, {
    ...coverage,
    failed_sources: [{ target: { kind: "message" }, code: "provider_error" }],
  });
  rejected(searchCoverageSchema, {
    ...coverage,
    failed_sources: [{ target: { kind: "message" }, code: "UNAVAILABLE", source: "company-runtime" }],
  });
  rejected(searchCoverageSchema, {
    ...coverage,
    visible_room_count: 1,
    searched_room_count: 2,
  });
});

test("Company Runtime identity is Company-scoped and heartbeat has Member App Servers", () => {
  const init = {
    company_id: "company_one",
    backend_callback_url: "https://backend.test/runtime",
    runtime_callback_token: "token",
    layout: {
      members_root: "/runtime/members",
      rooms_root: "/runtime/rooms",
      executors_root: "/runtime/executors",
    },
    storage_policy: {
      member_workspace_pattern: "members/<member_id>/workspace",
      codex_home_directory: ".codex",
      room_file_inputs: "execution_scoped_company_file_snapshots",
      executor_credentials_pattern: "executors/<executor_id>/credentials",
      codex_home_auth_json: "forbidden",
      codex_home_visibility: "excluded_from_files_search_upload_export_git",
    },
    execution_policy: {
      idle_timeout_ms: 1_800_000,
      same_agent_room_thread: "serial",
      different_room_threads: "parallel",
      thread_recovery: "resume",
      executor_auth: "chatgptAuthTokens",
    },
  };
  assert.deepEqual(companyRuntimeInitInputSchema.parse(init), init);
  rejected(companyRuntimeInitInputSchema, { ...init, room_id: "legacy" });
  rejected(companyRuntimeInitInputSchema, {
    ...init,
    execution_policy: { ...init.execution_policy, idle_timeout_ms: 60_000 },
  });

  const heartbeat = {
    company_id: "company_one",
    state: "ready",
    member_app_servers: [{
      member_id: "agent_one",
      state: "idle",
      executor_id: "executor_one",
      credential_version: 2,
      active_turn_count: 0,
      last_active_at_ms: 100,
      idle_deadline_at_ms: 1_800_100,
      plugin: {
        plugin_id: "fields-core@fields",
        plugin_name: "fields-core",
        marketplace_name: "fields",
        version: "1.0.0",
        installed: true,
        enabled: true,
        mcp_server_names: [
          "fields_embodiment",
          "fields_search",
          "fields_room_messages",
          "fields_assets",
          "fields_mail",
        ],
      },
      error: null,
    }],
    active_execution_count: 0,
    occurred_at_ms: 100,
  };
  assert.deepEqual(companyRuntimeHeartbeatInputSchema.parse(heartbeat), heartbeat);
});

test("Room Messages selector cannot carry Member, Room, or Thread identity", () => {
  assert.deepEqual(companyRuntimeRoomMessagesResourceSchema.parse({
    kind: "latest",
  }), { kind: "latest" });
  assert.deepEqual(companyRuntimeRoomMessagesResourceSchema.parse({
    kind: "before",
    sequence: 51,
  }), { kind: "before", sequence: 51 });
  assert.deepEqual(companyRuntimeRoomMessagesResourceSchema.parse({
    kind: "around",
    message_id: "message-7",
  }), { kind: "around", message_id: "message-7" });
  for (const identity of [
    { member_id: "member-other" },
    { room_id: "room-other" },
    { thread_id: "thread-other" },
  ]) {
    rejected(companyRuntimeRoomMessagesResourceSchema, {
      kind: "latest",
      ...identity,
    });
  }
});
