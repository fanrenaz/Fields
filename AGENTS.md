# Repository Agent Guide

This is the shared entry point for work in the canonical Fields product tree.
Keep it limited to repository-wide rules, source-of-truth order, and context
routing.

## First Constraint

严禁擅自做任何未经人类批准的技术选型或者架构改变。

## Universal Rules

- Keep changes scoped to the human request and approved product semantics.
- Do not revert, overwrite, or reformat human or other-agent work unless asked.
- Do not add long-lived task guides or repository-memory substitutes unless a
  human explicitly requests them.
- Prefer proven libraries that fit the approved stack. New dependencies,
  technology choices, service boundaries, or architecture changes require
  explicit human approval.
- Do not add explanatory captions, eyebrow copy, meta subtitles, or
  instructional UI microcopy unless a human requests it.
- 我们有观测设施，所以在排障时可以优先查看日志，而不是做静态分析。当然，这也意味着在添加新的代码时，也要注意观测日志的覆盖。

## Canonical Product Shape

```text
contracts/      public product and explicitly internal runtime contracts
backend/        Product API, PostgreSQL persistence, and Company Runtime controller
frontend/       shared product frontend, Windows Electron shell, and mobile PWA
gateway/        public API proxy, scoped PWA files, health routes, and desktop download page
company-runtime/ single-Company data plane, Member workspaces, Agent runtime, and Executor credential authority
compose.prod.yaml  canonical production deployment
compose.dev.yaml   canonical local development environment
```

- Room is the collaborative product entry point; Home is the personal Agent
  workspace.
- Backend owns control-plane product facts, Room messages, execution records,
  cascades, cursors, and Agent-Room Thread mappings. Company Runtime owns
  Member workspace data, Room files, Codex App Servers, and runtime behavior.
- `contracts/` is the protocol source of truth. Public Backend routes and
  browser state use provider-neutral contracts only. Credential-bearing
  Runtime contracts are available only from explicit internal subpaths.
- Raw provider payloads may be parsed transiently only inside the Backend Agent
  Activity anti-corruption boundary. They must not enter public routes,
  persistence, or browser state.
- Company Runtime is the Company Executor credential authority. Canonical
  credentials and refresh tokens must not be copied to Backend, Member
  workspaces, or browser-visible state. Member `workspace/.codex` directories
  must never contain `auth.json`.
- Do not introduce DDD layers, a JavaScript workspace, or cross-package shared
  abstractions without human approval.

## Production Builds

- Use `scripts/publish-production-images-local.sh` for incremental image build,
  full Smoke, push, promotion, and deployment dispatch.
- Desktop JavaScript ships as a signed, content-addressed Runtime. The local
  publisher builds its deterministic candidate; GitHub signs and publishes it,
  and promotes `stable` only after the exact-SHA production deployment succeeds.
- Shell-only changes still bump `frontend/package.json` and use the exact-SHA
  `.github/workflows/publish-desktop.yml` Windows packaging job. Windows
  packaging is GitHub-only.
- Shared manifests, Contracts, and the workspace lockfile are classified with
  target-specific source and dependency fingerprints; do not replace this with
  whole-file rebuild fallbacks.
- Do not run builds or publication unless a human explicitly requests it.
  Never package Windows locally or prune shared BuildKit cache. The local
  publisher may retain its repository-scoped recovery builder after failure
  and must remove that builder after a successful exact-SHA deployment.

## Test Discipline

- Unit and narrow contract tests may use fakes. Integration tests must exercise
  the real PostgreSQL, Docker, Company Runtime, object storage, or other
  backing service prepared in `conn-test`.
- Integration tests require an explicit opt-in flag. Missing credentials may
  produce an explicit skip, but must never silently select an in-memory or fake
  path.
- Run local non-build checks from the affected package. Build validation belongs
  in the local production publisher or the Windows workflow.
- Run package tests and typechecks for every affected package when they do not
  invoke a build as a prerequisite. The empty-database Compose smoke is part of
  image publication and is required only for database migrations, Docker build
  contexts or images, Compose
  service/network/volume/secret/environment wiring, or cross-package package
  exports/import resolution. A contract or source-behavior change alone
  requires targeted contract and package checks, not a full Compose rebuild.
- 除非人类要求，否则不要运行playwright测试.

## Source Of Truth

Read in this order:

1. This file for repository rules.
2. Root `README.md` for the current product/runtime map.
3. `contracts/src/` for public and internal wire interfaces.
4. The affected package README and implementation.

Strategy and brainstorm documents provide context but do not override current
contracts or approved implementation behavior.
