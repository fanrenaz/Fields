import type { FastifyLoggerOptions } from "fastify";

import { emitObservabilityLog } from "./events.js";

type PinoRecord = {
  level?: unknown;
  res?: { statusCode?: unknown };
};

/**
 * Keep Fastify's Pino records structured without sending application logs to
 * Docker stdout. The Pino line is parsed locally and reduced to the same
 * allowlisted OTLP log facts used by the rest of the Backend.
 */
export function createSafeFastifyLogger(): FastifyLoggerOptions {
  return {
    level: process.env.FIELDS_LOG_LEVEL?.trim() || "info",
    serializers: {
      req: (request) => ({ method: request.method }),
      res: (reply) => ({ statusCode: reply.statusCode }),
      err: (error) => ({
        type: "FastifyError",
        message: "",
        stack: "",
        code: typeof error.code === "string" ? error.code : "fastify_error",
      }),
    },
    stream: {
      write(line) {
        const attributes = safeFastifyPinoAttributes(line);
        emitObservabilityLog("fastify.pino", attributes);
      },
    },
  };
}

export function safeFastifyPinoAttributes(line: string): Record<string, number | string | boolean> {
  let record: PinoRecord;
  try {
    record = JSON.parse(line) as PinoRecord;
  } catch {
    return { code: "fastify_log_invalid", retryable: false };
  }

  const statusCode = typeof record.res?.statusCode === "number"
    && Number.isInteger(record.res.statusCode)
    && record.res.statusCode >= 100
    && record.res.statusCode <= 599
    ? record.res.statusCode
    : null;
  return {
    code: pinoLevelCode(record.level),
    retryable: statusCode !== null && statusCode >= 500,
    ...(statusCode === null ? {} : { "http.status_code": statusCode }),
  };
}

function pinoLevelCode(level: unknown): string {
  if (level === 10) return "fastify_trace";
  if (level === 20) return "fastify_debug";
  if (level === 30) return "fastify_info";
  if (level === 40) return "fastify_warn";
  if (level === 50) return "fastify_error";
  if (level === 60) return "fastify_fatal";
  return "fastify_log";
}
