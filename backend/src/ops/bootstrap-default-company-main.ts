#!/usr/bin/env node
import { eq } from "drizzle-orm";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createCompanyActorApplication, createHumanInvitationAdmissionPolicy } from "../composition/api/index.js";
import { createFieldsAuth } from "../infrastructure/auth/better-auth/index.js";
import { loadBackendEnvFiles } from "../infrastructure/configuration/env.js";
import { createBackendDatabaseService } from "../infrastructure/persistence/postgres/database-service.js";
import { PostgresRegistrationApplication } from "../infrastructure/persistence/postgres/repositories/index.js";
import { actors, companies, companyRegistrationSettings, user } from "../infrastructure/persistence/postgres/schema/index.js";

const ONBOARDING_TIMEOUT_MS = 5 * 60_000;

export async function main(): Promise<number> {
  loadBackendEnvFiles();
  if (!stdin.isTTY || !stdout.isTTY) {
    process.stderr.write("Bootstrap requires an interactive terminal.\n");
    return 1;
  }
  const reader = createInterface({ input: stdin, output: stdout });
  const database = createBackendDatabaseService();
  try {
    const companyName = required(await reader.question("Company name: "), "Company name");
    const ownerName = required(await reader.question("Owner display name: "), "Owner display name");
    const ownerEmail = normalizedEmail(await reader.question("Owner email: "));
    reader.close();
    const state = await readState(database.db);
    assertBootstrapState(state, { companyName, ownerName, ownerEmail });

    const auth = createFieldsAuth({
      database: database.db,
      secret: required(process.env.BETTER_AUTH_SECRET ?? "", "BETTER_AUTH_SECRET"),
      baseURL: required(process.env.BETTER_AUTH_URL ?? "", "BETTER_AUTH_URL"),
      trustedOrigins: trustedOrigins(),
      invitationPolicy: createHumanInvitationAdmissionPolicy({ database: database.db }),
      registrationAdmission: { validateSignupCredential: async () => null },
      committedMembershipProjection: {
        reconcileAcceptedMembership: async () => undefined,
        reconcileRemovedMembership: async () => undefined,
      },
    });

    let ownerUserId = state.owner?.id ?? null;
    if (!ownerUserId) {
      const password = await hiddenQuestion("Owner password: ");
      if (password.length < 8 || password.length > 128) throw new Error("Owner password must be 8-128 characters.");
      const created = await auth.api.signUpEmail({ body: {
        name: ownerName,
        email: ownerEmail,
        password,
      } });
      ownerUserId = created.user.id;
    }

    const companyActors = createCompanyActorApplication({
      database: database.db,
      auth,
      internalCompanyId: process.env.FIELDS_INTERNAL_COMPANY_ID ?? "company_internal",
    });

    let companyId = state.company?.id ?? null;
    let ownerActorId = state.ownerActor?.id ?? null;
    if (!companyId) {
      const created = await companyActors.createCompany.execute({
        name: companyName,
        ownerUserId,
        ownerDisplayName: ownerName,
      });
      companyId = created.company.id;
      ownerActorId = created.ownerActorId;
    }
    if (!ownerActorId) throw new Error("The bootstrap Owner Actor is unavailable.");

    await waitForCompany(companyActors, companyId, ownerActorId);
    const registration = new PostgresRegistrationApplication(
      database.db,
      companyActors.committedMembershipProjection,
    );
    const settings = await registration.initialize(companyId, ownerActorId);
    stdout.write(`${JSON.stringify({
      status: "complete",
      company_id: companyId,
      owner_email: ownerEmail,
      registration_code: settings.code,
    })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    reader.close();
    await database.close();
  }
}

async function readState(db: ReturnType<typeof createBackendDatabaseService>["db"]) {
  const [users, companyRows, ownerActors, settings] = await Promise.all([
    db.select({ id: user.id, email: user.email, name: user.name }).from(user).limit(2),
    db.select({ id: companies.id, name: companies.name }).from(companies).limit(2),
    db.select({ id: actors.id, authUserId: actors.authUserId, displayName: actors.displayName, role: actors.companyRole })
      .from(actors).where(eq(actors.companyRole, "owner")).limit(2),
    db.select({ companyId: companyRegistrationSettings.companyId }).from(companyRegistrationSettings).limit(2),
  ]);
  return {
    owner: users.length === 1 ? users[0]! : null,
    company: companyRows.length === 1 ? companyRows[0]! : null,
    ownerActor: ownerActors.length === 1 ? ownerActors[0]! : null,
    settingsCount: settings.length,
    counts: { users: users.length, companies: companyRows.length, ownerActors: ownerActors.length },
  };
}

function assertBootstrapState(
  state: Awaited<ReturnType<typeof readState>>,
  expected: { companyName: string; ownerName: string; ownerEmail: string },
): void {
  if (state.counts.users > 1 || state.counts.companies > 1 || state.counts.ownerActors > 1) {
    throw new Error("Bootstrap refused: unexpected existing business data.");
  }
  if (state.owner && (state.owner.email !== expected.ownerEmail || state.owner.name !== expected.ownerName)) {
    throw new Error("Bootstrap refused: the existing Owner account does not match.");
  }
  if (state.company && state.company.name !== expected.companyName) {
    throw new Error("Bootstrap refused: the existing Company does not match.");
  }
  if (state.ownerActor && (
    state.ownerActor.authUserId !== state.owner?.id
    || state.ownerActor.displayName !== expected.ownerName
    || state.ownerActor.role !== "owner"
  )) {
    throw new Error("Bootstrap refused: the existing Owner Actor does not match.");
  }
  if (state.company && (!state.owner || !state.ownerActor)) {
    throw new Error("Bootstrap refused: the Company is missing its matching Owner identity.");
  }
  if (state.settingsCount > 0 && !state.company) {
    throw new Error("Bootstrap refused: registration settings exist without a Company.");
  }
}

async function waitForCompany(
  application: ReturnType<typeof createCompanyActorApplication>,
  companyId: string,
  ownerActorId: string,
): Promise<void> {
  const deadline = Date.now() + ONBOARDING_TIMEOUT_MS;
  let retried = false;
  while (Date.now() < deadline) {
    const status = await application.onboardingStatus.execute({ companyId, isOwner: true });
    if (status.stage === "ready") return;
    if (status.stage === "failed") {
      if (retried) throw new Error(`Company onboarding failed: ${status.runtime.error?.code ?? "unknown"}.`);
      await application.retryCompanyOnboarding.execute({ companyId, actorId: ownerActorId });
      retried = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Company onboarding did not become ready before the bootstrap timeout.");
}

function trustedOrigins(): string[] {
  const configured = process.env.FIELDS_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((value) => value.trim()).filter(Boolean) ?? [];
  return configured.length > 0
    ? configured
    : [new URL(required(process.env.BETTER_AUTH_URL ?? "", "BETTER_AUTH_URL")).origin];
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 255) {
    throw new Error("Owner email is invalid.");
  }
  return email;
}

async function hiddenQuestion(label: string): Promise<string> {
  stdout.write(label);
  const input = stdin;
  input.setRawMode?.(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        cleanup();
        reject(new Error("Bootstrap cancelled."));
        return;
      }
      if (text === "\r" || text === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (text === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      if (!/[\u0000-\u001f]/u.test(text)) value += text;
    };
    input.on("data", onData);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
