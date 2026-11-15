/**
 * Safe error contract for application code. Infrastructure implementations
 * translate provider failures into these stable codes before they cross a
 * Port; interface code is the only place that maps them to public responses.
 */
export class ApplicationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "ApplicationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isApplicationError(value: unknown): value is ApplicationError {
  return value instanceof ApplicationError;
}
