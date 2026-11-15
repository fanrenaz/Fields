import type { ChatgptAuthTokensRefreshResponse } from "../../generated/codex-app-server-protocol/v2/ChatgptAuthTokensRefreshResponse.js";
import type { LoginAccountResponse } from "../../generated/codex-app-server-protocol/v2/LoginAccountResponse.js";
import { CodexAppServerClient } from "../adapter/codex-app-server-client.js";

export type ExternalChatgptAuthTokens = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
};

export type ExternalAuthClient = {
  request<TResult = unknown>(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<TResult>;
  notify(notification: { method: "initialized" }): Promise<void>;
  close(): Promise<void>;
};

export type ExternalAuthClientFactory = (socketPath: string) => ExternalAuthClient;

export async function loginWithChatgptAuthTokens(
  socketPath: string,
  tokens: ExternalChatgptAuthTokens,
  options: { clientFactory?: ExternalAuthClientFactory; timeoutMs?: number } = {},
): Promise<void> {
  const client = (options.clientFactory ?? openExternalAuthClient)(socketPath);
  try {
    await initialize(client, options.timeoutMs);
    const result = await client.request<LoginAccountResponse>("account/login/start", {
      type: "chatgptAuthTokens",
      accessToken: tokens.accessToken,
      chatgptAccountId: tokens.chatgptAccountId,
      chatgptPlanType: tokens.chatgptPlanType,
    }, { timeoutMs: options.timeoutMs });
    if (result.type !== "chatgptAuthTokens") {
      throw new Error("Codex app-server did not accept external ChatGPT authentication.");
    }
  } finally {
    await client.close();
  }
}

export function externalAuthRefreshResponse(tokens: ExternalChatgptAuthTokens): ChatgptAuthTokensRefreshResponse {
  return {
    accessToken: tokens.accessToken,
    chatgptAccountId: tokens.chatgptAccountId,
    chatgptPlanType: tokens.chatgptPlanType,
  };
}

export async function initializeExternalAuthClient(client: ExternalAuthClient, timeoutMs?: number): Promise<void> {
  await initialize(client, timeoutMs);
}

export function openExternalAuthClient(socketPath: string): ExternalAuthClient {
  const client = CodexAppServerClient.fromUnixSocket(socketPath);
  return {
    request: (method, params, options) => client.request(
      method as Parameters<CodexAppServerClient["request"]>[0],
      params as Parameters<CodexAppServerClient["request"]>[1],
      options,
    ),
    notify: (notification) => client.notify(notification),
    close: () => client.close(),
  };
}

async function initialize(client: ExternalAuthClient, timeoutMs?: number): Promise<void> {
  await client.request("initialize", {
    clientInfo: {
      name: "fields-company-runtime",
      title: "Fields Company Runtime",
      version: "0.1.3",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [],
    },
  }, { timeoutMs });
  await client.notify({ method: "initialized" });
}
