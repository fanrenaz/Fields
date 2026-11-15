import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";

import type { FieldsAuth } from "./fields-auth.js";
import { runInInvitationRenewalRequestScope } from "./stable-invitation-renewal-adapter.js";
import { runInRegistrationRequestScope } from "./registration-request-scope.js";

export type BetterAuthHttpRequestInput = {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body?: unknown;
  origin: string;
};

export type BetterAuthHttpResponseOutput = {
  statusCode: number;
  headers: Array<readonly [name: string, value: string]>;
  setCookie: string[];
  body: string | null;
};

/**
 * Fastify-independent adapter for the official Better Auth Fetch handler.
 * The composition root remains responsible for forwarding status, all
 * response headers (including every Set-Cookie value), and the response body.
 */
export async function dispatchBetterAuthHttpRequest(
  auth: FieldsAuth,
  input: BetterAuthHttpRequestInput,
): Promise<Response> {
  const url = new URL(input.url, input.origin);
  const method = input.method.toUpperCase();
  const headers = fromNodeHeaders(input.headers);
  const hasBody = method !== "GET" && method !== "HEAD" && input.body !== undefined;
  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  try {
    return await runInRegistrationRequestScope(() => (
      runInInvitationRenewalRequestScope(() => (
        auth.handler(new Request(url, {
          method,
          headers,
          ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
        }))
      ))
    ));
  } catch {
    // Never forward or log the original error here. Provider/adapter errors can
    // embed request bearer values in their message and cause chain.
    return new Response(JSON.stringify({
      code: "AUTHENTICATION_UNAVAILABLE",
      message: "Authentication is temporarily unavailable.",
    }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

/**
 * Materialize a Better Auth response without collapsing multiple Set-Cookie
 * headers. Fastify should set `setCookie` as an array and forward the remaining
 * header entries before sending `body` with `statusCode`.
 */
export async function materializeBetterAuthHttpResponse(
  response: Response,
): Promise<BetterAuthHttpResponseOutput> {
  const headers: Array<readonly [string, string]> = [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") {
      headers.push([name, value]);
    }
  });
  return {
    statusCode: response.status,
    headers,
    setCookie: response.headers.getSetCookie(),
    body: response.body ? await response.text() : null,
  };
}
