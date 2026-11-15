import type { FastifyReply, FastifyRequest } from "fastify";

export type BetterAuthHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  origin: string;
};

export type BetterAuthHttpResponse = {
  statusCode: number;
  headers: Array<readonly [name: string, value: string]>;
  setCookie: string[];
  body: string | null;
};

export type BetterAuthRouteDispatcher = {
  dispatch(request: BetterAuthHttpRequest): Promise<BetterAuthHttpResponse>;
};

/**
 * Interface-only Fastify adapter. Composition supplies the provider-backed
 * dispatcher so this transport boundary never reaches Better Auth directly.
 */
export async function handleBetterAuthHttpRoute(
  dispatcher: BetterAuthRouteDispatcher,
  origin: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const guardedRoute = betterAuthRouteGuard(request.method, request.url, origin);
  if (guardedRoute) {
    return reply.code(guardedRoute.statusCode).send({
      code: guardedRoute.code,
      message: guardedRoute.message,
    });
  }

  const output = await dispatcher.dispatch({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    origin,
  });
  reply.code(output.statusCode);
  for (const [name, value] of output.headers) {
    reply.header(name, value);
  }
  if (output.setCookie.length > 0) {
    reply.header("set-cookie", output.setCookie);
  }
  return reply.send(output.body);
}

function betterAuthRouteGuard(
  method: string,
  requestUrl: string,
  origin: string,
): { statusCode: 403 | 404; code: string; message: string } | null {
  const pathname = new URL(requestUrl, origin).pathname;
  if (
    method === "GET"
    && (
      pathname === "/api/auth/organization/list-invitations"
      || pathname === "/api/auth/organization/get-full-organization"
    )
  ) {
    return { statusCode: 404, code: "NOT_FOUND", message: "Not found." };
  }
  if (
    method === "POST"
    && (
      pathname === "/api/auth/organization/leave"
      || pathname === "/api/auth/organization/delete"
    )
  ) {
    return {
      statusCode: 403,
      code: "ORGANIZATION_OPERATION_UNSUPPORTED",
      message: "This Organization operation is not supported by the current Company lifecycle.",
    };
  }
  return null;
}
