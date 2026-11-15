import { randomUUID } from "node:crypto";

import type { AgentRoomInteractionResponseDispatch } from "@fields/contracts/internal/agent-room";
import { agentQuestionInteractionSchema } from "@fields/contracts/public/agent-activity";
import { sql } from "drizzle-orm";

import type { BackendDatabase } from "../persistence/postgres/database-service.js";

type Runtime = {
  respondAgentRoomInteraction(companyId: string, input: AgentRoomInteractionResponseDispatch): Promise<unknown>;
};

type ClaimedQuestion = {
  interaction_id: string;
  company_id: string;
  execution_id: string;
  room_id: string;
  agent_member_id: string;
  message_id: string;
  interaction_json: unknown;
  claim_token: string;
};

export class PostgresRoomQuestionTimeoutRunner {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: Runtime,
    private readonly now: () => number = Date.now,
  ) {}

  async runTick(): Promise<number> {
    const nowMs = this.now();
    const reconciled = await this.db.transaction(async (transaction) => {
      const resolved = rows<ClaimedQuestion>(await transaction.execute(sql`
        select interaction_id, company_id, execution_id, room_id, agent_member_id,
          message_id, interaction_json, claim_token
        from room_interactions
        where kind = 'request_user_input' and status = 'responding'
          and resolved_at_ms is not null and claimed_at_ms is not null
          and claimed_at_ms <= ${nowMs - 120_000}
        order by claimed_at_ms asc, interaction_id asc
        limit 25 for update skip locked
      `));
      for (const candidate of resolved) {
        const interaction = agentQuestionInteractionSchema.parse(candidate.interaction_json);
        const completed = {
          ...interaction,
          status: "completed",
          answers: Object.fromEntries(interaction.questions.filter((question) => question.secret).map((question) => [question.id, {
            values: ["••••••"],
            redacted: true,
          }])),
          resolution: "answered",
          deadline_at_ms: null,
          completed_at_ms: nowMs,
        };
        await transaction.execute(sql`
          update room_interactions set status = 'completed', interaction_json = ${JSON.stringify(completed)}::jsonb,
            deadline_at_ms = null, claim_token = null, claimed_at_ms = null,
            responded_at_ms = coalesce(responded_at_ms, ${nowMs}), updated_at_ms = ${nowMs}
          where interaction_id = ${candidate.interaction_id} and status = 'responding'
        `);
        await publishRoomMessageUpdate(transaction, candidate, nowMs);
      }
      return resolved.length;
    });
    await this.db.execute(sql`
      update room_interactions set status = 'pending', claim_token = null, claimed_at_ms = null,
        updated_at_ms = ${nowMs}
      where kind = 'request_user_input' and status = 'responding'
        and resolved_at_ms is null and claimed_at_ms is not null and claimed_at_ms <= ${nowMs - 120_000}
    `);
    const claimed = await this.db.transaction(async (transaction) => {
      const due = rows<ClaimedQuestion>(await transaction.execute(sql`
        select interaction_id, company_id, execution_id, room_id, agent_member_id,
          message_id, interaction_json
        from room_interactions
        where kind = 'request_user_input' and status = 'pending'
          and deadline_at_ms is not null and deadline_at_ms <= ${nowMs}
        order by deadline_at_ms asc, interaction_id asc
        limit 25
        for update skip locked
      `));
      const result: ClaimedQuestion[] = [];
      for (const candidate of due) {
        const claimToken = randomUUID();
        await transaction.execute(sql`
          update room_interactions set status = 'responding', claim_token = ${claimToken},
            claimed_at_ms = ${nowMs}, resolved_at_ms = null, updated_at_ms = ${nowMs}
          where interaction_id = ${candidate.interaction_id} and status = 'pending'
        `);
        result.push({ ...candidate, claim_token: claimToken });
      }
      return result;
    });
    for (const candidate of claimed) await this.deliver(candidate, nowMs);
    return claimed.length + reconciled;
  }

  private async deliver(candidate: ClaimedQuestion, nowMs: number): Promise<void> {
    const dispatch: AgentRoomInteractionResponseDispatch = {
      persisted_response_id: `timeout:${candidate.claim_token}`,
      idempotency_key: `timeout:${candidate.claim_token}`,
      execution_id: candidate.execution_id,
      room_id: candidate.room_id,
      agent_member_id: candidate.agent_member_id,
      message_id: candidate.message_id,
      interaction_id: candidate.interaction_id,
      responder_member_id: candidate.agent_member_id,
      response: { answers: {}, resolution: "timed_out" },
      responded_at_ms: nowMs,
    };
    try {
      await this.runtime.respondAgentRoomInteraction(candidate.company_id, dispatch);
      const interaction = agentQuestionInteractionSchema.parse(candidate.interaction_json);
      const completed = {
        ...interaction,
        status: "completed",
        answers: {},
        resolution: "timed_out",
        deadline_at_ms: null,
        completed_at_ms: nowMs,
      };
      await this.db.transaction(async (transaction) => {
        await transaction.execute(sql`
          update room_interactions set status = 'completed', interaction_json = ${JSON.stringify(completed)}::jsonb,
            deadline_at_ms = null, claim_token = null, claimed_at_ms = null,
            responded_at_ms = ${nowMs}, updated_at_ms = ${nowMs}
          where interaction_id = ${candidate.interaction_id} and claim_token = ${candidate.claim_token}
        `);
        await publishRoomMessageUpdate(transaction, candidate, nowMs);
      });
    } catch {
      await this.db.execute(sql`
        update room_interactions set status = 'pending', claim_token = null, claimed_at_ms = null,
          updated_at_ms = ${this.now()}
        where interaction_id = ${candidate.interaction_id} and claim_token = ${candidate.claim_token}
      `);
      throw new Error("Room question timeout delivery failed.");
    }
  }
}

async function publishRoomMessageUpdate(
  database: { execute(query: unknown): Promise<unknown> },
  candidate: Pick<ClaimedQuestion, "room_id" | "company_id" | "message_id">,
  nowMs: number,
): Promise<void> {
  const sequences = rows<{ event_sequence: number | string }>(await database.execute(sql`
    update rooms set next_message_event_sequence = next_message_event_sequence + 1,
      updated_at_ms = greatest(updated_at_ms, ${nowMs})
    where id = ${candidate.room_id} and company_id = ${candidate.company_id} and status = 'active'
    returning next_message_event_sequence - 1 as event_sequence
  `));
  if (sequences.length !== 1) throw new Error("Room question timeout could not allocate an event sequence.");
  await database.execute(sql`
    update room_messages set event_sequence = ${Number(sequences[0]!.event_sequence)},
      revision = revision + 1, updated_at_ms = greatest(updated_at_ms, ${nowMs})
    where message_id = ${candidate.message_id} and room_id = ${candidate.room_id}
      and company_id = ${candidate.company_id}
  `);
}

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const value = result as { rows?: unknown };
  return Array.isArray(value?.rows) ? value.rows as T[] : [];
}
