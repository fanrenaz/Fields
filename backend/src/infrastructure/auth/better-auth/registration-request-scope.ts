import { AsyncLocalStorage } from "node:async_hooks";

const registrationRequest = new AsyncLocalStorage<{ grantId: string | null }>();

export function runInRegistrationRequestScope<T>(work: () => T): T {
  return registrationRequest.run({ grantId: null }, work);
}

export function bindRegistrationGrant(grantId: string): void {
  const scope = registrationRequest.getStore();
  if (!scope) throw new Error("Registration request scope is unavailable.");
  scope.grantId = grantId;
}

export function currentRegistrationGrant(): string | null {
  return registrationRequest.getStore()?.grantId ?? null;
}
