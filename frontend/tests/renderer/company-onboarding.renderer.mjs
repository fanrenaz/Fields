import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const rendererSmokeRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(dirname(rendererSmokeRoot));
const exportedRendererRoot = join(desktopRoot, "artifacts/renderer");
const viewports = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

async function main() {
  await assertCurrentRendererExport();
  const backend = createRendererBackend(exportedRendererRoot);
  const origin = await backend.listen();
  let chrome;

  try {
    chrome = await launchChrome();
    for (const viewport of viewports) {
      await runOwnerOnboardingScenario(chrome, origin, backend, viewport);
      await runRegistrationScenario(chrome, origin, backend, viewport);
    }

    console.log(JSON.stringify({
      status: "passed",
      artifact: "artifacts/renderer",
      viewports: viewports.map(({ width, height }) => `${width}x${height}`),
      scenarios: [
        "bootstrapped-owner-with-skippable-personal-executor-onboarding",
        "invite-only-registration-auto-joins-default-company",
        "personal-multi-account-sharing-governance",
        "member-executor-assignment",
        "terminals-bind-online-unbind",
      ],
    }));
  } finally {
    await settleCleanup(chrome?.close(), backend.close());
  }
}

async function runOwnerOnboardingScenario(chrome, origin, backend, viewport) {
  backend.reset({
    authenticated: true,
    membership: true,
    companyRole: "owner",
    companyStatus: "provisioning",
    onboardingStage: "creatingRuntime",
    personalExecutors: [],
    memberExecutorId: null,
    memberSessionState: "unconfigured",
    memberExecutorVersion: 0,
  });
  const cdp = await chrome.page();
  try {
    await preparePage(cdp, `${origin}/`, viewport);
    await forceEnglish(cdp);
    await waitForLoadingWithoutShell(cdp);
    assert.equal(backend.state.onboardingStage, "creatingRuntime");
    assert.equal(backend.countTrpc("company.create"), 0);
    assert.equal(backend.state.personalExecutors.length, 0, "bootstrap does not provision a Personal Executor");
    assert.equal(backend.state.memberExecutorId, null, "bootstrap leaves the Human Member Executor unconfigured");
    assert.equal(backend.state.memberSessionState, "unconfigured");
    assertNoPreActiveDataPlane(backend);

    backend.setOnboardingStage("initializingRuntime");
    await waitForLoadingWithoutShell(cdp, 3_000);
    assertNoPreActiveDataPlane(backend);

    backend.markActivationBoundary();
    backend.setOnboardingStage("ready");
    await waitForText(cdp, "Home is temporarily unavailable", 5_000);
    await clickText(cdp, "Set up a personal Executor");
    await waitForText(cdp, "Create Executor");
    await clickText(cdp, "Codex");
    await clickText(cdp, "Device code");
    await clickText(cdp, "Continue");
    await clickText(cdp, "Start authorization");
    await waitForText(cdp, "ABCD-EFGH");
    backend.completePersonalAuthorization();
    await waitForText(cdp, "Search models", 3_000);
    await clickText(cdp, "Validate selected models");
    await waitForText(cdp, "Available", 3_000);
    await clickText(cdp, "Continue");
    await clickText(cdp, "Add to shared pool");
    await clickText(cdp, "Continue");
    await clickText(cdp, "Finish creating Executor");
    await waitForText(cdp, "Executor created", 3_000);
    await clickText(cdp, "Continue");
    await waitFor(() => backend.countTrpc("account.executors.share") === 1, 3_000);
    assert.equal(backend.countTrpc("member.executor.set"), 1, "onboarding assigns the Human Member Executor");
    backend.prepareExistingWorkspaceFixtures();
    await reloadPage(cdp);
    await waitForSelector(cdp, '[aria-label="Open account menu"]', 5_000);
    await waitForSelector(cdp, '[aria-label="Composer"]', 5_000);
    await clickSelector(cdp, '[aria-label="Expand side panel"]');
    await waitForTrpc(backend, (procedure) => procedure === "home.thread.list", 3_000);
    assert.equal(backend.state.companyStatus, "active");
    assertNoPreActiveDataPlane(backend);
    assert.ok(
      backend.trpcProceduresAfterActivation().some((procedure) => procedure.startsWith("home.")),
      "Home data-plane starts only after Company activation",
    );
    await clickSelector(cdp, '[aria-label="Change Executor"]');
    await waitForText(cdp, "Work Codex", 3_000);
    await clickText(cdp, "Owner Smoke · Research Codex");
    await waitFor(() => backend.countTrpc("member.executor.set") === 2, 3_000);
    await clickSelector(cdp, '[aria-label="Change Executor"]');
    await waitForText(cdp, "Switching", 3_000);
    await waitForText(cdp, "Research Codex", 3_000);
    assert.equal(backend.countTrpc("member.executor.set"), 2, "Member Executor assignment is changed through both onboarding and the real UI control");

    await clickSelector(cdp, '[aria-label="Open account menu"]');
    await waitForText(cdp, "Account settings");
    await clickText(cdp, "Account settings");
    await waitForText(cdp, "Settings");
    await clickText(cdp, "繁體中文");
    await waitForText(cdp, "設定");
    assert.equal(await hasSelector(cdp, '[aria-label="關閉帳戶設定"]'), true, "Account language changes immediately");
    assert.equal(await evaluate(cdp, "document.documentElement.lang"), "zh-TW", "Web language metadata changes immediately");
    await clickSelector(cdp, '[aria-label="關閉帳戶設定"]');
    await waitForSelector(cdp, '[aria-label="搜尋"]');
    await clickSelector(cdp, '[aria-label="搜尋"]');
    assert.equal(await hasSelector(cdp, '[placeholder="搜尋工作區"]'), true, "Search placeholder changes immediately");
    await clickSelector(cdp, '[aria-label="關閉搜尋"]');
    await clickSelector(cdp, '[aria-label="開啟帳戶選單"]');
    await waitForText(cdp, "帳戶設定");
    await clickText(cdp, "帳戶設定");
    await waitForText(cdp, "設定");
    await clickText(cdp, "English");
    await waitForText(cdp, "Settings");
    const executorListCountBeforeSettings = backend.countTrpc("account.executors.list");
    await clickText(cdp, "Executors");
    await waitForText(cdp, "Work Codex", 3_000);
    await waitForText(cdp, "Research Codex", 3_000);
    await waitForText(cdp, "Teammate · Shared Codex", 3_000);
    assert.equal(
      backend.countTrpc("account.executors.list"),
      executorListCountBeforeSettings + 1,
      "opening Executor Settings performs its own Personal Executor query",
    );
    assert.equal(backend.countTrpc("account.executors.usage"), 2);
    assert.equal(backend.countTrpc("company.executors.sharedPool"), 1);

    await clickText(cdp, "Share");
    await waitForTrpc(backend, (procedure) => procedure === "account.executors.share", 3_000);
    await waitForText(cdp, "Unshare", 3_000);
    assert.equal(backend.countTrpc("account.executors.share"), 2, "Personal Executor sharing is exercised through onboarding and Settings");

    await clickText(cdp, "Block sharing");
    await waitForTrpc(backend, (procedure) => procedure === "company.executors.blockSharing", 3_000);
    await waitForText(cdp, "Unblock sharing", 3_000);
    assert.equal(backend.countTrpc("company.executors.blockSharing"), 1, "Owner shared-pool governance is exercised through Settings");

    await clickText(cdp, "Terminals");
    await waitForText(cdp, "No terminals", 3_000);
    await fill(cdp, "#terminal-pairing-code", "a1b2c3", "A1B2C3");
    await fill(cdp, "#terminal-label", "Smoke StickS3");
    await waitFor(cdp, "!document.querySelector('#terminal-bind').disabled");
    await clickSelector(cdp, "#terminal-bind");
    await waitForText(cdp, "Terminal bound.", 3_000);
    await waitForText(cdp, "Online", 3_000);
    assert.equal(backend.countTerminal("/api/v1/embodiment/terminals/pairing/claim"), 1);

    await clickSelector(cdp, "#terminal-unbind-terminal-browser-smoke");
    await waitForText(cdp, "Unbind terminal?", 3_000);
    await clickSelector(cdp, "#terminal-unbind-confirm");
    await waitForText(cdp, "No terminals", 3_000);
    assert.equal(backend.countTerminal("/api/v1/embodiment/terminals/terminal-browser-smoke/revoke"), 1);

    const metrics = await evaluate(cdp, "({ width: innerWidth, height: innerHeight })");
    assert.deepEqual(metrics, viewport);
  } finally {
    await cdp.close();
  }
}

async function runRegistrationScenario(chrome, origin, backend, viewport) {
  backend.reset({ companyStatus: "active", onboardingStage: "ready" });
  const cdp = await chrome.page();
  try {
    await preparePage(cdp, `${origin}/?registration=registration-browser-smoke`, viewport);
    await forceEnglish(cdp);
    await waitForText(cdp, "Sign up");
    assert.equal(await evaluate(cdp, "location.search"), "", "registration code is removed from browser history");
    assert.equal(await hasSelector(cdp, "#signup-registration-code"), true, "invite-only signup renders its code field");
    await fill(cdp, "#signup-name", "Member Smoke");
    await fill(cdp, "#signup-email", "member@example.test");
    await fill(cdp, "#signup-password", "smoke-password");
    await fill(cdp, "#signup-confirm-password", "smoke-password");
    await clickText(cdp, "Sign up");
    await waitForSelector(cdp, '[aria-label="Open account menu"]', 5_000);

    assert.equal(backend.countTrpc("registration.prepare"), 1);
    assert.equal(backend.countAuth("/api/auth/sign-up/email"), 1);
    assert.equal(backend.countTrpc("registration.claim"), 1);
    assert.equal(backend.state.companyRole, "member");
    assert.equal(backend.state.companyStatus, "active");

    const metrics = await evaluate(cdp, "({ width: innerWidth, height: innerHeight })");
    assert.deepEqual(metrics, viewport);
  } finally {
    await cdp.close();
  }
}

function createRendererBackend(staticRoot) {
  const state = initialState();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuthRequest(state, request, response, url);
    }
    if (url.pathname.startsWith("/api/v1/embodiment/terminals")) {
      return handleTerminalRequest(state, request, response, url);
    }
    if (url.pathname.startsWith("/api/v1/trpc/")) {
      return handleTrpcRequest(state, request, response, url);
    }
    return serveExportedRenderer(staticRoot, url, response);
  });
  server.on("upgrade", (request, socket) => {
    state.requests.push({ kind: "websocket", path: request.url ?? "" });
    socket.destroy();
  });

  return {
    state,
    reset(overrides = {}) {
      Object.assign(state, initialState(), overrides);
    },
    setOnboardingStage(stage) {
      state.onboardingStage = stage;
      state.companyStatus = stage === "ready" ? "active" : stage === "failed" ? "setup_failed" : "provisioning";
    },
    markActivationBoundary() {
      state.activationBoundary = state.requests.length;
    },
    completePersonalAuthorization() {
      state.authorizationCompleted = true;
    },
    prepareExistingWorkspaceFixtures() {
      const work = state.personalExecutors.find((executor) => executor.executor_id === "executor-personal-onboarding");
      if (work) {
        work.executor_id = "executor-personal-work";
        work.sharing_status = "private";
      }
      state.memberExecutorId = "executor-personal-work";
      state.memberSessionState = "ready";
      state.personalExecutors.push(personalExecutorFixture({
        executorId: "executor-personal-research",
        name: "Research Codex",
        accountId: "acct-personal-research",
        sharingStatus: "company_shared",
      }));
    },
    countAuth(path) {
      return state.requests.filter((entry) => entry.kind === "auth" && entry.path === path).length;
    },
    countTrpc(procedure) {
      return state.requests.filter((entry) => entry.kind === "trpc" && entry.procedure === procedure).length;
    },
    countTerminal(path) {
      return state.requests.filter((entry) => entry.kind === "terminal" && entry.path === path).length;
    },
    uniqueAttemptIds() {
      return new Set(state.issuedAttemptIds);
    },
    trpcProceduresBeforeActivation() {
      const boundary = state.activationBoundary ?? state.requests.length;
      return state.requests.slice(0, boundary).filter((entry) => entry.kind === "trpc").map((entry) => entry.procedure);
    },
    trpcProceduresAfterActivation() {
      const boundary = state.activationBoundary ?? state.requests.length;
      return state.requests.slice(boundary).filter((entry) => entry.kind === "trpc").map((entry) => entry.procedure);
    },
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    })),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function initialState() {
  return {
    authenticated: false,
    membership: false,
    companyRole: null,
    companyStatus: null,
    onboardingStage: null,
    attemptId: "attempt-browser-smoke-0001",
    issuedAttemptIds: [],
    personalExecutors: personalExecutorFixtures(),
    sharedPool: [sharedPoolExecutorFixture("company_shared")],
    memberExecutorId: "executor-personal-work",
    memberSessionState: "ready",
    memberExecutorVersion: 1,
    authorizationCompleted: false,
    terminals: [],
    requests: [],
    activationBoundary: null,
  };
}

async function handleAuthRequest(state, request, response, url) {
  const body = await readJson(request);
  state.requests.push({ kind: "auth", method: request.method, path: url.pathname, body });

  if (url.pathname === "/api/auth/get-session") {
    return json(response, state.authenticated ? authSessionFixture() : null);
  }
  if (url.pathname === "/api/auth/sign-up/email" || url.pathname === "/api/auth/sign-in/email") {
    state.authenticated = true;
    return json(response, { token: "browser-smoke-session", user: authSessionFixture().user });
  }
  if (url.pathname === "/api/auth/sign-out") {
    state.authenticated = false;
    return json(response, { success: true });
  }
  if (url.pathname === "/api/auth/organization/accept-invitation") {
    state.membership = true;
    state.companyRole = "member";
    state.companyStatus = "provisioning";
    state.onboardingStage = "creatingRuntime";
    return json(response, { invitation: { id: body.invitationId ?? "invitation-browser-smoke" } });
  }
  return json(response, { message: `Unhandled auth smoke endpoint: ${url.pathname}` }, 404);
}

async function handleTerminalRequest(state, request, response, url) {
  const body = await readJson(request);
  state.requests.push({ kind: "terminal", method: request.method, path: url.pathname, body });
  if (request.method === "GET" && url.pathname === "/api/v1/embodiment/terminals") {
    return json(response, { items: state.terminals });
  }
  if (request.method === "POST" && url.pathname === "/api/v1/embodiment/terminals/pairing/claim") {
    const terminal = {
      terminal_id: "terminal-browser-smoke",
      label: typeof body.label === "string" && body.label.length > 0 ? body.label : "StickS3 Call",
      status: "active",
      paired_at_ms: 1_700_000_000_000,
      connection_status: "online",
    };
    state.terminals = [terminal];
    return json(response, { terminal: { terminal_id: terminal.terminal_id, label: terminal.label, status: terminal.status, paired_at_ms: terminal.paired_at_ms } });
  }
  if (request.method === "POST" && url.pathname === "/api/v1/embodiment/terminals/terminal-browser-smoke/revoke") {
    if (declaresJsonWithoutBody(request)) return json(response, { code: "FST_ERR_CTP_EMPTY_JSON_BODY" }, 400);
    state.terminals = [];
    return json(response, { terminal_id: "terminal-browser-smoke" });
  }
  return json(response, { code: "EMBODIMENT_TERMINAL_NOT_FOUND", message: "Terminal not found.", retryable: false }, 404);
}

function declaresJsonWithoutBody(request) {
  const contentType = request.headers["content-type"];
  const contentLength = request.headers["content-length"];
  return typeof contentType === "string" && contentType.toLowerCase().includes("application/json")
    && (contentLength === undefined || contentLength === "0");
}

async function handleTrpcRequest(state, request, response, url) {
  const body = await readJson(request);
  const procedures = decodeURIComponent(url.pathname.slice("/api/v1/trpc/".length)).split(",");
  const results = procedures.map((procedure, index) => {
    const input = trpcInput(url, body, index);
    state.requests.push({ kind: "trpc", method: request.method, procedure, input });
    return { result: { data: trpcFixture(state, procedure, input) } };
  });
  return json(response, results);
}

function trpcFixture(state, procedure, input) {
  switch (procedure) {
    case "session.me":
      return sessionFixture(state);
    case "registration.prepare":
      return { signup_credential: "signup-credential-browser-smoke", expires_at_ms: 1_700_000_900_000 };
    case "registration.claim":
      state.membership = true;
      state.companyRole = "member";
      state.companyStatus = "active";
      state.onboardingStage = "ready";
      return { company_id: "company-browser-smoke", status: "joined" };
    case "company.onboarding.status":
      return onboardingFixture(state);
    case "company.onboarding.retry":
      state.onboardingStage = "creatingRuntime";
      state.companyStatus = "provisioning";
      return onboardingFixture(state);
    case "company.executors.sharedPool":
      return { items: state.sharedPool };
    case "company.executors.blockSharing": {
      const current = state.sharedPool.find((executor) => executor.executor_id === input.executor_id);
      if (!current) throw new Error(`Unknown shared Executor: ${input.executor_id}`);
      const next = { ...current, sharing_status: "admin_blocked" };
      state.sharedPool = state.sharedPool.map((executor) => executor.executor_id === next.executor_id ? next : executor);
      const { sharing_status, ...executor } = next;
      return { executor, sharing_status };
    }
    case "company.executors.unblockSharing": {
      const current = state.sharedPool.find((executor) => executor.executor_id === input.executor_id);
      if (!current) throw new Error(`Unknown shared Executor: ${input.executor_id}`);
      state.sharedPool = state.sharedPool.filter((executor) => executor.executor_id !== current.executor_id);
      const { sharing_status: _sharingStatus, ...executor } = current;
      return { executor, sharing_status: "private" };
    }
    case "account.executors.list":
      return { items: state.personalExecutors };
    case "account.executors.create": {
      const executor = personalExecutorFixture({
        executorId: "executor-personal-onboarding",
        name: input.name,
        accountId: null,
        sharingStatus: "private",
      });
      executor.availability = "pending_auth";
      executor.authorization = { method: "chatgpt", account_id: null, plan_type: null };
      executor.model_policy = modelPolicyFixture("pending");
      executor.credential_version = 0;
      executor.connected_at_ms = null;
      state.personalExecutors.push(executor);
      return { executor };
    }
    case "account.executors.authorization.start":
      state.authorizationCompleted = false;
      return { ...deviceCodeFixture(state), executor_id: input.executor_id };
    case "account.executors.authorization.status": {
      const executor = state.personalExecutors.find((candidate) => candidate.executor_id === input.executor_id);
      if (state.authorizationCompleted && executor) {
        executor.availability = "configuration_required";
        executor.authorization = { method: "chatgpt", account_id: "acct-personal-onboarding", plan_type: "plus" };
        executor.credential_version = 1;
        executor.connected_at_ms = 1_700_000_000_000;
      }
      return {
        executor_id: input.executor_id,
        attempt_id: input.attempt_id,
        status: state.authorizationCompleted ? "completed" : "pending",
        error_code: null,
        retryable: true,
      };
    }
    case "account.executors.models.catalog":
      return {
        executor_id: input.executor_id,
        items: [modelFixture("unvalidated")],
        catalog_state: "live",
        checked_at_ms: 1_700_000_000_000,
      };
    case "account.executors.models.validate":
      return {
        executor_id: input.executor_id,
        items: input.models.map((model) => ({ ...model, validation_status: "available", last_validated_at_ms: 1_700_000_000_000 })),
      };
    case "account.executors.models.configure": {
      const executor = state.personalExecutors.find((candidate) => candidate.executor_id === input.executor_id);
      if (!executor) throw new Error(`Unknown Personal Executor: ${input.executor_id}`);
      executor.availability = "available";
      executor.model_policy = {
        revision: input.expected_revision + 1,
        status: "ready",
        models: input.models,
        allowed_reasoning_efforts: input.allowed_reasoning_efforts,
        default_model: input.default_model,
        default_reasoning_effort: input.default_reasoning_effort,
        catalog_checked_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      };
      return { executor_id: input.executor_id, policy: executor.model_policy };
    }
    case "account.executors.rename": {
      const executor = state.personalExecutors.find((candidate) => candidate.executor_id === input.executor_id);
      if (!executor) throw new Error(`Unknown Personal Executor: ${input.executor_id}`);
      executor.name = input.name;
      return { executor };
    }
    case "account.executors.usage":
      return {
        executor_id: input.executor_id,
        items: input.executor_id === "executor-personal-work"
          ? [{ type: "member", member_id: "actor-browser-smoke-owner", member_name: "Owner Smoke", member_type: "human" }]
          : [],
      };
    case "account.executors.share": {
      const current = state.personalExecutors.find((executor) => executor.executor_id === input.executor_id);
      if (!current) throw new Error(`Unknown Personal Executor: ${input.executor_id}`);
      const next = { ...current, sharing_status: "company_shared" };
      state.personalExecutors = state.personalExecutors.map((executor) => executor.executor_id === next.executor_id ? next : executor);
      return { executor: next };
    }
    case "member.executor.current":
      return memberAssignmentFixture(state);
    case "member.executor.options":
      return {
        member_id: "actor-browser-smoke-owner",
        items: state.personalExecutors.map(safeExecutorFixture),
      };
    case "member.executor.set":
      state.memberExecutorId = input.executor_id;
      state.memberSessionState = "switching";
      state.memberExecutorVersion += 1;
      return memberAssignmentFixture(state);
    case "home.thread.list":
      return { items: [], page: { next_cursor: null, backwards_cursor: null } };
    case "home.filesystem.list":
      return {
        parent: { id: ".", path: ".", name: ".", is_folder: true, size_bytes: null, modified_at_ms: null },
        children: [],
      };
    case "room.list":
      return { items: [], page: { next_cursor: null } };
    case "company.actors.list":
      return { items: [] };
    default:
      throw new Error(`Unhandled tRPC browser smoke procedure: ${procedure} (${JSON.stringify(input)})`);
  }
}

function sessionFixture(state) {
  if (!state.membership) {
    return {
      has_company: false,
      registration_pending: false,
      user_id: "user-browser-smoke-owner",
      actor_id: null,
      company_id: null,
      display_name: "Owner Smoke",
      actor_type: "human",
      company_role: null,
      company_status: null,
    };
  }
  return {
    has_company: true,
    registration_pending: false,
    user_id: "user-browser-smoke-owner",
    actor_id: "actor-browser-smoke-owner",
    company_id: "company-browser-smoke",
    display_name: "Owner Smoke",
    actor_type: "human",
    company_role: state.companyRole,
    company_status: state.companyStatus,
  };
}

function onboardingFixture(state) {
  return {
    stage: state.onboardingStage,
    company: companyFixture(state),
    runtime: runtimeFixture(state),
  };
}

function companyFixture(state) {
  return {
    company_id: "company-browser-smoke",
    name: "Fields Browser Smoke",
    status: state.companyStatus,
  };
}

function runtimeFixture(state) {
  const status = {
    creatingRuntime: "provisioning",
    initializingRuntime: "initializing",
    failed: "failed",
    ready: "ready",
  }[state.onboardingStage] ?? "pending";
  return {
    status,
    error: state.onboardingStage === "failed" ? { code: "COMPANY_RUNTIME_UNAVAILABLE", retryable: true } : null,
  };
}

function personalExecutorFixtures() {
  return [
    personalExecutorFixture({
      executorId: "executor-personal-work",
      name: "Work Codex",
      accountId: "acct-personal-work",
      sharingStatus: "private",
    }),
    personalExecutorFixture({
      executorId: "executor-personal-research",
      name: "Research Codex",
      accountId: "acct-personal-research",
      sharingStatus: "company_shared",
    }),
  ];
}

function personalExecutorFixture({ executorId, name, accountId, sharingStatus }) {
  return {
    executor_id: executorId,
    scope: "personal",
    executor_type: "codex",
    binding_method: "device_code",
    owner_actor_id: "actor-browser-smoke-owner",
    owner_display_name: "Owner Smoke",
    name,
    authorization: { method: "chatgpt", account_id: accountId, plan_type: "plus" },
    availability: "available",
    model_policy: modelPolicyFixture("ready"),
    sharing_status: sharingStatus,
    credential_version: 1,
    connected_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  };
}

function sharedPoolExecutorFixture(sharingStatus) {
  return {
    executor_id: "executor-shared-teammate",
    scope: "personal",
    executor_type: "codex",
    binding_method: "device_code",
    owner_actor_id: "actor-browser-smoke-teammate",
    owner_display_name: "Teammate",
    name: "Shared Codex",
    authorization: { method: "chatgpt", plan_type: "team" },
    availability: "available",
    model_policy: modelPolicyFixture("ready"),
    sharing_status: sharingStatus,
  };
}

function safeExecutorFixture(executor) {
  return {
    executor_id: executor.executor_id,
    scope: executor.scope,
    executor_type: executor.executor_type,
    binding_method: executor.binding_method,
    owner_actor_id: executor.owner_actor_id,
    owner_display_name: executor.owner_display_name,
    name: executor.name,
    authorization: executor.authorization.method === "chatgpt"
      ? { method: "chatgpt", plan_type: executor.authorization.plan_type }
      : { method: "custom_api_key" },
    availability: executor.availability,
    model_policy: executor.model_policy,
  };
}

function modelFixture(validationStatus = "available") {
  return {
    model: "gpt-5.2-codex",
    display_name: "GPT-5.2 Codex",
    source: "catalog",
    supported_reasoning_efforts: ["medium", "high"],
    validation_status: validationStatus,
    last_validated_at_ms: validationStatus === "available" ? 1_700_000_000_000 : null,
  };
}

function modelPolicyFixture(status) {
  const ready = status === "ready";
  return {
    revision: 0,
    status,
    models: ready ? [modelFixture()] : [],
    allowed_reasoning_efforts: ready ? ["medium", "high"] : [],
    default_model: ready ? "gpt-5.2-codex" : null,
    default_reasoning_effort: ready ? "medium" : null,
    catalog_checked_at_ms: ready ? 1_700_000_000_000 : null,
    updated_at_ms: ready ? 1_700_000_000_000 : null,
  };
}

function memberAssignmentFixture(state) {
  const executor = state.personalExecutors.find((candidate) => candidate.executor_id === state.memberExecutorId);
  return {
    member_id: "actor-browser-smoke-owner",
    executor: executor ? safeExecutorFixture(executor) : null,
    version: state.memberExecutorVersion,
    session_state: state.memberSessionState,
    updated_at_ms: 1_700_000_000_000,
  };
}

function deviceCodeFixture(state) {
  return {
    attempt_id: state.attemptId,
    verification_url: "https://auth.openai.com/device",
    user_code: "ABCD-EFGH",
  };
}

function authSessionFixture() {
  const now = new Date().toISOString();
  return {
    session: {
      id: "session-browser-smoke",
      userId: "user-browser-smoke-owner",
      token: "browser-smoke-session",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: "user-browser-smoke-owner",
      name: "Owner Smoke",
      email: "owner@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      image: null,
    },
  };
}

function trpcInput(url, body, index) {
  const queryInput = url.searchParams.get("input");
  let envelope = body;
  if (queryInput) {
    try {
      envelope = JSON.parse(queryInput);
    } catch {
      envelope = {};
    }
  }
  const indexed = envelope?.[index] ?? envelope?.[String(index)];
  return indexed?.json ?? indexed ?? envelope?.json ?? envelope ?? null;
}

async function serveExportedRenderer(staticRoot, url, response) {
  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const normalizedPath = normalize(requestedPath);
  if (normalizedPath.startsWith("..") || relative(staticRoot, join(staticRoot, normalizedPath)).startsWith("..")) {
    return send(response, 403, "text/plain", "Forbidden");
  }
  const filePath = join(staticRoot, normalizedPath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return send(response, 404, "text/plain", "Not found");
    return send(response, 200, contentType(filePath), await readFile(filePath));
  } catch {
    return send(response, 404, "text/plain", "Not found");
  }
}

async function assertCurrentRendererExport() {
  const index = await readFile(join(exportedRendererRoot, "index.html"), "utf8");
  const scriptPath = index.match(/<script[^>]+src="([^"]+)"/u)?.[1];
  assert.ok(scriptPath, "artifacts/renderer/index.html must reference the exported renderer bundle");
  const bundle = await readFile(join(exportedRendererRoot, scriptPath.slice(1)), "utf8");
  for (const marker of ["Invitation code", "Authorize Codex", "Executors", "No product access"]) {
    assert.ok(bundle.includes(marker), `artifacts/renderer is stale: missing ${marker}`);
  }
}

function assertNoPreActiveDataPlane(backend) {
  const forbidden = backend.trpcProceduresBeforeActivation().filter((procedure) => (
    procedure.startsWith("home.") || procedure.startsWith("room.")
  ));
  assert.deepEqual(forbidden, [], "Home/Room requests are forbidden before Company active");
}

async function preparePage(cdp, url, viewport) {
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
  await waitFor(cdp, "document.readyState === 'complete'");
}

async function reloadPage(cdp) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.reload", { ignoreCache: true });
  await loaded;
  await waitFor(cdp, "document.readyState === 'complete'");
}

async function forceEnglish(cdp) {
  await waitForText(cdp, "English", 4_000);
  await clickText(cdp, "English");
}

async function waitForLoadingWithoutShell(cdp, timeoutMs = 2_500) {
  await waitFor(cdp, `document.body.innerText.includes('Loading…') && !document.querySelector('[aria-label="Open account menu"]')`, timeoutMs);
}

async function clickText(cdp, text) {
  const result = await evaluate(cdp, `(() => {
    const expected = ${JSON.stringify(text)};
    const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, [role="button"]')];
    const element = candidates.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return normalize(candidate.textContent) === expected && rect.width > 0 && rect.height > 0 && !candidate.disabled;
    });
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert.equal(result, true, `clickable text not found: ${text}`);
}

async function clickSelector(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `clickable selector not found: ${selector}`);
}

async function fill(cdp, selector, value, expectedValue = value) {
  const changed = await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(expectedValue)};
  })()`);
  assert.equal(changed, true, `input not found: ${selector}`);
}

async function hasSelector(cdp, selector) {
  return evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
}

async function waitForSelector(cdp, selector, timeoutMs = 2_500) {
  return waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs);
}

async function waitForText(cdp, text, timeoutMs = 2_500) {
  return waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(text)})`, timeoutMs);
}

async function waitForTrpc(backend, predicate, timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const procedures = backend.state.requests.filter((entry) => entry.kind === "trpc").map((entry) => entry.procedure);
    if (procedures.some(predicate)) return;
    await delay(25);
  }
  throw new Error("Expected renderer tRPC request was not observed.");
}

async function launchChrome() {
  const userDataDir = await mkdtemp(join(tmpdir(), "fields-onboarding-smoke-"));
  const port = await reservePort();
  const child = spawn(process.env.CHROME_BIN ?? "google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const pageTarget = targets.find((target) => target.type === "page");
      if (!pageTarget) throw new Error("Chrome page target is unavailable.");
      return {
        page: async () => new CdpClient(pageTarget.webSocketDebuggerUrl),
        close: async () => {
          await terminateChild(child);
          await removeDirectory(userDataDir);
        },
      };
    } catch {
      await delay(100);
    }
  }
  await terminateChild(child).finally(() => removeDirectory(userDataDir));
  throw new Error("Headless Chrome did not expose its debugging endpoint.");
}

async function removeDirectory(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function settleCleanup(...operations) {
  const results = await Promise.allSettled(operations);
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Browser smoke cleanup failed.");
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, 2_000)) return;
  child.kill("SIGKILL");
  if (!await waitForChildExit(child, 2_000)) {
    throw new Error("Headless Chrome did not terminate after SIGKILL.");
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.events = new Map();
    this.open = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? pending?.reject(new Error(message.error.message)) : pending?.resolve(message.result);
      } else {
        const waiters = this.events.get(message.method) ?? [];
        this.events.delete(message.method);
        for (const resolve of waiters) resolve(message.params);
      }
    });
  }

  async send(method, params = {}) {
    await this.open;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  waitFor(method) {
    return new Promise((resolve) => this.events.set(method, [...(this.events.get(method) ?? []), resolve]));
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await delay(50);
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

function readJson(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({ raw: body });
      }
    });
  });
}

function contentType(filePath) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[extname(filePath)] ?? "application/octet-stream";
}

function json(response, body, status = 200) {
  return send(response, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function send(response, status, contentTypeValue, body) {
  response.writeHead(status, {
    "content-type": contentTypeValue,
    "cache-control": "no-store",
  });
  response.end(body);
}

function reservePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

await main();
