# Build with the repository root as the Docker context.
FROM node:22-alpine AS toolchain

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

FROM toolchain AS dependencies

WORKDIR /build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contracts/package.json ./contracts/package.json
COPY backend/package.json ./backend/package.json
COPY company-runtime/package.json ./company-runtime/package.json
COPY tools/eslint-config/package.json ./tools/eslint-config/package.json
RUN --mount=type=cache,id=fields-backend-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store \
  --filter @fields/backend... \
  --filter @fields/company-runtime...

FROM dependencies AS contracts-build

COPY contracts/tsconfig.json contracts/tsconfig.build.json ./contracts/
COPY contracts/src/ ./contracts/src/
RUN pnpm --filter @fields/contracts run build

FROM contracts-build AS backend-build

COPY backend/tsconfig.json backend/tsconfig.build.json backend/drizzle.config.ts ./backend/
COPY backend/src/ ./backend/src/
COPY backend/drizzle/ ./backend/drizzle/
RUN pnpm --filter @fields/backend run build

FROM contracts-build AS company-runtime-build

COPY company-runtime/tsconfig.json company-runtime/tsconfig.build.json ./company-runtime/
COPY company-runtime/src/ ./company-runtime/src/
RUN pnpm --filter @fields/company-runtime run build

FROM toolchain AS production-workspace

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contracts/package.json ./contracts/package.json
COPY backend/package.json ./backend/package.json
COPY company-runtime/package.json ./company-runtime/package.json
COPY tools/eslint-config/package.json ./tools/eslint-config/package.json
COPY --from=contracts-build /build/contracts/dist ./contracts/dist
COPY --from=backend-build /build/backend/dist ./backend/dist
COPY --from=backend-build /build/backend/drizzle ./backend/drizzle
COPY --from=backend-build /build/backend/drizzle.config.ts ./backend/drizzle.config.ts
COPY --from=backend-build /build/backend/src ./backend/src
COPY --from=company-runtime-build /build/company-runtime/dist ./company-runtime/dist
COPY company-runtime/fields-plugin-template/ ./company-runtime/fields-plugin-template/
RUN --mount=type=cache,id=fields-backend-pnpm-store,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile --offline --store-dir=/pnpm/store \
  --filter @fields/backend... \
  --filter @fields/company-runtime...
RUN set -eu; \
  for link in \
    /app/backend/node_modules/@fields/contracts \
    /app/company-runtime/node_modules/@fields/contracts; do \
    if [ ! -L "$link" ]; then \
      echo "Required workspace link is missing: $link" >&2; \
      exit 1; \
    fi; \
    target="$(readlink -f "$link")"; \
    case "$target" in \
      /app/contracts|/app/contracts/*) ;; \
      *) echo "Workspace link has an invalid target: $link -> $target" >&2; exit 1 ;; \
    esac; \
  done

FROM node:22-alpine AS runtime

RUN apk add --no-cache git openssh-client tini
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /app
COPY --from=production-workspace /app/ ./
WORKDIR /app/backend

ENV NODE_ENV=production
ENV PATH=/app/company-runtime/node_modules/.bin:/app/backend/node_modules/.bin:${PATH}

EXPOSE 4102 4103 4104 4110

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "./dist/observability/bootstrap.js", "dist/index.js"]
