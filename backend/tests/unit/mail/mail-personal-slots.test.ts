import assert from "node:assert/strict";
import test from "node:test";

import type {
  ListActiveOrdinaryActorProfilesUseCase,
} from "../../../src/application/actor/index.js";
import type { MailRuntimeGateway } from "../../../src/application/mail/index.js";
import type { BackendDatabase } from "../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresMailApplication,
} from "../../../src/infrastructure/persistence/postgres/repositories/company/mail-repository.js";
import {
  companyMailboxGrants,
  companyMailboxes,
} from "../../../src/infrastructure/persistence/postgres/schema/company/mail.js";

const companyId = "company-one";
const activeActors = [
  actor("owner", "human", "Owner"),
  actor("human-two", "human", "Human Two"),
  actor("agent-one", "agent", "Agent One"),
  actor("agent-two", "agent", "Agent Two"),
  actor("inactive-agent", "agent", "Inactive Agent", "inactive"),
  actor("foreign-agent", "agent", "Foreign Agent", "active", "company-two"),
];

test("listing mailboxes never provisions or exposes pristine personal slots", async () => {
  const database = new PersonalSlotDatabase();
  database.mailboxes.push(
    mailboxRow("owner", "Owner"),
    mailboxRow("agent-one", "Agent One"),
    {
      ...mailboxRow("agent-two", "Agent Two"),
      emailAddress: "agent-two@example.test",
      connectionState: "connected",
      credentialVersion: 1,
      capabilityFolders: true,
    },
  );
  let runtimeCalls = 0;
  const runtime = new Proxy({}, {
    get: () => async () => {
      runtimeCalls += 1;
      throw new Error("Runtime must not be called while listing unconnected slots.");
    },
  });
  const profiles = {
    execute: async (input: { companyId: string; actorIds: readonly string[] }) => (
      activeActors
        .filter((candidate) => (
          candidate.companyId === input.companyId
          && candidate.status === "active"
          && input.actorIds.includes(candidate.actorId)
        ))
        .map((candidate) => ({
          actorId: candidate.actorId,
          companyId: candidate.companyId,
          displayName: candidate.displayName,
          mark: candidate.actorType === "human" ? "HU" : "AG",
          actorType: candidate.actorType,
        }))
    ),
  };
  const application = new PostgresMailApplication(
    database as unknown as BackendDatabase,
    runtime as unknown as MailRuntimeGateway,
    profiles as unknown as ListActiveOrdinaryActorProfilesUseCase,
    () => 100,
  );

  const owner = { companyId, actorId: "owner", isCompanyOwner: true };
  const firstOwnerList = await application.listMailboxes(owner);
  const secondOwnerList = await application.listMailboxes(owner);
  assert.deepEqual(firstOwnerList.items.map((item) => item.target_actor_id), ["agent-two"]);
  assert.deepEqual(secondOwnerList, firstOwnerList);
  assert.equal(firstOwnerList.items[0]?.access, "company_owner");

  const agentList = await application.listMailboxes({
    companyId,
    actorId: "agent-one",
    isCompanyOwner: false,
  });
  assert.deepEqual(agentList.items, []);

  const humanList = await application.listMailboxes({
    companyId,
    actorId: "human-two",
    isCompanyOwner: false,
  });
  assert.deepEqual(humanList.items, []);

  const finalOwnerList = await application.listMailboxes(owner);
  assert.deepEqual(finalOwnerList, firstOwnerList);
  assert.equal(database.mailboxes.length, 3);
  assert.equal(runtimeCalls, 0);
});

type ActorRow = {
  actorId: string;
  actorType: "human" | "agent";
  companyId: string;
  displayName: string;
  status: "active" | "inactive";
};

type MailboxRow = {
  mailboxId: string;
  companyId: string;
  kind: "personal";
  targetActorId: string;
  displayName: string | null;
  emailAddress: string | null;
  connectionState: string;
  credentialVersion: number;
  capabilityFolders: boolean;
  capabilitySearch: boolean;
  capabilityFlags: boolean;
  capabilityMove: boolean;
  capabilityTrash: boolean;
  capabilityAppendSent: boolean;
  lastCheckedAtMs: number | null;
  lastErrorCode: string | null;
  createdByActorId: string;
  createdAtMs: number;
  updatedAtMs: number;
};

class PersonalSlotDatabase {
  readonly mailboxes: MailboxRow[] = [];

  select(selection?: Record<string, unknown>) {
    return {
      from: (table: unknown) => {
        const rows = table === companyMailboxes
          ? selection && "mailbox" in selection
            ? this.mailboxes.map((mailbox) => ({ mailbox, grantedActorId: null }))
            : [...this.mailboxes]
          : table === companyMailboxGrants
            ? []
            : [];
        return chainReturning(rows);
      },
    };
  }

  insert(table: unknown) {
    return {
      values: (value: Record<string, unknown>) => {
        const rows: unknown[] = [];
        if (table === companyMailboxes) {
          const mailbox = value as unknown as MailboxRow;
          const exists = this.mailboxes.some((candidate) => (
            candidate.mailboxId === mailbox.mailboxId
            || (
              candidate.companyId === mailbox.companyId
              && candidate.targetActorId === mailbox.targetActorId
            )
          ));
          if (!exists) {
            this.mailboxes.push(mailbox);
            rows.push(mailbox);
          }
        }
        return chainReturning(rows);
      },
    };
  }
}

function actor(
  actorId: string,
  actorType: "human" | "agent",
  displayName: string,
  status: "active" | "inactive" = "active",
  actorCompanyId = companyId,
): ActorRow {
  return {
    actorId,
    actorType,
    companyId: actorCompanyId,
    displayName,
    status,
  };
}

function mailboxRow(actorId: string, displayName: string): MailboxRow {
  return {
    mailboxId: `mailbox-${actorId}`,
    companyId,
    kind: "personal",
    targetActorId: actorId,
    displayName,
    emailAddress: null,
    connectionState: "unconnected",
    credentialVersion: 0,
    capabilityFolders: false,
    capabilitySearch: false,
    capabilityFlags: false,
    capabilityMove: false,
    capabilityTrash: false,
    capabilityAppendSent: false,
    lastCheckedAtMs: null,
    lastErrorCode: null,
    createdByActorId: "owner",
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function chainReturning(rows: unknown[]) {
  const result = Promise.resolve(rows);
  const chain: {
    leftJoin: () => typeof chain;
    where: () => typeof chain;
    orderBy: () => Promise<unknown[]>;
    limit: () => Promise<unknown[]>;
    onConflictDoNothing: () => typeof chain;
    returning: () => Promise<unknown[]>;
    then: Promise<unknown[]>["then"];
  } = {
    leftJoin: () => chain,
    where: () => chain,
    orderBy: async () => rows,
    limit: async () => rows,
    onConflictDoNothing: () => chain,
    returning: async () => rows,
    then: result.then.bind(result),
  };
  return chain;
}
