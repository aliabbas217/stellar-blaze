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
| `pnpm e2e` | Playwright (`tests/e2e`: PWA, Alerts, data removal, axe) in `mobile-chromium` and `desktop-chromium`, against the production build. Run `pnpm build` first and `pnpm exec playwright install chromium` once. It starts and stops the mock API and the standalone server itself (`playwright.config.ts`), so ports 3000 and 4010 must be free. One worker, because the push tests share the OS notification centre |
| `pnpm exec lhci autorun` | Lighthouse CI (`lighthouserc.json`): `/en/worker` and `/en/worker/alerts`, 3 mobile runs each, against the performance, accessibility, LCP, CLS, TBT and 170 KB script budgets. Run `pnpm build` first; it starts and stops the same stack through `scripts/serve-stack.mjs`. Reports go to `.lighthouseci/` |
| `pnpm design:lint` | Lints `../DESIGN.md`; any warning fails |
| `pnpm api:gen` | Regenerates `src/api/schema.d.ts` from `openapi/stellar-blaze.mock.openapi.json` |
| `pnpm api:check` | `api:gen`, then fails if `schema.d.ts` differs from the committed file (it needs the file to be tracked: an untracked one passes) |
| `pnpm mock:api` | The MSW handlers behind <http://127.0.0.1:4010> (the mock API; used by e2e and Lighthouse CI). Ctrl+C stops it |

## Where things live

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
- `src/mocks/`: the fixtures and MSW handlers for the contract proposal in `openapi/`. Vitest starts them for every
  test (`tests/setup-msw.ts`); `pnpm mock:api` serves them over HTTP. A request header `x-sb-mock-scenario: error | stale
  | empty` selects a failure, a stale forecast or an empty result (forwarded only outside production, or with
  `SB_MOCK_SCENARIOS=1`).
- Layout classes are logical only (`ms-*`, `pe-*`, `text-start`); a test rejects `ml-*`, `left-*` and friends
  everywhere except `src/components/ui`.

`AGENTS.md` is written by `next dev` (Next.js agent instructions) and is committed on purpose; see
`node_modules/next/dist/docs/` for the documentation that matches the installed version.
