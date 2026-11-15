import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createActor } from "xstate";
import type {
  ProductSession,
} from "@fields/contracts/public/company";

import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_STATE_TAGS,
  authMachine,
  type AuthMachineActor,
} from "../../../../app/session/auth-machine";
import type {
  AuthMachineServices,
  AuthRequestOptions,
  AuthSessionIdentity,
  InvitationPreview,
} from "../../../../data/auth/auth-machine-services";
import { authServiceErrorMessage } from "../../../../data/auth/auth-machine-services";

const identity: AuthSessionIdentity = {
  displayName: "Ada Owner",
  email: "ada@example.com",
};

const productSession: ProductSession = {
  actor_id: "actor-ada",
  company_id: "company-fields",
  display_name: "Ada Owner",
  actor_type: "human",
  company_role: "owner",
  company_status: "active",
};

test("authentication service errors preserve public API details and retain a fallback", () => {
  assert.equal(
    authServiceErrorMessage(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      "Unable to log in.",
    ),
    "Invalid email or password",
  );
  assert.equal(authServiceErrorMessage(new Error("Authentication is unavailable"), "fallback"), "fallback");
  assert.equal(authServiceErrorMessage({ message: "   " }, "Unable to log in."), "Unable to log in.");
});

test("initialization selects bootstrap, invitation preview, or ordinary login without exposing signup", async () => {
  const bootstrap = createTestServices({ getBootstrapAvailability: async () => true });
  const bootstrapActor = startAuthActor(bootstrap.services);
  await waitFor(bootstrapActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.bootstrap));
  assert.equal(bootstrapActor.getSnapshot().matches({ signedOut: { bootstrap: "editing" } }), true);
  bootstrapActor.stop();

  const ordinary = createTestServices();
  const ordinaryActor = startAuthActor(ordinary.services);
  await waitFor(ordinaryActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.login));
  ordinaryActor.send({ type: "INVITATION_SIGNUP_SELECTED" });
  assert.equal(ordinaryActor.getSnapshot().matches({ signedOut: { login: "editing" } }), true);
  assert.equal(ordinaryActor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationSignup), false);
  ordinaryActor.stop();

  const preview = deferred<InvitationPreview>();
  const invitation = createTestServices({ previewInvitation: async () => preview.promise });
  const invitationActor = startAuthActor(invitation.services, "invite-a");
  await waitFor(invitationActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationPreviewing));
  assert.equal(invitationActor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationSignup), false, "signup is gated by preview");
  preview.resolve({ companyName: "Fields Labs" });
  await waitFor(invitationActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationSignup));
  assert.equal(invitationActor.getSnapshot().context.forms.invitation.preview.companyName, "Fields Labs");
  invitationActor.stop();
});

test("bootstrap validation owns password confirmation, visibility, and the 8-128 rule", async () => {
  const harness = createTestServices({ getBootstrapAvailability: async () => true });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.bootstrap));

  actor.send({ type: "BOOTSTRAP_DISPLAY_NAME_CHANGED", value: "Ada" });
  actor.send({ type: "BOOTSTRAP_EMAIL_CHANGED", value: "ada@example.com" });
  actor.send({ type: "BOOTSTRAP_PASSWORD_CHANGED", value: "short" });
  actor.send({ type: "BOOTSTRAP_CONFIRM_PASSWORD_CHANGED", value: "different" });
  actor.send({ type: "BOOTSTRAP_PASSWORD_VISIBILITY_TOGGLED" });
  actor.send({ type: "BOOTSTRAP_CONFIRM_PASSWORD_VISIBILITY_TOGGLED" });
  actor.send({ type: "BOOTSTRAP_SUBMITTED" });

  const invalid = actor.getSnapshot().context.forms.bootstrap;
  assert.match(invalid.errors.password ?? "", /8-128/u);
  assert.equal(invalid.errors.confirmPassword, "Passwords do not match.");
  assert.equal(invalid.passwordVisible, true);
  assert.equal(invalid.confirmPasswordVisible, true);
  assert.equal(harness.calls.bootstrap.length, 0);

  const maximum = "a".repeat(AUTH_PASSWORD_MAX_LENGTH);
  actor.send({ type: "BOOTSTRAP_PASSWORD_CHANGED", value: maximum });
  actor.send({ type: "BOOTSTRAP_CONFIRM_PASSWORD_CHANGED", value: maximum });
  actor.send({ type: "BOOTSTRAP_SUBMITTED" });
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));

  assert.deepEqual(harness.calls.bootstrap[0], {
    displayName: "Ada",
    email: "ada@example.com",
    password: maximum,
  });
  assert.equal(actor.getSnapshot().context.forms.bootstrap.password, "");
  assert.equal(actor.getSnapshot().context.forms.bootstrap.confirmPassword, "");
  actor.stop();
});

test("new-account and existing-account invitation flows both accept before entering the workspace", async () => {
  const signup = createTestServices();
  const signupActor = startAuthActor(signup.services, "invite-signup");
  await waitFor(signupActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationSignup));
  fillInvitationSignup(signupActor);
  signupActor.send({ type: "INVITATION_SIGNUP_SUBMITTED" });
  await waitFor(signupActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));

  assert.equal(signup.calls.signup[0]?.credential, "invite-signup");
  assert.deepEqual(signup.calls.accept, ["invite-signup"]);
  assert.equal(signupActor.getSnapshot().context.invitationCredential, null);
  assert.deepEqual(signupActor.getSnapshot().context.account, {
    displayName: "Ada Owner",
    email: "ada@example.com",
    companyRole: "owner",
  });
  signupActor.stop();

  const existing = createTestServices();
  const existingActor = startAuthActor(existing.services, "invite-existing");
  await waitFor(existingActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationSignup));
  existingActor.send({ type: "INVITATION_LOGIN_SELECTED" });
  existingActor.send({ type: "INVITATION_LOGIN_EMAIL_CHANGED", value: "ada@example.com" });
  existingActor.send({ type: "INVITATION_LOGIN_PASSWORD_CHANGED", value: "existing-password" });
  existingActor.send({ type: "INVITATION_LOGIN_SUBMITTED" });
  await waitFor(existingActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));

  assert.deepEqual(existing.calls.login[0], { email: "ada@example.com", password: "existing-password" });
  assert.deepEqual(existing.calls.accept, ["invite-existing"]);
  existingActor.stop();
});

test("a failed submitted invitation recovers through ProductSession without accepting twice", async () => {
  const harness = createTestServices({
    getAuthSession: async () => identity,
    acceptInvitation: async () => {
      throw new Error("accept response lost");
    },
  });
  const actor = startAuthActor(harness.services, "invite-recovery");
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));

  assert.deepEqual(harness.calls.accept, ["invite-recovery"]);
  assert.equal(harness.calls.resolveProductSession, 1);
  assert.equal(actor.getSnapshot().context.forms.invitation.acceptance.status, "success");
  assert.equal(actor.getSnapshot().context.access.error, null);
  actor.stop();
});

test("credential replacement aborts old preview and acceptance actors and ignores their late results", async () => {
  const previewA = deferred<InvitationPreview>();
  const previewB = deferred<InvitationPreview>();
  const previewHarness = createTestServices({
    previewInvitation: async ({ credential }) => credential === "invite-a" ? previewA.promise : previewB.promise,
  });
  const previewActor = startAuthActor(previewHarness.services, "invite-a");
  await waitFor(previewActor, () => previewHarness.calls.preview.length === 1);
  previewActor.send({ type: "INVITATION_CREDENTIAL_CHANGED", credential: "invite-b" });
  await waitFor(previewActor, () => previewHarness.calls.preview.length === 2);
  assert.equal(previewHarness.calls.preview[0]?.signal.aborted, true);

  previewA.resolve({ companyName: "Old Company" });
  await settleEffects();
  assert.equal(previewActor.getSnapshot().context.forms.invitation.preview.companyName, null);
  assert.equal(previewActor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationPreviewing), true);
  previewB.resolve({ companyName: "New Company" });
  await waitFor(previewActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationSignup));
  assert.equal(previewActor.getSnapshot().context.forms.invitation.preview.companyName, "New Company");
  previewActor.stop();

  const acceptA = deferred<void>();
  const acceptB = deferred<void>();
  const acceptHarness = createTestServices({
    getAuthSession: async () => identity,
    acceptInvitation: async ({ credential }) => credential === "invite-a" ? acceptA.promise : acceptB.promise,
  });
  const acceptActor = startAuthActor(acceptHarness.services, "invite-a");
  await waitFor(acceptActor, () => acceptHarness.calls.accept.length === 1);
  acceptActor.send({ type: "INVITATION_CREDENTIAL_CHANGED", credential: "invite-b" });
  await waitFor(acceptActor, () => acceptHarness.calls.accept.length === 2);
  assert.equal(acceptHarness.calls.acceptOptions[0]?.signal.aborted, true);

  acceptA.resolve();
  await settleEffects();
  assert.equal(acceptActor.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace), false);
  acceptB.resolve();
  await waitFor(acceptActor, (actor) => actor.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));
  assert.deepEqual(acceptHarness.calls.accept, ["invite-a", "invite-b"]);
  acceptActor.stop();
});

test("leaving a submitting login drops its late result", async () => {
  const login = deferred<AuthSessionIdentity>();
  const preview = deferred<InvitationPreview>();
  const harness = createTestServices({
    login: async () => login.promise,
    previewInvitation: async () => preview.promise,
  });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.login));
  actor.send({ type: "LOGIN_EMAIL_CHANGED", value: "ada@example.com" });
  actor.send({ type: "LOGIN_PASSWORD_CHANGED", value: "password" });
  actor.send({ type: "LOGIN_SUBMITTED" });
  await waitFor(actor, () => harness.calls.login.length === 1);
  actor.send({ type: "INVITATION_CREDENTIAL_CHANGED", credential: "invite-new" });
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationPreviewing));
  assert.equal(harness.calls.loginOptions[0]?.signal.aborted, true);

  login.resolve(identity);
  await settleEffects();
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.authenticated), false);
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationPreviewing), true);
  preview.resolve({ companyName: "New Company" });
  actor.stop();
});

test("credential replacement drops a late ProductSession result", async () => {
  const productRead = deferred<ProductSession | null>();
  const acceptance = deferred<void>();
  const harness = createTestServices({
    getAuthSession: async () => identity,
    resolveProductSession: async () => productRead.promise,
    acceptInvitation: async () => acceptance.promise,
  });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, () => harness.calls.resolveProductSession === 1);
  const oldResolveSignal = harness.calls.resolveProductSessionOptions[0]?.signal;

  actor.send({ type: "INVITATION_CREDENTIAL_CHANGED", credential: "invite-replacement" });
  await waitFor(actor, () => harness.calls.accept.length === 1);
  assert.equal(oldResolveSignal?.aborted, true);
  productRead.resolve(productSession);
  await settleEffects();
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace), false);
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.invitationAccepting), true);
  actor.stop();
});

test("noAccess, network retry, and logout remain explicit machine states", async () => {
  let sessionRead = 0;
  let authRead = 0;
  const harness = createTestServices({
    getAuthSession: async () => authRead++ === 0 ? identity : null,
    resolveProductSession: async () => {
      sessionRead += 1;
      if (sessionRead === 1) throw new Error("offline");
      if (sessionRead === 2) return null;
      return productSession;
    },
  });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.fatalError));
  assert.equal(actor.getSnapshot().context.fatalError?.message, "Unable to load Fields.");

  actor.send({ type: "RETRY_REQUESTED" });
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.noAccess));
  assert.equal(actor.getSnapshot().context.access.error, "No product access.");

  actor.send({ type: "ACCESS_RETRY_REQUESTED" });
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));
  actor.send({ type: "LOGOUT_REQUESTED" });
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.login));

  assert.equal(harness.calls.logout, 1);
  assert.equal(actor.getSnapshot().context.identity, null);
  assert.equal(actor.getSnapshot().context.session, null);
  assert.equal(actor.getSnapshot().context.invitationCredential, null);
  actor.stop();
});

test("account states and password change own validation, retry, default revocation, and sensitive clearing", async () => {
  let passwordAttempt = 0;
  const harness = createTestServices({
    getAuthSession: async () => identity,
    changePassword: async () => {
      passwordAttempt += 1;
      if (passwordAttempt === 1) throw new Error("current password is wrong");
    },
  });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.accountClosed), true);

  actor.send({ type: "ACCOUNT_MENU_OPENED" });
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.accountMenu), true);
  actor.send({ type: "ACCOUNT_SETTINGS_OPENED" });
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.accountSettings), true);
  assert.equal(actor.getSnapshot().context.forms.password.revokeOtherSessions, true);

  actor.send({ type: "PASSWORD_CURRENT_CHANGED", value: "" });
  actor.send({ type: "PASSWORD_NEW_CHANGED", value: "short" });
  actor.send({ type: "PASSWORD_CONFIRM_CHANGED", value: "different" });
  actor.send({ type: "PASSWORD_CHANGE_SUBMITTED" });
  assert.match(actor.getSnapshot().context.forms.password.errors.newPassword ?? "", /8-128/u);
  assert.equal(actor.getSnapshot().context.forms.password.errors.confirmPassword, "Passwords do not match.");
  assert.equal(harness.calls.changePassword.length, 0);

  actor.send({ type: "PASSWORD_CURRENT_CHANGED", value: "old-password" });
  actor.send({ type: "PASSWORD_NEW_CHANGED", value: "new-password" });
  actor.send({ type: "PASSWORD_CONFIRM_CHANGED", value: "new-password" });
  actor.send({ type: "PASSWORD_CURRENT_VISIBILITY_TOGGLED" });
  actor.send({ type: "PASSWORD_NEW_VISIBILITY_TOGGLED" });
  actor.send({ type: "PASSWORD_CONFIRM_VISIBILITY_TOGGLED" });
  actor.send({ type: "PASSWORD_CHANGE_SUBMITTED" });
  await waitFor(actor, (current) => current.getSnapshot().context.forms.password.submit.status === "error");
  assert.equal(actor.getSnapshot().context.forms.password.submit.error, "Unable to change the password.");
  assert.equal(actor.getSnapshot().context.forms.password.currentPassword, "old-password");
  assert.equal(harness.calls.changePassword[0]?.revokeOtherSessions, true);

  actor.send({ type: "PASSWORD_CHANGE_SUBMITTED" });
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.success));
  const completed = actor.getSnapshot().context.forms.password;
  assert.equal(completed.submit.status, "success");
  assert.equal(completed.currentPassword, "");
  assert.equal(completed.newPassword, "");
  assert.equal(completed.confirmPassword, "");
  assert.equal(completed.currentPasswordVisible, false);
  assert.equal(completed.newPasswordVisible, false);
  assert.equal(completed.confirmPasswordVisible, false);
  assert.equal(completed.revokeOtherSessions, true);
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace), true, "current session remains active");
  actor.stop();
});

test("closing account settings drops a late password-change result", async () => {
  const change = deferred<void>();
  const harness = createTestServices({
    getAuthSession: async () => identity,
    changePassword: async () => change.promise,
  });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));
  actor.send({ type: "ACCOUNT_SETTINGS_OPENED" });
  actor.send({ type: "PASSWORD_CURRENT_CHANGED", value: "old-password" });
  actor.send({ type: "PASSWORD_NEW_CHANGED", value: "new-password" });
  actor.send({ type: "PASSWORD_CONFIRM_CHANGED", value: "new-password" });
  actor.send({ type: "PASSWORD_CHANGE_SUBMITTED" });
  await waitFor(actor, () => harness.calls.changePassword.length === 1);
  actor.send({ type: "ACCOUNT_SETTINGS_CLOSED" });

  assert.equal(harness.calls.changePasswordOptions[0]?.signal.aborted, true);
  change.resolve();
  await settleEffects();
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.accountClosed), true);
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.success), false);
  assert.equal(actor.getSnapshot().context.forms.password.currentPassword, "");
  actor.stop();
});

test("credential replacement clears account secrets and closes settings", async () => {
  const acceptance = deferred<void>();
  const harness = createTestServices({
    getAuthSession: async () => identity,
    acceptInvitation: async () => acceptance.promise,
  });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));
  actor.send({ type: "ACCOUNT_SETTINGS_OPENED" });
  actor.send({ type: "PASSWORD_CURRENT_CHANGED", value: "old-password" });
  actor.send({ type: "PASSWORD_NEW_CHANGED", value: "new-password" });
  actor.send({ type: "PASSWORD_CONFIRM_CHANGED", value: "new-password" });

  actor.send({ type: "INVITATION_CREDENTIAL_CHANGED", credential: "replacement-invitation" });
  await waitFor(actor, () => harness.calls.accept.length === 1);
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.accountClosed), true);
  assert.equal(actor.getSnapshot().context.forms.password.currentPassword, "");
  assert.equal(actor.getSnapshot().context.forms.password.newPassword, "");
  assert.equal(actor.getSnapshot().context.forms.password.confirmPassword, "");
  actor.stop();
});

test("account events cannot cancel an in-flight logout", async () => {
  const logout = deferred<void>();
  let authRead = 0;
  const harness = createTestServices({
    getAuthSession: async () => authRead++ === 0 ? identity : null,
    logout: async () => logout.promise,
  });
  const actor = startAuthActor(harness.services);
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.workspace));
  actor.send({ type: "ACCOUNT_MENU_OPENED" });
  actor.send({ type: "ACCOUNT_MENU_CLOSED" });
  actor.send({ type: "LOGOUT_REQUESTED" });
  await waitFor(actor, () => harness.calls.logout === 1);

  actor.send({ type: "ACCOUNT_MENU_OPENED" });
  actor.send({ type: "ACCOUNT_SETTINGS_OPENED" });
  actor.send({ type: "ACCOUNT_MENU_CLOSED" });
  assert.equal(harness.calls.logoutOptions[0]?.signal.aborted, false);
  assert.equal(actor.getSnapshot().hasTag(AUTH_STATE_TAGS.submitting), true);

  logout.resolve();
  await waitFor(actor, (current) => current.getSnapshot().hasTag(AUTH_STATE_TAGS.login));
  actor.stop();
});

function startAuthActor(services: AuthMachineServices, invitationCredential: string | null = null): AuthMachineActor {
  return createActor(authMachine, { input: { services, invitationCredential } }).start();
}

function fillInvitationSignup(actor: AuthMachineActor): void {
  actor.send({ type: "INVITATION_SIGNUP_DISPLAY_NAME_CHANGED", value: "Ada Owner" });
  actor.send({ type: "INVITATION_SIGNUP_EMAIL_CHANGED", value: "ada@example.com" });
  actor.send({ type: "INVITATION_SIGNUP_PASSWORD_CHANGED", value: "secure-password" });
  actor.send({ type: "INVITATION_SIGNUP_CONFIRM_PASSWORD_CHANGED", value: "secure-password" });
}

type ServiceOverrides = Partial<AuthMachineServices>;

type TestServiceCalls = {
  authSession: number;
  bootstrapAvailability: number;
  preview: Array<{ credential: string; signal: AbortSignal }>;
  bootstrap: Array<{ displayName: string; email: string; password: string }>;
  login: Array<{ email: string; password: string }>;
  loginOptions: AuthRequestOptions[];
  signup: Array<{ credential: string; displayName: string; email: string; password: string }>;
  accept: string[];
  acceptOptions: AuthRequestOptions[];
  resolveProductSession: number;
  resolveProductSessionOptions: AuthRequestOptions[];
  changePassword: Array<{ currentPassword: string; newPassword: string; revokeOtherSessions: boolean }>;
  changePasswordOptions: AuthRequestOptions[];
  logout: number;
  logoutOptions: AuthRequestOptions[];
};

function createTestServices(overrides: ServiceOverrides = {}): {
  services: AuthMachineServices;
  calls: TestServiceCalls;
} {
  const calls: TestServiceCalls = {
    authSession: 0,
    bootstrapAvailability: 0,
    preview: [],
    bootstrap: [],
    login: [],
    loginOptions: [],
    signup: [],
    accept: [],
    acceptOptions: [],
    resolveProductSession: 0,
    resolveProductSessionOptions: [],
    changePassword: [],
    changePasswordOptions: [],
    logout: 0,
    logoutOptions: [],
  };
  const services: AuthMachineServices = {
    async getAuthSession(options) {
      calls.authSession += 1;
      return overrides.getAuthSession ? overrides.getAuthSession(options) : null;
    },
    async getBootstrapAvailability(options) {
      calls.bootstrapAvailability += 1;
      return overrides.getBootstrapAvailability ? overrides.getBootstrapAvailability(options) : false;
    },
    async previewInvitation(input, options) {
      calls.preview.push({ credential: input.credential, signal: options.signal });
      return overrides.previewInvitation
        ? overrides.previewInvitation(input, options)
        : { companyName: "Fields Labs" };
    },
    async bootstrapOwner(input, options) {
      calls.bootstrap.push(input);
      return overrides.bootstrapOwner ? overrides.bootstrapOwner(input, options) : identity;
    },
    async login(input, options) {
      calls.login.push(input);
      calls.loginOptions.push(options);
      return overrides.login ? overrides.login(input, options) : identity;
    },
    async signUpWithInvitation(input, options) {
      calls.signup.push(input);
      return overrides.signUpWithInvitation ? overrides.signUpWithInvitation(input, options) : identity;
    },
    async acceptInvitation(input, options) {
      calls.accept.push(input.credential);
      calls.acceptOptions.push(options);
      if (overrides.acceptInvitation) return overrides.acceptInvitation(input, options);
    },
    async resolveProductSession(options) {
      calls.resolveProductSession += 1;
      calls.resolveProductSessionOptions.push(options);
      return overrides.resolveProductSession ? overrides.resolveProductSession(options) : productSession;
    },
    async changePassword(input, options) {
      calls.changePassword.push(input);
      calls.changePasswordOptions.push(options);
      if (overrides.changePassword) return overrides.changePassword(input, options);
    },
    async logout(options) {
      calls.logout += 1;
      calls.logoutOptions.push(options);
      if (overrides.logout) return overrides.logout(options);
    },
  };
  return { services, calls };
}

async function waitFor(actor: AuthMachineActor, predicate: (actor: AuthMachineActor) => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate(actor)) return;
    await settleEffects();
  }
  assert.fail(`Auth machine did not reach the expected state. Current value: ${JSON.stringify(actor.getSnapshot().value)}`);
}

async function settleEffects(iterations = 3): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await setImmediate();
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
