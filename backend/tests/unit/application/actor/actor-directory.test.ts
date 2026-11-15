import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyAccessQuery } from "../../../../src/application/company/queries/index.js";
import type { Actor } from "../../../../src/domain/actor/index.js";
import type { OwnerName, OwnerTransaction, OwnerUnitOfWork } from "../../../../src/application/platform/ports/index.js";
import { FixedClock, SequenceIdGenerator } from "../../../../src/application/platform/testing/index.js";
import { ApplicationError } from "../../../../src/application/platform/errors.js";
import {
  ACTOR_DIRECTORY_ACCESS_DENIED_CODE,
  type ActiveHumanDirectoryCaller,
  type ActiveOrdinaryActorProfile,
  type ActorDirectoryCommandRepository,
  type ActorDirectoryProfileQuery,
  type ActorDirectoryQueryRepository,
  type HumanActorEmailQuery,
} from "../../../../src/application/actor/ports/index.js";
import {
  COMPANY_ACTOR_NOT_FOUND_CODE,
  COMPANY_ACTOR_PROVISIONING_FAILED_CODE,
  COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE,
  COMPANY_DIRECTORY_INVARIANT_VIOLATION_CODE,
  COMPANY_DIRECTORY_UNAUTHENTICATED_CODE,
  COMPANY_OWNER_PROTECTED_CODE,
  COMPANY_OWNER_REQUIRED_CODE,
} from "../../../../src/application/actor/directory-support.js";
import {
  CreateCompanyDirectoryActor,
  CreateOrdinaryAgent,
  RemoveOrdinaryAgent,
} from "../../../../src/application/actor/commands/ordinary-agent-directory.js";
import {
  ACTOR_DIRECTORY_PROFILE_INVALID_CODE,
  ListActiveOrdinaryActorProfiles,
} from "../../../../src/application/actor/queries/active-ordinary-actor-profiles.js";
import {
  GetCompanyDirectoryActor,
  ListCompanyDirectoryActors,
} from "../../../../src/application/actor/queries/company-directory.js";
import { RequireActiveHumanCompanyOwner } from "../../../../src/application/actor/queries/require-active-company-owner.js";
import {
  ACTOR_ORDINARY_ACCESS_DENIED_CODE,
  RequireActiveOrdinaryActor,
} from "../../../../src/application/actor/queries/require-active-ordinary-actor.js";

const request = { companyId: "company_one", requestedByActorId: "actor_owner" };

test("Actor Directory lists and gets only active projections, hydrating Human email through its narrow query", async () => {
  const actors = new FakeDirectoryQueries({
    list: [human(), agent()],
    get: human(),
  });
  const emails = new FakeHumanEmails([["user_owner", "owner@example.test"]]);
  const companies = new FakeCompanies();

  const list = new ListCompanyDirectoryActors({ companies, directory: actors, humanEmails: emails });
  assert.deepEqual(await list.execute(request), [
    {
      actorId: "actor_owner",
      displayName: "Ada Lovelace",
      mark: "AL",
      email: "owner@example.test",
      actorType: "human",
      companyRole: "owner",
      status: "active",
    },
    {
      actorId: "actor_agent",
      displayName: "Research Agent",
      mark: "RA",
      email: null,
      actorType: "agent",
      companyRole: "member",
      status: "active",
    },
  ]);
  assert.deepEqual(emails.calls, [["user_owner"]]);

  const get = new GetCompanyDirectoryActor({ companies, directory: actors, humanEmails: emails });
  assert.equal((await get.execute({ ...request, actorId: "actor_owner" })).actorId, "actor_owner");

  actors.get = null;
  await assert.rejects(
    get.execute({ ...request, actorId: "actor_home" }),
    applicationError(COMPANY_ACTOR_NOT_FOUND_CODE, false),
  );
});

test("Actor Directory commands require an active Human owner and preserve the ordinary-Agent removal rules", async () => {
  const companies = new FakeCompanies();
  const queries = new FakeDirectoryQueries();
  const commands = new FakeDirectoryCommands();
  const unitOfWork = new RecordingActorUnitOfWork();
  const dependencies = {
    companies,
    directory: queries,
    commands,
    actorUnitOfWork: unitOfWork,
    ids: new SequenceIdGenerator(),
    clock: new FixedClock(125),
  };

  const create = new CreateOrdinaryAgent(dependencies);
  const created = await create.execute({ ...request, displayName: "  Research Agent  ", mark: " RA " });
  assert.deepEqual(created, {
    actorId: "actor_1",
    displayName: "Research Agent",
    mark: "RA",
    email: null,
    actorType: "agent",
    companyRole: "member",
    status: "active",
  });
  assert.equal(unitOfWork.executions, 1);
  assert.deepEqual(commands.created, [{
    id: "actor_1",
    companyId: "company_one",
    type: "agent",
    displayName: "Research Agent",
    mark: "RA",
    companyRole: "member",
    status: "active",
    authUserId: null,
  }]);

  const remove = new RemoveOrdinaryAgent(dependencies);
  commands.target = agent();
  assert.deepEqual(await remove.execute({ ...request, actorId: "actor_agent" }), {
    actorId: "actor_agent",
    status: "inactive",
  });
  assert.deepEqual(commands.deactivated, [{ actorId: "actor_agent", companyId: "company_one", updatedAtMs: 125 }]);

  for (const candidate of [
    { actor: { ...human(), companyRole: "owner" as const }, code: COMPANY_OWNER_PROTECTED_CODE },
    { actor: { ...human(), companyRole: "member" as const }, code: COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE },
    { actor: { ...agent(), authUserId: "unexpected" }, code: COMPANY_DIRECTORY_INVARIANT_VIOLATION_CODE },
  ]) {
    commands.target = candidate.actor;
    await assert.rejects(
      remove.execute({ ...request, actorId: candidate.actor.id }),
      applicationError(candidate.code, false),
    );
  }

  commands.target = { ...agent(), status: "inactive" };
  commands.deactivated.length = 0;
  assert.deepEqual(await remove.execute({ ...request, actorId: "actor_agent" }), {
    actorId: "actor_agent",
    status: "inactive",
  });
  assert.deepEqual(commands.deactivated, [{
    actorId: "actor_agent",
    companyId: "company_one",
    updatedAtMs: 125,
  }]);

  queries.caller = { ...queries.caller, companyRole: "member" };
  await assert.rejects(
    create.execute({ ...request, displayName: "Another", mark: "AN" }),
    applicationError(COMPANY_OWNER_REQUIRED_CODE, false),
  );
});

test("router-facing Company Directory create authorizes the owner before rejecting a non-Agent type", async () => {
  const companies = new FakeCompanies();
  const queries = new FakeDirectoryQueries();
  const commands = new FakeDirectoryCommands();
  const create = new CreateCompanyDirectoryActor({
    companies,
    directory: queries,
    commands,
    actorUnitOfWork: new RecordingActorUnitOfWork(),
    ids: new SequenceIdGenerator(),
    clock: new FixedClock(125),
  });

  queries.caller = { ...queries.caller, companyRole: "member" };
  await assert.rejects(
    create.execute({ ...request, actorType: "human", displayName: "Ada", mark: "AD" }),
    applicationError(COMPANY_OWNER_REQUIRED_CODE, false),
  );
  assert.deepEqual(commands.created, []);

  queries.caller = { ...queries.caller, companyRole: "owner" };
  await assert.rejects(
    create.execute({ ...request, actorType: "human", displayName: "Ada", mark: "AD" }),
    applicationError(COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE, false),
  );
  assert.deepEqual(commands.created, []);

  assert.equal((await create.execute({
    ...request,
    actorType: "agent",
    displayName: "Research Agent",
    mark: "RA",
  })).actorType, "agent");
});

test("Actor Directory preserves its authenticated active-Company boundary and fails closed on missing Human email", async () => {
  const companies = new FakeCompanies();
  const queries = new FakeDirectoryQueries({ list: [human()] });
  const emails = new FakeHumanEmails();
  const list = new ListCompanyDirectoryActors({ companies, directory: queries, humanEmails: emails });

  await assert.rejects(
    list.execute(request),
    applicationError(COMPANY_DIRECTORY_INVARIANT_VIOLATION_CODE, false),
  );

  queries.failure = new ApplicationError(ACTOR_DIRECTORY_ACCESS_DENIED_CODE, false);
  await assert.rejects(
    list.execute(request),
    applicationError(COMPANY_DIRECTORY_UNAUTHENTICATED_CODE, false),
  );

  queries.failure = null;
  companies.failure = new ApplicationError("COMPANY_STORAGE_UNAVAILABLE", true);
  await assert.rejects(
    list.execute(request),
    applicationError(COMPANY_ACTOR_PROVISIONING_FAILED_CODE, true),
  );
});

test("Actor public profiles retain requested order, return only the eligible subset, and reject unsafe adapter output", async () => {
  const profiles = new FakeDirectoryQueries({
    profiles: [
      { actorId: "actor_agent", companyId: "company_one", displayName: "Research Agent", mark: "RA", actorType: "agent" },
      { actorId: "actor_owner", companyId: "company_one", displayName: "Ada Lovelace", mark: "AL", actorType: "human" },
    ],
  });
  const query = new ListActiveOrdinaryActorProfiles({ profiles });

  assert.deepEqual(await query.execute({
    companyId: "company_one",
    actorIds: ["actor_owner", "actor_missing", "actor_agent", "actor_owner"],
  }), [
    { actorId: "actor_owner", companyId: "company_one", displayName: "Ada Lovelace", mark: "AL", actorType: "human" },
    { actorId: "actor_agent", companyId: "company_one", displayName: "Research Agent", mark: "RA", actorType: "agent" },
  ]);
  assert.deepEqual(profiles.profileCalls, [{
    companyId: "company_one",
    actorIds: ["actor_owner", "actor_missing", "actor_agent"],
  }]);

  profiles.profiles = [{
    actorId: "actor_other",
    companyId: "company_one",
    displayName: "Other",
    mark: "OT",
    actorType: "agent",
  }];
  await assert.rejects(
    query.execute({ companyId: "company_one", actorIds: ["actor_owner"] }),
    applicationError(ACTOR_DIRECTORY_PROFILE_INVALID_CODE, false),
  );

  profiles.profiles = [{
    actorId: "actor_owner",
    companyId: "company_other",
    displayName: "Ada Lovelace",
    mark: "AL",
    actorType: "human",
  }];
  await assert.rejects(
    query.execute({ companyId: "company_one", actorIds: ["actor_owner"] }),
    applicationError(ACTOR_DIRECTORY_PROFILE_INVALID_CODE, false),
  );
});

test("Company retry owner authorization does not consult active Company and denies inactive or non-owner callers", async () => {
  const queries = new FakeDirectoryQueries();
  const authorization = new RequireActiveHumanCompanyOwner({ directory: queries });

  assert.deepEqual(await authorization.execute(request), {
    actorId: "actor_owner",
    companyId: "company_one",
    companyRole: "owner",
  });

  // The use case deliberately has no Company dependency: a setup_failed
  // Company remains retryable by its active Human owner.
  queries.failure = new ApplicationError(ACTOR_DIRECTORY_ACCESS_DENIED_CODE, false);
  await assert.rejects(
    authorization.execute(request),
    applicationError(COMPANY_DIRECTORY_UNAUTHENTICATED_CODE, false),
  );

  queries.failure = null;
  queries.caller = { ...queries.caller, companyRole: "member" };
  await assert.rejects(
    authorization.execute(request),
    applicationError(COMPANY_OWNER_REQUIRED_CODE, false),
  );
});

test("Actor public ordinary access admits exactly one active profile", async () => {
  const profiles = new FakeDirectoryQueries({
    profiles: [{
      actorId: "actor_agent",
      companyId: "company_one",
      displayName: "Research Agent",
      mark: "RA",
      actorType: "agent",
    }],
  });
  const access = new RequireActiveOrdinaryActor({ profiles });

  assert.deepEqual(await access.execute({ actorId: "actor_agent", companyId: "company_one" }), {
    actorId: "actor_agent",
    companyId: "company_one",
    actorType: "agent",
  });

  profiles.profiles = [];
  await assert.rejects(
    access.execute({ actorId: "actor_agent", companyId: "company_one" }),
    applicationError(ACTOR_ORDINARY_ACCESS_DENIED_CODE, false),
  );

  profiles.profiles = [{
    actorId: "actor_agent",
    companyId: "company_other",
    displayName: "Research Agent",
    mark: "RA",
    actorType: "agent",
  }];
  await assert.rejects(
    access.execute({ actorId: "actor_agent", companyId: "company_one" }),
    applicationError(ACTOR_ORDINARY_ACCESS_DENIED_CODE, false),
  );
});

class FakeCompanies implements CompanyAccessQuery {
  failure: Error | null = null;

  async requireActiveCompany(companyId: string): Promise<{ companyId: string; status: "active" }> {
    if (this.failure) {
      throw this.failure;
    }
    return { companyId, status: "active" };
  }
}

class FakeDirectoryQueries implements ActorDirectoryQueryRepository, ActorDirectoryProfileQuery {
  caller: ActiveHumanDirectoryCaller = {
    actorId: request.requestedByActorId,
    companyId: request.companyId,
    companyRole: "owner",
  };
  failure: Error | null = null;
  list: readonly Actor[];
  get: Actor | null;
  profiles: readonly ActiveOrdinaryActorProfile[];
  readonly profileCalls: Array<{ companyId: string; actorIds: readonly string[] }> = [];

  constructor(input: {
    list?: readonly Actor[];
    get?: Actor | null;
    profiles?: readonly ActiveOrdinaryActorProfile[];
  } = {}) {
    this.list = input.list ?? [];
    this.get = input.get ?? null;
    this.profiles = input.profiles ?? [];
  }

  async requireActiveHumanCaller(): Promise<ActiveHumanDirectoryCaller> {
    if (this.failure) {
      throw this.failure;
    }
    return this.caller;
  }

  async listActiveActors(): Promise<readonly Actor[]> {
    if (this.failure) {
      throw this.failure;
    }
    return this.list;
  }

  async findActiveActor(): Promise<Actor | null> {
    if (this.failure) {
      throw this.failure;
    }
    return this.get;
  }

  async listActiveOrdinaryProfiles(input: {
    companyId: string;
    actorIds: readonly string[];
  }): Promise<readonly ActiveOrdinaryActorProfile[]> {
    this.profileCalls.push(input);
    return this.profiles;
  }
}

class FakeHumanEmails implements HumanActorEmailQuery {
  readonly calls: readonly string[][] = [];
  private readonly emails: ReadonlyMap<string, string>;

  constructor(entries: ReadonlyArray<readonly [string, string]> = []) {
    this.emails = new Map(entries);
  }

  async findEmailsByAuthUserIds(authUserIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    (this.calls as string[][]).push([...authUserIds]);
    return new Map([...this.emails].filter(([id]) => authUserIds.includes(id)));
  }
}

class FakeDirectoryCommands implements ActorDirectoryCommandRepository {
  readonly created: Actor[] = [];
  readonly deactivated: Array<{ actorId: string; companyId: string; updatedAtMs: number }> = [];
  target: Actor | null = null;

  async createOrdinaryAgent(_transaction: OwnerTransaction, actor: Actor): Promise<Actor | null> {
    this.created.push(actor);
    return actor;
  }

  async findActorForRemoval(): Promise<Actor | null> {
    return this.target;
  }

  async deactivateOrdinaryAgent(
    _transaction: OwnerTransaction,
    input: { actorId: string; companyId: string; updatedAtMs: number },
  ): Promise<Actor | null> {
    this.deactivated.push(input);
    return this.target === null ? null : { ...this.target, status: "inactive" };
  }
}

class RecordingActorUnitOfWork implements OwnerUnitOfWork {
  executions = 0;
  readonly transaction: OwnerTransaction = {
    owner: "actor",
    outbox: { kind: "outbox-transaction" },
  };

  async execute<T>(owner: OwnerName, work: (transaction: OwnerTransaction) => Promise<T>): Promise<T> {
    assert.equal(owner, "actor");
    this.executions += 1;
    return work(this.transaction);
  }
}

function human(): Actor {
  return {
    id: "actor_owner",
    companyId: "company_one",
    type: "human",
    displayName: "Ada Lovelace",
    mark: "AL",
    companyRole: "owner",
    status: "active",
    authUserId: "user_owner",
  };
}

function agent(): Actor {
  return {
    id: "actor_agent",
    companyId: "company_one",
    type: "agent",
    displayName: "Research Agent",
    mark: "RA",
    companyRole: "member",
    status: "active",
    authUserId: null,
  };
}

function applicationError(code: string, retryable: boolean): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.equal("cause" in error, false);
    return true;
  };
}
