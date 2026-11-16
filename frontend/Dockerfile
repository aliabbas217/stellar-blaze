# syntax=docker/dockerfile:1

# Node 24.22.3 (2026-11-11) is a security release (http2 and tls, HIGH). The digest pins the exact image: a tag moves, a digest does not.
# Looked up 2026-11-16 with `docker buildx imagetools inspect node:24.22.3-trixie-slim` (the multi-platform index digest).
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS build
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
# The release id for the BUILD too: the offline pages' precache revision (src/app/serwist/[path]/route.ts) is `APP_VERSION ||
# crypto.randomUUID()` at build time, so without it every build of one release gets its own revision and a visitor re-downloads the
# offline shell for nothing. Empty or unset keeps the random revision. (The runtime stage below has its own ARG: ARG and ENV do not
# cross stages.)
ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}
RUN pnpm build

FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS runtime
WORKDIR /app
# The runtime runs `node server.js` and nothing else. The base image's package managers (npm, corepack, yarn) are not needed and carry
# their own bundled dependencies: npm's brace-expansion and undici were every HIGH finding of the first trivy scan of this image
# (usr/local/lib/node_modules/npm/node_modules/{brace-expansion,undici}). The build stage keeps npm: it installs pnpm.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-v1.22.22 /usr/local/bin/yarn /usr/local/bin/yarnpkg
# ARG and ENV do not cross stages: APP_VERSION must be set here for GET /api/healthz to report it at request time.
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 APP_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
