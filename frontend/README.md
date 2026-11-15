# Stellar Blaze frontend

Heat-stress safety app for outdoor workers in the UAE: Next.js 16 (App Router, Turbopack), React 19,
TypeScript 6, Tailwind CSS 4. Six languages (`en` default, `ar`, `ur`, `hi`, `bn`, `ne`; `ar` and `ur` are
right-to-left). The visual identity is "Arish Signal"; its rationale is `../DESIGN.md` and its values are
`src/styles/tokens.css`.

## Setup

Requires Node 24.22.2 (`.nvmrc`) and pnpm 12.18.0 (pinned in `package.json` as `packageManager`).

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. `/` redirects to the language of the browser (default `/en`). The token and
type specimen is at `/en/dev/specimen` (any language prefix works; it returns 404 in a production build unless
`SB_SPECIMEN=1`).

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build (`output: "standalone"`) |
| `pnpm start` | `next start`. It warns because the build is standalone; the Docker image runs `node server.js` |
| `pnpm start:standalone` | Runs the standalone build as the Docker image does (`node .next/standalone/server.js`, with `public/` and `.next/static` copied in). Needs `pnpm build` first; configured by `PORT`, `HOSTNAME`, `API_ORIGIN`, `VAPID_PUBLIC_KEY` |
| `pnpm lint` | `next typegen`, then ESLint with zero warnings allowed |
| `pnpm typecheck` | `next typegen`, then `tsc --noEmit` |
| `pnpm test` | Vitest unit tests (`tests/unit`) |
| `pnpm e2e` | Playwright (`tests/e2e`: PWA, Alerts, data removal, security headers, axe) in `mobile-chromium` and `desktop-chromium`, against the production build. Run `pnpm build` first and `pnpm exec playwright install chromium` once. It starts and stops the mock API and the standalone server itself (`playwright.config.ts`), so ports 3000 and 4010 must be free. One worker, because the push tests share the OS notification centre |
| `pnpm exec lhci autorun` | Lighthouse CI (`lighthouserc.json`): `/en/worker` and `/en/worker/alerts`, 3 mobile runs each, against the performance, accessibility, LCP, CLS, TBT and 170 KB script budgets. Run `pnpm build` first; it starts and stops the same stack through `scripts/serve-stack.mjs`. Reports go to `.lighthouseci/` |
| `pnpm design:lint` | Lints `../DESIGN.md`; any warning fails |
| `pnpm api:gen` | Regenerates `src/api/schema.d.ts` from `openapi/stellar-blaze.openapi.json` |
| `pnpm api:check` | `api:gen`, then fails if `schema.d.ts` differs from the committed file (it needs the file to be tracked: an untracked one passes) |
| `pnpm mock:api` | The MSW handlers behind <http://127.0.0.1:4010> (the mock API; used by e2e and Lighthouse CI). Ctrl+C stops it |
| `pnpm e2e:live` | The `live` Playwright project (`tests/e2e/live`) against a REAL B3 backend in replay mode, not the mock. It never starts the backend; with `E2E_API_ORIGIN` unset every spec skips with a message. See "Running F2 against the real B3" below |

## Running F2 against the real B3

MSW (`pnpm mock:api`) stays the default backend for `pnpm dev`, `pnpm e2e` and Lighthouse CI. The `live` project runs a few
specs against the real B3 backend in replay mode, to prove the app reads what the API really serves: the worker's Today level
equals the `site_level` of the forecast hour the replay clock is in, the alert card names it, and the governance refusal is
answered 403 and written to the log. Every site id, date and level in those specs comes from the API's own answers.

**This repository never starts B3.** The operator starts it (a Postgres database, the commands below, run in B3's own checkout:
branch `feat/b3-warnings-planner`, `backend/`), runs the specs, and stops it:

1. Database and demo site: `SB_DATABASE_URL=<postgres url> uv run sb-jobs db upgrade`, then
   `uv run sb-jobs site load backend/fixtures/demo_site.toml --actor <actor> --reason <reason>`.
2. A replay snapshot under `SB_REPLAY_DIR` (default `replay/`), built with `uv run sb-jobs replay build --summer <year> --station OMAA --snapshot-id <id>`;
   the directory is empty in a fresh checkout.
3. API environment: `SB_FORECAST_SOURCE=replay`, `SB_REPLAY_SNAPSHOT_ID=<id>`, `SB_REPLAY_DEFAULT_DATE=2025-07-10`,
   `SB_ACCESS_TOKENS` as JSON `{"<sha256 of the token>": {"actor": "...", "role": "employer", "employer_id": "emp-demo"}}`.
   The replay clock starts at `SB_REPLAY_NOW` when set, else the replay date at 11:10 Asia/Dubai, and runs at real speed. 11:10 is crew B's midday
   break, so for a live stop set `SB_REPLAY_NOW` near 10:10 at the site.
4. Serve it: `uv run uvicorn stellar_blaze.api.app:create_app --factory --port 8000`.

Then, here, from `frontend/` (a production build first, `pnpm build`; the token is the plain bearer whose SHA-256 is in `SB_ACCESS_TOKENS`):

```sh
E2E_API_ORIGIN=http://127.0.0.1:8000 E2E_DEMO_EMPLOYER_TOKEN=<token> pnpm e2e:live
```

| Variable | What it is |
|---|---|
| `E2E_API_ORIGIN` | The running B3's origin, no path. Unset: every live spec skips with "Live project skipped: E2E_API_ORIGIN is not set" |
| `E2E_DEMO_EMPLOYER_TOKEN` | The employer token the web server's BFF holds (`DEMO_EMPLOYER_TOKEN` there); never printed. Unset: the specs that need it skip |

`pnpm e2e:live` starts only the web server, wired to that origin, with no mock switch (`SB_MOCK_SCENARIOS` is forced off, so no
`x-sb-mock-scenario` header reaches the real API) and the BFF's real write limits. Ports: 3000 must be free. The run records,
as annotations in the report, whether the app drew the replay forecast as live or as last known (its three-hour freshness rule
compares the forecast's `generated_at` with the replay clock). A plain `pnpm e2e` never runs this project.

## Runtime configuration

One image serves every environment, so what differs between them is the container's environment, which the server
reads while it runs. None of it is `NEXT_PUBLIC_*`: Next.js inlines those at `next build` and would freeze them into the
image (ADR 0009). These variables are wiring only; tunable values (bands, lead times, live flags) come from the API
(ADR 0010).

| Variable | Read by | What it is |
|---|---|---|
| `API_ORIGIN` | the BFF proxy (`src/app/api/v1/[...path]/route.ts`), `serverApiClient()` (`src/api/server-client.ts`) | The backend API's origin, for example `http://api:8000`. Required: unset, the proxy answers 502 `application/problem+json` and `serverApiClient()` throws. The browser never calls it; it calls same-origin `/api/v1/*` |
| `VAPID_PUBLIC_KEY` | the Alerts page (`src/app/[locale]/(worker)/worker/alerts/page.tsx`) | The Web Push application server key, public half only, base64url. Unset, the page logs an error and cannot turn alerts on; the rest of the app is unaffected |
| `APP_VERSION` | `GET /api/healthz` (returns it as `version`, `dev` when unset) | The release id, which the Dockerfile takes as `ARG APP_VERSION` and sets in the runtime stage. The build also uses it, when set, as the revision of the offline pages the service worker precaches (`src/app/serwist/[path]/route.ts`); unset, each build gets a random one |
| `PORT`, `HOSTNAME` | the standalone server (`server.js`) | Where it listens. The Dockerfile sets `3000` and `0.0.0.0` |
| `DEMO_EMPLOYER_TOKEN` | the BFF proxy (`route.ts`, `employer-auth.ts`) | The demo employer token. A **secret**: a container secret, never `NEXT_PUBLIC_*`, never logged, never sent to the browser. The BFF attaches it as `Authorization: Bearer` only on the allow-listed method and path pairs of the synthetic demo fixture (day plan, sign-off, stops, data requests, demo reset) and strips any client `Authorization`. Unset, those routes reach the API without a token and it answers 401 |
| `DEMO_WRITE_RATE_PER_MIN`, `DEMO_WRITE_GLOBAL_RATE_PER_MIN` | the BFF proxy (`route.ts`, `rate-limit.ts`) | The **general** class: every token-bearing request except Stop work (day-plan reads, sign-off, data requests, demo reset). Requests allowed per client (default 20) and over all clients (default 40) in any sliding window of 61 s (the upstream's 60 s plus a 1 s margin; the counter is exact, never more than N in any window). Over either: 429 `application/problem+json` with `Retry-After`. Settings can only lower the defaults: the global is clamped to 40 and the per-client value to the global. Per process; each replica keeps its own counters. A blank, invalid or zero value is the default |
| `DEMO_STOP_RATE_PER_MIN`, `DEMO_STOP_GLOBAL_RATE_PER_MIN` | the BFF proxy | The **stop** class, Stop work only (create and clear a stop): a reserve nothing else draws on, counted the same way. Per client default 10, global default 20; clamped the same way (global at most 20, per-client at most the global, so the per-client limit never exceeds the reserve). A 429 on a stop is a safety failure: the screen must say it was not sent and to tell the crew now |
| `TRUSTED_PROXY_HOPS` | the BFF proxy (`rate-limit.ts`) | How many reverse proxies in front of the app append to `x-forwarded-for` (default 1: the platform ingress). The per-client bucket is keyed on the entry that many from the right, because earlier entries are whatever the caller wrote; with 2 (a CDN and an ingress) it is the second from the right. 0 trusts none and puts every caller in one bucket; a header shorter than the hops does the same. Wrong in either direction weakens only the per-client bucket; the global bucket holds regardless |

**The demo switch is a build-time setting, not a runtime one.** `NEXT_PUBLIC_SB_DEMO` is the one `NEXT_PUBLIC_*` variable, read by
`isDemoMode()` (`src/features/demo/constants.ts`) and inlined by `next build`. A missing variable means **demo mode** (so a build that
forgot the flag can never dial a synthetic number); demo is off only when it is exactly `0`, so a real deployment must build with
`NEXT_PUBLIC_SB_DEMO=0`. The Dockerfile takes it as a build argument of the build stage (`ARG NEXT_PUBLIC_SB_DEMO`, default empty, which is demo
mode), because Next inlines it while `pnpm build` runs and ARG and ENV do not cross stages: a real image is built with
`docker build --build-arg NEXT_PUBLIC_SB_DEMO=0 ...`, and an image built without the argument is a demo image (the unwell sheet's calls
confirm instead of dialling).

**Invariant: no rate limit on another operation may block the safety path (stop work, the unwell call actions).** The
API limits employer operations to 60 per 60 s per token (`x-rate-limit` in `openapi/stellar-blaze.openapi.json`) and does
not say whether that is one quota per operation or one for all; the demo has one shared token, so the BFF assumes the
worse reading. Its two classes therefore add up to that quota: 20 reserved for Stop work and 40 for everything else that
carries the token, the day-plan GET included. Each limit is an exact sliding-window counter (not a token bucket, which
can admit up to twice its size in one window), so in ANY 60 s window the two together admit at most 60 requests upstream,
and general traffic is refused by the BFF's own 429 once its 40 are spent; a stop is refused only by its own reserve.
`tests/unit/api/rate-limit.test.ts` reads the quota from the contract, drives every limit flat out on an injected clock
for 3 minutes and fails if more than the quota is admitted in any 60 s window, or if the defaults, or any value the
environment could set (they are clamped), add up to more. demo-reset has a tighter limit of its own upstream (1 per 60 s,
10 an hour); the BFF passes upstream's 429 and `Retry-After` through. The unwell call actions (D6) are one-tap calls to the
site's numbers, not API operations, so no limit here applies to them.

The deployment sets `API_ORIGIN`, `VAPID_PUBLIC_KEY` and `APP_VERSION` (and, for the public demo, the secret `DEMO_EMPLOYER_TOKEN` and `TRUSTED_PROXY_HOPS`) on the `web` container app and gates a release
on `GET /api/healthz`, which answers on port 3000 and is never under the proxied `/api/v1`.

## Where things live

- `next.config.ts`: the security headers of every response except the hashed build output (CSP, `Referrer-Policy`,
  `X-Content-Type-Options`, `Permissions-Policy`); `tests/e2e/headers.spec.ts` pins the exact values. The CSP allows
  only the same origin, plus inline scripts and styles until nonces are wired (parked, trigger "before any pilot"), so a
  new third-party script, font host, image host or API origin needs a change there first. `next dev` adds
  `'unsafe-eval'` to `script-src`, as the Next.js CSP guide requires; a production build never has it.
- `messages/*.json`: every user-visible string. `en` is the source; the other five are machine drafts
  (`_meta.review_status`) and show a "Draft translation" badge. A unit test keeps all six in step (same keys,
  same placeholders, Western digits only).
- `src/i18n/`: routing, request config, navigation helpers, text direction. `src/proxy.ts` negotiates the locale.
- `src/app/[locale]/layout.tsx`: the root layout; it owns `<html lang dir>`. `src/app/fonts.ts` holds the per-script fonts.
- `src/styles/`: `tokens.css` (the only place with colour, size and duration values) and `globals.css` (Tailwind
  names for them, plus the adapter that maps the shadcn/ui components onto the tokens).
- `src/components/ui/`: shadcn/ui (Base UI, `rtl: true`) with a few documented local edits
  (`grep -rn "Local edit" src/components/ui`).
- `src/api/`: the typed API client (`apiClient` for the browser, `serverApiClient()` for server code), `call()` (turns a
  response into a `Result`), `problem.ts` (`application/problem+json`) and the generated `schema.d.ts`. The browser calls
  only same-origin `/api/v1/*`; `src/app/api/v1/[...path]/route.ts` forwards it to `API_ORIGIN`.
- `src/mocks/`: the canned fixtures and MSW handlers for the contract in `openapi/` (B3's v1, copied unedited from `backend/openapi/v1.json`). Vitest starts them for every
  test (`tests/setup-msw.ts`); `pnpm mock:api` serves them over HTTP. A request header `x-sb-mock-scenario: error | stale
  | empty | fallback | suppressed` selects a failure, a stale forecast, an empty result, a missing forecast (the protective
  fallback) or every crew below k (forwarded only outside production, or with `SB_MOCK_SCENARIOS=1`).
- Layout classes are logical only (`ms-*`, `pe-*`, `text-start`); a test rejects `ml-*`, `left-*` and friends
  everywhere except `src/components/ui`.

`AGENTS.md` is written by `next dev` (Next.js agent instructions) and is committed on purpose; see
`node_modules/next/dist/docs/` for the documentation that matches the installed version.
