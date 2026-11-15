import { assign, fromPromise, setup } from "xstate";
import type { ActorRefFrom, SnapshotFrom } from "xstate";
import type {
  ProductSession,
} from "@fields/contracts/public/company";

import {
  authServiceErrorMessage,
  type AuthMachineServices,
  type AuthSessionIdentity,
  type InvitationPreview,
} from "../../data/auth/auth-machine-services";

export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 128;

export const AUTH_STATE_TAGS = {
  initializing: "auth-initializing",
  signedOut: "auth-signed-out",
  bootstrap: "auth-bootstrap",
  login: "auth-login",
  invitation: "auth-invitation",
  invitationPreviewing: "auth-invitation-previewing",
  invitationSignup: "auth-invitation-signup",
  invitationLogin: "auth-invitation-login",
  authenticated: "auth-authenticated",
  accessResolving: "auth-access-resolving",
  invitationAccepting: "auth-invitation-accepting",
  workspace: "auth-workspace",
  noAccess: "auth-no-access",
  accountClosed: "auth-account-closed",
  accountMenu: "auth-account-menu",
  accountSettings: "auth-account-settings",
  submitting: "auth-submitting",
  success: "auth-success",
  fatalError: "auth-fatal-error",
} as const;

export type AuthStateTag = typeof AUTH_STATE_TAGS[keyof typeof AUTH_STATE_TAGS];
export type AuthSubmitStatus = "idle" | "submitting" | "success" | "error";
export type AuthSubmitState = {
  status: AuthSubmitStatus;
  error: string | null;
};

export type BootstrapFieldErrors = Partial<Record<"displayName" | "email" | "password" | "confirmPassword", string>>;
export type LoginFieldErrors = Partial<Record<"email" | "password", string>>;
export type InvitationSignupFieldErrors = BootstrapFieldErrors;
export type ChangePasswordFieldErrors = Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>;

export type BootstrapFormState = {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  passwordVisible: boolean;
  confirmPasswordVisible: boolean;
  errors: BootstrapFieldErrors;
  submit: AuthSubmitState;
};

export type LoginFormState = {
  email: string;
  password: string;
  passwordVisible: boolean;
  errors: LoginFieldErrors;
  submit: AuthSubmitState;
};

export type InvitationFormState = {
  preview: {
    companyName: string | null;
    submit: AuthSubmitState;
  };
  signup: BootstrapFormState;
  login: LoginFormState;
  acceptance: AuthSubmitState & {
    submitted: boolean;
  };
};

export type ChangePasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  currentPasswordVisible: boolean;
  newPasswordVisible: boolean;
  confirmPasswordVisible: boolean;
  revokeOtherSessions: boolean;
  errors: ChangePasswordFieldErrors;
  submit: AuthSubmitState;
};

export type AuthenticatedAccount = {
  displayName: string;
  email: string;
  companyRole: "owner" | "member";
};

/** React-facing projection contract. The eventual hook only needs to map a
 * snapshot plus `send`; it must not own additional Auth state. */
export type ChangePasswordController = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  currentPasswordVisible: boolean;
  newPasswordVisible: boolean;
  confirmPasswordVisible: boolean;
  revokeOtherSessions: boolean;
  fieldErrors: ChangePasswordFieldErrors;
  submitting: boolean;
  success: boolean;
  error: string | null;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  toggleCurrentPasswordVisibility: () => void;
  toggleNewPasswordVisibility: () => void;
  toggleConfirmPasswordVisibility: () => void;
  setRevokeOtherSessions: (value: boolean) => void;
  submit: () => void;
};

export type AuthenticatedAuthController = {
  session: ProductSession;
  account: {
    displayName: string;
    email: string;
    companyRole: "owner" | "member";
    menu: {
      isOpen: boolean;
      open: () => void;
      close: () => void;
    };
    settings: {
      isOpen: boolean;
      open: () => void;
      close: () => void;
    };
    password: ChangePasswordController;
    logout: () => void;
  };
};

export type AuthMachineContext = {
  services: AuthMachineServices;
  invitationCredential: string | null;
  identity: AuthSessionIdentity | null;
  session: ProductSession | null;
  account: AuthenticatedAccount | null;
  forms: {
    bootstrap: BootstrapFormState;
    login: LoginFormState;
    invitation: InvitationFormState;
    password: ChangePasswordFormState;
  };
  access: {
    error: string | null;
  };
  accountUi: {
    logout: AuthSubmitState;
  };
  fatalError: {
    message: string;
    retry: "initializing" | "access";
  } | null;
};

export type AuthMachineInput = {
  services: AuthMachineServices;
  invitationCredential?: string | null;
};

export type AuthMachineEvent =
  | { type: "INVITATION_CREDENTIAL_CHANGED"; credential: string | null }
  | { type: "BOOTSTRAP_DISPLAY_NAME_CHANGED"; value: string }
  | { type: "BOOTSTRAP_EMAIL_CHANGED"; value: string }
  | { type: "BOOTSTRAP_PASSWORD_CHANGED"; value: string }
  | { type: "BOOTSTRAP_CONFIRM_PASSWORD_CHANGED"; value: string }
  | { type: "BOOTSTRAP_PASSWORD_VISIBILITY_TOGGLED" }
  | { type: "BOOTSTRAP_CONFIRM_PASSWORD_VISIBILITY_TOGGLED" }
  | { type: "BOOTSTRAP_SUBMITTED" }
  | { type: "LOGIN_EMAIL_CHANGED"; value: string }
  | { type: "LOGIN_PASSWORD_CHANGED"; value: string }
  | { type: "LOGIN_PASSWORD_VISIBILITY_TOGGLED" }
  | { type: "LOGIN_SUBMITTED" }
  | { type: "INVITATION_SIGNUP_SELECTED" }
  | { type: "INVITATION_LOGIN_SELECTED" }
  | { type: "INVITATION_SIGNUP_DISPLAY_NAME_CHANGED"; value: string }
  | { type: "INVITATION_SIGNUP_EMAIL_CHANGED"; value: string }
  | { type: "INVITATION_SIGNUP_PASSWORD_CHANGED"; value: string }
  | { type: "INVITATION_SIGNUP_CONFIRM_PASSWORD_CHANGED"; value: string }
  | { type: "INVITATION_SIGNUP_PASSWORD_VISIBILITY_TOGGLED" }
  | { type: "INVITATION_SIGNUP_CONFIRM_PASSWORD_VISIBILITY_TOGGLED" }
  | { type: "INVITATION_SIGNUP_SUBMITTED" }
  | { type: "INVITATION_LOGIN_EMAIL_CHANGED"; value: string }
  | { type: "INVITATION_LOGIN_PASSWORD_CHANGED"; value: string }
  | { type: "INVITATION_LOGIN_PASSWORD_VISIBILITY_TOGGLED" }
  | { type: "INVITATION_LOGIN_SUBMITTED" }
  | { type: "ACCOUNT_MENU_OPENED" }
  | { type: "ACCOUNT_MENU_CLOSED" }
  | { type: "ACCOUNT_SETTINGS_OPENED" }
  | { type: "ACCOUNT_SETTINGS_CLOSED" }
  | { type: "PASSWORD_CURRENT_CHANGED"; value: string }
  | { type: "PASSWORD_NEW_CHANGED"; value: string }
  | { type: "PASSWORD_CONFIRM_CHANGED"; value: string }
  | { type: "PASSWORD_CURRENT_VISIBILITY_TOGGLED" }
  | { type: "PASSWORD_NEW_VISIBILITY_TOGGLED" }
  | { type: "PASSWORD_CONFIRM_VISIBILITY_TOGGLED" }
  | { type: "PASSWORD_REVOKE_OTHER_SESSIONS_CHANGED"; value: boolean }
  | { type: "PASSWORD_CHANGE_SUBMITTED" }
  | { type: "ACCESS_RETRY_REQUESTED" }
  | { type: "RETRY_REQUESTED" }
  | { type: "LOGOUT_REQUESTED" };

type InitializeActorInput = { services: AuthMachineServices };
type InitializeActorOutput = {
  identity: AuthSessionIdentity | null;
  bootstrapAvailable: boolean;
};
type CredentialActorInput = { services: AuthMachineServices; credential: string };
type BootstrapActorInput = {
  services: AuthMachineServices;
  displayName: string;
  email: string;
  password: string;
};
type LoginActorInput = { services: AuthMachineServices; email: string; password: string };
type InvitationSignupActorInput = BootstrapActorInput & { credential: string };
type ServiceOnlyActorInput = { services: AuthMachineServices };
type ChangePasswordActorInput = {
  services: AuthMachineServices;
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
};

const initializeActor = fromPromise<InitializeActorOutput, InitializeActorInput>(async ({ input, signal }) => {
  const identity = await input.services.getAuthSession({ signal });
  if (identity) return { identity, bootstrapAvailable: false };
  const bootstrapAvailable = await input.services.getBootstrapAvailability({ signal });
  return { identity: null, bootstrapAvailable };
});

const invitationPreviewActor = fromPromise<InvitationPreview, CredentialActorInput>(
  ({ input, signal }) => input.services.previewInvitation({ credential: input.credential }, { signal }),
);

const bootstrapActor = fromPromise<AuthSessionIdentity, BootstrapActorInput>(
  ({ input, signal }) => input.services.bootstrapOwner({
    displayName: input.displayName,
    email: input.email,
    password: input.password,
  }, { signal }),
);

const loginActor = fromPromise<AuthSessionIdentity, LoginActorInput>(
  ({ input, signal }) => input.services.login({ email: input.email, password: input.password }, { signal }),
);

const invitationSignupActor = fromPromise<AuthSessionIdentity, InvitationSignupActorInput>(
  ({ input, signal }) => input.services.signUpWithInvitation({
    credential: input.credential,
    displayName: input.displayName,
    email: input.email,
    password: input.password,
  }, { signal }),
);

const acceptInvitationActor = fromPromise<void, CredentialActorInput>(
  ({ input, signal }) => input.services.acceptInvitation({ credential: input.credential }, { signal }),
);

const resolveProductSessionActor = fromPromise<ProductSession | null, ServiceOnlyActorInput>(
  ({ input, signal }) => input.services.resolveProductSession({ signal }),
);

const changePasswordActor = fromPromise<void, ChangePasswordActorInput>(
  ({ input, signal }) => input.services.changePassword({
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    revokeOtherSessions: input.revokeOtherSessions,
  }, { signal }),
);

const logoutActor = fromPromise<void, ServiceOnlyActorInput>(
  ({ input, signal }) => input.services.logout({ signal }),
);

export const authMachine = setup({
  types: {} as {
    context: AuthMachineContext;
    events: AuthMachineEvent;
    input: AuthMachineInput;
    tags: AuthStateTag;
  },
  actors: {
    initialize: initializeActor,
    previewInvitation: invitationPreviewActor,
    bootstrapOwner: bootstrapActor,
    login: loginActor,
    signUpWithInvitation: invitationSignupActor,
    acceptInvitation: acceptInvitationActor,
    resolveProductSession: resolveProductSessionActor,
    changePassword: changePasswordActor,
    logout: logoutActor,
  },
  guards: {
    initializedWithSession: ({ event }) => initializationOutput(event).identity !== null,
    bootstrapAvailable: ({ event }) => initializationOutput(event).bootstrapAvailable,
    hasInvitationCredential: ({ context }) => context.invitationCredential !== null,
    hasUnsubmittedInvitationCredential: ({ context }) => context.invitationCredential !== null
      && !context.forms.invitation.acceptance.submitted,
    receivedNewInvitationCredential: ({ context, event }) => event.type === "INVITATION_CREDENTIAL_CHANGED"
      && normalizedCredential(event.credential) !== null
      && normalizedCredential(event.credential) !== context.invitationCredential,
    clearedInvitationCredential: ({ context, event }) => event.type === "INVITATION_CREDENTIAL_CHANGED"
      && normalizedCredential(event.credential) === null
      && context.invitationCredential !== null,
    bootstrapFormValid: ({ context }) => isEmptyErrors(validateBootstrapForm(context.forms.bootstrap)),
    loginFormValid: ({ context }) => isEmptyErrors(validateLoginForm(context.forms.login)),
    invitationSignupFormValid: ({ context }) => isEmptyErrors(validateBootstrapForm(context.forms.invitation.signup)),
    invitationLoginFormValid: ({ context }) => isEmptyErrors(validateLoginForm(context.forms.invitation.login)),
    resolvedProductSession: ({ event }) => productSessionOutput(event) !== null,
    hasWorkspace: ({ context }) => context.session !== null && context.account !== null,
    passwordFormValid: ({ context }) => isEmptyErrors(validateChangePasswordForm(context.forms.password)),
    retryInitialization: ({ context }) => context.fatalError?.retry === "initializing",
    retryAccess: ({ context }) => context.fatalError?.retry === "access",
    editableFormEvent: ({ context, event }) => formSubmitStatusForEvent(context, event) !== "submitting",
  },
  actions: {
    updateFormValue: assign({
      forms: ({ context, event }) => updateFormsFromEvent(context.forms, event),
    }),
    replaceInvitationCredential: assign({
      invitationCredential: ({ event }) => event.type === "INVITATION_CREDENTIAL_CHANGED"
        ? normalizedCredential(event.credential)
        : null,
      session: null,
      account: null,
      forms: ({ context }) => ({
        ...context.forms,
        invitation: initialInvitationForm(),
        password: initialChangePasswordForm(),
      }),
      access: { error: null },
    }),
    recordBootstrapValidation: assign({
      forms: ({ context }) => ({
        ...context.forms,
        bootstrap: {
          ...context.forms.bootstrap,
          errors: validateBootstrapForm(context.forms.bootstrap),
          submit: idleSubmit(),
        },
      }),
    }),
    beginBootstrapSubmission: assign({
      forms: ({ context }) => ({
        ...context.forms,
        bootstrap: { ...context.forms.bootstrap, errors: {}, submit: submittingSubmit() },
      }),
    }),
    failBootstrapSubmission: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        bootstrap: {
          ...context.forms.bootstrap,
          submit: failedSubmit(actorError(event), "Unable to create the owner account."),
        },
      }),
    }),
    recordLoginValidation: assign({
      forms: ({ context }) => ({
        ...context.forms,
        login: { ...context.forms.login, errors: validateLoginForm(context.forms.login), submit: idleSubmit() },
      }),
    }),
    beginLoginSubmission: assign({
      forms: ({ context }) => ({
        ...context.forms,
        login: { ...context.forms.login, errors: {}, submit: submittingSubmit() },
      }),
    }),
    failLoginSubmission: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        login: { ...context.forms.login, submit: failedSubmit(actorError(event), "Unable to log in.") },
      }),
    }),
    beginInvitationPreview: assign({
      forms: ({ context }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          preview: { companyName: null, submit: submittingSubmit() },
        },
      }),
    }),
    completeInvitationPreview: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          preview: { companyName: invitationPreviewOutput(event).companyName, submit: successfulSubmit() },
        },
      }),
    }),
    failInvitationPreview: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          preview: {
            companyName: null,
            submit: failedSubmit(actorError(event), "This invitation is unavailable."),
          },
        },
      }),
    }),
    recordInvitationSignupValidation: assign({
      forms: ({ context }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          signup: {
            ...context.forms.invitation.signup,
            errors: validateBootstrapForm(context.forms.invitation.signup),
            submit: idleSubmit(),
          },
        },
      }),
    }),
    beginInvitationSignupSubmission: assign({
      forms: ({ context }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          signup: { ...context.forms.invitation.signup, errors: {}, submit: submittingSubmit() },
        },
      }),
    }),
    failInvitationSignupSubmission: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          signup: {
            ...context.forms.invitation.signup,
            submit: failedSubmit(actorError(event), "Unable to create the account."),
          },
        },
      }),
    }),
    recordInvitationLoginValidation: assign({
      forms: ({ context }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          login: {
            ...context.forms.invitation.login,
            errors: validateLoginForm(context.forms.invitation.login),
            submit: idleSubmit(),
          },
        },
      }),
    }),
    beginInvitationLoginSubmission: assign({
      forms: ({ context }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          login: { ...context.forms.invitation.login, errors: {}, submit: submittingSubmit() },
        },
      }),
    }),
    failInvitationLoginSubmission: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          login: {
            ...context.forms.invitation.login,
            submit: failedSubmit(actorError(event), "Unable to log in."),
          },
        },
      }),
    }),
    completeAuthentication: assign({
      identity: ({ event }) => identityOutput(event),
      session: null,
      account: null,
      forms: ({ context }) => clearSignedOutSensitiveForms(context.forms),
      access: { error: null },
      fatalError: null,
    }),
    storeInitializedIdentity: assign({
      identity: ({ event }) => initializationOutput(event).identity,
      fatalError: null,
    }),
    setInitializationFatalError: assign({
      fatalError: ({ event }) => ({
        message: authServiceErrorMessage(actorError(event), "Unable to load authentication."),
        retry: "initializing" as const,
      }),
    }),
    beginInvitationAcceptance: assign({
      forms: ({ context }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          acceptance: { submitted: true, ...submittingSubmit() },
        },
      }),
      access: { error: null },
    }),
    completeInvitationAcceptance: assign({
      invitationCredential: null,
      forms: ({ context }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          acceptance: { submitted: true, ...successfulSubmit() },
        },
      }),
    }),
    failInvitationAcceptanceForRecovery: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        invitation: {
          ...context.forms.invitation,
          acceptance: {
            submitted: true,
            ...failedSubmit(actorError(event), "Unable to accept the invitation."),
          },
        },
      }),
    }),
    completeProductAccess: assign({
      invitationCredential: null,
      session: ({ event }) => productSessionOutput(event),
      account: ({ context, event }) => accountFrom(context.identity, productSessionOutput(event)),
      forms: ({ context }) => clearInvitationSensitiveForm(context.forms),
      access: { error: null },
      fatalError: null,
    }),
    recordNoAccess: assign({
      session: null,
      account: null,
      access: ({ context }) => ({
        error: context.forms.invitation.acceptance.error ?? "No product access.",
      }),
      fatalError: null,
    }),
    setAccessFatalError: assign({
      session: null,
      account: null,
      fatalError: ({ event }) => ({
        message: authServiceErrorMessage(actorError(event), "Unable to load Fields."),
        retry: "access" as const,
      }),
    }),
    prepareAccessRetry: assign({
      access: { error: null },
      forms: ({ context }) => context.forms.invitation.acceptance.status === "error"
        ? {
          ...context.forms,
          invitation: {
            ...context.forms.invitation,
            acceptance: { submitted: false, ...idleSubmit() },
          },
        }
        : context.forms,
    }),
    clearFatalError: assign({ fatalError: null }),
    recordPasswordValidation: assign({
      forms: ({ context }) => ({
        ...context.forms,
        password: {
          ...context.forms.password,
          errors: validateChangePasswordForm(context.forms.password),
          submit: idleSubmit(),
        },
      }),
    }),
    beginPasswordSubmission: assign({
      forms: ({ context }) => ({
        ...context.forms,
        password: { ...context.forms.password, errors: {}, submit: submittingSubmit() },
      }),
    }),
    failPasswordSubmission: assign({
      forms: ({ context, event }) => ({
        ...context.forms,
        password: {
          ...context.forms.password,
          submit: failedSubmit(actorError(event), "Unable to change the password."),
        },
      }),
    }),
    completePasswordSubmission: assign({
      forms: ({ context }) => ({
        ...context.forms,
        password: {
          ...initialChangePasswordForm(),
          submit: successfulSubmit(),
        },
      }),
    }),
    resetPasswordForm: assign({
      forms: ({ context }) => ({
        ...context.forms,
        password: initialChangePasswordForm(),
      }),
    }),
    beginLogout: assign({
      accountUi: { logout: submittingSubmit() },
    }),
    failLogout: assign({
      accountUi: ({ event }) => ({
        logout: failedSubmit(actorError(event), "Unable to log out."),
      }),
      fatalError: ({ event }) => ({
        message: authServiceErrorMessage(actorError(event), "Unable to log out."),
        retry: "access" as const,
      }),
    }),
    failFatalLogout: assign({
      accountUi: ({ event }) => ({
        logout: failedSubmit(actorError(event), "Unable to log out."),
      }),
      fatalError: ({ context, event }) => ({
        message: authServiceErrorMessage(actorError(event), "Unable to log out."),
        retry: context.fatalError?.retry ?? "initializing",
      }),
    }),
    resetAfterLogout: assign(({ context }) => initialContext({
      services: context.services,
      invitationCredential: null,
    })),
  },
}).createMachine({
  id: "auth",
  context: ({ input }) => initialContext(input),
  on: {
    BOOTSTRAP_DISPLAY_NAME_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    BOOTSTRAP_EMAIL_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    BOOTSTRAP_PASSWORD_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    BOOTSTRAP_CONFIRM_PASSWORD_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    BOOTSTRAP_PASSWORD_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    BOOTSTRAP_CONFIRM_PASSWORD_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    LOGIN_EMAIL_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    LOGIN_PASSWORD_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    LOGIN_PASSWORD_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    INVITATION_SIGNUP_DISPLAY_NAME_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    INVITATION_SIGNUP_EMAIL_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    INVITATION_SIGNUP_PASSWORD_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    INVITATION_SIGNUP_CONFIRM_PASSWORD_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    INVITATION_SIGNUP_PASSWORD_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    INVITATION_SIGNUP_CONFIRM_PASSWORD_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    INVITATION_LOGIN_EMAIL_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    INVITATION_LOGIN_PASSWORD_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    INVITATION_LOGIN_PASSWORD_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    PASSWORD_CURRENT_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    PASSWORD_NEW_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    PASSWORD_CONFIRM_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    PASSWORD_CURRENT_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    PASSWORD_NEW_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    PASSWORD_CONFIRM_VISIBILITY_TOGGLED: { actions: "updateFormValue" },
    PASSWORD_REVOKE_OTHER_SESSIONS_CHANGED: { guard: "editableFormEvent", actions: "updateFormValue" },
    INVITATION_CREDENTIAL_CHANGED: [
      { guard: "receivedNewInvitationCredential", actions: "replaceInvitationCredential" },
      { guard: "clearedInvitationCredential", actions: "replaceInvitationCredential" },
    ],
  },
  initial: "initializing",
  states: {
    initializing: {
      tags: AUTH_STATE_TAGS.initializing,
      invoke: {
        src: "initialize",
        input: ({ context }) => ({ services: context.services }),
        onDone: [
          {
            guard: "initializedWithSession",
            target: "authenticated",
            actions: "storeInitializedIdentity",
          },
          { guard: "bootstrapAvailable", target: "signedOut.bootstrap" },
          { guard: "hasInvitationCredential", target: "signedOut.invitation.previewing" },
          { target: "signedOut.login" },
        ],
        onError: { target: "fatalError", actions: "setInitializationFatalError" },
      },
    },
    signedOut: {
      tags: AUTH_STATE_TAGS.signedOut,
      initial: "login",
      on: {
        INVITATION_CREDENTIAL_CHANGED: [
          {
            guard: "receivedNewInvitationCredential",
            target: ".invitation.previewing",
            reenter: true,
            actions: "replaceInvitationCredential",
          },
          {
            guard: "clearedInvitationCredential",
            target: ".login",
            reenter: true,
            actions: "replaceInvitationCredential",
          },
        ],
      },
      states: {
        bootstrap: {
          tags: AUTH_STATE_TAGS.bootstrap,
          initial: "editing",
          states: {
            editing: {
              on: {
                BOOTSTRAP_SUBMITTED: [
                  {
                    guard: "bootstrapFormValid",
                    target: "submitting",
                    actions: "beginBootstrapSubmission",
                  },
                  { actions: "recordBootstrapValidation" },
                ],
              },
            },
            submitting: {
              tags: AUTH_STATE_TAGS.submitting,
              invoke: {
                src: "bootstrapOwner",
                input: ({ context }) => ({
                  services: context.services,
                  displayName: context.forms.bootstrap.displayName.trim(),
                  email: context.forms.bootstrap.email.trim(),
                  password: context.forms.bootstrap.password,
                }),
                onDone: { target: "#auth.authenticated", actions: "completeAuthentication" },
                onError: { target: "editing", actions: "failBootstrapSubmission" },
              },
            },
          },
        },
        login: {
          tags: AUTH_STATE_TAGS.login,
          initial: "editing",
          states: {
            editing: {
              on: {
                LOGIN_SUBMITTED: [
                  { guard: "loginFormValid", target: "submitting", actions: "beginLoginSubmission" },
                  { actions: "recordLoginValidation" },
                ],
              },
            },
            submitting: {
              tags: AUTH_STATE_TAGS.submitting,
              invoke: {
                src: "login",
                input: ({ context }) => ({
                  services: context.services,
                  email: context.forms.login.email.trim(),
                  password: context.forms.login.password,
                }),
                onDone: { target: "#auth.authenticated", actions: "completeAuthentication" },
                onError: { target: "editing", actions: "failLoginSubmission" },
              },
            },
          },
        },
        invitation: {
          tags: AUTH_STATE_TAGS.invitation,
          initial: "previewing",
          states: {
            previewing: {
              tags: AUTH_STATE_TAGS.invitationPreviewing,
              initial: "loading",
              states: {
                loading: {
                  tags: AUTH_STATE_TAGS.submitting,
                  entry: "beginInvitationPreview",
                  invoke: {
                    src: "previewInvitation",
                    input: ({ context }) => ({
                      services: context.services,
                      credential: requiredCredential(context.invitationCredential),
                    }),
                    onDone: {
                      target: "#auth.signedOut.invitation.signup",
                      actions: "completeInvitationPreview",
                    },
                    onError: { target: "error", actions: "failInvitationPreview" },
                  },
                },
                error: {
                  on: { RETRY_REQUESTED: { target: "loading" } },
                },
              },
            },
            signup: {
              tags: AUTH_STATE_TAGS.invitationSignup,
              initial: "editing",
              on: { INVITATION_LOGIN_SELECTED: { target: "login" } },
              states: {
                editing: {
                  on: {
                    INVITATION_SIGNUP_SUBMITTED: [
                      {
                        guard: "invitationSignupFormValid",
                        target: "submitting",
                        actions: "beginInvitationSignupSubmission",
                      },
                      { actions: "recordInvitationSignupValidation" },
                    ],
                  },
                },
                submitting: {
                  tags: AUTH_STATE_TAGS.submitting,
                  invoke: {
                    src: "signUpWithInvitation",
                    input: ({ context }) => ({
                      services: context.services,
                      credential: requiredCredential(context.invitationCredential),
                      displayName: context.forms.invitation.signup.displayName.trim(),
                      email: context.forms.invitation.signup.email.trim(),
                      password: context.forms.invitation.signup.password,
                    }),
                    onDone: { target: "#auth.authenticated", actions: "completeAuthentication" },
                    onError: { target: "editing", actions: "failInvitationSignupSubmission" },
                  },
                },
              },
            },
            login: {
              tags: AUTH_STATE_TAGS.invitationLogin,
              initial: "editing",
              on: { INVITATION_SIGNUP_SELECTED: { target: "signup" } },
              states: {
                editing: {
                  on: {
                    INVITATION_LOGIN_SUBMITTED: [
                      {
                        guard: "invitationLoginFormValid",
                        target: "submitting",
                        actions: "beginInvitationLoginSubmission",
                      },
                      { actions: "recordInvitationLoginValidation" },
                    ],
                  },
                },
                submitting: {
                  tags: AUTH_STATE_TAGS.submitting,
                  invoke: {
                    src: "login",
                    input: ({ context }) => ({
                      services: context.services,
                      email: context.forms.invitation.login.email.trim(),
                      password: context.forms.invitation.login.password,
                    }),
                    onDone: { target: "#auth.authenticated", actions: "completeAuthentication" },
                    onError: { target: "editing", actions: "failInvitationLoginSubmission" },
                  },
                },
              },
            },
          },
        },
      },
    },
    authenticated: {
      type: "parallel",
      tags: AUTH_STATE_TAGS.authenticated,
      on: {
        INVITATION_CREDENTIAL_CHANGED: [
          {
            guard: "receivedNewInvitationCredential",
            target: [".access.resolving", ".account.closed"],
            actions: "replaceInvitationCredential",
          },
          {
            guard: "clearedInvitationCredential",
            target: [".access.resolving", ".account.closed"],
            actions: "replaceInvitationCredential",
          },
        ],
      },
      states: {
        access: {
          initial: "resolving",
          states: {
            resolving: {
              tags: AUTH_STATE_TAGS.accessResolving,
              always: {
                guard: "hasUnsubmittedInvitationCredential",
                target: "accepting",
              },
              invoke: {
                src: "resolveProductSession",
                input: ({ context }) => ({ services: context.services }),
                onDone: [
                  {
                    guard: "resolvedProductSession",
                    target: "workspace",
                    actions: "completeProductAccess",
                  },
                  { target: "noAccess", actions: "recordNoAccess" },
                ],
                onError: { target: "#auth.fatalError", actions: "setAccessFatalError" },
              },
            },
            accepting: {
              tags: [AUTH_STATE_TAGS.invitationAccepting, AUTH_STATE_TAGS.submitting],
              entry: "beginInvitationAcceptance",
              invoke: {
                src: "acceptInvitation",
                input: ({ context }) => ({
                  services: context.services,
                  credential: requiredCredential(context.invitationCredential),
                }),
                onDone: {
                  target: "resolving",
                  actions: "completeInvitationAcceptance",
                },
                onError: {
                  target: "resolving",
                  actions: "failInvitationAcceptanceForRecovery",
                },
              },
            },
            workspace: {
              tags: AUTH_STATE_TAGS.workspace,
              on: { ACCESS_RETRY_REQUESTED: { target: "resolving", actions: "prepareAccessRetry" } },
            },
            noAccess: {
              tags: AUTH_STATE_TAGS.noAccess,
              on: { ACCESS_RETRY_REQUESTED: { target: "resolving", actions: "prepareAccessRetry" } },
            },
          },
        },
        account: {
          initial: "closed",
          states: {
            closed: {
              tags: AUTH_STATE_TAGS.accountClosed,
              initial: "idle",
              states: {
                idle: {
                  on: {
                    ACCOUNT_MENU_OPENED: {
                      guard: "hasWorkspace",
                      target: "#auth.authenticated.account.menu",
                    },
                    ACCOUNT_SETTINGS_OPENED: {
                      guard: "hasWorkspace",
                      target: "#auth.authenticated.account.settings",
                    },
                    LOGOUT_REQUESTED: { target: "loggingOut" },
                  },
                },
                loggingOut: {
                  tags: AUTH_STATE_TAGS.submitting,
                  entry: "beginLogout",
                  invoke: {
                    src: "logout",
                    input: ({ context }) => ({ services: context.services }),
                    onDone: {
                      target: "#auth.initializing",
                      actions: "resetAfterLogout",
                    },
                    onError: { target: "#auth.fatalError", actions: "failLogout" },
                  },
                },
              },
            },
            menu: {
              tags: AUTH_STATE_TAGS.accountMenu,
              on: {
                ACCOUNT_SETTINGS_OPENED: { target: "settings" },
                ACCOUNT_MENU_CLOSED: { target: "closed" },
                LOGOUT_REQUESTED: { target: "closed.loggingOut" },
              },
            },
            settings: {
              tags: AUTH_STATE_TAGS.accountSettings,
              initial: "editing",
              on: {
                ACCOUNT_SETTINGS_CLOSED: { target: "closed", actions: "resetPasswordForm" },
              },
              states: {
                editing: {
                  on: {
                    PASSWORD_CHANGE_SUBMITTED: [
                      {
                        guard: "passwordFormValid",
                        target: "submitting",
                        actions: "beginPasswordSubmission",
                      },
                      { actions: "recordPasswordValidation" },
                    ],
                  },
                },
                submitting: {
                  tags: AUTH_STATE_TAGS.submitting,
                  invoke: {
                    src: "changePassword",
                    input: ({ context }) => ({
                      services: context.services,
                      currentPassword: context.forms.password.currentPassword,
                      newPassword: context.forms.password.newPassword,
                      revokeOtherSessions: context.forms.password.revokeOtherSessions,
                    }),
                    onDone: { target: "success", actions: "completePasswordSubmission" },
                    onError: { target: "editing", actions: "failPasswordSubmission" },
                  },
                },
                success: {
                  tags: AUTH_STATE_TAGS.success,
                  on: {
                    PASSWORD_CURRENT_CHANGED: { target: "editing", actions: "updateFormValue" },
                    PASSWORD_NEW_CHANGED: { target: "editing", actions: "updateFormValue" },
                    PASSWORD_CONFIRM_CHANGED: { target: "editing", actions: "updateFormValue" },
                    PASSWORD_CURRENT_VISIBILITY_TOGGLED: { target: "editing", actions: "updateFormValue" },
                    PASSWORD_NEW_VISIBILITY_TOGGLED: { target: "editing", actions: "updateFormValue" },
                    PASSWORD_CONFIRM_VISIBILITY_TOGGLED: { target: "editing", actions: "updateFormValue" },
                    PASSWORD_REVOKE_OTHER_SESSIONS_CHANGED: { target: "editing", actions: "updateFormValue" },
                    PASSWORD_CHANGE_SUBMITTED: [
                      {
                        guard: "passwordFormValid",
                        target: "submitting",
                        actions: "beginPasswordSubmission",
                      },
                      { target: "editing", actions: "recordPasswordValidation" },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
    fatalError: {
      tags: AUTH_STATE_TAGS.fatalError,
      initial: "idle",
      states: {
        idle: {
          on: {
            RETRY_REQUESTED: [
              {
                guard: "retryInitialization",
                target: "#auth.initializing",
                actions: "clearFatalError",
              },
              {
                guard: "retryAccess",
                target: "#auth.authenticated",
                actions: "clearFatalError",
              },
            ],
            LOGOUT_REQUESTED: { target: "loggingOut", actions: "beginLogout" },
          },
        },
        loggingOut: {
          tags: AUTH_STATE_TAGS.submitting,
          invoke: {
            src: "logout",
            input: ({ context }) => ({ services: context.services }),
            onDone: { target: "#auth.initializing", actions: "resetAfterLogout" },
            onError: { target: "idle", actions: "failFatalLogout" },
          },
        },
      },
    },
  },
});

export type AuthMachineSnapshot = SnapshotFrom<typeof authMachine>;
export type AuthMachineActor = ActorRefFrom<typeof authMachine>;

function initialContext(input: AuthMachineInput): AuthMachineContext {
  return {
    services: input.services,
    invitationCredential: normalizedCredential(input.invitationCredential ?? null),
    identity: null,
    session: null,
    account: null,
    forms: {
      bootstrap: initialBootstrapForm(),
      login: initialLoginForm(),
      invitation: initialInvitationForm(),
      password: initialChangePasswordForm(),
    },
    access: { error: null },
    accountUi: { logout: idleSubmit() },
    fatalError: null,
  };
}

function initialBootstrapForm(): BootstrapFormState {
  return {
    displayName: "",
    email: "",
    password: "",
    confirmPassword: "",
    passwordVisible: false,
    confirmPasswordVisible: false,
    errors: {},
    submit: idleSubmit(),
  };
}

function initialLoginForm(): LoginFormState {
  return {
    email: "",
    password: "",
    passwordVisible: false,
    errors: {},
    submit: idleSubmit(),
  };
}

function initialInvitationForm(): InvitationFormState {
  return {
    preview: { companyName: null, submit: idleSubmit() },
    signup: initialBootstrapForm(),
    login: initialLoginForm(),
    acceptance: { submitted: false, ...idleSubmit() },
  };
}

function initialChangePasswordForm(): ChangePasswordFormState {
  return {
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    currentPasswordVisible: false,
    newPasswordVisible: false,
    confirmPasswordVisible: false,
    revokeOtherSessions: true,
    errors: {},
    submit: idleSubmit(),
  };
}

function idleSubmit(): AuthSubmitState {
  return { status: "idle", error: null };
}

function submittingSubmit(): AuthSubmitState {
  return { status: "submitting", error: null };
}

function successfulSubmit(): AuthSubmitState {
  return { status: "success", error: null };
}

function failedSubmit(error: unknown, fallback: string): AuthSubmitState {
  return { status: "error", error: authServiceErrorMessage(error, fallback) };
}

function validateBootstrapForm(form: BootstrapFormState): BootstrapFieldErrors {
  const errors: BootstrapFieldErrors = {};
  if (form.displayName.trim().length === 0) errors.displayName = "Name is required.";
  const emailError = validateEmail(form.email);
  if (emailError) errors.email = emailError;
  const passwordError = validateNewPassword(form.password);
  if (passwordError) errors.password = passwordError;
  if (form.confirmPassword.length === 0) {
    errors.confirmPassword = "Confirm the password.";
  } else if (form.confirmPassword !== form.password) {
    errors.confirmPassword = "Passwords do not match.";
  }
  return errors;
}

function validateLoginForm(form: LoginFormState): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const emailError = validateEmail(form.email);
  if (emailError) errors.email = emailError;
  if (form.password.length === 0) errors.password = "Password is required.";
  return errors;
}

function validateChangePasswordForm(form: ChangePasswordFormState): ChangePasswordFieldErrors {
  const errors: ChangePasswordFieldErrors = {};
  if (form.currentPassword.length === 0) errors.currentPassword = "Current password is required.";
  const newPasswordError = validateNewPassword(form.newPassword);
  if (newPasswordError) errors.newPassword = newPasswordError;
  if (form.confirmPassword.length === 0) {
    errors.confirmPassword = "Confirm the new password.";
  } else if (form.confirmPassword !== form.newPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }
  return errors;
}

function validateEmail(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) return "Enter a valid email address.";
  return null;
}

function validateNewPassword(value: string): string | null {
  if (value.length < AUTH_PASSWORD_MIN_LENGTH || value.length > AUTH_PASSWORD_MAX_LENGTH) {
    return `Use ${AUTH_PASSWORD_MIN_LENGTH}-${AUTH_PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

function isEmptyErrors(value: object): boolean {
  return Object.keys(value).length === 0;
}

function normalizedCredential(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredCredential(value: string | null): string {
  if (!value) throw new Error("The invitation credential is unavailable.");
  return value;
}

function initializationOutput(event: unknown): InitializeActorOutput {
  return actorOutput<InitializeActorOutput>(event);
}

function invitationPreviewOutput(event: unknown): InvitationPreview {
  return actorOutput<InvitationPreview>(event);
}

function identityOutput(event: unknown): AuthSessionIdentity {
  return actorOutput<AuthSessionIdentity>(event);
}

function productSessionOutput(event: unknown): ProductSession | null {
  return actorOutput<ProductSession | null>(event);
}

function actorOutput<T>(event: unknown): T {
  return (event as { output: T }).output;
}

function actorError(event: unknown): unknown {
  return (event as { error?: unknown }).error;
}

function accountFrom(identity: AuthSessionIdentity | null, session: ProductSession | null): AuthenticatedAccount | null {
  if (!identity || !session) return null;
  return {
    displayName: session.display_name,
    email: identity.email,
    companyRole: session.company_role,
  };
}

function clearSignedOutSensitiveForms(forms: AuthMachineContext["forms"]): AuthMachineContext["forms"] {
  return {
    ...forms,
    bootstrap: { ...initialBootstrapForm(), submit: successfulSubmit() },
    login: { ...initialLoginForm(), submit: successfulSubmit() },
    invitation: {
      ...forms.invitation,
      signup: { ...initialBootstrapForm(), submit: successfulSubmit() },
      login: { ...initialLoginForm(), submit: successfulSubmit() },
    },
  };
}

function clearInvitationSensitiveForm(forms: AuthMachineContext["forms"]): AuthMachineContext["forms"] {
  return {
    ...forms,
    invitation: {
      ...forms.invitation,
      signup: initialBootstrapForm(),
      login: initialLoginForm(),
      acceptance: { submitted: true, ...successfulSubmit() },
    },
  };
}

function formSubmitStatusForEvent(context: AuthMachineContext, event: AuthMachineEvent): AuthSubmitStatus {
  if (event.type.startsWith("BOOTSTRAP_")) return context.forms.bootstrap.submit.status;
  if (event.type.startsWith("LOGIN_")) return context.forms.login.submit.status;
  if (event.type.startsWith("INVITATION_SIGNUP_")) return context.forms.invitation.signup.submit.status;
  if (event.type.startsWith("INVITATION_LOGIN_")) return context.forms.invitation.login.submit.status;
  if (event.type.startsWith("PASSWORD_")) return context.forms.password.submit.status;
  return "idle";
}

function updateFormsFromEvent(forms: AuthMachineContext["forms"], event: AuthMachineEvent): AuthMachineContext["forms"] {
  const bootstrap = forms.bootstrap;
  const login = forms.login;
  const invitation = forms.invitation;
  const password = forms.password;
  switch (event.type) {
    case "BOOTSTRAP_DISPLAY_NAME_CHANGED":
      return { ...forms, bootstrap: updateBootstrapField(bootstrap, "displayName", event.value) };
    case "BOOTSTRAP_EMAIL_CHANGED":
      return { ...forms, bootstrap: updateBootstrapField(bootstrap, "email", event.value) };
    case "BOOTSTRAP_PASSWORD_CHANGED":
      return { ...forms, bootstrap: updateBootstrapField(bootstrap, "password", event.value) };
    case "BOOTSTRAP_CONFIRM_PASSWORD_CHANGED":
      return { ...forms, bootstrap: updateBootstrapField(bootstrap, "confirmPassword", event.value) };
    case "BOOTSTRAP_PASSWORD_VISIBILITY_TOGGLED":
      return { ...forms, bootstrap: { ...bootstrap, passwordVisible: !bootstrap.passwordVisible } };
    case "BOOTSTRAP_CONFIRM_PASSWORD_VISIBILITY_TOGGLED":
      return { ...forms, bootstrap: { ...bootstrap, confirmPasswordVisible: !bootstrap.confirmPasswordVisible } };
    case "LOGIN_EMAIL_CHANGED":
      return { ...forms, login: updateLoginField(login, "email", event.value) };
    case "LOGIN_PASSWORD_CHANGED":
      return { ...forms, login: updateLoginField(login, "password", event.value) };
    case "LOGIN_PASSWORD_VISIBILITY_TOGGLED":
      return { ...forms, login: { ...login, passwordVisible: !login.passwordVisible } };
    case "INVITATION_SIGNUP_DISPLAY_NAME_CHANGED":
      return { ...forms, invitation: { ...invitation, signup: updateBootstrapField(invitation.signup, "displayName", event.value) } };
    case "INVITATION_SIGNUP_EMAIL_CHANGED":
      return { ...forms, invitation: { ...invitation, signup: updateBootstrapField(invitation.signup, "email", event.value) } };
    case "INVITATION_SIGNUP_PASSWORD_CHANGED":
      return { ...forms, invitation: { ...invitation, signup: updateBootstrapField(invitation.signup, "password", event.value) } };
    case "INVITATION_SIGNUP_CONFIRM_PASSWORD_CHANGED":
      return { ...forms, invitation: { ...invitation, signup: updateBootstrapField(invitation.signup, "confirmPassword", event.value) } };
    case "INVITATION_SIGNUP_PASSWORD_VISIBILITY_TOGGLED":
      return { ...forms, invitation: { ...invitation, signup: { ...invitation.signup, passwordVisible: !invitation.signup.passwordVisible } } };
    case "INVITATION_SIGNUP_CONFIRM_PASSWORD_VISIBILITY_TOGGLED":
      return { ...forms, invitation: { ...invitation, signup: { ...invitation.signup, confirmPasswordVisible: !invitation.signup.confirmPasswordVisible } } };
    case "INVITATION_LOGIN_EMAIL_CHANGED":
      return { ...forms, invitation: { ...invitation, login: updateLoginField(invitation.login, "email", event.value) } };
    case "INVITATION_LOGIN_PASSWORD_CHANGED":
      return { ...forms, invitation: { ...invitation, login: updateLoginField(invitation.login, "password", event.value) } };
    case "INVITATION_LOGIN_PASSWORD_VISIBILITY_TOGGLED":
      return { ...forms, invitation: { ...invitation, login: { ...invitation.login, passwordVisible: !invitation.login.passwordVisible } } };
    case "PASSWORD_CURRENT_CHANGED":
      return { ...forms, password: updatePasswordField(password, "currentPassword", event.value) };
    case "PASSWORD_NEW_CHANGED":
      return { ...forms, password: updatePasswordField(password, "newPassword", event.value) };
    case "PASSWORD_CONFIRM_CHANGED":
      return { ...forms, password: updatePasswordField(password, "confirmPassword", event.value) };
    case "PASSWORD_CURRENT_VISIBILITY_TOGGLED":
      return { ...forms, password: { ...password, currentPasswordVisible: !password.currentPasswordVisible } };
    case "PASSWORD_NEW_VISIBILITY_TOGGLED":
      return { ...forms, password: { ...password, newPasswordVisible: !password.newPasswordVisible } };
    case "PASSWORD_CONFIRM_VISIBILITY_TOGGLED":
      return { ...forms, password: { ...password, confirmPasswordVisible: !password.confirmPasswordVisible } };
    case "PASSWORD_REVOKE_OTHER_SESSIONS_CHANGED":
      return { ...forms, password: { ...password, revokeOtherSessions: event.value, submit: idleSubmit() } };
    default:
      return forms;
  }
}

function updateBootstrapField<K extends keyof Pick<BootstrapFormState, "displayName" | "email" | "password" | "confirmPassword">>(
  form: BootstrapFormState,
  field: K,
  value: BootstrapFormState[K],
): BootstrapFormState {
  const errors = { ...form.errors };
  delete errors[field];
  return { ...form, [field]: value, errors, submit: idleSubmit() };
}

function updateLoginField<K extends keyof Pick<LoginFormState, "email" | "password">>(
  form: LoginFormState,
  field: K,
  value: LoginFormState[K],
): LoginFormState {
  const errors = { ...form.errors };
  delete errors[field];
  return { ...form, [field]: value, errors, submit: idleSubmit() };
}

function updatePasswordField<K extends keyof Pick<ChangePasswordFormState, "currentPassword" | "newPassword" | "confirmPassword">>(
  form: ChangePasswordFormState,
  field: K,
  value: ChangePasswordFormState[K],
): ChangePasswordFormState {
  const errors = { ...form.errors };
  delete errors[field];
  return { ...form, [field]: value, errors, submit: idleSubmit() };
}
