# Company Runtime

The fixed internal Company Runtime process owns the Company-isolated data plane:

- one persistent volume with `members/`, `assets/`, and `executors/`;
- at most one Codex App Server for each Member;
- Member Home Threads and files;
- Agent-Room executions with read-only, execution-scoped Company File snapshots;
- a verified local cache of immutable Company Asset archives stored in RustFS;
- the only canonical Executor credentials.

Member App Servers use `members/<member_id>/workspace` as `cwd` and its
`.codex` directory as `CODEX_HOME`. The Runtime rejects `.codex/auth.json`;
canonical credentials stay under
`executors/<executor_id>/credentials/auth.json`.

Each running Member App Server must install and verify the Runtime-managed
`fields-core@fields` plugin before it becomes ready. The plugin supplies the
`fields_embodiment`, `fields_search`, `fields_room_messages`, `fields_assets`,
and `fields_mail` MCP servers; no direct Fields MCP sections remain in Member
Codex config. Room Messages is disabled by default and enabled only through
the Agent-Room Thread's plugin override. The tool resolves Room identity from
Codex `extra._meta.threadId` and the Runtime's persisted Thread mapping, never
from model input or a Room header. Agent-Room completion publishes only the last Codex
`final_answer` message, with an unphased Agent message as the protocol
fallback; commentary is never published.

`fields_search` exposes authorized search plus Company File list, read, and
publish tools. Read materializes an exact immutable version into the Member's
hidden verified runtime cache and returns a local path; it never exposes object
storage URLs or credentials. Agents may publish a new file or version from their
own Member Workspace, but cannot rename, move, or delete Company Files. A Room
file is available to an Agent only when a frozen prompt message explicitly
references its exact version. That snapshot is mounted read-only for the Turn
and removed afterward; there is no Room-level file projection.

Run non-build checks from the repository root:

```bash
pnpm --filter @fields/company-runtime run lint
pnpm --filter @fields/company-runtime run typecheck
pnpm --filter @fields/company-runtime run test
```

The real Codex integration is explicit and never substitutes fake credentials:

```bash
FIELDS_REAL_CODEX_RUNTIME_TEST=1 \
FIELDS_REAL_CODEX_AUTH_JSON=/absolute/path/to/dedicated/auth.json \
pnpm --filter @fields/company-runtime run test
```

The conn-test IMAP/SMTP acceptance is likewise explicit and fails when its
required connection and SMTP fault-injection configurations are incomplete:

```bash
FIELDS_REAL_MAIL_INTEGRATION_TEST=1 \
FIELDS_REAL_MAIL_CONFIGURATION_JSON='<conn-test configuration>' \
FIELDS_REAL_MAIL_SMTP_UNKNOWN_CONFIGURATION_JSON='<conn-test custom fault-endpoint configuration>' \
FIELDS_REAL_MAIL_FAULT_CONTROL_URL='https://conn-test.example/faults/arm' \
FIELDS_REAL_MAIL_FAULT_CONTROL_TOKEN_FILE='/run/secrets/conn-test-mail-fault-token' \
pnpm --filter @fields/company-runtime run integration:mail
```

The fault-control endpoint is a strict, authenticated conn-test contract. It
accepts version `1` scenarios `imap_drop_next_authenticated_operation` and
`smtp_accept_data_then_drop_response`, returning
`{"version":1,"armed":true,"scenario":"..."}`. SMTP faults must include and
honor the supplied matcher: the Runtime suite uses the exact subject prefix
`Fields unknown `. This keeps the connection-time ownership probe on the
normal accept-and-IMAP-readback path and drops the DATA result only for the
explicitly targeted test message. Unmatched mail must be delivered normally.

Production packages this process into the shared Backend image. The Backend
container supervisor runs it as an independent Node.js process with the
configured Runtime volume; there is no standalone Company Runtime image or
Runtime Controller.
