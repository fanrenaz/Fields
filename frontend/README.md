# Fields Desktop

The Room-first Fields desktop client uses a Vite + React 19 renderer inside Electron.
It uses Lobe UI Chat primitives for the conversation surface and Ant Design
with antd-style for product controls, panels, and themes.

`pnpm --filter @fields/frontend run dev` serves the hot-reload renderer simulation on
`0.0.0.0:3103`. Public renderer configuration is limited to the documented
`VITE_FIELDS_*` values in `shared/config/runtime.ts`.

Vite writes the packaged static interface to `artifacts/renderer`. Electron
packages that directory behind its local HTTPS protocol. The Electron renderer remains sandboxed;
product API, Home, and Room traffic continue to use their established online
ownership boundaries.

Run focused lint, test, and type checks from this package when needed. Renderer
and desktop artifacts are built only by the remote release workflow;
do not run package, desktop, Docker, or image build commands locally.
