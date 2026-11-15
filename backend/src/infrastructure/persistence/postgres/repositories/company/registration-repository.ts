import { and, eq, gt } from "drizzle-orm";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { CommittedMembershipActorProjection } from "../../../../../application/actor/ports/index.js";
import type { BackendDatabase } from "../../database-service.js";
import {
  companies,
  companyRegistrationSettings,
  member,
  registrationSignupGrants,
  user,
} from "../../schema/index.js";

export const REGISTRATION_INVALID_CODE = "REGISTRATION_INVALID";
export const REGISTRATION_CONFLICT_CODE = "REGISTRATION_CONFLICT";
export const REGISTRATION_ACCESS_DENIED_CODE = "REGISTRATION_ACCESS_DENIED";
export const REGISTRATION_UNAVAILABLE_CODE = "REGISTRATION_UNAVAILABLE";

const SIGNUP_GRANT_TTL_MS = 15 * 60_000;

export type RegistrationSettingsView = {
  enabled: boolean;
  code: string;
  code_version: number;
  updated_at_ms: number;
};

export class PostgresRegistrationApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly projection: CommittedMembershipActorProjection,
    private readonly now: () => number = Date.now,
  ) {}

  async prepare(input: { email: string; code: string }): Promise<{
    signup_credential: string;
    expires_at_ms: number;
  }> {
    const email = normalizedEmail(input.email);
    const code = normalizedCode(input.code);
    const now = this.now();
    try {
      return await this.db.transaction(async (tx) => {
        const settingsRows = await tx.select({
          companyId: companyRegistrationSettings.companyId,
          code: companyRegistrationSettings.code,
          codeVersion: companyRegistrationSettings.codeVersion,
          enabled: companyRegistrationSettings.enabled,
          companyStatus: companies.status,
        })
          .from(companyRegistrationSettings)
          .innerJoin(companies, eq(companies.id, companyRegistrationSettings.companyId))
          .limit(2)
          .for("update");
        const users = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
        const settings = settingsRows.length === 1 ? settingsRows[0]! : null;
        if (
          !settings
          || !settings.enabled
          || settings.companyStatus !== "active"
          || !secureEqual(code, settings.code)
          || users.length > 0
        ) {
          throw new ApplicationError(REGISTRATION_INVALID_CODE, false);
        }
        const id = `registration_grant_${randomUUID()}`;
        const credential = randomBytes(32).toString("base64url");
        const expiresAtMs = now + SIGNUP_GRANT_TTL_MS;
        await tx.insert(registrationSignupGrants).values({
          id,
          companyId: settings.companyId,
          credentialHash: credentialHash(credential),
          normalizedEmail: email,
          codeVersion: settings.codeVersion,
          status: "prepared",
          expiresAtMs,
          claimedAtMs: null,
          createdAtMs: now,
          updatedAtMs: now,
        });
        return { signup_credential: credential, expires_at_ms: expiresAtMs };
      });
    } catch (error) {
      throw registrationError(error);
    }
  }

  async validateSignupCredential(input: { credential: string; email: string }): Promise<string> {
    const email = normalizedEmail(input.email);
    const credential = normalizedCredential(input.credential);
    try {
      const rows = await this.db.select({
        id: registrationSignupGrants.id,
        email: registrationSignupGrants.normalizedEmail,
        grantCodeVersion: registrationSignupGrants.codeVersion,
        currentCodeVersion: companyRegistrationSettings.codeVersion,
        enabled: companyRegistrationSettings.enabled,
        companyStatus: companies.status,
      })
        .from(registrationSignupGrants)
        .innerJoin(
          companyRegistrationSettings,
          eq(companyRegistrationSettings.companyId, registrationSignupGrants.companyId),
        )
        .innerJoin(companies, eq(companies.id, registrationSignupGrants.companyId))
        .where(and(
          eq(registrationSignupGrants.credentialHash, credentialHash(credential)),
          eq(registrationSignupGrants.status, "prepared"),
          gt(registrationSignupGrants.expiresAtMs, this.now()),
        ))
        .limit(2);
      const grant = rows.length === 1 ? rows[0]! : null;
      if (
        !grant
        || grant.email !== email
        || !grant.enabled
        || grant.companyStatus !== "active"
        || grant.grantCodeVersion !== grant.currentCodeVersion
      ) {
        throw new ApplicationError(REGISTRATION_INVALID_CODE, false);
      }
      return grant.id;
    } catch (error) {
      throw registrationError(error);
    }
  }

  async hasPendingGrant(authUserId: string): Promise<boolean> {
    try {
      const rows = await this.db.select({ status: registrationSignupGrants.status })
        .from(user)
        .innerJoin(registrationSignupGrants, eq(registrationSignupGrants.id, user.registrationGrantId))
        .where(eq(user.id, authUserId))
        .limit(2);
      return rows.length === 1;
    } catch (error) {
      throw registrationError(error);
    }
  }

  async claim(authUserId: string): Promise<{ company_id: string; status: "joined" }> {
    try {
      const result = await this.db.transaction(async (tx) => {
        const users = await tx.select({
          id: user.id,
          grantId: user.registrationGrantId,
        }).from(user).where(eq(user.id, authUserId)).limit(2).for("update");
        const identity = users.length === 1 ? users[0]! : null;
        if (!identity?.grantId) throw new ApplicationError(REGISTRATION_ACCESS_DENIED_CODE, false);

        const grants = await tx.select({
          id: registrationSignupGrants.id,
          companyId: registrationSignupGrants.companyId,
          status: registrationSignupGrants.status,
        }).from(registrationSignupGrants)
          .where(eq(registrationSignupGrants.id, identity.grantId))
          .limit(2)
          .for("update");
        const grant = grants.length === 1 ? grants[0]! : null;
        if (!grant) throw new ApplicationError(REGISTRATION_ACCESS_DENIED_CODE, false);

        const [companyRows, memberships] = await Promise.all([
          tx.select({ organizationId: companies.authOrganizationId })
            .from(companies)
            .where(eq(companies.id, grant.companyId))
            .limit(2),
          tx.select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, authUserId))
            .limit(2),
        ]);
        const organizationId = companyRows.length === 1 ? companyRows[0]!.organizationId : null;
        if (!organizationId) throw new ApplicationError(REGISTRATION_UNAVAILABLE_CODE, true);
        if (
          memberships.length > 1
          || (memberships.length === 1 && memberships[0]!.organizationId !== organizationId)
        ) {
          throw new ApplicationError(REGISTRATION_CONFLICT_CODE, false);
        }
        if (memberships.length === 0) {
          await tx.insert(member).values({
            id: `member_${randomUUID()}`,
            organizationId,
            userId: authUserId,
            role: "member",
            createdAt: new Date(this.now()),
          });
        }
        if (grant.status === "prepared") {
          const now = this.now();
          await tx.update(registrationSignupGrants).set({
            status: "claimed",
            claimedAtMs: now,
            updatedAtMs: now,
          }).where(eq(registrationSignupGrants.id, grant.id));
        }
        return { companyId: grant.companyId, organizationId };
      });
      await this.projection.reconcileAcceptedMembership({
        organizationId: result.organizationId,
        authUserId,
      });
      return { company_id: result.companyId, status: "joined" };
    } catch (error) {
      throw registrationError(error);
    }
  }

  async getSettings(companyId: string): Promise<RegistrationSettingsView> {
    try {
      const rows = await this.db.select().from(companyRegistrationSettings)
        .where(eq(companyRegistrationSettings.companyId, companyId)).limit(2);
      if (rows.length !== 1) throw new ApplicationError(REGISTRATION_UNAVAILABLE_CODE, true);
      return settingsView(rows[0]!);
    } catch (error) {
      throw registrationError(error);
    }
  }

  async rotate(companyId: string, actorId: string): Promise<RegistrationSettingsView> {
    try {
      return await this.db.transaction(async (tx) => {
        const current = await tx.select().from(companyRegistrationSettings)
          .where(eq(companyRegistrationSettings.companyId, companyId)).limit(2).for("update");
        if (current.length !== 1) throw new ApplicationError(REGISTRATION_UNAVAILABLE_CODE, true);
        const rows = await tx.update(companyRegistrationSettings).set({
          code: newRegistrationCode(),
          codeVersion: current[0]!.codeVersion + 1,
          updatedByActorId: actorId,
          updatedAtMs: this.now(),
        }).where(eq(companyRegistrationSettings.companyId, companyId)).returning();
        return settingsView(rows[0]!);
      });
    } catch (error) {
      throw registrationError(error);
    }
  }

  async setEnabled(companyId: string, actorId: string, enabled: boolean): Promise<RegistrationSettingsView> {
    try {
      const rows = await this.db.update(companyRegistrationSettings).set({
        enabled,
        updatedByActorId: actorId,
        updatedAtMs: this.now(),
      }).where(eq(companyRegistrationSettings.companyId, companyId)).returning();
      if (rows.length !== 1) throw new ApplicationError(REGISTRATION_UNAVAILABLE_CODE, true);
      return settingsView(rows[0]!);
    } catch (error) {
      throw registrationError(error);
    }
  }

  async initialize(companyId: string, actorId: string): Promise<RegistrationSettingsView> {
    try {
      const now = this.now();
      const rows = await this.db.insert(companyRegistrationSettings).values({
        companyId,
        code: newRegistrationCode(),
        codeVersion: 1,
        enabled: true,
        updatedByActorId: actorId,
        createdAtMs: now,
        updatedAtMs: now,
      }).onConflictDoNothing().returning();
      return rows.length === 1 ? settingsView(rows[0]!) : this.getSettings(companyId);
    } catch (error) {
      throw registrationError(error);
    }
  }
}

export function newRegistrationCode(): string {
  return randomBytes(32).toString("base64url");
}

function settingsView(row: typeof companyRegistrationSettings.$inferSelect): RegistrationSettingsView {
  return {
    enabled: row.enabled,
    code: row.code,
    code_version: row.codeVersion,
    updated_at_ms: row.updatedAtMs,
  };
}

function credentialHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const actual = Buffer.from(left, "utf8");
  const expected = Buffer.from(right, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 255 || !email.includes("@")) {
    throw new ApplicationError(REGISTRATION_INVALID_CODE, false);
  }
  return email;
}

function normalizedCode(value: string): string {
  const code = value.trim();
  if (code.length < 16 || code.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(code)) {
    throw new ApplicationError(REGISTRATION_INVALID_CODE, false);
  }
  return code;
}

function normalizedCredential(value: string): string {
  const credential = value.trim();
  if (credential.length < 32 || credential.length > 512 || /\s/u.test(credential)) {
    throw new ApplicationError(REGISTRATION_INVALID_CODE, false);
  }
  return credential;
}

function registrationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError(REGISTRATION_UNAVAILABLE_CODE, true);
}
