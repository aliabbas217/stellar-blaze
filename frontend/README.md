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
| `DEMO_WRITE_RATE_PER_MIN`, `DEMO_WRITE_GLOBAL_RATE_PER_MIN` | the BFF proxy (`route.ts`, `rate-limit.ts`) | Writes per minute allowed per client (default 20) and over all clients (default 60, the API's own ceiling of 60 per 60 s per token) for sign-off, data requests and demo reset. Over either: 429 `application/problem+json` with `Retry-After`. Per process; each replica keeps its own buckets. An invalid or zero value is the default |
| `DEMO_STOP_RATE_PER_MIN`, `DEMO_STOP_GLOBAL_RATE_PER_MIN` | the BFF proxy | The same, for Stop work (create and clear a stop) only, in buckets the other writes cannot drain: per client default 30, global default 60 (the API's ceiling; a higher number could never be used). A 429 on a stop is a safety failure: the screen must say it was not sent and to tell the crew now |
| `TRUSTED_PROXY_HOPS` | the BFF proxy (`rate-limit.ts`) | How many reverse proxies in front of the app append to `x-forwarded-for` (default 1: the platform ingress). The per-client bucket is keyed on the entry that many from the right, because earlier entries are whatever the caller wrote; with 2 (a CDN and an ingress) it is the second from the right. 0 trusts none and puts every caller in one bucket; a header shorter than the hops does the same. Wrong in either direction weakens only the per-client bucket; the global bucket holds regardless |

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
  | empty` selects a failure, a stale forecast or an empty result (forwarded only outside production, or with
  `SB_MOCK_SCENARIOS=1`).
- Layout classes are logical only (`ms-*`, `pe-*`, `text-start`); a test rejects `ml-*`, `left-*` and friends
  everywhere except `src/components/ui`.

`AGENTS.md` is written by `next dev` (Next.js agent instructions) and is committed on purpose; see
`node_modules/next/dist/docs/` for the documentation that matches the installed version.
