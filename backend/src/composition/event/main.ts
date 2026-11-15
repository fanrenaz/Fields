import { startEventFromEnv } from "./index.js";

const app = await startEventFromEnv();
let closing = false;

async function close(signal: string): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  app.server.log.info({ signal }, "Stopping Event worker.");
  await app.close();
}

process.once("SIGINT", () => { void close("SIGINT"); });
process.once("SIGTERM", () => { void close("SIGTERM"); });
