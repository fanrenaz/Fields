import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

import { backendAuthBaseUrl } from "./backend-url";

export const authClient = createAuthClient({
  baseURL: backendAuthBaseUrl(),
  plugins: [organizationClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: "include",
  });
}
