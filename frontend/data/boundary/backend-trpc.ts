import type {
  BackendRouter,
} from "@fields/contracts/router/backend";
import {
  createTRPCProxyClient,
  createWSClient,
  httpBatchLink,
  splitLink,
  wsLink,
  type TRPCClient,
} from "@trpc/client";

import { authFetch } from "./auth-client";
import { backendTrpcHttpUrl, backendTrpcWsUrl } from "./backend-url";
import { workspaceTelemetry } from "../observability/workspace-telemetry";

type BackendClient = TRPCClient<BackendRouter>;

type BackendTransport = {
  client: BackendClient;
  wsClient: ReturnType<typeof createWSClient>;
};

export const backendTrpcConfig = {
  httpUrl: backendTrpcHttpUrl(),
  wsUrl: backendTrpcWsUrl(),
  maxBatchItems: 3,
  maxURLLength: 2_083,
} as const;

let transport = createBackendTransport();

export let backendWsClient = transport.wsClient;
export let backendTrpc = transport.client;

export function rebuildBackendTransport(): void {
  void transport.wsClient.close().catch(() => undefined);
  transport = createBackendTransport();
  backendWsClient = transport.wsClient;
  backendTrpc = transport.client;
}

function createBackendTransport(): BackendTransport {
  const wsClient = createWSClient({
    url: backendTrpcConfig.wsUrl,
    connectionParams: () => {
      const traceparent = workspaceTelemetry.traceparent();
      return traceparent ? { traceparent } : {};
    },
    lazy: {
      enabled: true,
      closeMs: 0,
    },
  });
  const client = createTRPCProxyClient<BackendRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === "subscription",
        true: wsLink({ client: wsClient }),
        false: httpBatchLink({
          url: backendTrpcConfig.httpUrl,
          fetch: authFetch,
          maxItems: backendTrpcConfig.maxBatchItems,
          maxURLLength: backendTrpcConfig.maxURLLength,
        }),
      }),
    ],
  });
  return { client, wsClient };
}

export { backendTrpcHttpUrl, backendTrpcWsUrl } from "./backend-url";
