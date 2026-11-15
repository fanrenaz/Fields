FROM node:22-alpine AS build

RUN apk add --no-cache cmake g++ make boost-dev openssl-dev
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contracts/package.json ./contracts/package.json
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY company-runtime/package.json ./company-runtime/package.json
COPY tools/eslint-config/package.json ./tools/eslint-config/package.json
COPY embodiments/simulator/package.json ./embodiments/simulator/package.json
RUN pnpm install --ignore-scripts --frozen-lockfile --filter @sticks3-call/simulator...

COPY contracts ./contracts
RUN pnpm --filter @fields/contracts run build

COPY embodiments/simulator ./embodiments/simulator
COPY embodiments/simulator/native/src/lv_conf.h ./embodiments/simulator/native/src/lv_conf.h
COPY embodiments/simulator/third_party/lv_m5_emulator ./embodiments/simulator/third_party/lv_m5_emulator
COPY embodiments/simulator/third_party/lvgl ./embodiments/simulator/third_party/lvgl
COPY embodiments/firmware/StickS3_Call/src/terminal_core ./embodiments/firmware/StickS3_Call/src/terminal_core
COPY embodiments/firmware/StickS3_Call/src/firmware_app ./embodiments/firmware/StickS3_Call/src/firmware_app
COPY embodiments/firmware/StickS3_Call/src/terminal_ui ./embodiments/firmware/StickS3_Call/src/terminal_ui
COPY embodiments/firmware/StickS3_Call/third_party/ArduinoJson ./embodiments/firmware/StickS3_Call/third_party/ArduinoJson
COPY embodiments/firmware/StickS3_Call/third_party/M5GFX ./embodiments/firmware/StickS3_Call/third_party/M5GFX
RUN cmake -S ./embodiments/simulator/native -B /tmp/sticks3-pc-runner-build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build /tmp/sticks3-pc-runner-build --parallel \
 && ctest --test-dir /tmp/sticks3-pc-runner-build --output-on-failure
RUN pnpm --filter @sticks3-call/simulator run build

FROM node:22-alpine

ENV NODE_ENV=production
ENV STICKS3_PC_RUNNER_PATH=/usr/local/bin/sticks3-pc-runner
RUN apk add --no-cache libstdc++ openssl boost-json boost-system
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /app/embodiments/simulator

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml /app/
COPY contracts/package.json /app/contracts/package.json
COPY backend/package.json /app/backend/package.json
COPY frontend/package.json /app/frontend/package.json
COPY company-runtime/package.json /app/company-runtime/package.json
COPY tools/eslint-config/package.json /app/tools/eslint-config/package.json
COPY embodiments/simulator/package.json /app/embodiments/simulator/package.json
COPY --from=build /app/contracts/dist /app/contracts/dist
WORKDIR /app
RUN pnpm install --prod --frozen-lockfile --filter @sticks3-call/simulator...
WORKDIR /app/embodiments/simulator

COPY --from=build --chown=node:node /app/embodiments/simulator/dist ./dist
COPY --from=build /tmp/sticks3-pc-runner-build/sticks3-pc-runner /usr/local/bin/sticks3-pc-runner
RUN mkdir -p /home/node/.fields/sticks3-call && chown -R node:node /home/node/.fields

USER node
EXPOSE 8790
CMD ["node", "dist/pc-server.js"]
