import type { HomeMemoryProfile } from "@fields/contracts/public/home";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { MemberMemoryApplication } from "../../../../../application/member-memory/index.js";
import type { CompanyRuntimePublicGateway } from "../../../../../application/execution/ports/index.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import { memberMemoryProfiles } from "../../schema/company/member-memory.js";

export const MEMBER_MEMORY_TARGET_INVALID_CODE = "MEMBER_MEMORY_TARGET_INVALID";
export const MEMBER_MEMORY_REVISION_CONFLICT_CODE = "MEMBER_MEMORY_REVISION_CONFLICT";

export class PostgresMemberMemoryApplication implements MemberMemoryApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: CompanyRuntimePublicGateway,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async profile(companyId: string, memberId: string): Promise<HomeMemoryProfile> {
    await this.ensureProfile(companyId, memberId);
    return this.readProfile(companyId, memberId);
  }

  async update(input: {
    companyId: string;
    memberId: string;
    enabled: boolean;
    expectedRevision: number;
  }): Promise<HomeMemoryProfile> {
    await this.ensureProfile(input.companyId, input.memberId);
    const current = await this.readProfile(input.companyId, input.memberId);
    const needsApply = current.enabled !== input.enabled || current.status === "failed";
    const operationId = needsApply ? `member_memory_${randomUUID()}` : null;
    const rows = await this.db.update(memberMemoryProfiles).set({
      enabled: input.enabled,
      ...(operationId ? {
        status: "applying",
        errorCode: null,
        operationId,
      } : {}),
      revision: sql`${memberMemoryProfiles.revision} + 1`,
      updatedAtMs: this.nowMs(),
    }).where(and(
      eq(memberMemoryProfiles.companyId, input.companyId),
      eq(memberMemoryProfiles.memberId, input.memberId),
      eq(memberMemoryProfiles.revision, input.expectedRevision),
    )).returning();
    if (rows.length !== 1) {
      throw new ApplicationError(MEMBER_MEMORY_REVISION_CONFLICT_CODE, false);
    }
    if (operationId) {
      try {
        await this.runtime.memberMemoryApply(input.companyId, {
          memberId: input.memberId,
          operationId,
          enabled: input.enabled,
          previousEnabled: current.applied_enabled,
        });
      } catch (_error) {
        await this.db.update(memberMemoryProfiles).set({
          status: "failed",
          errorCode: "member_memory_runtime_unavailable",
          operationId: null,
        }).where(and(
          eq(memberMemoryProfiles.companyId, input.companyId),
          eq(memberMemoryProfiles.memberId, input.memberId),
          eq(memberMemoryProfiles.operationId, operationId),
        ));
      }
    }
    return this.readProfile(input.companyId, input.memberId);
  }

  async complete(input: {
    companyId: string;
    memberId: string;
    operationId: string;
    appliedEnabled: boolean;
    status: "ready" | "failed";
    errorCode: string | null;
    completedAtMs: number;
  }): Promise<void> {
    await this.db.update(memberMemoryProfiles).set({
      appliedEnabled: input.appliedEnabled,
      status: input.status,
      errorCode: input.errorCode,
      operationId: null,
      updatedAtMs: input.completedAtMs,
    }).where(and(
      eq(memberMemoryProfiles.companyId, input.companyId),
      eq(memberMemoryProfiles.memberId, input.memberId),
      eq(memberMemoryProfiles.operationId, input.operationId),
    ));
  }

  private async ensureProfile(companyId: string, memberId: string): Promise<void> {
    const result = await this.db.execute(sql<{ id: string }>`
      select id from actors
      where company_id = ${companyId}
        and id = ${memberId}
        and type in ('human', 'agent')
        and status = 'active'
        and system_role is null
      limit 2
    `);
    if (result.rows.length !== 1) {
      throw new ApplicationError(MEMBER_MEMORY_TARGET_INVALID_CODE, false);
    }
    await this.db.insert(memberMemoryProfiles).values({
      companyId,
      memberId,
      updatedAtMs: this.nowMs(),
    }).onConflictDoNothing();
  }

  private async readProfile(companyId: string, memberId: string): Promise<HomeMemoryProfile> {
    const [row] = await this.db.select().from(memberMemoryProfiles).where(and(
      eq(memberMemoryProfiles.companyId, companyId),
      eq(memberMemoryProfiles.memberId, memberId),
    )).limit(1);
    if (!row) throw new ApplicationError(MEMBER_MEMORY_TARGET_INVALID_CODE, false);
    return {
      enabled: row.enabled,
      applied_enabled: row.appliedEnabled,
      status: row.status === "applying" || row.status === "failed" ? row.status : "ready",
      error_code: row.errorCode,
      revision: Number(row.revision),
    };
  }
}
