import type {
  MemberExecutorSwitchInput,
  MemberExecutorSwitchResult,
} from "@fields/contracts/internal/company-runtime";
import type { ExecutorModelPolicyItem } from "@fields/contracts/public/executor";
import { sql } from "drizzle-orm";

import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";

export const MEMBER_EXECUTOR_ACCESS_DENIED_CODE = "MEMBER_EXECUTOR_ACCESS_DENIED";
export const MEMBER_EXECUTOR_INVALID_CODE = "MEMBER_EXECUTOR_INVALID";
export const MEMBER_EXECUTOR_NOT_FOUND_CODE = "MEMBER_EXECUTOR_NOT_FOUND";
export const MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE = "MEMBER_EXECUTOR_SWITCH_CONFLICT";
export const MEMBER_EXECUTOR_SWITCH_COMPENSATION_FAILED_CODE =
  "MEMBER_EXECUTOR_SWITCH_COMPENSATION_FAILED";
export const MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE = "MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE";

export type MemberExecutorSummary = {
  executorId: string;
  ownerMemberId: string;
  ownerDisplayName: string;
  name: string;
  sharingState: "private" | "company_shared" | "admin_blocked";
  availability: "available" | "pending_auth" | "configuration_required" | "unavailable" | "disconnected";
  executorType: "codex";
  configurationStatus: "pending" | "validating" | "ready" | "invalid";
  configurationRevision: number;
  allowedModels: ExecutorModelPolicyItem[];
  allowedReasoningEfforts: string[];
  defaultModel: string | null;
  defaultReasoningEffort: string | null;
  catalogCheckedAtMs: number | null;
  configurationUpdatedAtMs: number | null;
  authorization:
    | { method: "chatgpt"; planType: string | null }
    | { method: "custom_api_key" };
};

export type MemberExecutorAssignment = {
  companyId: string;
  memberId: string;
  executor: MemberExecutorSummary;
  assignmentVersion: number;
  state: "ready" | "switching" | "configuration_required" | "auth_required" | "failed";
  pendingExecutorId: string | null;
  switchOperationId: string | null;
  lastErrorCode: string | null;
  lastErrorRetryable: boolean | null;
  updatedAtMs: number;
};

export type ExecutorAssignmentAuthority =
  | { kind: "self"; requestedByMemberId: string }
  | { kind: "company_owner"; requestedByMemberId: string };

export type BeginMemberExecutorSwitchInput = {
  companyId: string;
  memberId: string;
  executorId: string;
  operationId: string;
  authority: ExecutorAssignmentAuthority;
  nowMs: number;
};

export type BeginMemberExecutorSwitchResult =
  | { kind: "unchanged"; assignment: MemberExecutorAssignment }
  | {
    kind: "switching";
    assignment: MemberExecutorAssignment;
    previousExecutorId: string | null;
    targetExecutorId: string;
    operationId: string;
  };

type DatabaseExecutor = Pick<BackendDatabase, "execute">;
type DatabaseNumber = number | string | bigint;

type AssignmentRow = {
  company_id: string;
  member_id: string;
  executor_id: string;
  pending_executor_id: string | null;
  assignment_version: DatabaseNumber;
  state: string;
  switch_operation_id: string | null;
  last_error_code: string | null;
  last_error_retryable: boolean | null;
  updated_at_ms: DatabaseNumber;
  owner_member_id: string;
  owner_display_name: string;
  executor_name: string;
  sharing_state: string;
  executor_status: string;
  authorization_method: string;
  plan_type: string | null;
  executor_type: string;
  configuration_status: string;
  configuration_revision: DatabaseNumber;
  allowed_models_json: unknown;
  allowed_reasoning_efforts_json: unknown;
  default_model: string | null;
  default_reasoning_effort: string | null;
  catalog_checked_at_ms: DatabaseNumber | null;
  configuration_updated_at_ms: DatabaseNumber | null;
};

type ExecutorRow = {
  executor_id: string;
  owner_member_id: string;
  owner_display_name: string;
  executor_name: string;
  sharing_state: string;
  executor_status: string;
  authorization_method: string;
  plan_type: string | null;
  executor_type: string;
  configuration_status: string;
  configuration_revision: DatabaseNumber;
  allowed_models_json: unknown;
  allowed_reasoning_efforts_json: unknown;
  default_model: string | null;
  default_reasoning_effort: string | null;
  catalog_checked_at_ms: DatabaseNumber | null;
  configuration_updated_at_ms: DatabaseNumber | null;
};

/**
 * Backend owns the committed Member -> Executor fact. The repository exposes
 * a three-step switch so Runtime work occurs outside the database transaction
 * while the old binding remains recoverable and authoritative.
 */
export class PostgresMemberExecutorAssignmentRepository {
  constructor(private readonly db: BackendDatabase) {}

  async readRuntimeStartFacts(input: {
    companyId: string;
    memberId: string;
  }): Promise<{
    executorId: string;
    credentialVersion: number;
    allowedModels: string[];
    modelReasoningEfforts: Record<string, string[]>;
    allowedReasoningEfforts: string[];
    defaultModel: string;
    defaultReasoningEffort: string | null;
    memoryEnabled: boolean;
    memoryManaged: boolean;
  }> {
    try {
      const rows = rowsFromResult<{
        executor_id: string;
        credential_version: DatabaseNumber;
        allowed_models_json: unknown;
        allowed_reasoning_efforts_json: unknown;
        default_model: string;
        default_reasoning_effort: string | null;
        memory_enabled: boolean;
        member_type: string;
      }>(await this.db.execute(sql`
        select assignment.executor_id, executor.credential_version,
          executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
          executor.default_model, executor.default_reasoning_effort, member.type as member_type,
          coalesce(memory.enabled, true) as memory_enabled
        from member_executor_assignments assignment
        inner join company_executors executor
          on executor.company_id = assignment.company_id
          and executor.executor_id = assignment.executor_id
        inner join actors member
          on member.company_id = assignment.company_id
          and member.id = assignment.member_id
          and member.status = 'active'
          and member.system_role is null
        left join member_memory_profiles memory
          on memory.company_id = assignment.company_id
          and memory.member_id = assignment.member_id
        where assignment.company_id = ${input.companyId}
          and assignment.member_id = ${input.memberId}
          and assignment.state = 'ready'
          and executor.status = 'connected'
          and executor.configuration_status = 'ready'
          and executor.credential_version > 0
        limit 2
      `));
      if (rows.length !== 1) {
        throw new ApplicationError(MEMBER_EXECUTOR_NOT_FOUND_CODE, false);
      }
      const models = modelItems(rows[0]!.allowed_models_json);
      return {
        executorId: rows[0]!.executor_id,
        credentialVersion: positiveNumber(rows[0]!.credential_version),
        allowedModels: models.map((item) => item.model),
        modelReasoningEfforts: Object.fromEntries(models.map((item) => [item.model, item.supported_reasoning_efforts])),
        allowedReasoningEfforts: stringArray(rows[0]!.allowed_reasoning_efforts_json),
        defaultModel: rows[0]!.default_model,
        defaultReasoningEffort: rows[0]!.default_reasoning_effort,
        memoryEnabled: rows[0]!.memory_enabled,
        memoryManaged: true,
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async read(input: {
    companyId: string;
    memberId: string;
    authority: ExecutorAssignmentAuthority;
  }): Promise<MemberExecutorAssignment> {
    try {
      await requireAssignmentAuthority(this.db, input.companyId, input.memberId, input.authority);
      const assignment = await readAssignment(this.db, input.companyId, input.memberId, false);
      if (assignment === null) throw new ApplicationError(MEMBER_EXECUTOR_NOT_FOUND_CODE, false);
      return assignment;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async listOptions(input: {
    companyId: string;
    memberId: string;
    authority: ExecutorAssignmentAuthority;
  }): Promise<readonly MemberExecutorSummary[]> {
    try {
      const targetType = await requireAssignmentAuthority(
        this.db,
        input.companyId,
        input.memberId,
        input.authority,
      );
      const rows = rowsFromResult<ExecutorRow>(await this.db.execute(
        targetType === "human"
          ? sql`
            select executor.executor_id, executor.owner_member_id,
              owner.display_name as owner_display_name,
              executor.name as executor_name, executor.sharing_state,
              executor.status as executor_status, executor.authorization_method, executor.plan_type,
              executor.executor_type, executor.configuration_status, executor.configuration_revision,
              executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
              executor.default_model, executor.default_reasoning_effort,
              executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
            from company_executors executor
            inner join actors owner
              on owner.id = executor.owner_member_id
              and owner.company_id = executor.company_id
            where executor.company_id = ${input.companyId}
              and (
                (
                  executor.owner_member_id = ${input.memberId}
                  and executor.sharing_state <> 'admin_blocked'
                )
                or executor.sharing_state = 'company_shared'
              )
            order by executor.updated_at_ms desc, executor.executor_id asc
          `
          : sql`
            select executor.executor_id, executor.owner_member_id,
              owner.display_name as owner_display_name,
              executor.name as executor_name, executor.sharing_state,
              executor.status as executor_status, executor.authorization_method, executor.plan_type,
              executor.executor_type, executor.configuration_status, executor.configuration_revision,
              executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
              executor.default_model, executor.default_reasoning_effort,
              executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
            from company_executors executor
            inner join actors owner
              on owner.id = executor.owner_member_id
              and owner.company_id = executor.company_id
            where executor.company_id = ${input.companyId}
              and executor.sharing_state = 'company_shared'
            order by executor.updated_at_ms desc, executor.executor_id asc
          `,
      ));
      return Object.freeze(rows.map(executorFromRow));
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async beginSwitch(input: BeginMemberExecutorSwitchInput): Promise<BeginMemberExecutorSwitchResult> {
    assertSwitchInput(input);
    try {
      return await this.db.transaction(async (transaction) => {
        const targetType = await requireAssignmentAuthority(
          transaction,
          input.companyId,
          input.memberId,
          input.authority,
          true,
        );
        await requireEligibleExecutor(
          transaction,
          input.companyId,
          input.memberId,
          input.executorId,
          targetType,
        );
        const current = await readAssignment(
          transaction,
          input.companyId,
          input.memberId,
          true,
        );
        if (current === null) {
          const rows = rowsFromResult<AssignmentRow>(await transaction.execute(sql`
            with changed as (
              insert into member_executor_assignments (
                member_id, company_id, executor_id, pending_executor_id,
                previous_executor_id, assignment_version, state,
                switch_operation_id, last_error_code, last_error_retryable,
                created_at_ms, updated_at_ms
              ) values (
                ${input.memberId}, ${input.companyId}, ${input.executorId}, ${input.executorId},
                ${input.executorId}, 1, 'switching', ${input.operationId},
                null, null, ${input.nowMs}, ${input.nowMs}
              )
              returning *
            )
            select changed.company_id, changed.member_id, changed.executor_id,
              changed.pending_executor_id, changed.assignment_version,
              changed.state, changed.switch_operation_id, changed.last_error_code,
              changed.last_error_retryable, changed.updated_at_ms, executor.owner_member_id,
              owner.display_name as owner_display_name,
              executor.name as executor_name, executor.sharing_state,
              executor.status as executor_status, executor.authorization_method, executor.plan_type,
              executor.executor_type, executor.configuration_status, executor.configuration_revision,
              executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
              executor.default_model, executor.default_reasoning_effort,
              executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
            from changed
            inner join company_executors executor
              on executor.company_id = changed.company_id
              and executor.executor_id = changed.executor_id
            inner join actors owner
              on owner.company_id = executor.company_id
              and owner.id = executor.owner_member_id
          `));
          if (rows.length !== 1) throw new ApplicationError(MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE, true);
          return {
            kind: "switching",
            assignment: assignmentFromRow(rows[0]!),
            previousExecutorId: null,
            targetExecutorId: input.executorId,
            operationId: input.operationId,
          };
        }
        if (current.executor.executorId === input.executorId && current.state !== "switching") {
          return { kind: "unchanged", assignment: current };
        }
        if (current.state === "switching") {
          if (
            current.pendingExecutorId === input.executorId
            && current.switchOperationId === input.operationId
          ) {
            return {
              kind: "switching",
              assignment: current,
              previousExecutorId: current.executor.executorId,
              targetExecutorId: input.executorId,
              operationId: input.operationId,
            };
          }
          throw new ApplicationError(MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE, true);
        }

        const updated = rowsFromResult<AssignmentRow>(await transaction.execute(sql`
          with changed as (
            update member_executor_assignments
            set pending_executor_id = ${input.executorId},
              previous_executor_id = executor_id,
              state = 'switching',
              switch_operation_id = ${input.operationId},
              last_error_code = null,
              last_error_retryable = null,
              updated_at_ms = ${input.nowMs}
            where company_id = ${input.companyId}
              and member_id = ${input.memberId}
              and state <> 'switching'
            returning *
          )
          select changed.company_id, changed.member_id, changed.executor_id,
            changed.pending_executor_id, changed.assignment_version,
            changed.state, changed.switch_operation_id, changed.last_error_code,
            changed.last_error_retryable, changed.updated_at_ms, executor.owner_member_id,
            owner.display_name as owner_display_name,
            executor.name as executor_name, executor.sharing_state,
            executor.status as executor_status, executor.authorization_method, executor.plan_type,
            executor.executor_type, executor.configuration_status, executor.configuration_revision,
            executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
            executor.default_model, executor.default_reasoning_effort,
            executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
          from changed
          inner join company_executors executor
            on executor.company_id = changed.company_id
            and executor.executor_id = changed.executor_id
          inner join actors owner
            on owner.company_id = executor.company_id
            and owner.id = executor.owner_member_id
        `));
        if (updated.length !== 1) throw new ApplicationError(MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE, true);
        const assignment = assignmentFromRow(updated[0]!);
        return {
          kind: "switching",
          assignment,
          previousExecutorId: current.executor.executorId,
          targetExecutorId: input.executorId,
          operationId: input.operationId,
        };
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async readRuntimeSwitchFacts(input: {
    companyId: string;
    memberId: string;
    targetExecutorId: string;
  }): Promise<{
    credentialVersion: number;
    defaultModel: string;
    memoryEnabled: boolean;
    memoryManaged: boolean;
    codexThreadIds: readonly string[];
  }> {
    try {
      const executorRows = rowsFromResult<{
        credential_version: DatabaseNumber;
        default_model: string;
        memory_enabled: boolean;
        member_type: string;
      }>(
        await this.db.execute(sql`
          select executor.credential_version, executor.default_model, member.type as member_type,
            coalesce(memory.enabled, true) as memory_enabled
          from company_executors executor
          inner join actors member
            on member.company_id = executor.company_id
            and member.id = ${input.memberId}
            and member.status = 'active'
            and member.system_role is null
          left join member_memory_profiles memory
            on memory.company_id = executor.company_id
            and memory.member_id = ${input.memberId}
          where executor.company_id = ${input.companyId}
            and executor.executor_id = ${input.targetExecutorId}
            and executor.status = 'connected'
            and executor.configuration_status = 'ready'
          limit 2
        `),
      );
      if (executorRows.length !== 1) {
        throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
      }
      const threadRows = rowsFromResult<{ thread_id: string }>(await this.db.execute(sql`
        select thread_id
        from agent_room_states
        where company_id = ${input.companyId}
          and agent_member_id = ${input.memberId}
          and thread_id is not null
        order by room_id asc
      `));
      return {
        credentialVersion: positiveNumber(executorRows[0]!.credential_version),
        defaultModel: executorRows[0]!.default_model,
        memoryEnabled: executorRows[0]!.memory_enabled,
        memoryManaged: true,
        codexThreadIds: Object.freeze(threadRows.map((row) => row.thread_id)),
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async commitSwitch(input: {
    companyId: string;
    memberId: string;
    operationId: string;
    targetExecutorId: string;
    nowMs: number;
  }): Promise<MemberExecutorAssignment> {
    try {
      const rows = rowsFromResult<AssignmentRow>(await this.db.execute(sql`
        with changed as (
          update member_executor_assignments
          set executor_id = pending_executor_id,
            pending_executor_id = null,
            previous_executor_id = null,
            assignment_version = assignment_version + 1,
            state = 'ready',
            switch_operation_id = null,
            last_error_code = null,
            last_error_retryable = null,
            updated_at_ms = ${input.nowMs}
          where company_id = ${input.companyId}
            and member_id = ${input.memberId}
            and state = 'switching'
            and switch_operation_id = ${input.operationId}
            and pending_executor_id = ${input.targetExecutorId}
          returning *
        )
        select changed.company_id, changed.member_id, changed.executor_id,
          changed.pending_executor_id, changed.assignment_version,
          changed.state, changed.switch_operation_id, changed.last_error_code,
          changed.last_error_retryable, changed.updated_at_ms, executor.owner_member_id,
          owner.display_name as owner_display_name,
          executor.name as executor_name, executor.sharing_state,
          executor.status as executor_status, executor.authorization_method, executor.plan_type,
          executor.executor_type, executor.configuration_status, executor.configuration_revision,
          executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
          executor.default_model, executor.default_reasoning_effort,
          executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
        from changed
        inner join company_executors executor
          on executor.company_id = changed.company_id
          and executor.executor_id = changed.executor_id
        inner join actors owner
          on owner.company_id = executor.company_id
          and owner.id = executor.owner_member_id
      `));
      if (rows.length !== 1) throw new ApplicationError(MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE, true);
      return assignmentFromRow(rows[0]!);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async rollbackSwitch(input: {
    companyId: string;
    memberId: string;
    operationId: string;
    errorCode: string;
    retryable: boolean;
    nowMs: number;
  }): Promise<MemberExecutorAssignment> {
    try {
      const initialRows = rowsFromResult<{ previous_executor_id: string; pending_executor_id: string }>(
        await this.db.execute(sql`
          select previous_executor_id, pending_executor_id
          from member_executor_assignments
          where company_id = ${input.companyId}
            and member_id = ${input.memberId}
            and state = 'switching'
            and switch_operation_id = ${input.operationId}
          limit 2
        `),
      );
      if (
        initialRows.length === 1
        && initialRows[0]!.previous_executor_id === initialRows[0]!.pending_executor_id
      ) {
        await this.db.execute(sql`
          delete from member_executor_assignments
          where company_id = ${input.companyId}
            and member_id = ${input.memberId}
            and state = 'switching'
            and switch_operation_id = ${input.operationId}
        `);
        throw new ApplicationError(input.errorCode, input.retryable);
      }
      const rows = rowsFromResult<AssignmentRow>(await this.db.execute(sql`
        with changed as (
          update member_executor_assignments
          set executor_id = previous_executor_id,
            pending_executor_id = null,
            previous_executor_id = null,
            state = 'ready',
            switch_operation_id = null,
            last_error_code = ${input.errorCode},
            last_error_retryable = ${input.retryable},
            updated_at_ms = ${input.nowMs}
          where company_id = ${input.companyId}
            and member_id = ${input.memberId}
            and state = 'switching'
            and switch_operation_id = ${input.operationId}
          returning *
        )
        select changed.company_id, changed.member_id, changed.executor_id,
          changed.pending_executor_id, changed.assignment_version,
          changed.state, changed.switch_operation_id, changed.last_error_code,
          changed.last_error_retryable, changed.updated_at_ms, executor.owner_member_id,
          owner.display_name as owner_display_name,
          executor.name as executor_name, executor.sharing_state,
          executor.status as executor_status, executor.authorization_method, executor.plan_type,
          executor.executor_type, executor.configuration_status, executor.configuration_revision,
          executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
          executor.default_model, executor.default_reasoning_effort,
          executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
        from changed
        inner join company_executors executor
          on executor.company_id = changed.company_id
          and executor.executor_id = changed.executor_id
        inner join actors owner
          on owner.company_id = executor.company_id
          and owner.id = executor.owner_member_id
      `));
      if (rows.length !== 1) throw new ApplicationError(MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE, true);
      return assignmentFromRow(rows[0]!);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async failSwitch(input: {
    companyId: string;
    memberId: string;
    operationId: string;
    errorCode: string;
    retryable: boolean;
    nowMs: number;
  }): Promise<void> {
    try {
      const rows = rowsFromResult<{ member_id: string }>(await this.db.execute(sql`
        update member_executor_assignments
        set pending_executor_id = null,
          previous_executor_id = null,
          state = 'failed',
          switch_operation_id = null,
          last_error_code = ${input.errorCode},
          last_error_retryable = ${input.retryable},
          updated_at_ms = ${input.nowMs}
        where company_id = ${input.companyId}
          and member_id = ${input.memberId}
          and state = 'switching'
          and switch_operation_id = ${input.operationId}
        returning member_id
      `));
      if (rows.length !== 1) {
        throw new ApplicationError(MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE, true);
      }
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(MEMBER_EXECUTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }
}

export type MemberExecutorRuntimeSwitchGateway = {
  switchExecutor(companyId: string, input: MemberExecutorSwitchInput): Promise<MemberExecutorSwitchResult>;
  stopMemberAppServer(
    companyId: string,
    memberId: string,
  ): Promise<{ member_id: string; stopped: true }>;
};

/**
 * Coordinates the only non-transactional step. The committed database binding
 * changes only after Runtime proves every previous Thread was resumed with the
 * same identifier; any error restores the old binding.
 */
export class MemberExecutorAssignmentService {
  constructor(
    private readonly assignments: PostgresMemberExecutorAssignmentRepository,
    private readonly runtime: MemberExecutorRuntimeSwitchGateway,
    private readonly now: () => number,
    private readonly newOperationId: () => string,
  ) {}

  read(input: {
    companyId: string;
    memberId: string;
    authority: ExecutorAssignmentAuthority;
  }): Promise<MemberExecutorAssignment> {
    return this.assignments.read(input);
  }

  listOptions(input: {
    companyId: string;
    memberId: string;
    authority: ExecutorAssignmentAuthority;
  }): Promise<readonly MemberExecutorSummary[]> {
    return this.assignments.listOptions(input);
  }

  async set(input: {
    companyId: string;
    memberId: string;
    executorId: string;
    authority: ExecutorAssignmentAuthority;
  }): Promise<MemberExecutorAssignment> {
    const operationId = this.newOperationId();
    const started = await this.assignments.beginSwitch({
      ...input,
      operationId,
      nowMs: this.now(),
    });
    if (started.kind === "unchanged") {
      return started.assignment;
    }

    let runtimeMayHaveChanged = false;
    let previousSwitchFacts: {
      credentialVersion: number;
      defaultModel: string;
      memoryEnabled: boolean;
      memoryManaged: boolean;
      codexThreadIds: readonly string[];
    } | null = null;
    try {
      const switchFacts = await this.assignments.readRuntimeSwitchFacts({
        companyId: input.companyId,
        memberId: input.memberId,
        targetExecutorId: started.targetExecutorId,
      });
      previousSwitchFacts = started.previousExecutorId === null
        ? null
        : await this.assignments.readRuntimeSwitchFacts({
          companyId: input.companyId,
          memberId: input.memberId,
          targetExecutorId: started.previousExecutorId,
        });
      runtimeMayHaveChanged = true;
      const result = await this.runtime.switchExecutor(input.companyId, {
        member_id: input.memberId,
        assignment_version: started.assignment.assignmentVersion,
        current_executor_id: started.previousExecutorId,
        target_executor_id: started.targetExecutorId,
        target_credential_version: switchFacts.credentialVersion,
        target_memory_enabled: switchFacts.memoryEnabled,
        target_memory_managed: switchFacts.memoryManaged,
        target_memory_model: switchFacts.defaultModel,
        codex_thread_ids: [...switchFacts.codexThreadIds],
      });
      if (
        result.member_id !== input.memberId
        || result.assignment_version !== started.assignment.assignmentVersion
        || result.outcome !== "switched"
        || result.executor_id !== started.targetExecutorId
        || !sameStringSet(switchFacts.codexThreadIds, result.resumed_codex_thread_ids)
      ) {
        throw new ApplicationError(MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE, true);
      }
      return await this.assignments.commitSwitch({
        companyId: input.companyId,
        memberId: input.memberId,
        operationId,
        targetExecutorId: input.executorId,
        nowMs: this.now(),
      });
    } catch (error) {
      const code = error instanceof ApplicationError
        ? error.code
        : MEMBER_EXECUTOR_SWITCH_CONFLICT_CODE;
      const retryable = error instanceof ApplicationError ? error.retryable : true;
      if (runtimeMayHaveChanged) {
        try {
          if (started.previousExecutorId === null) {
            const stopped = await this.runtime.stopMemberAppServer(
              input.companyId,
              input.memberId,
            );
            if (stopped.member_id !== input.memberId || !stopped.stopped) {
              throw new Error("Runtime did not stop the newly-created Member App Server.");
            }
          } else {
            if (previousSwitchFacts === null) {
              throw new Error("Previous Executor compensation facts are unavailable.");
            }
            const compensated = await this.runtime.switchExecutor(input.companyId, {
              member_id: input.memberId,
              assignment_version: started.assignment.assignmentVersion,
              current_executor_id: started.targetExecutorId,
              target_executor_id: started.previousExecutorId,
              target_credential_version: previousSwitchFacts.credentialVersion,
              target_memory_enabled: previousSwitchFacts.memoryEnabled,
              target_memory_managed: previousSwitchFacts.memoryManaged,
              target_memory_model: previousSwitchFacts.defaultModel,
              codex_thread_ids: [...previousSwitchFacts.codexThreadIds],
            });
            if (
              compensated.member_id !== input.memberId
              || compensated.assignment_version !== started.assignment.assignmentVersion
              || compensated.outcome !== "switched"
              || compensated.executor_id !== started.previousExecutorId
              || !sameStringSet(
                previousSwitchFacts.codexThreadIds,
                compensated.resumed_codex_thread_ids,
              )
            ) {
              throw new Error("Runtime compensation did not restore the previous Executor and Threads.");
            }
          }
        } catch {
          await this.assignments.failSwitch({
            companyId: input.companyId,
            memberId: input.memberId,
            operationId,
            errorCode: MEMBER_EXECUTOR_SWITCH_COMPENSATION_FAILED_CODE,
            retryable: true,
            nowMs: this.now(),
          });
          throw new ApplicationError(
            MEMBER_EXECUTOR_SWITCH_COMPENSATION_FAILED_CODE,
            true,
          );
        }
      }
      try {
        await this.assignments.rollbackSwitch({
          companyId: input.companyId,
          memberId: input.memberId,
          operationId,
          errorCode: code,
          retryable,
          nowMs: this.now(),
        });
      } catch (rollbackError) {
        if (!(rollbackError instanceof ApplicationError && rollbackError.code === code)) {
          throw rollbackError;
        }
      }
      throw error;
    }
  }
}

async function requireAssignmentAuthority(
  database: DatabaseExecutor,
  companyId: string,
  memberId: string,
  authority: ExecutorAssignmentAuthority,
  lock = false,
): Promise<"human" | "agent"> {
  const lockClause = lock ? sql`for update of target` : sql.empty();
  const rows = rowsFromResult<{ target_type: string }>(await database.execute(sql`
    select target.type as target_type
    from actors target
    inner join actors requester
      on requester.id = ${authority.requestedByMemberId}
      and requester.company_id = target.company_id
      and requester.status = 'active'
    where target.id = ${memberId}
      and target.company_id = ${companyId}
      and target.status = 'active'
      and target.system_role is null
      and requester.system_role is null
      and (
        (${authority.kind} = 'self' and requester.id = target.id and target.type = 'human')
        or
        (${authority.kind} = 'company_owner'
          and requester.company_role = 'owner'
          and requester.type = 'human'
          and target.type = 'agent')
      )
    limit 2
    ${lockClause}
  `));
  if (rows.length !== 1 || (rows[0]!.target_type !== "human" && rows[0]!.target_type !== "agent")) {
    throw new ApplicationError(MEMBER_EXECUTOR_ACCESS_DENIED_CODE, false);
  }
  return rows[0]!.target_type as "human" | "agent";
}

async function requireEligibleExecutor(
  database: DatabaseExecutor,
  companyId: string,
  memberId: string,
  executorId: string,
  targetType: "human" | "agent",
): Promise<MemberExecutorSummary> {
  const rows = rowsFromResult<ExecutorRow>(await database.execute(sql`
    select executor.executor_id, executor.owner_member_id,
      owner.display_name as owner_display_name,
      executor.name as executor_name, executor.sharing_state,
      executor.status as executor_status, executor.authorization_method, executor.plan_type,
      executor.executor_type, executor.configuration_status, executor.configuration_revision,
      executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
      executor.default_model, executor.default_reasoning_effort,
      executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
    from company_executors executor
    inner join actors owner
      on owner.id = executor.owner_member_id
      and owner.company_id = executor.company_id
    where executor.company_id = ${companyId}
      and executor.executor_id = ${executorId}
      and executor.status = 'connected'
      and executor.configuration_status = 'ready'
      and (
        (${targetType} = 'human'
          and (
            (
              executor.owner_member_id = ${memberId}
              and executor.sharing_state <> 'admin_blocked'
            )
            or executor.sharing_state = 'company_shared'
          ))
        or
        (${targetType} = 'agent'
          and executor.sharing_state = 'company_shared')
      )
    limit 2
    for share of executor
  `));
  if (rows.length !== 1) throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
  return executorFromRow(rows[0]!);
}

async function readAssignment(
  database: DatabaseExecutor,
  companyId: string,
  memberId: string,
  lock: boolean,
): Promise<MemberExecutorAssignment | null> {
  const lockClause = lock ? sql`for update of assignment` : sql.empty();
  const rows = rowsFromResult<AssignmentRow>(await database.execute(sql`
    select assignment.company_id, assignment.member_id,
      assignment.executor_id, assignment.pending_executor_id,
      assignment.assignment_version, assignment.state,
      assignment.switch_operation_id, assignment.last_error_code,
      assignment.last_error_retryable, assignment.updated_at_ms, executor.owner_member_id,
      owner.display_name as owner_display_name,
      executor.name as executor_name, executor.sharing_state,
      executor.status as executor_status, executor.authorization_method, executor.plan_type,
      executor.executor_type, executor.configuration_status, executor.configuration_revision,
      executor.allowed_models_json, executor.allowed_reasoning_efforts_json,
      executor.default_model, executor.default_reasoning_effort,
      executor.catalog_checked_at_ms, executor.configuration_updated_at_ms
    from member_executor_assignments assignment
    inner join company_executors executor
      on executor.company_id = assignment.company_id
      and executor.executor_id = assignment.executor_id
    inner join actors owner
      on owner.company_id = executor.company_id
      and owner.id = executor.owner_member_id
    where assignment.company_id = ${companyId}
      and assignment.member_id = ${memberId}
    limit 2
    ${lockClause}
  `));
  if (rows.length > 1) throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
  return rows[0] ? assignmentFromRow(rows[0]) : null;
}

function assignmentFromRow(row: AssignmentRow): MemberExecutorAssignment {
  return {
    companyId: row.company_id,
    memberId: row.member_id,
    executor: executorFromRow({
      executor_id: row.executor_id,
      owner_member_id: row.owner_member_id,
      owner_display_name: row.owner_display_name,
      executor_name: row.executor_name,
      sharing_state: row.sharing_state,
      executor_status: row.executor_status,
      authorization_method: row.authorization_method,
      plan_type: row.plan_type,
      executor_type: row.executor_type,
      configuration_status: row.configuration_status,
      configuration_revision: row.configuration_revision,
      allowed_models_json: row.allowed_models_json,
      allowed_reasoning_efforts_json: row.allowed_reasoning_efforts_json,
      default_model: row.default_model,
      default_reasoning_effort: row.default_reasoning_effort,
      catalog_checked_at_ms: row.catalog_checked_at_ms,
      configuration_updated_at_ms: row.configuration_updated_at_ms,
    }),
    assignmentVersion: positiveNumber(row.assignment_version),
    state: assignmentState(row.state),
    pendingExecutorId: row.pending_executor_id,
    switchOperationId: row.switch_operation_id,
    lastErrorCode: row.last_error_code,
    lastErrorRetryable: row.last_error_retryable,
    updatedAtMs: nonNegativeNumber(row.updated_at_ms),
  };
}

function executorFromRow(row: ExecutorRow): MemberExecutorSummary {
  if (!row.executor_id || !row.owner_member_id || !row.owner_display_name || !row.executor_name) {
    throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
  }
  return {
    executorId: row.executor_id,
    ownerMemberId: row.owner_member_id,
    ownerDisplayName: row.owner_display_name,
    name: row.executor_name,
    sharingState: sharingState(row.sharing_state),
    availability: availability(row.executor_status, row.configuration_status),
    executorType: executorType(row.executor_type),
    configurationStatus: configurationStatus(row.configuration_status),
    configurationRevision: nonNegativeNumber(row.configuration_revision),
    allowedModels: Array.isArray(row.allowed_models_json) ? row.allowed_models_json as ExecutorModelPolicyItem[] : [],
    allowedReasoningEfforts: Array.isArray(row.allowed_reasoning_efforts_json)
      ? row.allowed_reasoning_efforts_json.filter((value): value is string => typeof value === "string")
      : [],
    defaultModel: row.default_model,
    defaultReasoningEffort: row.default_reasoning_effort,
    catalogCheckedAtMs: row.catalog_checked_at_ms === null ? null : nonNegativeNumber(row.catalog_checked_at_ms),
    configurationUpdatedAtMs: row.configuration_updated_at_ms === null ? null : nonNegativeNumber(row.configuration_updated_at_ms),
    authorization: executorAuthorization(row),
  };
}

function executorAuthorization(row: ExecutorRow): MemberExecutorSummary["authorization"] {
  if (row.authorization_method === "chatgpt") {
    return { method: "chatgpt", planType: row.plan_type };
  }
  if (row.authorization_method === "custom_api_key") {
    return { method: "custom_api_key" };
  }
  throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
}

function assignmentState(value: string): MemberExecutorAssignment["state"] {
  if (value === "ready" || value === "switching" || value === "configuration_required" || value === "auth_required" || value === "failed") {
    return value;
  }
  throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
}

function sharingState(value: string): MemberExecutorSummary["sharingState"] {
  if (value === "private" || value === "company_shared" || value === "admin_blocked") return value;
  throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
}

function availability(value: string, configurationStatus: string): MemberExecutorSummary["availability"] {
  if (value === "connected" && configurationStatus !== "ready") return "configuration_required";
  if (value === "connected") return "available";
  if (value === "pending_auth") return "pending_auth";
  if (value === "expired" || value === "failed") return "unavailable";
  if (value === "revoked") return "disconnected";
  throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
}

function executorType(value: string): "codex" {
  if (value === "codex") return value;
  throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
}

function configurationStatus(value: string): MemberExecutorSummary["configurationStatus"] {
  if (value === "pending" || value === "validating" || value === "ready" || value === "invalid") return value;
  throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function modelItems(value: unknown): Array<{ model: string; supported_reasoning_efforts: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || !("model" in item)) return [];
    if (typeof item.model !== "string") return [];
    const efforts = "supported_reasoning_efforts" in item
      ? stringArray(item.supported_reasoning_efforts)
      : [];
    return [{ model: item.model, supported_reasoning_efforts: efforts }];
  });
}

function assertSwitchInput(input: BeginMemberExecutorSwitchInput): void {
  if (
    !input.companyId
    || !input.memberId
    || !input.executorId
    || !input.operationId
    || !Number.isSafeInteger(input.nowMs)
    || input.nowMs < 0
  ) {
    throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
  }
}

function positiveNumber(value: DatabaseNumber): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
  }
  return result;
}

function nonNegativeNumber(value: DatabaseNumber): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ApplicationError(MEMBER_EXECUTOR_INVALID_CODE, false);
  }
  return result;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return expected.size === left.length && right.every((value) => expected.has(value));
}

function rowsFromResult<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Row[];
  }
  return [];
}
