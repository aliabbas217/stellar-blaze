# syntax=docker/dockerfile:1

FROM node:24.22.2-trixie-slim AS build
WORKDIR /app
RUN npm i -g pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# NEXT_PUBLIC_SB_DEMO is inlined into the client bundle by `next build`, so it can only be set here, in the stage that builds
# (it is not a runtime variable, and ARG and ENV do not cross stages). Empty or unset is DEMO mode, the safe default: the unwell
# sheet's calls show their number and say "Demo: this would call ..." instead of dialling, so a build that forgot the flag can
# never ring a real number. A real deployment must pass `--build-arg NEXT_PUBLIC_SB_DEMO=0`; only exactly "0" turns demo off
# (src/features/demo/constants.ts, README "The demo switch").
ARG NEXT_PUBLIC_SB_DEMO=
ENV NEXT_PUBLIC_SB_DEMO=${NEXT_PUBLIC_SB_DEMO}
RUN pnpm build

FROM node:24.22.2-trixie-slim AS runtime
WORKDIR /app
# ARG and ENV do not cross stages: APP_VERSION must be set here for GET /api/healthz to report it at request time.
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 APP_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
