import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  CompanyExecutorAuthCancelResult,
  CompanyExecutorAuthStartInput,
  CompanyExecutorAuthStartResult,
  CompanyExecutorAuthStatusResult,
  CompanyExecutorCredentialCleanupResult,
  CompanyExecutorCustomApiConfigureInput,
  CompanyExecutorCustomApiConfigureResult,
  CompanyExecutorModelCatalogInput,
  CompanyExecutorModelCatalogResult,
  CompanyExecutorModelValidationInput,
  CompanyExecutorModelValidationResult,
  CompanyExecutorTokenIssueInput,
  CompanyExecutorTokenIssueResult,
} from "@fields/contracts/internal/company-runtime";
import type { GetAccountResponse } from "../../generated/codex-app-server-protocol/v2/GetAccountResponse.js";
import type { LoginAccountResponse } from "../../generated/codex-app-server-protocol/v2/LoginAccountResponse.js";
import type { ModelListResponse } from "../../generated/codex-app-server-protocol/v2/ModelListResponse.js";
import type { ThreadStartResponse } from "../../generated/codex-app-server-protocol/v2/ThreadStartResponse.js";
import { CodexAppServerClient } from "../adapter/codex-app-server-client.js";
import {
  codexAppServerSocketReady,
  codexAppServerStatus,
  startCodexAppServerProcess,
  stopCodexAppServerProcess,
} from "../codex/codex-process.js";
import {
  initializeExternalAuthClient,
  type ExternalAuthClient,
} from "../codex/external-auth.js";
import {
  COMPANY_EXECUTORS_DIR,
  companyExecutorAuthPath,
  companyExecutorCustomApiPath,
  companyExecutorRoot,
  ensureCompanyExecutorCodexHome,
} from "../init/executor.js";
import { emitLifecycleEvent } from "../../observability/events.js";

type PublicOperationError = { code: string; retryable: boolean };

type ManagedAccountVerification = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string;
  credentialVersion: number;
};

type ManagedCustomApiCredential = {
  baseUrl: string;
  apiKey: string;
  endpointHost: string;
  credentialVersion: number;
  fingerprint: string;
};

type AuthAttempt = {
  executorId: string;
  attemptId: string;
  loginId: string;
  verificationUrl: string;
  userCode: string;
  status: "pending" | "completed" | "cancelled" | "failed";
  error: PublicOperationError | null;
  listener: CompanyExecutorClient | null;
  transition: Promise<void>;
};

export type CompanyExecutorConnected = {
  executorId: string;
  credentialVersion: number;
  authorization:
    | { method: "chatgpt"; accountId: string; planType: string }
    | { method: "custom_api_key"; endpointHost: string };
};

export type CompanyExecutorClient = ExternalAuthClient & {
  readMessage(deadlineMs: number): Promise<Record<string, unknown> | null>;
};

export type CompanyExecutorServiceOptions = {
  appServerSocketReady?: (socketPath: string) => Promise<boolean>;
  startAppServer?: typeof startCodexAppServerProcess;
  proxyEnv?: () => NodeJS.ProcessEnv;
  ensureAppServer?: (executorId: string) => Promise<string>;
  clientFactory?: (socketPath: string) => CompanyExecutorClient;
  afterCanonicalCredentialOpen?: (path: string) => Promise<void>;
  onConnected?: (
    connected: CompanyExecutorConnected,
  ) => Promise<void> | void;
  onUnavailable?: (unavailable: CompanyExecutorUnavailable) => Promise<void> | void;
  onCredentialChanged?: (input: {
    executorId: string;
    previousCredentialVersion: number;
    credentialVersion: number;
  }) => Promise<void> | void;
  onCredentialRollback?: (input: {
    executorId: string;
    previousCredentialVersion: number;
  }) => Promise<void> | void;
  nowMs?: () => number;
  credentialPropagationAttempts?: number;
  credentialPropagationIntervalMs?: number;
};

export type CompanyExecutorUnavailable = {
  executorId: string;
  credentialVersion?: number;
  status: "expired" | "failed";
  code: string;
};

export type CompanyExecutorRestoreResult = {
  executorId: string;
  status: "connected" | "unavailable";
  connected?: CompanyExecutorConnected;
  error?: PublicOperationError;
};

export class CompanyExecutorServiceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "CompanyExecutorServiceError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export class CompanyExecutorService {
  readonly workdir: string;

  private readonly options: CompanyExecutorServiceOptions;
  private readonly attempts = new Map<string, AuthAttempt>();
  private readonly activeAttemptByExecutor = new Map<string, string>();
  private readonly authStartFlights = new Map<string, Promise<CompanyExecutorAuthStartResult>>();
  private readonly appServerFlights = new Map<string, Promise<string>>();
  private readonly accountRefreshFlights = new Map<string, Promise<GetAccountResponse>>();
  private readonly accountVerificationFlights = new Map<string, Promise<ManagedAccountVerification>>();
  private readonly credentialVersions = new Map<string, { fingerprint: string; version: number }>();
  private readonly connectedNotifications = new Map<string, string>();
  private readonly connectedNotificationFlights = new Map<string, Promise<void>>();
  private readonly listenerCloseFlights = new Set<Promise<void>>();
  private proxyReconfiguring = false;
  private closed = false;

  constructor(workdir: string, options: CompanyExecutorServiceOptions = {}) {
    this.workdir = workdir;
    this.options = options;
  }

  async startAuth(input: CompanyExecutorAuthStartInput): Promise<CompanyExecutorAuthStartResult> {
    this.assertOpenForWork();
    if (this.proxyReconfiguring) {
      throw new CompanyExecutorServiceError(
        "company_proxy_reconfigure_in_progress",
        "Codex authorization is temporarily unavailable while the Company proxy changes.",
        { retryable: true },
      );
    }
    const key = attemptKey(input.executor_id, input.attempt_id);
    const existing = this.attempts.get(key);
    if (existing) {
      return startResult(existing);
    }
    const existingFlight = this.authStartFlights.get(key);
    if (existingFlight) {
      return existingFlight;
    }
    const activeAttemptId = this.activeAttemptByExecutor.get(input.executor_id);
    if (activeAttemptId) {
      const active = this.attempts.get(attemptKey(input.executor_id, activeAttemptId));
      const activeFlight = this.authStartFlights.get(attemptKey(input.executor_id, activeAttemptId));
      if (active?.status === "pending" || activeFlight) {
        throw new CompanyExecutorServiceError("auth_attempt_in_progress", "A Codex authentication attempt is already pending.");
      }
    }

    this.activeAttemptByExecutor.set(input.executor_id, input.attempt_id);
    const flight = this.startReservedAuth(input, key);
    this.authStartFlights.set(key, flight);
    try {
      return await flight;
    } finally {
      if (this.authStartFlights.get(key) === flight) {
        this.authStartFlights.delete(key);
      }
      if (
        !this.attempts.has(key)
        && this.activeAttemptByExecutor.get(input.executor_id) === input.attempt_id
      ) {
        this.activeAttemptByExecutor.delete(input.executor_id);
      }
    }
  }

  private async startReservedAuth(
    input: CompanyExecutorAuthStartInput,
    key: string,
  ): Promise<CompanyExecutorAuthStartResult> {
    await ensureCompanyExecutorCodexHome(this.workdir, input.executor_id);
    const socketPath = await this.ensureAppServer(input.executor_id);
    const client = this.openClient(socketPath);
    try {
      await initializeExternalAuthClient(client);
      const result = await client.request<LoginAccountResponse>("account/login/start", { type: "chatgptDeviceCode" });
      if (result.type !== "chatgptDeviceCode") {
        throw new CompanyExecutorServiceError("codex_device_code_unavailable", "Codex did not start Device Code authentication.");
      }
      const attempt: AuthAttempt = {
        executorId: input.executor_id,
        attemptId: input.attempt_id,
        loginId: result.loginId,
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
        status: "pending",
        error: null,
        listener: client,
        transition: Promise.resolve(),
      };
      this.attempts.set(key, attempt);
      void this.listenForCompletion(attempt);
      return startResult(attempt);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  status(input: { executor_id: string; attempt_id: string }): CompanyExecutorAuthStatusResult {
    const attempt = this.attempts.get(attemptKey(input.executor_id, input.attempt_id));
    if (!attempt) {
      return {
        attempt_id: input.attempt_id,
        status: "failed",
        login_id: null,
        verification_url: null,
        user_code: null,
        error: { code: "AUTH_ATTEMPT_NOT_FOUND", retryable: true },
      };
    }
    return statusResult(attempt);
  }

  async cancel(input: { executor_id: string; attempt_id: string }): Promise<CompanyExecutorAuthCancelResult> {
    this.assertOpenForWork();
    const attempt = this.requireAttempt(input.executor_id, input.attempt_id);
    const result = await this.withAttemptTransition(attempt, async () => {
      if (attempt.status !== "pending") {
        throw new CompanyExecutorServiceError(
          "auth_attempt_not_pending",
          "The Codex authentication attempt is no longer pending.",
        );
      }
      const socketPath = await this.ensureAppServer(input.executor_id);
      const client = this.openClient(socketPath);
      try {
        await initializeExternalAuthClient(client);
        await client.request("account/login/cancel", { loginId: attempt.loginId });
      } finally {
        await client.close();
      }
      attempt.status = "cancelled";
      attempt.error = null;
      return { attempt_id: attempt.attemptId, status: "cancelled" as const };
    });
    await this.closeAttemptListener(attempt);
    return result;
  }

  async issueToken(input: CompanyExecutorTokenIssueInput): Promise<CompanyExecutorTokenIssueResult> {
    this.assertOpenForWork();
    try {
      const custom = await readCustomApiCredential(this.workdir, input.executor_id);
      if (custom) {
        const credentialVersion = custom.credentialVersion;
        this.credentialVersions.set(input.executor_id, {
          fingerprint: custom.fingerprint,
          version: credentialVersion,
        });
        return {
          executor_id: input.executor_id,
          credential_version: credentialVersion,
          credential: {
            type: "custom_api_key",
            base_url: custom.baseUrl,
            api_key: custom.apiKey,
          },
        };
      }
      const verified = await this.verifyManagedAccount(input.executor_id, input.previous_credential_version);
      return issuedTokenResult(input.executor_id, verified);
    } catch (error) {
      const unavailable = companyExecutorCredentialFailure(error);
      if (unavailable) {
        this.connectedNotifications.delete(input.executor_id);
        await Promise.resolve(this.options.onUnavailable?.({
          executorId: input.executor_id,
          credentialVersion: input.previous_credential_version,
          ...unavailable,
        })).catch(() => undefined);
      }
      throw error;
    }
  }

  async configureCustom(
    input: CompanyExecutorCustomApiConfigureInput,
  ): Promise<CompanyExecutorCustomApiConfigureResult> {
    this.assertOpenForWork();
    if (this.proxyReconfiguring) {
      throw new CompanyExecutorServiceError(
        "company_proxy_reconfigure_in_progress",
        "Executor authorization is temporarily unavailable while the Company proxy changes.",
        { retryable: true },
      );
    }
    const baseUrl = normalizeCustomBaseUrl(input.base_url);
    if (!input.api_key.trim()) {
      throw new CompanyExecutorServiceError(
        "custom_api_key_invalid",
        "The custom API key must not be blank.",
      );
    }
    const endpointHost = new URL(baseUrl).host;
    if (endpointHost.length > 512) {
      throw new CompanyExecutorServiceError(
        "custom_api_base_url_invalid",
        "The custom API endpoint host is too long.",
      );
    }
    const path = companyExecutorCustomApiPath(this.workdir, input.executor_id);
    await ensureCompanyExecutorCodexHome(this.workdir, input.executor_id);
    const previous = await readFile(path, "utf8").catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    });
    const credentialVersion = Math.max(input.previous_credential_version + 1, Date.now());
    const document = JSON.stringify({
      schema_version: 1,
      type: "custom_api_key",
      base_url: baseUrl,
      api_key: input.api_key,
      credential_version: credentialVersion,
    });
    await writeCredentialAtomically(path, document);
    this.credentialVersions.delete(input.executor_id);
    const connected: CompanyExecutorConnected = {
      executorId: input.executor_id,
      credentialVersion,
      authorization: { method: "custom_api_key", endpointHost },
    };
    try {
      await this.options.onCredentialChanged?.({
        executorId: input.executor_id,
        previousCredentialVersion: input.previous_credential_version,
        credentialVersion,
      });
      await this.notifyConnected(
        connected,
        `${credentialVersion}\0custom_api_key\0${endpointHost}`,
      );
    } catch (error) {
      if (previous === null) {
        await unlink(path).catch(() => undefined);
      } else {
        await writeCredentialAtomically(path, previous);
      }
      this.credentialVersions.delete(input.executor_id);
      await this.options.onCredentialRollback?.({
        executorId: input.executor_id,
        previousCredentialVersion: input.previous_credential_version,
      });
      throw error;
    }
    return {
      executor_id: input.executor_id,
      credential_version: credentialVersion,
      endpoint_host: endpointHost,
    };
  }

  async modelCatalog(
    input: CompanyExecutorModelCatalogInput,
  ): Promise<CompanyExecutorModelCatalogResult> {
    this.assertOpenForWork();
    const socketPath = await this.ensureAppServer(input.executor_id);
    const client = this.openClient(socketPath);
    try {
      await initializeExternalAuthClient(client);
      const items: CompanyExecutorModelCatalogResult["items"] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const result: ModelListResponse = await client.request<ModelListResponse>("model/list", {
          cursor,
          limit: 100,
          includeHidden: false,
        });
        const data = Array.isArray(result.data) ? result.data : [];
        for (const candidate of data) {
          const projected = projectExecutorModel(candidate);
          if (projected && !seen.has(projected.model)) {
            seen.add(projected.model);
            items.push(projected);
          }
        }
        cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
      } while (cursor !== null);
      emitLifecycleEvent("codex.executor.model_catalog", {
        result: "succeeded",
        "fields.operation_id": input.executor_id,
        "fields.refreshed_count": items.length,
      });
      return { executor_id: input.executor_id, items };
    } catch (error) {
      emitLifecycleEvent("codex.executor.model_catalog", {
        result: "failed",
        code: "model_catalog_failed",
        retryable: true,
        "fields.operation_id": input.executor_id,
      });
      throw error;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async validateModels(
    input: CompanyExecutorModelValidationInput,
  ): Promise<CompanyExecutorModelValidationResult> {
    this.assertOpenForWork();
    const results: CompanyExecutorModelValidationResult["items"] = [];
    for (const model of input.models) {
      const validatedAt = this.options.nowMs?.() ?? Date.now();
      try {
        await this.validateModel(input.executor_id, model.model);
        results.push({ ...model, validation_status: "available", last_validated_at_ms: validatedAt });
        emitLifecycleEvent("codex.executor.model_validate", {
          result: "succeeded",
          "fields.operation_id": input.executor_id,
        });
      } catch {
        results.push({ ...model, validation_status: "unavailable", last_validated_at_ms: validatedAt });
        emitLifecycleEvent("codex.executor.model_validate", {
          result: "failed",
          code: "model_unavailable",
          retryable: false,
          "fields.operation_id": input.executor_id,
        });
      }
    }
    return { executor_id: input.executor_id, items: results };
  }

  private async validateModel(executorId: string, model: string): Promise<void> {
    const socketPath = await this.ensureAppServer(executorId);
    const client = this.openClient(socketPath);
    const probeRoot = join(companyExecutorRoot(this.workdir, executorId), "probe-workspace");
    await mkdir(probeRoot, { recursive: true, mode: 0o700 });
    try {
      await initializeExternalAuthClient(client);
      const thread = await client.request<ThreadStartResponse>("thread/start", {
        model,
        cwd: probeRoot,
        runtimeWorkspaceRoots: [probeRoot],
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        baseInstructions: "This is a connectivity probe. Reply with exactly OK and do not use tools.",
      }, { timeoutMs: 30_000 });
      const threadId = typeof thread.thread?.id === "string" ? thread.thread.id : null;
      if (!threadId) throw new CompanyExecutorServiceError("model_probe_thread_invalid", "Codex did not create a probe thread.");
      await client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "OK", text_elements: [] }],
        model,
        cwd: probeRoot,
        runtimeWorkspaceRoots: [probeRoot],
        approvalPolicy: "never",
      }, { timeoutMs: 30_000 });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const message = await client.readMessage(deadline);
        if (message === null) break;
        if (message.method === "turn/completed") return;
        if (message.method === "error") {
          throw new CompanyExecutorServiceError("model_probe_failed", "Codex reported a model validation error.");
        }
      }
      throw new CompanyExecutorServiceError("model_probe_timeout", "Codex model validation timed out.", { retryable: true });
    } finally {
      await client.close().catch(() => undefined);
      await rm(probeRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async cleanupCredential(input: { executor_id: string }): Promise<CompanyExecutorCredentialCleanupResult> {
    this.assertOpenForWork();
    const pendingAttempts = [...this.attempts.values()].filter(
      (attempt) => attempt.executorId === input.executor_id && attempt.status === "pending",
    );
    await Promise.all(pendingAttempts.map((attempt) => this.closeAttemptListener(attempt)));
    await stopCodexAppServerProcess(companyExecutorRoot(this.workdir, input.executor_id));
    await this.cleanupCanonicalCredential(input.executor_id);
    return { executor_id: input.executor_id, cleaned: true };
  }

  async restoreAll(): Promise<CompanyExecutorRestoreResult[]> {
    this.assertOpenForWork();
    const executorIds = await this.executorIdsOnDisk();
    return Promise.all(executorIds.map(async (executorId): Promise<CompanyExecutorRestoreResult> => {
      try {
        const custom = await readCustomApiCredential(this.workdir, executorId);
        if (custom) {
          const credentialVersion = custom.credentialVersion;
          this.credentialVersions.set(executorId, {
            fingerprint: custom.fingerprint,
            version: credentialVersion,
          });
          const connected: CompanyExecutorConnected = {
            executorId,
            credentialVersion,
            authorization: { method: "custom_api_key", endpointHost: custom.endpointHost },
          };
          await this.notifyConnected(
            connected,
            `${credentialVersion}\0custom_api_key\0${custom.endpointHost}`,
          );
          return { executorId, status: "connected", connected };
        }
        const verified = await this.verifyManagedAccount(executorId);
        return {
          executorId,
          status: "connected",
          connected: connectedSummary(executorId, verified),
        };
      } catch (error) {
        const unavailable = companyExecutorCredentialFailure(error) ?? {
          status: "failed" as const,
          code: "EXECUTOR_AUTH_FAILED",
        };
        this.connectedNotifications.delete(executorId);
        await Promise.resolve(this.options.onUnavailable?.({ executorId, ...unavailable })).catch(() => undefined);
        return {
          executorId,
          status: "unavailable",
          error: publicError(error),
        };
      }
    }));
  }

  hasPendingAuthorization(): boolean {
    return [...this.attempts.values()].some((attempt) => attempt.status === "pending");
  }

  beginProxyChange(): void {
    if (this.proxyReconfiguring) {
      throw new CompanyExecutorServiceError(
        "company_proxy_reconfigure_in_progress",
        "A Company proxy change is already in progress.",
        { retryable: true },
      );
    }
    if (this.hasPendingAuthorization()) {
      throw new CompanyExecutorServiceError(
        "company_proxy_authorization_in_progress",
        "Finish or cancel the active Codex authorization before changing the proxy.",
      );
    }
    this.proxyReconfiguring = true;
  }

  endProxyChange(): void {
    this.proxyReconfiguring = false;
  }

  async stopAllAppServersForProxyChange(): Promise<void> {
    if (this.hasPendingAuthorization()) {
      throw new CompanyExecutorServiceError(
        "company_proxy_authorization_in_progress",
        "Finish or cancel the active Codex authorization before changing the proxy.",
      );
    }
    await Promise.all((await this.executorIdsOnDisk()).map((executorId) =>
      stopCodexAppServerProcess(companyExecutorRoot(this.workdir, executorId)).catch(() => undefined),
    ));
    this.appServerFlights.clear();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([
      ...[...this.attempts.values()].map((attempt) => this.closeAttemptListener(attempt)),
      ...this.connectedNotificationFlights.values(),
      ...this.authStartFlights.values(),
      ...this.accountVerificationFlights.values(),
      ...this.accountRefreshFlights.values(),
      ...this.appServerFlights.values(),
    ]);
    await Promise.allSettled([...this.attempts.values()].map((attempt) => this.closeAttemptListener(attempt)));
    await Promise.allSettled([...this.listenerCloseFlights]);
  }

  private async listenForCompletion(attempt: AuthAttempt): Promise<void> {
    const client = attempt.listener;
    if (!client) return;
    try {
      while (!this.closed && attempt.status === "pending") {
        const message = await client.readMessage((this.options.nowMs?.() ?? Date.now()) + 30_000);
        if (message === null || message.method !== "account/login/completed") {
          continue;
        }
        const params = asRecord(message.params);
        if (params?.loginId !== attempt.loginId) {
          continue;
        }
        await this.withAttemptTransition(attempt, async () => {
          if (attempt.status !== "pending") return;
          if (params.success !== true) {
            attempt.status = "failed";
            attempt.error = { code: "codex_auth_failed", retryable: true };
            return;
          }
          await this.verifyManagedAccountAfterLogin(attempt.executorId);
          attempt.status = "completed";
          attempt.error = null;
        });
        break;
      }
    } catch (error) {
      if (attempt.status === "pending" && !this.closed) {
        attempt.status = "failed";
        attempt.error = publicError(error);
      }
    } finally {
      await this.closeAttemptListener(attempt);
    }
  }

  private verifyManagedAccount(executorId: string, previousVersion?: number): Promise<ManagedAccountVerification> {
    const key = JSON.stringify([executorId, previousVersion ?? null]);
    const current = this.accountVerificationFlights.get(key);
    if (current) return current;
    const flight = this.verifyManagedAccountOnce(executorId, previousVersion).finally(() => {
      if (this.accountVerificationFlights.get(key) === flight) {
        this.accountVerificationFlights.delete(key);
      }
    });
    this.accountVerificationFlights.set(key, flight);
    return flight;
  }

  private async verifyManagedAccountAfterLogin(executorId: string): Promise<ManagedAccountVerification> {
    const attempts = Math.max(1, this.options.credentialPropagationAttempts ?? 50);
    const intervalMs = Math.max(0, this.options.credentialPropagationIntervalMs ?? 100);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.verifyManagedAccount(executorId);
      } catch (error) {
        const credentialPending = error instanceof CompanyExecutorServiceError
          && error.code === "executor_auth_required";
        if (!credentialPending || attempt === attempts) throw error;
        await sleep(intervalMs);
      }
    }
    throw new CompanyExecutorServiceError(
      "executor_auth_required",
      "The Codex executor credential did not become available.",
      { retryable: true },
    );
  }

  private async verifyManagedAccountOnce(
    executorId: string,
    previousVersion?: number,
  ): Promise<ManagedAccountVerification> {
    const account = await this.refreshManagedAccount(executorId);
    if (account.account?.type !== "chatgpt") {
      throw new CompanyExecutorServiceError("executor_auth_required", "The Codex executor is not connected.", { retryable: true });
    }
    const canonical = await readCanonicalCredential(
      this.workdir,
      executorId,
      this.options.afterCanonicalCredentialOpen,
    );
    const credentialVersion = this.versionFor(
      executorId,
      canonical.fingerprint,
      canonical.mtimeMs,
      previousVersion,
    );
    const connected: CompanyExecutorConnected = {
      executorId,
      credentialVersion,
      authorization: {
        method: "chatgpt",
        accountId: canonical.chatgptAccountId,
        planType: String(account.account.planType),
      },
    };
    const planType = String(account.account.planType);
    const notificationKey = `${credentialVersion}\0${canonical.chatgptAccountId}\0${planType}`;
    const verified = {
      accessToken: canonical.accessToken,
      chatgptAccountId: canonical.chatgptAccountId,
      chatgptPlanType: planType,
      credentialVersion,
    };
    await this.notifyConnected(connected, notificationKey);
    return verified;
  }

  private refreshManagedAccount(executorId: string): Promise<GetAccountResponse> {
    const current = this.accountRefreshFlights.get(executorId);
    if (current) return current;
    const flight = this.readManagedAccount(executorId).finally(() => {
      if (this.accountRefreshFlights.get(executorId) === flight) {
        this.accountRefreshFlights.delete(executorId);
      }
    });
    this.accountRefreshFlights.set(executorId, flight);
    return flight;
  }

  private async readManagedAccount(executorId: string): Promise<GetAccountResponse> {
    const socketPath = await this.ensureAppServer(executorId);
    const client = this.openClient(socketPath);
    try {
      await initializeExternalAuthClient(client);
      return await client.request<GetAccountResponse>("account/read", { refreshToken: true });
    } finally {
      await client.close();
    }
  }

  private versionFor(
    executorId: string,
    fingerprint: string,
    mtimeMs: number,
    previousVersion?: number,
  ): number {
    const current = this.credentialVersions.get(executorId);
    if (current?.fingerprint === fingerprint) {
      return current.version;
    }
    const version = Math.max(1, Math.trunc(mtimeMs), (current?.version ?? 0) + 1, (previousVersion ?? 0) + 1);
    this.credentialVersions.set(executorId, { fingerprint, version });
    return version;
  }

  private async notifyConnected(
    connected: CompanyExecutorConnected,
    notificationKey: string,
  ): Promise<void> {
    while (!this.closed && this.connectedNotifications.get(connected.executorId) !== notificationKey) {
      const current = this.connectedNotificationFlights.get(connected.executorId);
      if (current) {
        await current;
        continue;
      }
      const flight = Promise.resolve().then(async () => {
        if (this.closed) return;
        try {
          await this.options.onConnected?.(connected);
          this.connectedNotifications.set(connected.executorId, notificationKey);
        } catch (error) {
          if (requiresCanonicalCredentialCleanup(error)) {
            await this.cleanupCanonicalCredential(connected.executorId);
          }
          throw error;
        }
      }).finally(() => {
        if (this.connectedNotificationFlights.get(connected.executorId) === flight) {
          this.connectedNotificationFlights.delete(connected.executorId);
        }
      });
      this.connectedNotificationFlights.set(connected.executorId, flight);
      await flight;
    }
  }

  private async executorIdsOnDisk(): Promise<string[]> {
    const root = join(this.workdir, COMPANY_EXECUTORS_DIR);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }

  private async cleanupCanonicalCredential(executorId: string): Promise<void> {
    for (const path of [
      companyExecutorAuthPath(this.workdir, executorId),
      companyExecutorCustomApiPath(this.workdir, executorId),
    ]) {
      try {
        const current = await lstat(path);
        if (!current.isFile() || current.isSymbolicLink()) {
          throw new CompanyExecutorServiceError(
            "canonical_credential_invalid",
            "The rejected canonical Codex credential is not a regular file.",
          );
        }
        await unlink(path);
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      }
    }
    this.credentialVersions.delete(executorId);
    this.connectedNotifications.delete(executorId);
  }

  private ensureAppServer(executorId: string): Promise<string> {
    this.assertOpenForWork();
    const current = this.appServerFlights.get(executorId);
    if (current) return current;
    const flight = (this.options.ensureAppServer
      ? this.options.ensureAppServer(executorId)
      : this.ensureDefaultAppServer(executorId)
    ).finally(() => {
      if (this.appServerFlights.get(executorId) === flight) {
        this.appServerFlights.delete(executorId);
      }
    });
    this.appServerFlights.set(executorId, flight);
    return flight;
  }

  private assertOpenForWork(): void {
    if (this.closed) {
      throw new CompanyExecutorServiceError("company_executor_closing", "Company Executor service is shutting down.");
    }
  }

  private async ensureDefaultAppServer(executorId: string): Promise<string> {
    const root = companyExecutorRoot(this.workdir, executorId);
    const home = await ensureCompanyExecutorCodexHome(this.workdir, executorId);
    const status = await codexAppServerStatus(root);
    if (
      status.pid.alive
      && status.socket.present
      && await (this.options.appServerSocketReady ?? codexAppServerSocketReady)(
        status.socket.path,
      )
    ) {
      return status.socket.path;
    }
    return (await (this.options.startAppServer ?? startCodexAppServerProcess)(root, {
      codexHomePath: home,
      secretEnv: this.options.proxyEnv?.(),
    })).socketPath;
  }

  private openClient(socketPath: string): CompanyExecutorClient {
    if (this.options.clientFactory) return this.options.clientFactory(socketPath);
    return defaultCompanyExecutorClient(socketPath);
  }

  private requireAttempt(executorId: string, attemptId: string): AuthAttempt {
    const attempt = this.attempts.get(attemptKey(executorId, attemptId));
    if (!attempt) {
      throw new CompanyExecutorServiceError("auth_attempt_not_found", "The Codex authentication attempt was not found.");
    }
    return attempt;
  }

  private withAttemptTransition<TResult>(attempt: AuthAttempt, action: () => Promise<TResult>): Promise<TResult> {
    const result = attempt.transition.then(action);
    attempt.transition = result.then(() => undefined, () => undefined);
    return result;
  }

  private closeAttemptListener(attempt: AuthAttempt): Promise<void> {
    const listener = attempt.listener;
    attempt.listener = null;
    if (!listener) return Promise.resolve();
    const closeFlight = listener.close().catch(() => undefined).finally(() => {
      this.listenerCloseFlights.delete(closeFlight);
    });
    this.listenerCloseFlights.add(closeFlight);
    return closeFlight;
  }
}

/** In-process credential authority for both ChatGPT and custom API Executors. */
export { CompanyExecutorService as ExecutorAuthWorker };

function defaultCompanyExecutorClient(socketPath: string): CompanyExecutorClient {
  const client = CodexAppServerClient.fromUnixSocket(socketPath);
  return {
    request: (method, params, options) => client.request(
      method as Parameters<CodexAppServerClient["request"]>[0],
      params as Parameters<CodexAppServerClient["request"]>[1],
      options,
    ),
    notify: (notification) => client.notify(notification),
    readMessage: (deadlineMs) => client.readMessage(deadlineMs),
    close: () => client.close(),
  };
}

function issuedTokenResult(
  executorId: string,
  verified: ManagedAccountVerification,
): CompanyExecutorTokenIssueResult {
  return {
    executor_id: executorId,
    credential_version: verified.credentialVersion,
    credential: {
      type: "chatgpt_auth_tokens",
      access_token: verified.accessToken,
      account_id: verified.chatgptAccountId,
      plan_type: verified.chatgptPlanType,
    },
  };
}

function connectedSummary(
  executorId: string,
  verified: ManagedAccountVerification,
): CompanyExecutorConnected {
  return {
    executorId,
    credentialVersion: verified.credentialVersion,
    authorization: {
      method: "chatgpt",
      accountId: verified.chatgptAccountId,
      planType: verified.chatgptPlanType,
    },
  };
}

async function readCustomApiCredential(
  workdir: string,
  executorId: string,
): Promise<ManagedCustomApiCredential | null> {
  const path = companyExecutorCustomApiPath(workdir, executorId);
  let text: string;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new CompanyExecutorServiceError(
        "canonical_credential_invalid",
        "The custom API credential must be one uniquely linked regular file.",
      );
    }
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  let raw: Record<string, unknown> | null;
  try {
    raw = asRecord(JSON.parse(text));
  } catch {
    raw = null;
  }
  if (
    raw?.schema_version !== 1 ||
    raw.type !== "custom_api_key" ||
    typeof raw.base_url !== "string" ||
    typeof raw.api_key !== "string" ||
    typeof raw.credential_version !== "number"
  ) {
    throw new CompanyExecutorServiceError(
      "canonical_credential_invalid",
      "The custom API credential is invalid.",
    );
  }
  const baseUrl = normalizeCustomBaseUrl(raw.base_url);
  if (!raw.api_key.trim()) {
    throw new CompanyExecutorServiceError(
      "canonical_credential_invalid",
      "The custom API key is empty.",
    );
  }
  return {
    baseUrl,
    apiKey: raw.api_key,
    endpointHost: new URL(baseUrl).host,
    credentialVersion: Math.max(1, Math.trunc(raw.credential_version)),
    fingerprint: createHash("sha256").update(text).digest("hex"),
  };
}

function normalizeCustomBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new CompanyExecutorServiceError(
      "custom_api_base_url_invalid",
      "The custom API base URL must be HTTPS and must not contain credentials.",
    );
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

async function writeCredentialAtomically(path: string, text: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, text, { mode: 0o600, flag: "wx" });
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function requiresCanonicalCredentialCleanup(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { cleanupCanonicalCredential?: unknown }).cleanupCanonicalCredential === true;
}

async function readCanonicalCredential(
  workdir: string,
  executorId: string,
  afterOpen?: (path: string) => Promise<void>,
): Promise<{
  accessToken: string;
  chatgptAccountId: string;
  fingerprint: string;
  mtimeMs: number;
}> {
  const path = companyExecutorAuthPath(workdir, executorId);
  let handle: FileHandle | null = null;
  let text: string;
  let mtimeMs: number;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    await afterOpen?.(path);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1) {
      throw new CompanyExecutorServiceError(
        "canonical_credential_invalid",
        "The canonical Codex credential must be one uniquely linked regular file.",
      );
    }
    await handle.chmod(0o600);
    text = await handle.readFile("utf8");
    const read = await handle.stat();
    const currentPath = await lstat(path).catch(() => null);
    if (
      !read.isFile() || read.nlink !== 1 ||
      read.dev !== opened.dev || read.ino !== opened.ino ||
      currentPath === null || !currentPath.isFile() || currentPath.nlink !== 1 ||
      currentPath.dev !== opened.dev || currentPath.ino !== opened.ino
    ) {
      throw new CompanyExecutorServiceError(
        "canonical_credential_invalid",
        "The canonical Codex credential changed during the secured read.",
      );
    }
    mtimeMs = read.mtimeMs;
  } catch (error) {
    if (error instanceof CompanyExecutorServiceError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new CompanyExecutorServiceError("executor_auth_required", "The canonical Codex credential is missing.", { retryable: true });
    }
    if (isNodeError(error) && error.code === "ELOOP") {
      throw new CompanyExecutorServiceError(
        "canonical_credential_invalid",
        "The canonical Codex credential must not be a symbolic link.",
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
  let raw: Record<string, unknown> | null;
  try {
    raw = asRecord(JSON.parse(text));
  } catch {
    throw new CompanyExecutorServiceError("canonical_credential_invalid", "The canonical Codex credential is invalid.");
  }
  const tokens = asRecord(raw?.tokens) ?? asRecord(raw?.OPENAI_AUTH) ?? raw;
  const accessToken = stringValue(tokens?.access_token) ?? stringValue(tokens?.accessToken);
  const chatgptAccountId = stringValue(tokens?.account_id) ??
    stringValue(tokens?.chatgpt_account_id) ??
    stringValue(raw?.account_id) ??
    stringValue(raw?.chatgpt_account_id) ??
    accountIdFromJwt(accessToken);
  if (!accessToken || !chatgptAccountId) {
    throw new CompanyExecutorServiceError("canonical_credential_invalid", "The canonical Codex credential is incomplete.");
  }
  return {
    accessToken,
    chatgptAccountId,
    fingerprint: createHash("sha256").update(text).digest("hex"),
    mtimeMs,
  };
}

function accountIdFromJwt(accessToken: string | null): string | null {
  if (!accessToken) return null;
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const auth = asRecord(claims?.["https://api.openai.com/auth"]);
    return stringValue(auth?.chatgpt_account_id) ?? stringValue(claims?.chatgpt_account_id);
  } catch {
    return null;
  }
}

function startResult(attempt: AuthAttempt): CompanyExecutorAuthStartResult {
  return {
    attempt_id: attempt.attemptId,
    login_id: attempt.loginId,
    verification_url: attempt.verificationUrl,
    user_code: attempt.userCode,
  };
}

function statusResult(attempt: AuthAttempt): CompanyExecutorAuthStatusResult {
  const includeDeviceCode = attempt.status === "pending";
  return {
    attempt_id: attempt.attemptId,
    status: attempt.status,
    login_id: includeDeviceCode ? attempt.loginId : null,
    verification_url: includeDeviceCode ? attempt.verificationUrl : null,
    user_code: includeDeviceCode ? attempt.userCode : null,
    error: attempt.error,
  };
}

function publicError(error: unknown): PublicOperationError {
  if (error instanceof CompanyExecutorServiceError) {
    return { code: error.code, retryable: error.retryable };
  }
  return { code: "codex_auth_failed", retryable: true };
}

function attemptKey(executorId: string, attemptId: string): string {
  return `${executorId}\0${attemptId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function projectExecutorModel(value: unknown): CompanyExecutorModelCatalogResult["items"][number] | null {
  const model = asRecord(value);
  const modelId = stringValue(model?.model) ?? stringValue(model?.id);
  if (!modelId) return null;
  const effortItems = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [];
  const efforts = effortItems.flatMap((candidate) => {
    const item = asRecord(candidate);
    const effort = stringValue(item?.reasoningEffort) ?? stringValue(candidate);
    return effort ? [effort] : [];
  });
  return {
    model: modelId,
    display_name: stringValue(model?.displayName) ?? modelId,
    source: "catalog",
    supported_reasoning_efforts: [...new Set(efforts)],
    validation_status: "unvalidated",
    last_validated_at_ms: null,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function companyExecutorCredentialFailure(error: unknown): {
  status: "expired" | "failed";
  code: string;
} | null {
  if (!(error instanceof CompanyExecutorServiceError)) return null;
  if (error.code === "executor_auth_required") {
    return { status: "expired", code: "EXECUTOR_AUTH_REQUIRED" };
  }
  if (error.code === "canonical_credential_invalid") {
    return { status: "failed", code: "EXECUTOR_AUTH_FAILED" };
  }
  return null;
}
