import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { sql } from "drizzle-orm";

import { createBackendDatabaseService } from "../src/infrastructure/persistence/postgres/database-service.js";
import {
  MemberExecutorAssignmentService,
  PostgresActorDirectoryRepository,
  PostgresMemberExecutorAssignmentRepository,
  PostgresRoomMessageRepository,
} from "../src/infrastructure/persistence/postgres/repositories/index.js";
import {
  PostgresOwnerUnitOfWork,
  postgresTransactionForOwner,
} from "../src/infrastructure/persistence/postgres/unit-of-work/index.js";

const integrationDatabaseUrl = process.env.FIELDS_INTEGRATION_DATABASE_URL?.trim();
const enabled = process.env.FIELDS_RUN_COMPANY_RUNTIME_INTEGRATION_TESTS === "1"
  && Boolean(integrationDatabaseUrl);
const realDependencySkip = enabled
  ? false
  : "Set FIELDS_RUN_COMPANY_RUNTIME_INTEGRATION_TESTS=1 and provide FIELDS_INTEGRATION_DATABASE_URL for real PostgreSQL tests.";

test("real PostgreSQL owns Room sequence, execution idempotency, outbox delivery, cursor, and policies", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({
    databaseUrl: integrationDatabaseUrl,
  });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_company_${suffix}`;
  const humanId = `it_human_${suffix}`;
  const otherHumanId = `it_other_human_${suffix}`;
  const agentId = `it_agent_${suffix}`;
  const roomId = `it_room_${suffix}`;
  const now = Date.now();
  const messages = new PostgresRoomMessageRepository(database.db);
  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into companies (id, name, status, created_at_ms, updated_at_ms)
        values (${companyId}, 'Runtime integration', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          created_at_ms, updated_at_ms
        ) values
          (${humanId}, ${companyId}, 'human', 'Human', 'HU', 'owner', 'active', ${now}, ${now}),
          (${otherHumanId}, ${companyId}, 'human', 'Other Human', 'OH', 'member', 'active', ${now}, ${now}),
          (${agentId}, ${companyId}, 'agent', 'Agent', 'AG', 'member', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into rooms (
          id, company_id, name, status, created_by_actor_id,
          membership_version, next_message_sequence, created_at_ms, updated_at_ms
        ) values (${roomId}, ${companyId}, 'Room', 'active', ${humanId}, 1, 1, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into room_memberships (
          id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
        ) values
          (${`membership_h_${suffix}`}, ${roomId}, ${companyId}, ${humanId}, 'owner', 'active', ${now}, ${now}, ${now}),
          (${`membership_o_${suffix}`}, ${roomId}, ${companyId}, ${otherHumanId}, 'member', 'active', ${now}, ${now}, ${now}),
          (${`membership_a_${suffix}`}, ${roomId}, ${companyId}, ${agentId}, 'member', 'active', ${now}, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into agent_room_states (
          room_id, company_id, agent_member_id, trigger_policy,
          trigger_policy_version, thread_id, cursor_sequence,
          eligible_from_sequence, membership_active, membership_version,
          created_at_ms, updated_at_ms
        ) values (
          ${roomId}, ${companyId}, ${agentId}, 'human_explicit',
          1, null, 0, 1, true, 1, ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into company_executors (
          executor_id, company_id, owner_member_id, name, sharing_state,
          status, credential_version, created_at_ms, updated_at_ms
        ) values (
          ${`it_executor_${suffix}`}, ${companyId}, ${humanId}, 'Integration',
          'company_shared', 'connected', 1, ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into member_executor_assignments (
          member_id, company_id, executor_id, assignment_version, state,
          created_at_ms, updated_at_ms
        ) values (
          ${agentId}, ${companyId}, ${`it_executor_${suffix}`}, 1, 'ready',
          ${now}, ${now}
        )
      `);
    });

    const first = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `client_1_${suffix}`,
      markdown: "Hello Agent",
      plainText: "Hello Agent",
      replyToMessageIds: [],
      references: [{ type: "member", id: agentId }],
      nowMs: now + 1,
    });
    assert.equal(first.message.sequence, 1);
    assert.equal(first.executionIds.length, 1);
    const duplicate = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `client_1_${suffix}`,
      markdown: "Hello Agent",
      plainText: "Hello Agent",
      replyToMessageIds: [],
      references: [{ type: "member", id: agentId }],
      nowMs: now + 2,
    });
    assert.equal(duplicate.created, false);
    assert.deepEqual(duplicate.executionIds, []);

    const executionId = first.executionIds[0]!;
    const dispatch = await messages.readExecutionDispatch(executionId);
    assert.ok(dispatch);
    assert.equal(dispatch.room_title, "Room");
    assert.equal(dispatch.agent_display_name, "Agent");
    assert.equal(dispatch.prompt_messages.length, 1);
    assert.equal(dispatch.prompt_messages[0]!.sequence, 1);
    const deliveryRows = rows<{ consumer_name: string }>(await database.db.execute(sql`
      select consumer_name from outbox_deliveries
      where event_id = ${`agent-room-execution:${executionId}`}
    `));
    assert.deepEqual(deliveryRows, [{ consumer_name: "runtime.agent-room-execution" }]);

    const firstCompletion = {
      execution_id: executionId,
      idempotency_key: dispatch.idempotency_key,
      cascade_id: dispatch.cascade_id,
      room_id: roomId,
      agent_member_id: agentId,
      status: "succeeded",
      codex_thread_id: `thread_${suffix}`,
      codex_turn_id: `turn_${suffix}`,
      consumed_through_sequence: 1,
      final_answer_markdown: "**Done** [link](https://example.test)",
      error: null,
      completed_at_ms: now + 3,
    } as const;
    const turnBeforeCompletion = rows<{
      message_id: string;
      revision: string;
      markdown: string;
    }>(await database.db.execute(sql`
      select message_id, revision::text as revision, markdown
      from room_messages
      where source_execution_id = ${executionId}
    `));
    assert.equal(turnBeforeCompletion.length, 1);
    assert.equal(turnBeforeCompletion[0]!.revision, "1");
    assert.equal(turnBeforeCompletion[0]!.markdown, "");
    await messages.completeExecution(firstCompletion);
    await messages.completeExecution(firstCompletion);
    const publishedReply = rows<{
      message_id: string;
      client_message_id: string;
      markdown: string;
      plain_text: string;
      reply_to_message_ids_json: unknown;
      revision: string;
    }>(await database.db.execute(sql`
      select message_id, client_message_id, markdown, plain_text,
        reply_to_message_ids_json, revision::text as revision
      from room_messages
      where source_execution_id = ${executionId}
    `));
    assert.deepEqual(publishedReply, [{
      message_id: turnBeforeCompletion[0]!.message_id,
      client_message_id: `agent-room-turn:${executionId}`,
      markdown: "**Done** [link](https://example.test)",
      plain_text: "Done link",
      reply_to_message_ids_json: [first.message.messageId],
      revision: "2",
    }]);
    const state = await messages.getTriggerPolicy({
      roomId,
      companyId,
      agentMemberId: agentId,
      requestedByMemberId: humanId,
    });
    assert.equal(state.threadId, `thread_${suffix}`);
    assert.equal(state.cursorSequence, 1);
    const cascade = rows<{ status: string }>(await database.db.execute(sql`
      select status from agent_room_cascades where cascade_id = ${dispatch.cascade_id}
    `));
    assert.deepEqual(cascade, [{ status: "silent_completed" }]);

    const policyCases = [
      ["member_explicit", [{ type: "member", id: agentId }]],
      ["human_auto", []],
      ["member_auto", []],
      ["human_explicit_agent_auto", [{ type: "member", id: agentId }]],
      ["agent_explicit_human_auto", []],
    ] as const;
    let expectedSequence = 3;
    for (const [policy, references] of policyCases) {
      await messages.setTriggerPolicy({
        roomId,
        companyId,
        agentMemberId: agentId,
        requestedByMemberId: humanId,
        policy,
        nowMs: now + expectedSequence,
      });
      const sent = await messages.send({
        roomId,
        companyId,
        senderMemberId: humanId,
        senderType: "human",
        clientMessageId: `client_${expectedSequence}_${suffix}`,
        markdown: `message ${expectedSequence}`,
        plainText: `message ${expectedSequence}`,
        replyToMessageIds: [],
        references: [...references],
        nowMs: now + expectedSequence + 1,
      });
      assert.equal(sent.message.sequence, expectedSequence);
      assert.equal(sent.executionIds.length, 1);
      const nextDispatch = await messages.readExecutionDispatch(sent.executionIds[0]!);
      assert.ok(nextDispatch);
      await messages.completeExecution({
        execution_id: nextDispatch.execution_id,
        idempotency_key: nextDispatch.idempotency_key,
        cascade_id: nextDispatch.cascade_id,
        room_id: roomId,
        agent_member_id: agentId,
        status: "succeeded",
        codex_thread_id: `thread_${suffix}`,
        codex_turn_id: `turn_${suffix}`,
        consumed_through_sequence: expectedSequence,
        ...(policy === "member_auto"
          ? { final_answer_markdown: "Member-auto output" }
          : {}),
        error: null,
        completed_at_ms: now + expectedSequence + 2,
      });
      if (policy === "member_auto") {
        const selfTriggerRows = rows<{ count: string }>(await database.db.execute(sql`
          select count(*)::text as count
          from agent_room_executions execution
          join room_messages message on message.message_id = execution.source_message_id
          where message.source_execution_id = ${nextDispatch.execution_id}
            and execution.agent_member_id = ${agentId}
        `));
        assert.deepEqual(selfTriggerRows, [{ count: "0" }]);
      }
      expectedSequence += 2;
    }

    const runningTrigger = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `remove_running_${suffix}`,
      markdown: "Run while membership changes",
      plainText: "Run while membership changes",
      replyToMessageIds: [],
      references: [],
      nowMs: now + expectedSequence,
    });
    assert.equal(runningTrigger.executionIds.length, 1);
    const runningExecutionId = runningTrigger.executionIds[0]!;
    const runningDispatch = await messages.readExecutionDispatch(runningExecutionId);
    assert.ok(runningDispatch);
    await messages.recordExecutionStarted({
      executionId: runningExecutionId,
      threadId: `thread_${suffix}`,
      nowMs: now + expectedSequence + 1,
    });
    const activityReceipt = await messages.recordActivityProjection({
      eventId: `activity_${suffix}`,
      executionId: runningExecutionId,
      roomId,
      agentMemberId: agentId,
      occurredAtMs: now + expectedSequence + 1,
      snapshot: {
        turn_id: `turn_${suffix}`,
        status: "running",
        started_at_ms: now + expectedSequence + 1,
        completed_at_ms: null,
        duration_ms: null,
        error: null,
        narrative_items: [],
        activity_items: [],
      },
      interaction: {
        id: `activity_${suffix}`,
        kind: "delegation_check",
        label: "Approve delegated work?",
        status: "pending",
        responses: [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }],
      },
      resolvedInteractionId: null,
    });
    assert.equal(activityReceipt.duplicate, false);
    assert.ok(activityReceipt.interactionId);
    const duplicateActivity = await messages.recordActivityProjection({
      eventId: `activity_${suffix}`,
      executionId: runningExecutionId,
      roomId,
      agentMemberId: agentId,
      occurredAtMs: now + expectedSequence + 1,
      snapshot: {
        turn_id: `turn_${suffix}`,
        status: "running",
        started_at_ms: now + expectedSequence + 1,
        completed_at_ms: null,
        duration_ms: null,
        error: null,
        narrative_items: [],
        activity_items: [],
      },
      interaction: {
        id: `activity_duplicate_${suffix}`,
        kind: "delegation_check",
        label: "This duplicate must not create another interaction.",
        status: "pending",
        responses: [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }],
      },
      resolvedInteractionId: null,
    });
    assert.equal(duplicateActivity.duplicate, true);
    assert.equal(duplicateActivity.interactionId, activityReceipt.interactionId);
    const interactionRows = rows<{ message_id: string }>(await database.db.execute(sql`
      select message_id from room_interactions
      where interaction_id = ${activityReceipt.interactionId!}
    `));
    const runningTurnRows = rows<{ message_id: string }>(await database.db.execute(sql`
      select message_id from room_messages
      where source_execution_id = ${runningExecutionId}
    `));
    assert.deepEqual(interactionRows, runningTurnRows);
    const interactionResponse = await messages.persistInteractionResponse({
      roomId,
      companyId,
      messageId: interactionRows[0]!.message_id,
      interactionId: activityReceipt.interactionId!,
      responderMemberId: humanId,
      response: "approve",
      clientResponseId: `response_${suffix}`,
      nowMs: now + expectedSequence + 2,
    });
    const duplicateResponse = await messages.persistInteractionResponse({
      roomId,
      companyId,
      messageId: interactionRows[0]!.message_id,
      interactionId: activityReceipt.interactionId!,
      responderMemberId: humanId,
      response: "approve",
      clientResponseId: `response_${suffix}`,
      nowMs: now + expectedSequence + 3,
    });
    assert.equal(
      duplicateResponse.dispatch.persisted_response_id,
      interactionResponse.dispatch.persisted_response_id,
    );
    await messages.markInteractionResponseDelivered(interactionResponse.dispatch, {
      accepted: true,
      persisted_response_id: interactionResponse.dispatch.persisted_response_id,
      idempotency_key: interactionResponse.dispatch.idempotency_key,
      duplicate: false,
    }, now + expectedSequence + 3);
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        update room_memberships
        set status = 'inactive', updated_at_ms = ${now + expectedSequence + 2}
        where room_id = ${roomId} and actor_id = ${agentId}
      `);
      await transaction.execute(sql`
        update agent_room_states
        set membership_active = false, membership_version = membership_version + 1,
          updated_at_ms = ${now + expectedSequence + 2}
        where room_id = ${roomId} and agent_member_id = ${agentId}
      `);
    });
    const completedAfterRemoval = await messages.completeExecution({
      execution_id: runningExecutionId,
      idempotency_key: runningDispatch.idempotency_key,
      cascade_id: runningDispatch.cascade_id,
      room_id: roomId,
      agent_member_id: agentId,
      status: "succeeded",
      codex_thread_id: `thread_${suffix}`,
      codex_turn_id: `turn_${suffix}`,
      consumed_through_sequence: runningDispatch.source_message_sequence,
      error: null,
      completed_at_ms: now + expectedSequence + 3,
    });
    assert.equal(completedAfterRemoval.status, "succeeded");

    const absentMessage = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `while_absent_${suffix}`,
      markdown: "Do not consume this",
      plainText: "Do not consume this",
      replyToMessageIds: [],
      references: [],
      nowMs: now + expectedSequence + 4,
    });
    assert.deepEqual(absentMessage.executionIds, []);
    const nextSequenceRows = rows<{ next_message_sequence: string }>(await database.db.execute(sql`
      select next_message_sequence::text as next_message_sequence
      from rooms where id = ${roomId}
    `));
    const eligibleFromSequence = Number(nextSequenceRows[0]!.next_message_sequence);
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        update room_memberships
        set status = 'active', joined_at_ms = ${now + expectedSequence + 5},
          updated_at_ms = ${now + expectedSequence + 5}
        where room_id = ${roomId} and actor_id = ${agentId}
      `);
      await transaction.execute(sql`
        update agent_room_states
        set membership_active = true, membership_version = membership_version + 1,
          eligible_from_sequence = ${eligibleFromSequence},
          updated_at_ms = ${now + expectedSequence + 5}
        where room_id = ${roomId} and agent_member_id = ${agentId}
      `);
    });
    const afterRejoin = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `after_rejoin_${suffix}`,
      markdown: "Consume only this",
      plainText: "Consume only this",
      replyToMessageIds: [],
      references: [],
      nowMs: now + expectedSequence + 6,
    });
    assert.equal(afterRejoin.executionIds.length, 1);
    const rejoinDispatch = await messages.readExecutionDispatch(afterRejoin.executionIds[0]!);
    assert.ok(rejoinDispatch);
    assert.equal(rejoinDispatch.thread.codex_thread_id, `thread_${suffix}`);
    assert.deepEqual(
      rejoinDispatch.prompt_messages.map((message) => message.message_id),
      [afterRejoin.message.messageId],
    );

    const watchAbort = new AbortController();
    const watcher = messages.watch({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      signal: watchAbort.signal,
    });
    const nextMessage = watcher.next();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const watched = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `watch_once_${suffix}`,
      markdown: "Watch once",
      plainText: "Watch once",
      replyToMessageIds: [],
      references: [],
      nowMs: now + expectedSequence + 7,
    });
    const watchedDuplicate = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `watch_once_${suffix}`,
      markdown: "Watch once",
      plainText: "Watch once",
      replyToMessageIds: [],
      references: [],
      nowMs: now + expectedSequence + 8,
    });
    assert.equal(watchedDuplicate.created, false);
    const watchedEvent = (await nextMessage).value;
    assert.equal(watchedEvent?.type, "message");
    assert.equal(
      watchedEvent?.type === "message" ? watchedEvent.message.messageId : undefined,
      watched.message.messageId,
    );
    watchAbort.abort();
    await watcher.return(undefined);

    const mutationClock = now + 100_000;
    await assert.rejects(
      messages.edit({
        roomId,
        companyId,
        requestedByMemberId: otherHumanId,
        messageId: watched.message.messageId,
        expectedRevision: 1,
        markdown: "Other member cannot edit this",
        idempotencyKey: `edit_forbidden_${suffix}`,
        nowMs: mutationClock,
      }),
      hasApplicationCode("ROOM_MESSAGE_NOT_OWNED"),
    );
    await assert.rejects(
      messages.edit({
        roomId,
        companyId,
        requestedByMemberId: humanId,
        messageId: publishedReply[0]!.message_id,
        expectedRevision: 2,
        markdown: "Agent messages cannot be edited",
        idempotencyKey: `edit_agent_${suffix}`,
        nowMs: mutationClock + 1,
      }),
      hasApplicationCode("ROOM_MESSAGE_NOT_OWNED"),
    );

    const edited = await messages.edit({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      messageId: watched.message.messageId,
      expectedRevision: 1,
      markdown: "Edited once",
      idempotencyKey: `edit_once_${suffix}`,
      nowMs: mutationClock + 2,
    });
    assert.equal(edited.revision, 2);
    assert.equal(edited.markdown, "Edited once");
    assert.equal((await messages.edit({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      messageId: watched.message.messageId,
      expectedRevision: 1,
      markdown: "Edited once",
      idempotencyKey: `edit_once_${suffix}`,
      nowMs: mutationClock + 3,
    })).revision, 2);
    await assert.rejects(
      messages.edit({
        roomId,
        companyId,
        requestedByMemberId: humanId,
        messageId: watched.message.messageId,
        expectedRevision: 1,
        markdown: "Stale edit",
        idempotencyKey: `edit_stale_${suffix}`,
        nowMs: mutationClock + 4,
      }),
      hasApplicationCode("ROOM_MESSAGE_REVISION_CONFLICT"),
    );
    const tombstone = await messages.softDelete({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      messageId: watched.message.messageId,
      expectedRevision: 2,
      idempotencyKey: `delete_once_${suffix}`,
      nowMs: mutationClock + 5,
    });
    assert.equal(tombstone.revision, 3);
    assert.equal(tombstone.markdown, "");
    assert.equal(tombstone.deletedAtMs, mutationClock + 5);
    assert.equal((await messages.softDelete({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      messageId: watched.message.messageId,
      expectedRevision: 2,
      idempotencyKey: `delete_once_${suffix}`,
      nowMs: mutationClock + 6,
    })).revision, 3);
    const auditRows = rows<{
      revision: string;
      markdown: string;
      deleted: boolean;
    }>(await database.db.execute(sql`
      select revision::text as revision, markdown, deleted
      from room_message_revisions
      where message_id = ${watched.message.messageId}
      order by revision asc
    `));
    assert.deepEqual(auditRows, [
      { revision: "1", markdown: "Watch once", deleted: false },
      { revision: "2", markdown: "Edited once", deleted: false },
      { revision: "3", markdown: "", deleted: true },
    ]);

    const regenerated = await messages.regenerateAgentReply({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      messageId: publishedReply[0]!.message_id,
      expectedRevision: 2,
      idempotencyKey: `regenerate_once_${suffix}`,
      nowMs: mutationClock + 7,
    });
    const regeneratedReplay = await messages.regenerateAgentReply({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      messageId: publishedReply[0]!.message_id,
      expectedRevision: 2,
      idempotencyKey: `regenerate_once_${suffix}`,
      nowMs: mutationClock + 8,
    });
    assert.equal(regeneratedReplay.executionId, regenerated.executionId);
    assert.equal(regeneratedReplay.message.messageId, regenerated.message.messageId);
    assert.equal(regenerated.versionNumber, 2);
    assert.equal(regenerated.message.markdown, "");
    const regeneratedDispatch = await messages.readExecutionDispatch(regenerated.executionId);
    assert.ok(regeneratedDispatch);
    assert.equal(regeneratedDispatch.regeneration?.source_execution_id, executionId);
    assert.equal(regeneratedDispatch.regeneration?.fork_parent_thread_id, `thread_${suffix}`);
    assert.equal(regeneratedDispatch.regeneration?.fork_before_turn_id, `turn_${suffix}`);
    assert.equal(regeneratedDispatch.source_message_id, first.message.messageId);
    assert.equal(regeneratedDispatch.thread.codex_thread_id, `thread_${suffix}`);
    assert.deepEqual(
      regeneratedDispatch.prompt_messages.map((message) => message.message_id),
      dispatch.prompt_messages.map((message) => message.message_id),
    );
    await messages.completeExecution({
      execution_id: regenerated.executionId,
      idempotency_key: regeneratedDispatch.idempotency_key,
      cascade_id: regeneratedDispatch.cascade_id,
      room_id: roomId,
      agent_member_id: agentId,
      status: "succeeded",
      codex_thread_id: `thread_regenerated_${suffix}`,
      codex_turn_id: `turn_regenerated_${suffix}`,
      consumed_through_sequence: regeneratedDispatch.source_message_sequence,
      final_answer_markdown: "Regenerated answer",
      error: null,
      completed_at_ms: mutationClock + 9,
    });

    const ownerVersions = (await messages.list({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      beforeSequence: null,
      limit: 100,
    })).filter((message) => message.versionGroupId === regenerated.versionGroupId);
    assert.equal(ownerVersions.length, 2);
    assert.equal(ownerVersions.find((message) => message.messageId === regenerated.message.messageId)?.selectedVersionMessageId, regenerated.message.messageId);
    assert.equal(ownerVersions.find((message) => message.messageId === regenerated.message.messageId)?.versionCount, 2);
    const otherVersions = (await messages.list({
      roomId,
      companyId,
      requestedByMemberId: otherHumanId,
      beforeSequence: null,
      limit: 100,
    })).filter((message) => message.versionGroupId === regenerated.versionGroupId);
    assert.equal(otherVersions.find((message) => message.messageId === regenerated.message.messageId)?.selectedVersionMessageId, regenerated.message.messageId);
    assert.equal(otherVersions[0]?.selectionRevision, 0);

    const selectedOriginal = await messages.selectAgentReplyVersion({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      versionGroupId: regenerated.versionGroupId,
      messageId: publishedReply[0]!.message_id,
      expectedRevision: 1,
      idempotencyKey: `select_original_${suffix}`,
      nowMs: mutationClock + 10,
    });
    assert.equal(selectedOriginal.revision, 2);
    assert.deepEqual(
      await messages.selectAgentReplyVersion({
        roomId,
        companyId,
        requestedByMemberId: humanId,
        versionGroupId: regenerated.versionGroupId,
        messageId: publishedReply[0]!.message_id,
        expectedRevision: 1,
        idempotencyKey: `select_original_${suffix}`,
        nowMs: mutationClock + 11,
      }),
      selectedOriginal,
    );
    const ownerAfterSelection = (await messages.list({
      roomId,
      companyId,
      requestedByMemberId: humanId,
      beforeSequence: null,
      limit: 100,
    })).find((message) => message.messageId === publishedReply[0]!.message_id);
    const otherAfterSelection = (await messages.list({
      roomId,
      companyId,
      requestedByMemberId: otherHumanId,
      beforeSequence: null,
      limit: 100,
    })).find((message) => message.messageId === publishedReply[0]!.message_id);
    assert.equal(ownerAfterSelection?.selectedVersionMessageId, publishedReply[0]!.message_id);
    assert.equal(ownerAfterSelection?.selectionRevision, 2);
    assert.equal(otherAfterSelection?.selectedVersionMessageId, regenerated.message.messageId);
    assert.equal(otherAfterSelection?.selectionRevision, 0);

    await assert.rejects(
      messages.send({
        roomId,
        companyId,
        senderMemberId: otherHumanId,
        senderType: "human",
        clientMessageId: `wrong_branch_${suffix}`,
        markdown: "Cannot continue another member's selected old version",
        plainText: "Cannot continue another member's selected old version",
        replyToMessageIds: [],
        branchMessageId: publishedReply[0]!.message_id,
        references: [],
        nowMs: mutationClock + 12,
      }),
      hasApplicationCode("ROOM_MESSAGE_INVALID"),
    );
    const continued = await messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId: `selected_branch_${suffix}`,
      markdown: "Continue selected original",
      plainText: "Continue selected original",
      replyToMessageIds: [],
      branchMessageId: publishedReply[0]!.message_id,
      references: [],
      nowMs: mutationClock + 13,
    });
    assert.equal(continued.executionIds.length, 1);
    assert.equal(continued.message.threadId, `thread_${suffix}`);
    const continuedDispatch = await messages.readExecutionDispatch(continued.executionIds[0]!);
    assert.ok(continuedDispatch);
    assert.equal(continuedDispatch.agent_member_id, agentId);
    assert.equal(continuedDispatch.thread.codex_thread_id, `thread_${suffix}`);
    await messages.completeExecution({
      execution_id: continuedDispatch.execution_id,
      idempotency_key: continuedDispatch.idempotency_key,
      cascade_id: continuedDispatch.cascade_id,
      room_id: roomId,
      agent_member_id: agentId,
      status: "succeeded",
      codex_thread_id: `thread_${suffix}`,
      codex_turn_id: `turn_continued_${suffix}`,
      consumed_through_sequence: continuedDispatch.source_message_sequence,
      error: null,
      completed_at_ms: mutationClock + 14,
    });

    const actorDirectory = new PostgresActorDirectoryRepository(
      database.db,
      postgresTransactionForOwner,
    );
    const actorUnitOfWork = new PostgresOwnerUnitOfWork(database.db);
    await actorUnitOfWork.execute("actor", (transaction) => (
      actorDirectory.deactivateOrdinaryAgent(transaction, {
        actorId: agentId,
        companyId,
        updatedAtMs: now + expectedSequence + 9,
      })
    ));
    const cleanupRows = rows<{
      operation_id: string;
      status: string;
      membership_count: string;
      pending_execution_count: string;
    }>(await database.db.execute(sql`
      select operation.operation_id, operation.status,
        (
          select count(*)::text from room_memberships membership
          where membership.company_id = operation.company_id
            and membership.actor_id = operation.member_id
            and membership.status = 'active'
        ) as membership_count,
        (
          select count(*)::text from agent_room_executions execution
          where execution.company_id = operation.company_id
            and execution.agent_member_id = operation.member_id
            and execution.status in ('pending', 'dispatched')
        ) as pending_execution_count
      from agent_member_cleanup_operations operation
      where operation.company_id = ${companyId} and operation.member_id = ${agentId}
    `));
    assert.equal(cleanupRows.length, 1);
    assert.equal(cleanupRows[0]!.status, "pending");
    assert.equal(cleanupRows[0]!.membership_count, "0");
    assert.equal(cleanupRows[0]!.pending_execution_count, "0");
    const cleanupOutbox = rows<{ event_type: string }>(await database.db.execute(sql`
      select event_type from outbox_events
      where aggregate_type = 'agent_member_cleanup'
        and aggregate_id = ${cleanupRows[0]!.operation_id}
    `));
    assert.deepEqual(cleanupOutbox, [{
      event_type: "execution.agent_member_cleanup_requested.v1",
    }]);
    await actorDirectory.finalizeAgentMemberCleanup(
      cleanupRows[0]!.operation_id,
      now + expectedSequence + 10,
    );
    const finalizedRows = rows<{
      status: string;
      state_count: string;
      assignment_count: string;
    }>(await database.db.execute(sql`
      select operation.status,
        (
          select count(*)::text from agent_room_states state
          where state.company_id = operation.company_id
            and state.agent_member_id = operation.member_id
        ) as state_count,
        (
          select count(*)::text from member_executor_assignments assignment
          where assignment.company_id = operation.company_id
            and assignment.member_id = operation.member_id
        ) as assignment_count
      from agent_member_cleanup_operations operation
      where operation.operation_id = ${cleanupRows[0]!.operation_id}
    `));
    assert.deepEqual(finalizedRows, [{
      status: "succeeded",
      state_count: "0",
      assignment_count: "0",
    }]);
  } finally {
    await database.db.execute(sql`delete from rooms where company_id = ${companyId}`);
    await database.db.execute(sql`delete from agent_member_cleanup_operations where company_id = ${companyId}`);
    await database.db.execute(sql`delete from member_executor_assignments where company_id = ${companyId}`);
    await database.db.execute(sql`delete from company_executors where company_id = ${companyId}`);
    await database.db.execute(sql`delete from actors where company_id = ${companyId}`);
    await database.db.execute(sql`delete from companies where id = ${companyId}`);
    await database.close();
  }
});

test("real PostgreSQL prompt projection follows only the bounded reply ancestry", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({
    databaseUrl: integrationDatabaseUrl,
  });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_prompt_company_${suffix}`;
  const humanId = `it_prompt_human_${suffix}`;
  const agentId = `it_prompt_agent_${suffix}`;
  const roomId = `it_prompt_room_${suffix}`;
  const now = Date.now();
  const messages = new PostgresRoomMessageRepository(database.db);
  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into companies (id, name, status, created_at_ms, updated_at_ms)
        values (${companyId}, 'Prompt integration', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          created_at_ms, updated_at_ms
        ) values
          (${humanId}, ${companyId}, 'human', 'Prompt Human', 'PH', 'owner', 'active', ${now}, ${now}),
          (${agentId}, ${companyId}, 'agent', 'Prompt Agent', 'PA', 'member', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into rooms (
          id, company_id, name, status, created_by_actor_id,
          membership_version, next_message_sequence, created_at_ms, updated_at_ms
        ) values (
          ${roomId}, ${companyId}, 'Prompt Room', 'active', ${humanId},
          1, 1, ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into room_memberships (
          id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
        ) values
          (${`it_prompt_h_${suffix}`}, ${roomId}, ${companyId}, ${humanId}, 'owner', 'active', ${now}, ${now}, ${now}),
          (${`it_prompt_a_${suffix}`}, ${roomId}, ${companyId}, ${agentId}, 'member', 'active', ${now}, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into agent_room_states (
          room_id, company_id, agent_member_id, trigger_policy,
          trigger_policy_version, thread_id, cursor_sequence,
          eligible_from_sequence, membership_active, membership_version,
          created_at_ms, updated_at_ms
        ) values (
          ${roomId}, ${companyId}, ${agentId}, 'human_explicit',
          1, null, 0, 1, true, 1, ${now}, ${now}
        )
      `);
    });

    let clock = now;
    const sendHuman = (
      clientMessageId: string,
      replyToMessageIds: readonly string[] = [],
      mentionAgent = false,
    ) => messages.send({
      roomId,
      companyId,
      senderMemberId: humanId,
      senderType: "human",
      clientMessageId,
      markdown: clientMessageId,
      plainText: clientMessageId,
      replyToMessageIds,
      references: mentionAgent ? [{ type: "member", id: agentId }] : [],
      nowMs: ++clock,
    });
    const completeSilently = async (
      dispatch: NonNullable<Awaited<ReturnType<typeof messages.readExecutionDispatch>>>,
    ) => messages.completeExecution({
      execution_id: dispatch.execution_id,
      idempotency_key: dispatch.idempotency_key,
      cascade_id: dispatch.cascade_id,
      room_id: roomId,
      agent_member_id: agentId,
      status: "succeeded",
      codex_thread_id: `thread_prompt_${suffix}`,
      codex_turn_id: `turn_prompt_${suffix}`,
      consumed_through_sequence: dispatch.source_message_sequence,
      error: null,
      completed_at_ms: ++clock,
    });

    const backlogIds: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const sent = await sendHuman(`backlog_${index}_${suffix}`);
      backlogIds.push(sent.message.messageId);
      assert.deepEqual(sent.executionIds, []);
    }

    const chainIds: string[] = [];
    let parentId: string | null = null;
    for (let index = 0; index < 12; index += 1) {
      const sent = await sendHuman(
        `chain_${index}_${suffix}`,
        parentId === null ? [] : [parentId],
      );
      chainIds.push(sent.message.messageId);
      parentId = sent.message.messageId;
    }
    const deepTrigger = await sendHuman(
      `deep_trigger_${suffix}`,
      [parentId!],
      true,
    );
    const deepDispatch = await messages.readExecutionDispatch(deepTrigger.executionIds[0]!);
    assert.ok(deepDispatch);
    assert.equal(deepDispatch.room_title, "Prompt Room");
    assert.equal(deepDispatch.agent_display_name, "Prompt Agent");
    assert.deepEqual(
      deepDispatch.prompt_messages.map((message) => message.message_id),
      [...chainIds.slice(-10), deepTrigger.message.messageId],
    );
    assert.equal(
      deepDispatch.prompt_messages.some((message) => backlogIds.includes(message.message_id)),
      false,
    );
    await completeSilently(deepDispatch);

    const brokenParent = await sendHuman(`broken_parent_${suffix}`);
    await database.db.execute(sql`
      update room_messages
      set reply_to_message_ids_json = ${JSON.stringify([`missing_${suffix}`])}::jsonb
      where message_id = ${brokenParent.message.messageId}
    `);
    const brokenTrigger = await sendHuman(
      `broken_trigger_${suffix}`,
      [brokenParent.message.messageId],
      true,
    );
    const brokenDispatch = await messages.readExecutionDispatch(brokenTrigger.executionIds[0]!);
    assert.ok(brokenDispatch);
    assert.deepEqual(
      brokenDispatch.prompt_messages.map((message) => message.message_id),
      [brokenParent.message.messageId, brokenTrigger.message.messageId],
    );
    await completeSilently(brokenDispatch);

    const cycleA = await sendHuman(`cycle_a_${suffix}`);
    const cycleB = await sendHuman(`cycle_b_${suffix}`, [cycleA.message.messageId]);
    await database.db.execute(sql`
      update room_messages
      set reply_to_message_ids_json = ${JSON.stringify([cycleB.message.messageId])}::jsonb
      where message_id = ${cycleA.message.messageId}
    `);
    const cycleTrigger = await sendHuman(
      `cycle_trigger_${suffix}`,
      [cycleB.message.messageId],
      true,
    );
    const cycleDispatch = await messages.readExecutionDispatch(cycleTrigger.executionIds[0]!);
    assert.ok(cycleDispatch);
    assert.deepEqual(
      cycleDispatch.prompt_messages.map((message) => message.message_id),
      [cycleA.message.messageId, cycleB.message.messageId, cycleTrigger.message.messageId],
    );
    await completeSilently(cycleDispatch);
  } finally {
    await database.db.execute(sql`delete from rooms where company_id = ${companyId}`);
    await database.db.execute(sql`delete from companies where id = ${companyId}`);
    await database.db.execute(sql`delete from actors where company_id = ${companyId}`);
    await database.close();
  }
});

test("real PostgreSQL Executor switch sends all authoritative Agent-Room Thread ids", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({
    databaseUrl: integrationDatabaseUrl,
  });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_company_${suffix}`;
  const ownerId = `it_owner_${suffix}`;
  const agentId = `it_agent_${suffix}`;
  const oldExecutorId = `it_executor_old_${suffix}`;
  const newExecutorId = `it_executor_new_${suffix}`;
  const roomA = `it_room_a_${suffix}`;
  const roomB = `it_room_b_${suffix}`;
  const now = Date.now();
  let runtimeThreads: readonly string[] = [];
  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into companies (id, name, status, created_at_ms, updated_at_ms)
        values (${companyId}, 'Executor integration', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          created_at_ms, updated_at_ms
        ) values
          (${ownerId}, ${companyId}, 'human', 'Owner', 'OW', 'owner', 'active', ${now}, ${now}),
          (${agentId}, ${companyId}, 'agent', 'Agent', 'AG', 'member', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into company_executors (
          executor_id, company_id, owner_member_id, name, sharing_state,
          status, credential_version, created_at_ms, updated_at_ms
        ) values
          (${oldExecutorId}, ${companyId}, ${ownerId}, 'Old', 'company_shared', 'connected', 1, ${now}, ${now}),
          (${newExecutorId}, ${companyId}, ${ownerId}, 'New', 'company_shared', 'connected', 2, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into member_executor_assignments (
          member_id, company_id, executor_id, assignment_version, state,
          created_at_ms, updated_at_ms
        ) values (${agentId}, ${companyId}, ${oldExecutorId}, 1, 'ready', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into rooms (
          id, company_id, name, status, created_by_actor_id,
          membership_version, next_message_sequence, created_at_ms, updated_at_ms
        ) values
          (${roomA}, ${companyId}, 'A', 'active', ${ownerId}, 1, 1, ${now}, ${now}),
          (${roomB}, ${companyId}, 'B', 'active', ${ownerId}, 1, 1, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into agent_room_states (
          room_id, company_id, agent_member_id, trigger_policy,
          trigger_policy_version, thread_id, cursor_sequence,
          eligible_from_sequence, membership_active, membership_version,
          created_at_ms, updated_at_ms
        ) values
          (${roomA}, ${companyId}, ${agentId}, 'human_explicit', 1, ${`thread_a_${suffix}`}, 0, 1, true, 1, ${now}, ${now}),
          (${roomB}, ${companyId}, ${agentId}, 'human_explicit', 1, ${`thread_b_${suffix}`}, 0, 1, true, 1, ${now}, ${now})
      `);
    });
    const repository = new PostgresMemberExecutorAssignmentRepository(database.db);
    const service = new MemberExecutorAssignmentService(
      repository,
      {
        switchExecutor: async (_runtimeCompanyId, input) => {
          runtimeThreads = input.codex_thread_ids;
          return {
            member_id: input.member_id,
            assignment_version: input.assignment_version,
            outcome: "switched",
            session_state: "ready",
            executor_id: input.target_executor_id,
            resumed_codex_thread_ids: [...input.codex_thread_ids],
            error: null,
          };
        },
        stopMemberAppServer: async (_runtimeCompanyId, memberId) => ({
          member_id: memberId,
          stopped: true as const,
        }),
      },
      () => now + 1,
      () => `switch_${suffix}`,
    );
    const assignment = await service.set({
      companyId,
      memberId: agentId,
      executorId: newExecutorId,
      authority: { kind: "company_owner", requestedByMemberId: ownerId },
    });
    assert.deepEqual(runtimeThreads, [`thread_a_${suffix}`, `thread_b_${suffix}`]);
    assert.equal(assignment.executor.executorId, newExecutorId);
    assert.equal(assignment.assignmentVersion, 2);
    assert.equal(assignment.state, "ready");
  } finally {
    await database.db.execute(sql`delete from rooms where company_id = ${companyId}`);
    await database.db.execute(sql`delete from agent_member_cleanup_operations where company_id = ${companyId}`);
    await database.db.execute(sql`delete from member_executor_assignments where company_id = ${companyId}`);
    await database.db.execute(sql`delete from company_executors where company_id = ${companyId}`);
    await database.db.execute(sql`delete from actors where company_id = ${companyId}`);
    await database.db.execute(sql`delete from companies where id = ${companyId}`);
    await database.close();
  }
});

test("real PostgreSQL enforces all trigger policies and member-auto Agent cascades", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl: integrationDatabaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_company_${suffix}`;
  const humanId = `it_human_${suffix}`;
  const agentA = `it_agent_a_${suffix}`;
  const agentB = `it_agent_b_${suffix}`;
  const roomId = `it_room_${suffix}`;
  const now = Date.now();
  const messages = new PostgresRoomMessageRepository(database.db);
  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into companies (id, name, status, created_at_ms, updated_at_ms)
        values (${companyId}, 'Policy integration', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          created_at_ms, updated_at_ms
        ) values
          (${humanId}, ${companyId}, 'human', 'Human', 'HU', 'owner', 'active', ${now}, ${now}),
          (${agentA}, ${companyId}, 'agent', 'Agent A', 'AA', 'member', 'active', ${now}, ${now}),
          (${agentB}, ${companyId}, 'agent', 'Agent B', 'AB', 'member', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into rooms (
          id, company_id, name, status, created_by_actor_id,
          membership_version, next_message_sequence, created_at_ms, updated_at_ms
        ) values (${roomId}, ${companyId}, 'Policy Room', 'active', ${humanId}, 1, 1, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into room_memberships (
          id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
        ) values
          (${`membership_h_${suffix}`}, ${roomId}, ${companyId}, ${humanId}, 'owner', 'active', ${now}, ${now}, ${now}),
          (${`membership_a_${suffix}`}, ${roomId}, ${companyId}, ${agentA}, 'member', 'active', ${now}, ${now}, ${now}),
          (${`membership_b_${suffix}`}, ${roomId}, ${companyId}, ${agentB}, 'member', 'active', ${now}, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into agent_room_states (
          room_id, company_id, agent_member_id, trigger_policy,
          trigger_policy_version, thread_id, cursor_sequence,
          eligible_from_sequence, membership_active, membership_version,
          created_at_ms, updated_at_ms
        ) values
          (${roomId}, ${companyId}, ${agentA}, 'human_explicit', 1, null, 0, 1, true, 1, ${now}, ${now}),
          (${roomId}, ${companyId}, ${agentB}, 'human_explicit', 1, null, 0, 1, true, 1, ${now}, ${now})
      `);
    });

    const send = (
      senderMemberId: string,
      senderType: "human" | "agent",
      clientMessageId: string,
      references: readonly { type: string; id: string }[] = [],
    ) => messages.send({
      roomId,
      companyId,
      senderMemberId,
      senderType,
      clientMessageId,
      markdown: clientMessageId,
      plainText: clientMessageId,
      replyToMessageIds: [],
      references: [...references],
      nowMs: Date.now(),
    });
    const complete = async (
      executionId: string,
      threadId: string,
      finalAnswer: string | null,
    ) => {
      const dispatch = await messages.readExecutionDispatch(executionId);
      assert.ok(dispatch);
      return messages.completeExecution({
        execution_id: dispatch.execution_id,
        idempotency_key: dispatch.idempotency_key,
        cascade_id: dispatch.cascade_id,
        room_id: roomId,
        agent_member_id: dispatch.agent_member_id,
        status: "succeeded",
        codex_thread_id: threadId,
        codex_turn_id: `turn_${dispatch.execution_id}`,
        consumed_through_sequence: dispatch.source_message_sequence,
        ...(finalAnswer === null ? {} : { final_answer_markdown: finalAnswer }),
        error: null,
        completed_at_ms: Date.now(),
      });
    };

    const humanExplicitRejectsAgent = await send(
      agentB,
      "agent",
      `human_explicit_agent_${suffix}`,
      [{ type: "member", id: agentA }],
    );
    assert.deepEqual(humanExplicitRejectsAgent.executionIds, []);
    const humanExplicitAcceptsHuman = await send(
      humanId,
      "human",
      `human_explicit_human_${suffix}`,
      [{ type: "member", id: agentA }],
    );
    assert.equal(humanExplicitAcceptsHuman.executionIds.length, 1);
    await complete(humanExplicitAcceptsHuman.executionIds[0]!, `thread_a_${suffix}`, null);

    await messages.setTriggerPolicy({
      roomId,
      companyId,
      agentMemberId: agentA,
      requestedByMemberId: humanId,
      policy: "member_explicit",
      nowMs: Date.now(),
    });
    const memberExplicit = await send(
      agentB,
      "agent",
      `member_explicit_${suffix}`,
      [{ type: "member", id: agentA }],
    );
    assert.equal(memberExplicit.executionIds.length, 1);
    await complete(memberExplicit.executionIds[0]!, `thread_a_${suffix}`, null);

    await messages.setTriggerPolicy({
      roomId,
      companyId,
      agentMemberId: agentA,
      requestedByMemberId: humanId,
      policy: "human_explicit_agent_auto",
      nowMs: Date.now(),
    });
    assert.deepEqual((await send(
      humanId,
      "human",
      `human_explicit_agent_auto_human_passive_${suffix}`,
    )).executionIds, []);
    const humanExplicitAgentAutoHuman = await send(
      humanId,
      "human",
      `human_explicit_agent_auto_human_explicit_${suffix}`,
      [{ type: "member", id: agentA }],
    );
    assert.equal(humanExplicitAgentAutoHuman.executionIds.length, 1);
    await complete(
      humanExplicitAgentAutoHuman.executionIds[0]!,
      `thread_a_${suffix}`,
      null,
    );
    const humanExplicitAgentAutoAgent = await send(
      agentB,
      "agent",
      `human_explicit_agent_auto_agent_passive_${suffix}`,
    );
    assert.equal(humanExplicitAgentAutoAgent.executionIds.length, 1);
    await complete(
      humanExplicitAgentAutoAgent.executionIds[0]!,
      `thread_a_${suffix}`,
      null,
    );

    await messages.setTriggerPolicy({
      roomId,
      companyId,
      agentMemberId: agentA,
      requestedByMemberId: humanId,
      policy: "agent_explicit_human_auto",
      nowMs: Date.now(),
    });
    const agentExplicitHumanAutoHuman = await send(
      humanId,
      "human",
      `agent_explicit_human_auto_human_passive_${suffix}`,
    );
    assert.equal(agentExplicitHumanAutoHuman.executionIds.length, 1);
    await complete(
      agentExplicitHumanAutoHuman.executionIds[0]!,
      `thread_a_${suffix}`,
      null,
    );
    assert.deepEqual((await send(
      agentB,
      "agent",
      `agent_explicit_human_auto_agent_passive_${suffix}`,
    )).executionIds, []);
    const agentExplicitHumanAutoAgent = await send(
      agentB,
      "agent",
      `agent_explicit_human_auto_agent_explicit_${suffix}`,
      [{ type: "member", id: agentA }],
    );
    assert.equal(agentExplicitHumanAutoAgent.executionIds.length, 1);
    await complete(
      agentExplicitHumanAutoAgent.executionIds[0]!,
      `thread_a_${suffix}`,
      null,
    );

    await messages.setTriggerPolicy({
      roomId,
      companyId,
      agentMemberId: agentA,
      requestedByMemberId: humanId,
      policy: "human_auto",
      nowMs: Date.now(),
    });
    assert.deepEqual((await send(
      agentB,
      "agent",
      `human_auto_agent_${suffix}`,
    )).executionIds, []);
    const humanAuto = await send(humanId, "human", `human_auto_human_${suffix}`);
    assert.equal(humanAuto.executionIds.length, 1);
    await complete(humanAuto.executionIds[0]!, `thread_a_${suffix}`, null);

    const rapidSuccessOne = await send(humanId, "human", `rapid_success_1_${suffix}`);
    const rapidSuccessTwo = await send(humanId, "human", `rapid_success_2_${suffix}`);
    assert.equal(await messages.prepareExecutionDispatch(
      rapidSuccessOne.executionIds[0]!,
      Date.now(),
    ), "ready");
    assert.equal(await messages.prepareExecutionDispatch(
      rapidSuccessTwo.executionIds[0]!,
      Date.now(),
    ), "blocked");
    await complete(rapidSuccessOne.executionIds[0]!, `thread_a_${suffix}`, null);
    assert.equal(await messages.prepareExecutionDispatch(
      rapidSuccessTwo.executionIds[0]!,
      Date.now(),
    ), "ready");
    const rapidSuccessDispatch = await messages.readExecutionDispatch(
      rapidSuccessTwo.executionIds[0]!,
    );
    assert.deepEqual(
      rapidSuccessDispatch?.prompt_messages.map((message) => message.message_id),
      [rapidSuccessTwo.message.messageId],
    );
    await complete(rapidSuccessTwo.executionIds[0]!, `thread_a_${suffix}`, null);

    const rapidFailedOne = await send(humanId, "human", `rapid_failed_1_${suffix}`);
    const rapidFailedTwo = await send(humanId, "human", `rapid_failed_2_${suffix}`);
    assert.equal(await messages.prepareExecutionDispatch(
      rapidFailedOne.executionIds[0]!,
      Date.now(),
    ), "ready");
    assert.equal(await messages.prepareExecutionDispatch(
      rapidFailedTwo.executionIds[0]!,
      Date.now(),
    ), "blocked");
    const rapidFailedDispatch = await messages.readExecutionDispatch(
      rapidFailedOne.executionIds[0]!,
    );
    assert.ok(rapidFailedDispatch);
    await messages.completeExecution({
      execution_id: rapidFailedDispatch.execution_id,
      idempotency_key: rapidFailedDispatch.idempotency_key,
      cascade_id: rapidFailedDispatch.cascade_id,
      room_id: roomId,
      agent_member_id: agentA,
      status: "failed",
      codex_thread_id: `thread_a_${suffix}`,
      codex_turn_id: `turn_a_${suffix}`,
      consumed_through_sequence: rapidFailedDispatch.source_message_sequence,
      error: { code: "INTEGRATION_FAILURE", retryable: false },
      completed_at_ms: Date.now(),
    });
    assert.equal(await messages.prepareExecutionDispatch(
      rapidFailedTwo.executionIds[0]!,
      Date.now(),
    ), "ready");
    const afterFailureDispatch = await messages.readExecutionDispatch(
      rapidFailedTwo.executionIds[0]!,
    );
    assert.deepEqual(
      afterFailureDispatch?.prompt_messages.map((message) => message.message_id),
      [rapidFailedTwo.message.messageId],
    );
    await complete(rapidFailedTwo.executionIds[0]!, `thread_a_${suffix}`, null);

    for (const agentMemberId of [agentA, agentB]) {
      await messages.setTriggerPolicy({
        roomId,
        companyId,
        agentMemberId,
        requestedByMemberId: humanId,
        policy: "member_auto",
        nowMs: Date.now(),
      });
    }
    const first = await send(agentB, "agent", `cascade_b_source_${suffix}`);
    assert.equal(first.executionIds.length, 1);
    const executionA1 = await messages.readExecution(first.executionIds[0]!);
    assert.equal(executionA1?.agentMemberId, agentA);
    await complete(first.executionIds[0]!, `thread_a_${suffix}`, `cascade_a_output_${suffix}`);

    const executionBRows = rows<{ execution_id: string; cascade_id: string }>(
      await database.db.execute(sql`
        select execution.execution_id, execution.cascade_id
        from agent_room_executions execution
        join room_messages source on source.message_id = execution.source_message_id
        where source.source_execution_id = ${first.executionIds[0]!}
          and execution.agent_member_id = ${agentB}
      `),
    );
    assert.equal(executionBRows.length, 1);
    assert.equal(executionBRows[0]!.cascade_id, first.cascadeId);
    await complete(
      executionBRows[0]!.execution_id,
      `thread_b_${suffix}`,
      `cascade_b_output_${suffix}`,
    );

    const executionA2Rows = rows<{ execution_id: string; cascade_id: string }>(
      await database.db.execute(sql`
        select execution.execution_id, execution.cascade_id
        from agent_room_executions execution
        join room_messages source on source.message_id = execution.source_message_id
        where source.source_execution_id = ${executionBRows[0]!.execution_id}
          and execution.agent_member_id = ${agentA}
      `),
    );
    assert.equal(executionA2Rows.length, 1);
    assert.equal(executionA2Rows[0]!.cascade_id, first.cascadeId);
    const selfTriggerRows = rows<{ count: string }>(await database.db.execute(sql`
      select count(*)::text as count
      from agent_room_executions execution
      join room_messages source on source.message_id = execution.source_message_id
      where (
        source.source_execution_id = ${first.executionIds[0]!}
        and execution.agent_member_id = ${agentA}
      ) or (
        source.source_execution_id = ${executionBRows[0]!.execution_id}
        and execution.agent_member_id = ${agentB}
      )
    `));
    assert.deepEqual(selfTriggerRows, [{ count: "0" }]);
    await complete(executionA2Rows[0]!.execution_id, `thread_a_${suffix}`, null);
  } finally {
    await database.db.execute(sql`delete from rooms where company_id = ${companyId}`);
    await database.db.execute(sql`delete from companies where id = ${companyId}`);
    await database.db.execute(sql`delete from actors where company_id = ${companyId}`);
    await database.close();
  }
});

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "rows" in value) {
    const result = (value as { rows?: unknown }).rows;
    return Array.isArray(result) ? result as T[] : [];
  }
  return [];
}

function hasApplicationCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof Error
    && "code" in error
    && error.code === code;
}
