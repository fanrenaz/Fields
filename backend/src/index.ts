#!/usr/bin/env node
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

import { main } from "./composition/api/server.js";

/**
 * Compatibility entrypoint for the Product API. All production composition
 * lives under composition/api; this file preserves the package entry surface
 * and direct Node launcher only.
 */
export {
  createApp,
  DEFAULT_AUTH_BASE_URL,
  DEFAULT_AUTH_TRUSTED_ORIGINS,
  DEFAULT_CLIENT_ORIGIN,
  DEFAULT_CLIENT_ORIGINS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  main,
  runServer,
  type ServerOptions,
} from "./composition/api/server.js";
export { createBackendTrpcRouter } from "./interface/trpc/router.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => {
    if (code !== 0) {
      exit(code);
    }
  }).catch(() => exit(1));
}
