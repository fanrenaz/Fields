export class FieldsCliError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly exitCode: number;

  constructor(code: string, message: string, options: { details?: Record<string, unknown>; exitCode?: number } = {}) {
    super(message);
    this.name = "FieldsCliError";
    this.code = code;
    this.details = options.details ?? {};
    this.exitCode = options.exitCode ?? 1;
  }
}
