# Desktop renderer smoke

Run from the repository root:

```bash
pnpm --filter @fields/frontend run renderer:smoke
```

The command runs two headless-Chrome suites at 1280x720 and 1920x1080.

The Room runtime suite bundles the production Room state machine and exercises
its services through a local HTTP control boundary. It verifies wake-before-data,
Room Ready gating, partial Agent readiness, retry, rapid Room switching,
presence release, and offline recovery.

The Company onboarding suite serves the actual `artifacts/renderer` production export and
drives the real authentication boundary, onboarding screens, Home workspace,
account settings, and Executors UI against a deterministic HTTP protocol double.
It covers invite-only signup into the default Company, bootstrapped Owner
onboarding, reload recovery, failure retry, Ready-to-Home transition, pre-active
Home/Room request blocking, and Executor reconnect/revoke.

These are desktop renderer-boundary smokes. The onboarding suite validates the
production browser artifact and its real request behavior, but its backend is a
controlled protocol implementation. It does not claim to validate Better Auth,
PostgreSQL, Docker, Controller, HomeClient, or RoomClient service internals;
those remain the real-service integration suites.
