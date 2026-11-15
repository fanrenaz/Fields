# Fields Backend

Node.js Product API, fixed Company Runtime access, and durable Event runtime for
Fields. The Backend owns Company, Actor, Room, message, executor-assignment,
Runtime status, and execution facts in PostgreSQL. The internal deployment has
one Company and one durable Runtime workspace.

Company Runtime owns the Company data plane: member app servers, Codex
credentials, Home execution and filesystem access, Room agent execution,
execution-scoped Company File snapshots, and the local Company Asset cache.
Backend owns Company File metadata, folders, versions, permissions, and Room
references in PostgreSQL while RustFS stores file bytes and immutable Asset
archives. Raw provider credentials and provider payloads never enter public
routes, persistence, or browser state.
External Company File links are signed with `FIELDS_FILE_SHARE_SECRET`, remain
owned by their creating Actor, and resolve to short-lived RustFS URLs.

## Local checks

Run non-build checks from the repository root:

```bash
pnpm --filter @fields/backend run lint
pnpm --filter @fields/backend run typecheck
pnpm --filter @fields/backend test
pnpm --filter @fields/backend run integration:company-runtime
```

The integration suite explicitly skips unless
`FIELDS_RUN_COMPANY_RUNTIME_INTEGRATION_TESTS=1` and
`FIELDS_INTEGRATION_DATABASE_URL` points to a real PostgreSQL database.
Production/application builds and Docker/Compose builds run only in approved
remote CI.

## Processes

```bash
pnpm --filter @fields/backend run dev
pnpm --filter @fields/backend run event:dev
pnpm --filter @fields/backend run embodiment:dev
```

Company Runtime self-initializes for the configured Company and reports its
latest operational state through authenticated callbacks. The Event process
delivers durable outbox events, including `runtime.agent-room-execution`.
Neither process mounts the Docker socket.

## Direct-process configuration

Copy `backend/.env.example` to `backend/.env` for direct API, Event,
or Embodiment commands. Existing process values are loaded first, workspace
`.env` supplies missing values, and `backend/.env` has final override
precedence. `FIELDS_BACKEND_DATABASE_URL` takes precedence over `DATABASE_URL`.

Backend, Event, and Company Runtime read the same control-token file from
`FIELDS_INTERNAL_CONTROL_TOKEN_FILE`. Compose mounts that file read-only at
`/run/secrets/fields-control-token`; credentials remain inside the Company
Runtime workspace.

## Full environment reset

Stop Compose services first. The default command is read-only and lists the
exact Company Runtime containers/workspace volumes and PostgreSQL volume that
would be removed:

```bash
pnpm --filter @fields/backend run environment:reset
```

Execution requires the exact V3 confirmation and preserves Caddy data/config
volumes:

```bash
pnpm --filter @fields/backend run environment:reset -- --confirm RESET_FIELDS_BACKEND_V3
```

The reset fails closed on legacy dual-runtime labels, unexpected labels or
mounts, ownership collisions, or a token bind that does not match
`FIELDS_COMPANY_RUNTIME_CONTROL_TOKEN_HOST_FILE`.
