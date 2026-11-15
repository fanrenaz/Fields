export type HomeFilesystemErrorCode =
  | "invalid_path"
  | "invalid_name"
  | "invalid_entry_kind"
  | "path_escape"
  | "symlink_ancestor"
  | "not_directory"
  | "root_operation_forbidden"
  | "protected_path"
  | "entry_already_exists"
  | "filesystem_unavailable";

export class HomeFilesystemError extends Error {
  readonly code: HomeFilesystemErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: HomeFilesystemErrorCode, message: string, options: { details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "HomeFilesystemError";
    this.code = code;
    this.details = options.details ?? {};
  }
}
