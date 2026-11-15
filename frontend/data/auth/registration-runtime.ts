export const REGISTRATION_CREDENTIAL_HEADER = "X-Fields-Registration-Credential";

const REGISTRATION_KEY = "registration";

export function registrationCodeFromWebUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const values = url.searchParams.getAll(REGISTRATION_KEY);
  if (values.length !== 1) return null;
  return validRegistrationCode(values[0] ?? "");
}

export function consumeWebRegistrationCode(): string | null {
  if (typeof window === "undefined") return null;
  const rawUrl = window.location.href;
  const code = registrationCodeFromWebUrl(rawUrl);
  if (!code || typeof history === "undefined") return code;
  const url = new URL(rawUrl);
  url.searchParams.delete(REGISTRATION_KEY);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return code;
}

export function registrationLinkForWeb(code: string): string {
  if (typeof window === "undefined") throw new Error("A browser origin is required.");
  const normalized = validRegistrationCode(code);
  if (!normalized) throw new Error("The registration code is invalid.");
  const url = new URL("/", window.location.origin);
  url.searchParams.set(REGISTRATION_KEY, normalized);
  return url.toString();
}

function validRegistrationCode(value: string): string | null {
  const normalized = value.trim();
  return normalized.length >= 16
    && normalized.length <= 128
    && /^[A-Za-z0-9_-]+$/u.test(normalized)
    ? normalized
    : null;
}
