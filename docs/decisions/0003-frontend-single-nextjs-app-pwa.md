# ADR 0003: One Next.js 16 app with worker / supervisor / hse route groups; worker view is an installable PWA

- **Status:** Accepted (Ali, 2026-11-11). Detailed planning belongs to the frontend architect (F1/F2).
- **Evidence:** `docs/research/2026-11-11-frontend-platform.md` §0, §1.4, §1.5, §3, §4, §7

## Context
Three audiences (workers, supervisors, HSE/regulator) must be served by one developer in nine days. App stores are not reachable in time (Play: 12 testers x 14 days for new personal accounts; Apple enrolment and push credentials). Judges open a prototype link.

## Decision
- **One Next.js 16 app** (`frontend/`, pnpm) with route groups **worker**, **supervisor**, **hse**. Shared tokens, i18n, auth and generated API types.
- **The worker route group is an installable PWA** using **`@serwist/turbopack` 9.5.13** (Turbopack is Next 16's default and `next build` fails if a webpack config exists). Fallback: the hand-written push service worker from Next's PWA guide, plus `--webpack` if needed.
- **No native app** for the demo.
- **Pins from the research:** Next 16.4.6, React 19.3.1, **TypeScript 6.0.3** (not 7.0.2: no TS 7 API, typescript-eslint peers `<6.1.0`), **ESLint 9.39.5** (not 10: `eslint-plugin-jsx-a11y` 6.10.2 peers `^9`), Node 24.22.2 LTS. `middleware.ts` is `proxy.ts` in Next 16 (nodejs runtime).
- **Contract:** FastAPI serves `/openapi.json`; the frontend generates its TypeScript client with `openapi-typescript`. Routes are under `/api/v1`; errors are RFC 9457 `application/problem+json`.

## Consequences
- Backend schemas are the single source of truth: a backend schema change is a frontend type change at the next generation, which CI catches.
- The worker route group carries no charts or maps (route JS budget; recharts alone is about 150 KB gzip upper bound).
- Offline behaviour must be tested against `next build && next start`, not `next dev`.
- iOS is best-effort (no `beforeinstallprompt`; push only for Home Screen apps on iOS 16.4+).

## Rejected options
| Option | Why rejected |
|---|---|
| Expo / React Native, or web + native | Store timelines; doubles the surface; background gains unproven |
| `next-pwa`, `@ducanh2912/next-pwa` | Unmaintained / superseded by Serwist |
| `@serwist/next` (webpack plugin) as default | Needs webpack; kept as fallback |
| Static export | Loses RSC and the BFF |
| TypeScript 7.0.2, ESLint 10 | Tooling incompatibility above |

## Revisit trigger
typescript-eslint ships TS 7 support; jsx-a11y allows ESLint 10; Serwist 10 leaves preview; a pilot proves it needs background execution (native wrapper ADR).
