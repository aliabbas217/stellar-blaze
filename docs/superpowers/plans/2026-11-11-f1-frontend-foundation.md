# F1 Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `frontend/` foundation of Stellar Blaze: a Next.js 16 app with `worker` / `supervisor` / `hse` route groups. It has a named visual direction with tokens, six locales (two of them RTL), an installable worker PWA with offline fallback and Web Push subscription, a typed API client generated from a mock OpenAPI contract and served by MSW, the worker "Today" screen and the supervisor crew-timeline skeleton (all four states each), tests, and the `frontend` CI job. It also contains Ali's real-phone Web Push spike (Task 15).

**Architecture:** One Next.js 16.4.6 App Router app under `frontend/src/app/[locale]/` with route groups `(worker)/worker`, `(supervisor)/supervisor`, `(hse)/hse`. The browser calls only same-origin `/api/v1/*`, which a route-handler proxy forwards to `API_ORIGIN` (the FastAPI app). Server Components call `API_ORIGIN` directly. All API types come from `openapi-typescript`. Until B3 Task 0 publishes `/openapi.json` (14 Nov), the source is `frontend/openapi/stellar-blaze.mock.openapi.json`, served in tests and e2e by MSW handlers. Personal risk is computed on the device from the cached site forecast and a locally held profile (ADR 0004 Tier B). The server receives only a pseudonymous push subscription bound to a site.

**Tech Stack:** Node 24.22.2 · pnpm 12.18.0 · Next 16.4.6 (Turbopack) · React 19.3.1 · TypeScript 6.0.3 · ESLint 9.39.5 + eslint-config-next 16.4.6 + typescript-eslint 8.72.2 · Tailwind 4.3.5 · shadcn CLI 4.23.0 (Base UI 1.9.0, RTL) · next-intl 4.14.10 · @serwist/turbopack 9.5.13 + serwist 9.5.13 + esbuild 0.28.2 · @tanstack/react-query 5.107.1 · zod 4.6.7 · react-hook-form 7.91.0 + @hookform/resolvers 7.0.5 · zustand 5.1.0 · openapi-typescript 7.13.0 + openapi-fetch 0.17.0 · msw 3.0.4 + @msw/serve 0.11.0 · Vitest 5.1.0 + jsdom 31.0.0 + Testing Library · Playwright 1.65.0 + @axe-core/playwright 4.14.0 · @lhci/cli 0.16.0 · @google/design.md 0.4.0 · web-push 4.0.0 (spike sender only).

**Spec:** `docs/decisions/0003-frontend-single-nextjs-app-pwa.md`, `docs/decisions/0004-tiered-alert-delivery.md`, `docs/decisions/0009-evolvability-configurability.md` (amended Global Constraints, Tasks 4, 5 and Execution on 2026-11-11), `docs/decisions/0010-runtime-tunable-configuration.md` (amended Global Constraints, Task 5 and Parked the same day), `docs/research/2026-11-11-frontend-platform.md` (§1.3, §4, §7, §8), `docs/context/challenge-07-plan.md` (§8.6, §8.8, §8.9, §8.11), `docs/superpowers/plans/2026-11-11-roadmap.md` (F1/F2 dates, coordination points). Executors read the spec files and this plan.

## Global Constraints

- **Pins (looked up on the npm registry 2026-11-11):** exactly the versions in Tech Stack. `typescript` is **6.0.3, not 7.0.2** (no TS 7 API; typescript-eslint peers `<6.1.0`). `eslint` is **9.39.5, not 10.x** (jsx-a11y 6.10.2 peers `^9`). `msw` is **3.0.4, not 3.0.5**: 3.0.5 was published today and pnpm 12's default `minimumReleaseAge` is 1440 minutes. `lucide-react` is **1.70.0** for the same reason (1.71.0 and 1.72.0 are less than 2 days old). Types: `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@types/node` 24.19.2. Exact versions, no `^`.
- **Supply chain:** `frontend/pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`. If pnpm refuses a pin because it is too new, take the previous patch release and record it in the task report. Never lower the setting.
- **Runtime:** `.nvmrc` = `24.22.2`; `package.json` `"engines": {"node": ">=24.22.2 <25"}`, `"packageManager": "pnpm@12.18.0"`.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. No `any`. No `@ts-ignore` / `@ts-expect-error` without a one-line justification.
- **Next 16:** `src/proxy.ts`, not `middleware.ts`. No webpack config anywhere (a webpack config makes `next build` fail). `output: "standalone"`.
- **Locales:** `en` (default), `ar` (RTL), `ur` (RTL), `hi`, `bn`, `ne`. `dir` comes from the static map `{ar: "rtl", ur: "rtl"}`. Times and temperatures always use Western digits (`numberingSystem: "latn"`) in every locale. Times render in the site's `timezone` (`Asia/Dubai` in the fixtures).
- **Copy:** no user-visible string outside `messages/*.json`. Only `en` is authored here. The other five files are machine drafts with `"_meta": {"review_status": "machine-draft"}`, and the UI shows a "Draft translation" badge for them. No safety-action wording is invented: action texts are keyed by `action_code` and stay placeholders flagged `"draft"` until the human-reviewed templates land (plan §8.6).
- **Governance (ADR 0004, plan §8.8):** the worker profile (workload class, heat-work start date, clothing option) lives only on the device. Personal risk is never sent to the server. The push subscription carries `site_id` and an optional `crew_id`, nothing about the worker. Supervisor views show crew aggregates only and honour `suppressed` (k-suppression). No screen offers or implies disciplinary use.
- **Closed-app limitation copy (ADR 0004, verbatim meaning, en):** "When the app is closed you get site and crew warnings only. Your personal risk shows when you open the app or tap a warning. It is worked out on this phone and never sent to the server."
- **Push payload (ADR 0002/0004):** `{"v":1,"audience":"site"|"crew","target_id":string,"level":"green"|"amber"|"orange"|"red","template_id":string,"valid_from":ISO-8601}` and nothing else. The SW renders localized text from its bundled strings.
- **Routes:** web health at `GET /api/healthz` (never under `/api/v1`, which is proxied). The browser never calls `API_ORIGIN` directly.
- **Design:** every colour, space, radius, font and duration comes from `src/styles/tokens.css`. No hex or oklch literals in TSX. No physical direction utilities (`ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`, `rounded-l-*`, `rounded-r-*`, `border-l-*`, `border-r-*`). Use logical ones (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`).
- **A11y:** WCAG 2.2 AA. Targets ≥ 44 px on the worker route group (gloved hands; design judgement above the 24 px floor). Level is never shown by colour alone: colour + pattern + pictogram + level numeral + text.
- **Budgets:** worker routes ≤ 170 KB gzip JS (checked by Lighthouse CI). No charting or map library in F1.
- **Git (executors):** Conventional Commits. Never `git stash`, `git reset`, `git rebase`, `git checkout -- <path>` or `--no-verify`. On an unexpected working tree, STOP and report. Stage only the files your task lists (`git add <paths>`, never `git add -A`). Backend subagents may be committing in parallel.
- **CI file is shared:** `.github/workflows/ci.yml` belongs to three owners. B1 creates it with job `backend`; this plan adds job `frontend`; I1 adds job `infra`. Edit only your own job block.
- **Evolvability (ADR 0009, amended 2026-11-11):** tokens and `messages/*.json` are the data layer of the UI; no literal outside them. Runtime flags are read on the server (RSC / route handlers, `process.env` at request time), **never** `NEXT_PUBLIC_*`: Next.js inlines those at `next build`, freezing them in the image. Action codes and template ids are owned by the backend ruleset (`backend/rulesets/*.toml`); `messages` only holds their words, keyed by code. `policy_version` and `RiskPolicy.version` carry the backend ruleset id. **ADR 0010 (amended 2026-11-11):** tunable values (bands, lead times, margins, live flags) come only from the API (`/api/v1/risk-policy`, later `/api/v1/config/active`), never from `process.env`. `process.env` holds wiring only (`API_ORIGIN`, `VAPID_PUBLIC_KEY`, `APP_VERSION`). Forecast and policy responses carry an integer `config_version`. The worker app computes personal risk only with a `RiskPolicy` whose `config_version` equals the forecast's; on a mismatch it refetches the policy. Offline, it uses the cached pair and shows both versions. The UI never parses either version.
- **Conventions win:** if a library's current docs contradict a step here, follow the docs, keep the interface named in the task, and say so in the task report.

## Review Focus

1. **Service worker scope.** The SW is served from `/serwist/sw.js`. If it registers with scope `/serwist/`, offline mode and push silently do nothing on `/en/worker`. Expected: `registration.scope === origin + "/"` and the page is controlled. Pinned by Task 6 e2e `sw controls the worker route`.
2. **Locale lost on the way back in.** An Urdu worker tapping a notification, or opening the app offline, must land on `/ur/...`, not `/en/...`. Pinned by Task 6 unit `fallbackUrlFor` and Task 7 unit `notificationTargetUrl`.
3. **Stale forecast shown as current.** A cached forecast from yesterday must not look live. Expected: a "Last updated …" banner when `generated_at` is older than 3 h, and no personal level when the hours do not cover "now". Pinned by Task 10 unit `freshness` and e2e `offline reload shows stale banner`.
4. **iPhone not installed / push unsupported / permission denied.** The Enable button must never throw. Expected: an install card on iOS Safari tabs, an explanation on denied, and nothing that blocks the rest of the screen. Pinned by Task 7 unit `pushCapability` cases and e2e `alerts page states`.
5. **RTL and Nastaliq layout.** In Urdu, Nastaliq glyphs clip in fixed-height boxes, and the shade band must flow in the reading direction. Expected: no fixed heights on text, band order follows `dir`, digits stay Western. Pinned by Task 3 unit `no physical direction classes`, Task 12 visual snapshots `ar` and `ur`, and Task 10 unit `latn digits in ar`.

---

## File Structure

```
DESIGN.md                                   # repo root (frontend-discipline rule 15)
docs/contracts/web-push.md                  # push contract for B3
docs/design/f1/                             # design-gate screenshots + critique report
docs/research/2026-11-13-web-push-spike.md  # spike results (Ali, Task 15)
.github/workflows/ci.yml                    # job `frontend` only
frontend/
  .nvmrc  package.json  pnpm-workspace.yaml  tsconfig.json  eslint.config.mjs
  next.config.ts  postcss.config.mjs  components.json  vitest.config.ts
  playwright.config.ts  lighthouserc.json  Dockerfile  .dockerignore  .gitignore
  openapi/stellar-blaze.mock.openapi.json   # contract proposal until B3 Task 0
  messages/{en,ar,ur,hi,bn,ne}.json
  public/icons/  public/templates/crew-template.csv
  scripts/mock-api.ts  scripts/send-test-push.ts
  src/
    proxy.ts
    i18n/{routing,request,navigation,direction}.ts
    styles/{tokens.css,globals.css}
    app/
      api/healthz/route.ts
      api/v1/[...path]/route.ts            # same-origin proxy to API_ORIGIN
      serwist/[path]/route.ts
      sw.ts
      [locale]/layout.tsx  [locale]/page.tsx  [locale]/offline/page.tsx
      [locale]/manifest.webmanifest/route.ts
      [locale]/(worker)/worker/{layout,page,loading}.tsx
      [locale]/(worker)/worker/setup/page.tsx
      [locale]/(worker)/worker/alerts/page.tsx
      [locale]/(supervisor)/supervisor/{layout,page,loading}.tsx
      [locale]/(supervisor)/supervisor/crews/[crewId]/{page,loading}.tsx
      [locale]/(hse)/hse/{layout,page}.tsx
      [locale]/dev/specimen/page.tsx        # token specimen (404 when NODE_ENV=production unless SB_SPECIMEN=1)
    api/{schema.d.ts (generated), client.ts, server-client.ts, problem.ts, result.ts}
    mocks/{fixtures.ts, handlers.ts, node.ts}
    components/ui/                          # shadcn output
    components/level/{level.ts, LevelBadge.tsx, LevelHero.tsx, ShadeBand.tsx, pictograms.tsx}
    components/states/{EmptyState.tsx, ErrorState.tsx, StaleBanner.tsx, Skeletons.tsx}
    components/shell/{LocaleSwitcher.tsx, ThemeToggle.tsx, theme-script.ts, DraftBadge.tsx}
    features/profile/{schema.ts, store.ts, ConsentPanel.tsx, ProfileForm.tsx}
    features/risk/{niosh.ts, exceedance.ts, personal.ts}
    features/today/{freshness.ts, TodayView.tsx, useSiteToday.ts}
    features/push/{payload.ts, capability.ts, subscribe.ts, usePush.ts, AlertsSettings.tsx, InstallCard.tsx, sw-strings.ts}
    features/supervisor/{CrewList.tsx, CrewTimeline.tsx}
    providers/QueryProvider.tsx
  tests/unit/...   tests/e2e/...
```

Every unit test lives at `frontend/tests/unit/<same path as source>.test.ts(x)`. Run all unit tests with `pnpm test`, e2e with `pnpm e2e`.

---

### Task 1: Scaffold, toolchain, health route, Dockerfile and the `frontend` CI job

**Files:**
- Create: `frontend/` (all config files listed in File Structure), `frontend/src/app/api/healthz/route.ts`, `frontend/src/app/[locale]/layout.tsx` (minimal, replaced in Task 3), `frontend/Dockerfile`, `frontend/.dockerignore`
- Modify: `.github/workflows/ci.yml` (add job `frontend` only)
- Test: `frontend/tests/unit/app/api/healthz/route.test.ts`

**Interfaces:**
- Produces: `GET /api/healthz` → `200 {"status":"ok","version": process.env.APP_VERSION ?? "dev"}`. Scripts: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm typecheck` (`tsc --noEmit`), `pnpm test` (`vitest run`). Docker image listens on port 3000, runs as non-root, `CMD ["node","server.js"]`.

- [ ] **Step 1: Create the app.** Run `pnpm dlx create-next-app@16.4.6 frontend --ts --eslint --tailwind --app --src-dir --turbopack --import-alias "@/*" --use-pnpm --no-react-compiler` from the repo root (accept defaults for anything else). Then set every dependency to the exact pins in Global Constraints, add `.nvmrc`, `engines`, `packageManager`, and create `frontend/pnpm-workspace.yaml`:

```yaml
minimumReleaseAge: 1440
allowBuilds:
  esbuild: true
  sharp: true
  unrs-resolver: true
```

Run `pnpm install`. Expected: exit 0 and no `ERR_PNPM_IGNORED_BUILDS` (if pnpm names another package with build scripts, add it with `true` only if it is a known native builder, and report it).

- [ ] **Step 2: Harden config.** Set the four TS flags. Use an ESLint flat config that extends `eslint-config-next` (core-web-vitals + typescript) and `typescript-eslint` `strictTypeChecked`, and turns on `jsx-a11y` `strict` rules. Set `next.config.ts` to `output: "standalone"` (no `webpack` key). Add `vitest.config.ts` (jsdom environment, `@vitejs/plugin-react` 6.3.0, `vite-tsconfig-paths` 6.1.1, setup file importing `@testing-library/jest-dom/vitest`).

- [ ] **Step 3: Write the failing test** `tests/unit/app/api/healthz/route.test.ts`:

```ts
import { GET } from "@/app/api/healthz/route";
it("returns ok with the build version", async () => {
  process.env.APP_VERSION = "abc123";
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", version: "abc123" });
});
```

Run `pnpm test`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `GET(): Promise<Response>`** in `src/app/api/healthz/route.ts`. Add `export const dynamic = "force-dynamic"` so the version is read at request time. Run `pnpm test`: PASS.

- [ ] **Step 5: Dockerfile.** Use a multi-stage build on `node:24.22.2-trixie-slim`. The build stage runs `npm i -g pnpm@12.18.0`, `pnpm install --frozen-lockfile` and `pnpm build`, with `ARG APP_VERSION` exported as `ENV APP_VERSION`. The runtime stage copies `.next/standalone`, `.next/static` → `.next/static` and `public`, and sets `ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0` and `USER node`, `EXPOSE 3000`. Run `docker build -t sb-web:local --build-arg APP_VERSION=local frontend && docker run --rm -d -p 3000:3000 --name sbweb sb-web:local && curl -s localhost:3000/api/healthz; docker rm -f sbweb`. Expected: `{"status":"ok","version":"local"}`.

- [ ] **Step 6: Add the `frontend` CI job.** If `.github/workflows/ci.yml` does not exist yet (B1 has not landed), create it with exactly this header, then add the job. If it exists, add only the `frontend` job under `jobs:`.

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
```

The `frontend` job runs on `ubuntu-24.04` with `defaults.run.working-directory: frontend`. Steps: `actions/checkout@v7.0.1`, `pnpm/action-setup@v6.1.1` (reads `packageManager`), `actions/setup-node@v7.1.0` (`node-version-file: frontend/.nvmrc`, `cache: pnpm`, `cache-dependency-path: frontend/pnpm-lock.yaml`), then `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. (Task 12 appends e2e and Lighthouse.)

- [ ] **Step 7: Verify locally.** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: all exit 0.

- [ ] **Step 8: Commit.** `git add frontend .github/workflows/ci.yml` then `git commit -m "build(frontend): scaffold next 16 app with pinned toolchain and ci job"`.

---

### Task 2: Visual direction "Arish Signal": DESIGN.md, tokens, specimen (human gate)

**Files:**
- Create: `DESIGN.md` (repo root), `frontend/src/styles/tokens.css`, `frontend/src/styles/globals.css` (replace scaffold), `frontend/src/components/level/level.ts`, `frontend/src/components/level/pictograms.tsx`, `frontend/src/app/[locale]/dev/specimen/page.tsx`
- Modify: `frontend/package.json` (script `design:lint`)
- Test: `frontend/tests/unit/components/level/level.test.ts`

**Interfaces:**
- Produces: `type Level = "green" | "amber" | "orange" | "red"`; `LEVELS: readonly Level[]` (ascending severity); `levelIndex(l: Level): 1 | 2 | 3 | 4`; `moreSevere(a: Level, b: Level): Level`. Pictogram components `LevelPictogram({ level, className }: { level: Level; className?: string })` render `aria-hidden` SVGs: green = sun with check, amber = water drop, orange = shade canopy, red = raised hand. Tailwind classes generated from tokens: `bg-surface`, `bg-surface-raised`, `text-ink`, `text-ink-muted`, `border-hairline`, `border-control`, `bg-action`, `text-on-action`, `bg-level-{l}`, `text-on-level-{l}`, `bg-level-{l}-soft`, `text-on-level-{l}-soft`, `pattern-level-{l}` (utility), `font-display`, `font-body`.

**Direction (decided here; the clone-distance gate is passed on purpose):**
- **Name:** *Arish Signal*. Gulf vernacular shade (the palm-frond *arish* canopy and the hard-edged shadows it casts) meets industrial safety signage (hazard hatching, big numerals, plain shapes). It is not SaaS: there is no indigo, no Inter, no soft glass cards and no gradient hero.
- **Three adjectives:** unmistakable at arm's length; calm under pressure; field-tough.
- **Signature element:** the **shade band**. Each forecast hour is a cell whose diagonal hatch density encodes the level (none / sparse / medium / dense cross-hatch), like shade slats or hazard tape. It carries a level numeral, so it reads without colour, in sunlight glare and in print.
- **Type:** display and numerals in **Barlow Condensed** 600/700 (signage-derived, OFL, Google Fonts). Body text in the per-script Noto families from research §8.2. Two families per locale.
- **Shape:** 2 px radius (cut-sign corners), 2 px rules, no drop shadows. Elevation uses a 1 px hairline plus a tonal step.
- **Motion:** none in F1 beyond 150 ms opacity on state change, disabled under `prefers-reduced-motion`.

**Tokens (OKLCH; sRGB hex and contrast computed 2026-11-11 with an OKLCH→sRGB script, all in gamut):**

| Primitive | OKLCH | Hex |
|---|---|---|
| sand-50 | 0.975 0.012 80 | #fbf6ee |
| sand-100 | 0.95 0.02 80 | #f6ede0 |
| sand-200 | 0.90 0.03 78 | #e9dcc8 |
| sand-300 | 0.83 0.04 76 | #d7c4ab |
| sand-500 | 0.60 0.045 70 | #927c63 |
| sand-600 | 0.52 0.04 68 | #796550 |
| sand-700 | 0.42 0.035 65 | #5b4939 |
| sand-900 | 0.24 0.02 60 | #261d16 |
| sand-950 | 0.17 0.015 60 | #140e09 |
| falaj-300 | 0.80 0.08 198 | #7cced0 |
| falaj-600 | 0.50 0.08 205 | #157079 |
| falaj-700 | 0.42 0.07 208 | #075761 |
| level-green | 0.52 0.13 150 | #1d7d3e |
| level-amber | 0.82 0.16 85 | #f3ba25 |
| level-orange | 0.70 0.17 50 | #ef7926 |
| level-red | 0.50 0.19 27 | #b7191c |
| green-soft / ink | 0.93 0.05 150 / 0.38 0.10 150 | #d1f2d7 / #085023 |
| amber-soft / ink | 0.95 0.06 90 / 0.45 0.09 75 | #feeec1 / #724d0b |
| orange-soft / ink | 0.93 0.04 55 / 0.45 0.12 45 | #fee2cf / #893a0e |
| red-soft / ink | 0.93 0.035 27 / 0.42 0.16 27 | #ffe0db / #901114 |
| dark soft (per hue h) | 0.30 0.05 h | green #1a3520, amber #392c0c, orange #422616, red #442320 |

| Semantic (light) | → | Contrast |
|---|---|---|
| surface / surface-raised | sand-50 / sand-100 | |
| ink / ink-muted | sand-950 / sand-700 | 17.81 / 7.93 on sand-50 |
| border-hairline / border-control | sand-300 / sand-500 | decorative / 3.70 |
| action / on-action | falaj-600 / white | 5.79 |
| focus ring | falaj-700, 3 px, 2 px offset | 7.64 vs sand-50 |
| level-{l} / on-level-{l} | fill / green: white, amber: sand-950, orange: sand-950, red: white | 5.19 / 10.85 / 6.77 / 6.62 |
| level-{l}-soft / on-level-{l}-soft | soft / ink | 7.93 / 6.54 / 6.32 / 7.39 |

Dark (`[data-theme="dark"]` and system default when no override): surface sand-950, surface-raised sand-900, ink sand-50 (17.81), ink-muted sand-300 (11.30), border-control sand-600, action falaj-300 with on-action sand-950 (10.57), focus falaj-300, level fills unchanged, level-soft = dark soft with on-soft sand-50 (≥ 12.4).

Patterns (component tier): `--pattern-level-green: none`; amber `repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 12px)`; orange the same at `0 2px, transparent 2px 7px`; red two crossed layers at `0 2px, transparent 2px 6px` (135deg and 45deg). The pattern colour is `on-level-{l}` at 35% via `color-mix(in oklch, …)`.

Space scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. Radius: `--radius-sign: 2px`. Type scale (rem): 0.875, 1, 1.25, 1.5625, 1.953, 3.052, 4.768 (major-third steps with a display jump), body line-height 1.5, `:lang(ur)` line-height 2.1, `:lang(ar)` 1.8.

- [ ] **Step 1: Write the failing test** `level.test.ts`: `expect(levelIndex("amber")).toBe(2)`, `expect(moreSevere("orange","amber")).toBe("orange")`, `expect(moreSevere("green","red")).toBe("red")`, `expect(LEVELS).toEqual(["green","amber","orange","red"])`. Run it: FAIL.
- [ ] **Step 2: Implement `level.ts`** and run it: PASS.
- [ ] **Step 3: Write `tokens.css`** in three tiers (primitives on `:root`; semantic on `:root` plus overrides under `[data-theme="dark"]` and under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`; component tokens for patterns and shade-band sizes). Write `globals.css` with `@import "tailwindcss"` and `@theme inline` mapping the semantic tokens to Tailwind names (Interfaces). Add `@utility pattern-level-*` and the `:lang()` line-heights. Never reference primitives from components.
- [ ] **Step 4: Write `DESIGN.md`** in the google-labs `design.md` format. YAML front matter: `name: Arish Signal`, colors (the semantic light set as `oklch(...)`), typography, rounded, spacing, and components `button-primary`, `level-red-badge`, `level-amber-badge` with `backgroundColor`/`textColor` so the linter checks contrast. Body sections: Overview (direction, adjectives, signature, what it is not), Colors, Typography (per-locale table), Layout, Shapes, Components, Do's and Don'ts (never colour alone; logical properties only; Western digits). Add the script `"design:lint": "design.md lint ../DESIGN.md"` with `@google/design.md` 0.4.0 as a devDependency. Run `pnpm design:lint`. Expected: `"errors": 0`.
- [ ] **Step 5: Specimen page** `/[locale]/dev/specimen`. It shows swatches for every semantic token in both themes, the type scale in each script (use the `en` and `ar` sample strings from messages), four `LevelBadge` placeholders and a 12-cell shade band using the patterns. It returns `notFound()` in production unless `process.env.SB_SPECIMEN === "1"`. Run `pnpm dev` and open `/en/dev/specimen` and `/ar/dev/specimen` (the locale layout comes in Task 3; until then use `/dev/specimen` under the scaffold layout).
- [ ] **Step 6: Human gate (Ali, ~10 min).** Screenshot the specimen in light and dark at 390×844 into `docs/design/f1/specimen-{light,dark}.png`. Ali approves or names one change. Do not start Task 4 until approved. Token values may change; token names may not.
- [ ] **Step 7: Commit.** `git add DESIGN.md frontend/src/styles frontend/src/components/level frontend/src/app/[locale]/dev frontend/package.json frontend/pnpm-lock.yaml frontend/tests/unit/components docs/design/f1` then `git commit -m "feat(frontend): arish signal direction, tokens and design.md"`.

---

### Task 3: i18n, RTL, fonts, theme, shadcn init

**Files:**
- Create: `frontend/src/i18n/{routing,request,navigation,direction}.ts`, `frontend/src/proxy.ts`, `frontend/messages/{en,ar,ur,hi,bn,ne}.json`, `frontend/src/app/fonts.ts`, `frontend/src/components/shell/{LocaleSwitcher,ThemeToggle,DraftBadge}.tsx`, `frontend/src/components/shell/theme-script.ts`, `frontend/components.json`
- Modify: `frontend/next.config.ts` (next-intl plugin), `frontend/src/app/[locale]/layout.tsx`
- Test: `frontend/tests/unit/i18n/direction.test.ts`, `frontend/tests/unit/i18n/messages-parity.test.ts`, `frontend/tests/unit/style/no-physical-direction.test.ts`

**Interfaces:**
- Produces: `routing` (`locales: ["en","ar","ur","hi","bn","ne"] as const`, `defaultLocale: "en"`), `type Locale`, `dirFor(locale: Locale): "ltr" | "rtl"`, `Link`/`useRouter`/`usePathname`/`redirect` from `@/i18n/navigation`, `fontClassFor(locale: Locale): string`. `<html lang dir data-theme>` is set in `[locale]/layout.tsx`. Messages have top-level namespaces `common`, `shell`, `worker`, `today`, `profile`, `alerts`, `push`, `supervisor`, `hse`, `states`, `levels`, `actions`, `offline`, and `_meta`.

- [ ] **Step 1: Write failing tests.**
  - `direction.test.ts`: `dirFor("ar") === "rtl"`, `dirFor("ur") === "rtl"`, and `"ltr"` for en, hi, bn, ne.
  - `messages-parity.test.ts`: load all six JSON files, flatten the keys (excluding `_meta`), and assert each key set equals `en`'s. Assert every non-en file has `_meta.review_status === "machine-draft"` and `en` has `"source"`.
  - `no-physical-direction.test.ts`: glob `src/**/*.tsx`, excluding `src/components/ui/**`, and assert no match for `/\b(ml|mr|pl|pr|left|right|rounded-l|rounded-r|border-l|border-r)-[\w[]|\btext-(left|right)\b/`.
  Run them: FAIL.
- [ ] **Step 2: Implement i18n.** Follow next-intl 4.14.10's "App Router with i18n routing" guide (https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing): `routing.ts`, `request.ts`, `navigation.ts`, plugin in `next.config.ts`, and `src/proxy.ts` with `export default createMiddleware(routing)` and matcher `"/((?!api|serwist|_next|_vercel|.*\\..*).*)"`. In `[locale]/layout.tsx`: `hasLocale` → `notFound()`, `setRequestLocale`, `generateStaticParams` over the locales, and `NextIntlClientProvider`.
- [ ] **Step 3: Fonts** in `src/app/fonts.ts` via `next/font/google` (self-hosted at build): `Barlow_Condensed` (weights 500/600/700, `variable: "--font-display"`), `Noto_Sans` (en), `Noto_Sans_Arabic` (ar), `Noto_Nastaliq_Urdu` (ur, weights 400/700, with `Noto_Naskh_Arabic` as fallback), `Noto_Sans_Devanagari` (hi, ne), `Noto_Sans_Bengali` (bn), each with `variable: "--font-body"` and `preload` true only for the active locale's family. `fontClassFor(locale)` returns the display variable class plus that locale's body class. Never set a fixed `height` on text containers.
- [ ] **Step 4: Messages.** Author `en.json` for every namespace used in Tasks 3–11. The en `today.limitation` string is the closed-app copy from Global Constraints. Generate the five drafts with the same keys and set `_meta.review_status: "machine-draft"`. `DraftBadge` renders `shell.draftTranslation` when the active locale's status is not `"reviewed"`.
- [ ] **Step 5: Theme.** `theme-script.ts` exports a string for an inline `<script>` in `<head>`. It reads `localStorage["sb-theme"]` (in try/catch) and sets `document.documentElement.dataset.theme` only for `"light"` or `"dark"`. With no override the CSS system default applies. `ThemeToggle` cycles system → light → dark and writes the key.
- [ ] **Step 6: shadcn.** Run `pnpm dlx shadcn@4.23.0 init` choosing Base UI and RTL support (`"rtl": true` in `components.json`, per the shadcn RTL changelog https://ui.shadcn.com/docs/changelog/2026-01-rtl). Add `button`, `card`, `badge`, `alert`, `skeleton`, `switch`, `radio-group`, `label`, `select`, `separator`, `sheet`. Map shadcn's CSS variables onto the semantic tokens in `globals.css` (one mapping block; do not keep shadcn's default palette).
- [ ] **Step 7: Run tests and the app.** `pnpm test` PASS. With `pnpm dev`, `/` redirects to `/en`; `/ar` renders `<html lang="ar" dir="rtl">`.
- [ ] **Step 8: Commit.** `git add frontend` then `git commit -m "feat(frontend): six-locale i18n with rtl, per-script fonts and theme"`.

---

### Task 4: App shell and the three route groups

**Files:**
- Create: `frontend/src/app/[locale]/page.tsx` (role chooser), `frontend/src/app/[locale]/(worker)/worker/layout.tsx`, `frontend/src/app/[locale]/(supervisor)/supervisor/layout.tsx`, `frontend/src/app/[locale]/(hse)/hse/{layout,page}.tsx`, `frontend/src/components/states/{EmptyState,ErrorState,StaleBanner,Skeletons}.tsx`
- Test: `frontend/tests/unit/components/states/states.test.tsx`

**Interfaces:**
- Consumes: Task 3 navigation, messages, `DraftBadge`, `LocaleSwitcher`, `ThemeToggle`.
- Produces:
  - `EmptyState({ title, reason, primary, secondary? }: { title: string; reason: string; primary: { label: string; href: string }; secondary?: { label: string; href: string } })`
  - `ErrorState({ title, detail, requestId, onRetry }: { title: string; detail?: string; requestId?: string; onRetry: () => void })`, which renders the request id as copyable text
  - `StaleBanner({ updatedAt, timeZone }: { updatedAt: string; timeZone: string })`
  - `Skeletons.Hero`, `Skeletons.Band`, `Skeletons.Rows`
  - The worker layout is lean: no charts, a single-column 16 px gutter, and a bottom bar with Today and Alerts (≥ 44 px targets). The supervisor layout has a top bar with site name, locale and theme. The HSE page is an actionable empty state ("The HSE aggregate view arrives with F2 — preview the supervisor view" → `/supervisor`).
  - The role chooser offers Worker, Supervisor and HSE with one line each, and states that this demo has no login and all data is synthetic.
  - **Route-group isolation (ADR 0009 §7)** in `eslint.config.mjs`, with the core `no-restricted-imports` rule (no new dependency), as `error`:
    - files `src/app/[[]locale]/(worker)/**` and `src/features/{today,profile,risk,push}/**` may not import `@/features/supervisor/*` or any path containing `(supervisor)` or `(hse)`;
    - files `src/app/[[]locale]/(supervisor)/**`, `src/app/[[]locale]/(hse)/**` and `src/features/supervisor/**` may not import `@/features/{profile,risk,today,push}/*` or any path containing `(worker)` (on-device personal data must be unreachable from supervisor code);
    - shared code lives in `src/components`, `src/api`, `src/i18n`, `src/styles`.
    Check glob escaping of `[locale]` against the ESLint flat-config docs and use whatever pattern the docs give.

- [ ] **Step 1: Write the failing test** `states.test.tsx`:
  - `EmptyState` renders the title and reason, and a link with `href`.
  - `ErrorState` shows `requestId` and calls `onRetry` on click of the button named by `states.retry`.
  - `StaleBanner` with `updatedAt "2026-11-11T05:40:00Z"` and `timeZone "Asia/Dubai"` contains `09:40`.
  Run it: FAIL.
- [ ] **Step 2: Implement the components and layouts.** Run `pnpm test`: PASS.
- [ ] **Step 2b: Prove the isolation rule is not vacuous.** Create two temporary files, `src/features/risk/__probe_target.ts` (`export const x = 1;`) and `src/features/supervisor/__probe.ts` (`export { x } from "@/features/risk/__probe_target";`), and run `pnpm lint`. It must fail with `no-restricted-imports` on `__probe.ts`. Delete both files and record the error line in the task report.
- [ ] **Step 3: Smoke-check routes.** Start `pnpm dev`. `/en`, `/en/worker`, `/en/supervisor`, `/en/hse` and `/ur/worker` each return 200 with the right layout. Worker and supervisor pages may be placeholders until Tasks 10–11.
- [ ] **Step 4: Commit.** `git add frontend` then `git commit -m "feat(frontend): app shell with worker, supervisor and hse route groups"`.

---

### Task 5: API contract proposal, generated client, BFF proxy and MSW

**Files:**
- Create: `frontend/openapi/stellar-blaze.mock.openapi.json`, `frontend/src/api/{schema.d.ts,client.ts,server-client.ts,problem.ts,result.ts}`, `frontend/src/app/api/v1/[...path]/route.ts`, `frontend/src/mocks/{fixtures,handlers,node}.ts`, `frontend/scripts/mock-api.ts`, `frontend/src/providers/QueryProvider.tsx`
- Modify: `frontend/package.json` (scripts `api:gen`, `api:check`, `mock:api`), `frontend/vitest.config.ts` (MSW setup file)
- Test: `frontend/tests/unit/api/problem.test.ts`, `frontend/tests/unit/api/proxy.test.ts`, `frontend/tests/unit/api/contract-governance.test.ts`

**Interfaces:**
- Produces (contract proposal; B3 Task 0 is the owner from 14 Nov). All paths are under `/api/v1`. Every non-2xx response is `application/problem+json` with `{type,title,status,detail?,instance?,request_id}`.

| Method + path | Response (200 unless stated) |
|---|---|
| `GET /api/v1/sites` | `Site[]` = `{id, name, timezone, synthetic: boolean}` |
| `GET /api/v1/sites/{site_id}/forecast/today` | `SiteForecastToday` = `{site_id, date, generated_at, policy_version, config_version: integer, hours: HourForecast[]}`; `HourForecast` = `{starts_at, wbgt_c: {p05: number\|null, p50: number\|null, p95: number\|null}, site_level: Level\|null, action_codes: string[], ban_active: boolean}` |
| `GET /api/v1/risk-policy` | `RiskPolicy` = `{version, config_version: integer, k_suppression: int, acclimatisation_days_required: int, bands: {level, min_exceedance_probability}[], workload_classes: {code: "light"\|"moderate"\|"heavy", metabolic_rate_w}[], clothing_options: {code, adjustment_c, source}[]}` |
| `GET /api/v1/sites/{site_id}/crews` | `Crew[]` = `{id, site_id, name, member_count}` |
| `GET /api/v1/crews/{crew_id}/timeline?date=YYYY-MM-DD` | `CrewTimeline` = `{crew_id, crew_name, site_id, date, suppressed: boolean, k: int, hours: {starts_at, crew_level: Level\|null, share_above_amber: number\|null, ban_active}[]}` |
| `POST /api/v1/push/subscriptions` | body `{subscription: {endpoint, expirationTime: number\|null, keys: {p256dh, auth}}, site_id, crew_id: string\|null}` → `201 {id}` |
| `DELETE /api/v1/push/subscriptions/{subscription_id}` | `204` |

- `client.ts`: `apiClient = createClient<paths>({ baseUrl: "" })` (openapi-fetch, same-origin; paths already carry `/api/v1`).
- `server-client.ts`: `serverApiClient()` uses `baseUrl: process.env.API_ORIGIN` and throws at call time if it is unset. It forwards the incoming `X-Request-ID` (read via `headers()`) when present, and `x-sb-mock-scenario` under the same condition as the proxy below. e2e sets that header with `page.setExtraHTTPHeaders`.
- `problem.ts`: `ProblemSchema` (zod) and `class ApiProblem extends Error { readonly problem: Problem }`. `toProblem(res: Response, body: unknown): Problem` falls back to `{type:"about:blank", title: res.statusText, status: res.status, request_id: res.headers.get("x-request-id") ?? undefined}` when the body is not problem+json.
- `result.ts`: `type Result<T> = { ok: true; data: T } | { ok: false; problem: Problem }` and `async function call<T>(p: Promise<{data?: T; error?: unknown; response: Response}>): Promise<Result<T>>`.
- Proxy: `src/app/api/v1/[...path]/route.ts` exports GET/POST/DELETE. They forward method, path, query, body, `content-type`, `accept` and `x-request-id` to `${API_ORIGIN}/api/v1/...` and stream status, body, `content-type` and `x-request-id` back. If `API_ORIGIN` is unset or the upstream is unreachable, the response is `502` problem+json with `type: "urn:stellar-blaze:problem:upstream-unavailable"`. Set `cache: "no-store"`.
- Fixtures (`fixtures.ts`, all synthetic and labelled so in names):
  - Sites `site-demo-mussafah` ("Demo yard A (synthetic)") and `site-demo-empty` ("Demo yard B (synthetic, no crews)"), both `Asia/Dubai`.
  - Hours 05:00–19:00 local for 2026-11-11 with plausible WBGT quantiles and levels rising to orange at 13:00–15:00 local.
  - Every forecast fixture and `riskPolicy` carry `config_version: 1` (ADR 0010: the backend's active runtime-config version id, an integer, additive to `policy_version`).
  - `riskPolicy` with `version: "mock-0"` (ADR 0009: in the real API `version` and every `policy_version` are the backend ruleset id, format `ae-heat-<yyyy>.<n>`; the UI shows it verbatim and never parses it), bands green 0 / amber 0.10 / orange 0.30 / red 0.60 (placeholders until B3's back-test), workload light 180 / moderate 300 / heavy 415 W (ADR 0006 test-vector rates), and clothing `[{code:"work_clothes", adjustment_c: 0, source:"baseline"}]`. Other clothing classes wait for B3's NIOSH Table 3-2 values (ADR 0006); the frontend invents none.
  - Crews: `crew-a` (12 members) and `crew-b` (3 members → `suppressed: true`, `share_above_amber: null`).
- `handlers.ts` exports `handlers` plus the named overrides `problemOnce(path, status)` and `staleToday()` (generated_at 26 h old). Because e2e runs against the standalone mock server (no per-test `server.use`), every handler also honours a request header `x-sb-mock-scenario: error | stale | empty`, which returns a 500 problem with `request_id "mock-req-1"`, the stale payload, or `[]`. The BFF proxy forwards that header only when `NODE_ENV !== "production"` or `SB_MOCK_SCENARIOS=1` (set only in Playwright's `webServer` env).
- `node.ts` exports `server = setupServer(...handlers)` from `msw/node`. The Vitest setup calls `server.listen({ onUnhandledFrame: "error" })` (MSW 3 renamed `onUnhandledRequest`), `resetHandlers` after each test, and `close` at the end.
- `scripts/mock-api.ts`: `createServer(...handlers).listen(4010)` from `@msw/serve`. Script `"mock:api": "node --experimental-strip-types scripts/mock-api.ts"` (Node 24 strips types; if it rejects a construct, use `tsx` and report it).
- Codegen: `"api:gen": "openapi-typescript openapi/stellar-blaze.mock.openapi.json -o src/api/schema.d.ts"`, and `"api:check": "pnpm api:gen && git diff --exit-code src/api/schema.d.ts"`. openapi-typescript 7.13.0 peers `typescript ^5.x` (TS 6 support is open issue #2723). Add `peerDependencyRules.allowedVersions: {"openapi-typescript>typescript": "6"}` to `pnpm-workspace.yaml`. If generation fails under TS 6, switch `api:gen` to `pnpm dlx --package=openapi-typescript@7.13.0 --package=typescript@5.9.3 openapi-typescript …` and report it. A fork, `openapi-typesafe`, claims TS 6 support. It is 9 days old, an RC and single-maintainer, so it is not adopted (parked).

- [ ] **Step 1: Write the mock OpenAPI 3.1 JSON** exactly per the table, with `components.schemas` named `Level, Problem, Site, HourForecast, SiteForecastToday, RiskPolicy, Crew, CrewHour, CrewTimeline, PushSubscriptionCreate, PushSubscriptionCreated`, `additionalProperties: false` on every object, and problem responses `404`, `422`, `502` and `default`. Run `pnpm api:gen`: a `schema.d.ts` is produced.
- [ ] **Step 2: Write failing tests.**
  - `problem.test.ts`: a JSON `{type:"urn:x",title:"Nope",status:403,request_id:"r-1"}` with content-type `application/problem+json` parses to `ApiProblem` with `request_id "r-1"`. A `text/html` 500 with header `x-request-id: r-2` yields `status 500, request_id "r-2"`.
  - `proxy.test.ts`: with `API_ORIGIN=http://upstream.test` and an MSW handler on `http://upstream.test/api/v1/sites`, calling the route's `GET` for `/api/v1/sites?x=1` returns the upstream body and passes `x-request-id` through. With `API_ORIGIN` unset it returns 502 and `content-type: application/problem+json`.
  - `contract-governance.test.ts`: parse the mock spec. Assert `CrewTimeline` and `CrewHour` property names ⊆ `{crew_id, crew_name, site_id, date, suppressed, k, hours, starts_at, crew_level, share_above_amber, ban_active}`. Assert no schema anywhere has a property matching `/worker|member_id|name_of|employee|heart|symptom/i`, except `crew_name`. Assert `PushSubscriptionCreate` properties are exactly `{subscription, site_id, crew_id}`.
  Run them: FAIL.
- [ ] **Step 3: Implement** `problem.ts`, `result.ts`, `client.ts`, `server-client.ts`, the proxy route, the fixtures, handlers, `node.ts`, `mock-api.ts` and the `QueryProvider` (TanStack Query, `staleTime: 60_000`, `retry: 1`, mounted in `[locale]/layout.tsx`). Run `pnpm test`: PASS.
- [ ] **Step 4: Verify the mock server and the drift check.** `pnpm mock:api &` then `curl -s localhost:4010/api/v1/sites` returns two sites. `pnpm api:check` exits 0. Add `pnpm api:check` to the `frontend` CI job before `pnpm test`.
- [ ] **Step 5: Write `docs/contracts/web-push.md`.** Cover the subscription POST/DELETE, the payload schema from Global Constraints, `Urgency: high`, `TTL: 3600`, the VAPID subject being a `mailto:` URI (Safari rejects `https://localhost` subjects, per web-push README), and the rule "no worker identifier, no free text, no personal level". End it with a paragraph telling B3 that this file and the mock OpenAPI are a proposal to adopt or replace in B3 Task 0.
- [ ] **Step 6: Commit.** `git add frontend docs/contracts/web-push.md .github/workflows/ci.yml` then `git commit -m "feat(frontend): typed api client, bff proxy, mock contract and msw"`.

---

### Task 6: PWA: per-locale manifest, Serwist service worker, offline fallback

**Files:**
- Create: `frontend/src/app/sw.ts`, `frontend/src/app/serwist/[path]/route.ts`, `frontend/src/app/[locale]/manifest.webmanifest/route.ts`, `frontend/src/app/[locale]/offline/page.tsx`, `frontend/public/icons/{icon-192.png,icon-512.png,icon-maskable-512.png}`, `frontend/src/features/pwa/fallback.ts`
- Modify: `frontend/next.config.ts` (`withSerwist`), `frontend/src/app/[locale]/layout.tsx` (`SerwistProvider`, manifest link, theme-color)
- Test: `frontend/tests/unit/features/pwa/fallback.test.ts`, `frontend/tests/unit/app/manifest.test.ts`, `frontend/tests/e2e/pwa.spec.ts`

**Interfaces:**
- Produces:
  - `fallbackUrlFor(pathname: string): string` returns `/${locale}/offline` when the pathname starts with a known locale, else `/en/offline`.
  - `manifestFor(locale: Locale, t): WebAppManifest` with `id: "/worker"`, `start_url: "/${locale}/worker?source=pwa"`, `scope: "/"`, `display: "standalone"`, `orientation: "portrait"`, localized `name`/`short_name`, `lang`, `dir`, `theme_color` = sand-50 hex, `background_color` = sand-50 hex, and icons 192 / 512 / 512 maskable. Served at `/${locale}/manifest.webmanifest` with `content-type: application/manifest+json`.
  - SW runtime caching: a custom `NetworkFirst` for `GET /api/v1/sites/*/forecast/today` and `GET /api/v1/risk-policy` (cache `sb-api`, `networkTimeoutSeconds: 4`, expiration 48 h, 20 entries) placed **before** `defaultCache`. `fallbacks.entries` holds one per locale (`url: "/${l}/offline"`, matcher: document request whose pathname starts with `/${l}/`), plus `/en/offline` for anything else.
  - Every `/${l}/offline` is in `additionalPrecacheEntries` with `revision: process.env.APP_VERSION ?? crypto.randomUUID()`.

- [ ] **Step 1: Write failing unit tests.**
  - `fallbackUrlFor("/ur/worker") === "/ur/offline"`, `fallbackUrlFor("/xx/foo") === "/en/offline"`, `fallbackUrlFor("/") === "/en/offline"`.
  - `manifestFor("ar", t)` has `dir "rtl"`, `start_url "/ar/worker?source=pwa"`, `scope "/"`, `id "/worker"`, one icon with `purpose "maskable"`, and every icon `src` starts with `/icons/`.
  Run them: FAIL.
- [ ] **Step 2: Implement** per the Serwist Turbopack guide (https://serwist.pages.dev/docs/next/turbo): `withSerwist` in `next.config.ts` (composed with the next-intl plugin), `createSerwistRoute({ swSrc: "src/app/sw.ts", useNativeEsbuild: true, additionalPrecacheEntries })`, `sw.ts` with `skipWaiting`, `clientsClaim`, `navigationPreload`, the runtime caching above and `addEventListeners()`, and `<SerwistProvider swUrl="/serwist/sw.js">` in the locale layout. The icons are the amber-drop pictogram on sand-50, exported from the SVG at the three sizes (maskable keeps its content inside the 80% safe zone). Run `pnpm test`: PASS.
- [ ] **Step 3: Write the e2e** `tests/e2e/pwa.spec.ts`, run against `pnpm build && pnpm start` with the mock API (Task 12 wires Playwright's `webServer`; until then start both by hand):
  - `sw controls the worker route`: visit `/en/worker`, wait for `navigator.serviceWorker.ready`, reload, and assert `navigator.serviceWorker.controller !== null` and `(await navigator.serviceWorker.getRegistration()).scope === location.origin + "/"`. If the scope is `/serwist/`, fix it by registering with `scope: "/"` and serving `Service-Worker-Allowed: /` from the SW route. Do not drop the assertion.
  - `offline navigation shows localized fallback`: visit `/ur/worker` online, then `context.setOffline(true)`, navigate to `/ur/supervisor` (never visited), and assert `html[lang="ur"][dir="rtl"]` with the `offline.title` text.
  - `manifest is installable-shaped`: fetch `/en/manifest.webmanifest` and assert `display`, `start_url` and the 192/512 icons exist with HTTP 200.
  Run `pnpm build && pnpm start` (with `API_ORIGIN=http://127.0.0.1:4010` and `pnpm mock:api` running) and `pnpm exec playwright test tests/e2e/pwa.spec.ts`. Expected: 3 passed. If `@serwist/turbopack` cannot build on Next 16.4.6 within 2 hours of trying, switch to the fallback in ADR 0003 (a hand-written SW from Next's PWA guide, served as `public/sw.js`). Keep the same three tests and record the switch in the task report.
- [ ] **Step 4: Commit.** `git add frontend` then `git commit -m "feat(frontend): installable worker pwa with serwist and localized offline fallback"`.

---

### Task 7: Web Push subscription flow (client side) and spike sender

**Files:**
- Create: `frontend/src/features/push/{payload,capability,subscribe,sw-strings}.ts`, `frontend/src/features/push/{usePush.ts,AlertsSettings.tsx,InstallCard.tsx}`, `frontend/src/app/[locale]/(worker)/worker/alerts/page.tsx`, `frontend/scripts/send-test-push.ts`
- Modify: `frontend/src/app/sw.ts` (push + notificationclick handlers), `frontend/package.json` (`web-push` 4.0.0 devDependency, script `push:send`)
- Test: `frontend/tests/unit/features/push/{payload,capability,subscribe}.test.ts`, `frontend/tests/unit/features/push/notification.test.ts`, `frontend/tests/e2e/alerts.spec.ts`

**Interfaces:**
- Consumes: `apiClient` and `call` (Task 5), Task 3 messages, the profile store's `siteId` (Task 8 adds the store; until then read it from `?site=` for the debug path).
- Produces:
  - `parsePushPayload(data: unknown): PushPayload | null` is a hand-written guard (no zod inside the SW, to keep it small). It accepts exactly the six keys of the Global Constraints payload and returns null for any extra key or bad value.
  - `type PushCapability = "supported" | "ios-needs-install" | "unsupported" | "insecure"`. `pushCapability(env: { isSecureContext: boolean; hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean; isIos: boolean; isStandalone: boolean }): PushCapability`.
  - `subscribeToSiteAlerts(deps: { registration: Pick<ServiceWorkerRegistration,"pushManager">; vapidPublicKey: string; siteId: string; crewId: string | null; post: (body) => Promise<Result<{id: string}>> }): Promise<{ subscription: PushSubscriptionJSON; serverId: string | null; problem: Problem | null }>`. It always returns the local subscription, even when the server registration fails (the spike relies on this).
  - `unsubscribe(deps): Promise<void>` unsubscribes locally and sends DELETE when a server id is stored.
  - `usePush()` is a state machine: `idle | requesting | subscribed | denied | error`. It persists `{serverId, endpoint, siteId}` in the zustand profile store and re-POSTs on app open when the current endpoint differs from the stored one.
  - `notificationTargetUrl(locale: string, payload: PushPayload): string` returns `/${locale}/worker?from=push&level=${level}`.
  - `notificationContent(locale, payload): { title: string; body: string; tag: string; vibrate: number[] }` uses bundled `sw-strings.ts`, which is generated at build from `messages/*.json` `push` namespace by a tiny script (`scripts/build-sw-strings.ts`, run in `prebuild`). Tag `"${audience}:${target_id}"`. Vibrate `[]` for green, `[200]` amber, `[200,100,200]` orange, `[400,100,400,100,400]` red.
  - The SW reads the locale from Cache Storage `sb-prefs` key `/__sb/prefs` (`{locale}`), which the app writes on every locale render, defaulting to `en`.
  - The VAPID public key reaches the client as a prop from the RSC page reading `process.env.VAPID_PUBLIC_KEY` at request time (runtime env, no rebuild per environment).
  - `send-test-push.ts --sub <file.json> --level <level> [--audience site|crew] [--target <id>]` reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` from the environment (`.env.spike.local`, gitignored). It calls `webpush.sendNotification(sub, JSON.stringify(payload), { urgency: "high", TTL: 3600 })` and prints the ISO send time and the status code.

- [ ] **Step 1: Write failing unit tests.**
  - `payload.test.ts`: the valid six-key object parses. `{...valid, worker_id:"x"}` → null. `level:"purple"` → null. A non-ISO `valid_from` → null.
  - `capability.test.ts`: the table below returns exactly as listed.

    | case | expected |
    |---|---|
    | insecure context | `insecure` |
    | iOS Safari tab, not standalone, no PushManager | `ios-needs-install` |
    | iOS standalone with PushManager | `supported` |
    | desktop Chrome full support | `supported` |
    | no service worker | `unsupported` |

  - `subscribe.test.ts`: a fake `pushManager.subscribe` (an awaited Promise that resolves after a microtask) is called with `{userVisibleOnly: true, applicationServerKey: <Uint8Array of the decoded key>}`. When `post` resolves `{ok:false, problem:{status:502,…}}`, the result still has `subscription.endpoint` and `problem.status === 502`. Two concurrent calls produce one `pushManager.subscribe` call (in-flight promise reuse).
  - `notification.test.ts`: `notificationTargetUrl("ur", p)` starts with `/ur/worker`. `notificationContent("ar", red)` has `vibrate.length === 5` and tag `"site:site-demo-mussafah"`.
  Run them: FAIL.
- [ ] **Step 2: Implement** the modules and the SW handlers. `push` → `parsePushPayload(event.data?.json())`, then `showNotification` (an invalid payload shows nothing and is not rethrown). `notificationclick` → focus an existing client on the target URL or `openWindow`. Run `pnpm test`: PASS.
- [ ] **Step 3: Alerts page.** `/[locale]/worker/alerts` renders `AlertsSettings`, which shows:
  - the capability state,
  - an Enable button (a user gesture, ≥ 44 px),
  - the subscribed state with Turn off,
  - the denied state, explaining how to re-enable in browser settings,
  - `InstallCard` for `ios-needs-install` (Share → Add to Home Screen, with the pictogram steps),
  - the closed-app limitation copy, always visible.

  With `?debug=push` it also shows the local subscription JSON and a Copy button (Clipboard API, falling back to a selectable `<textarea>`), plus "Share" via `navigator.share` when available.
- [ ] **Step 4: Write the e2e** `alerts.spec.ts` (stubs via `page.addInitScript`; no real push service in CI):
  - `alerts page states`: with `PushManager` deleted → the unsupported message, and no exception in the console. With `Notification.requestPermission` stubbed to `"denied"` → the denied state after clicking Enable. With a stubbed `pushManager.subscribe` returning a fake subscription and the mock API → the subscribed state, and the debug JSON contains the `endpoint`.
  - `limitation copy visible` in `en` and `ar`.
  Run it: PASS.
- [ ] **Step 5: Verify the sender compiles.** `pnpm push:send --help` prints usage. Add `.env.spike.local` to `frontend/.gitignore`.
- [ ] **Step 6: Commit.** `git add frontend` then `git commit -m "feat(frontend): web push subscription flow, sw handlers and spike sender"`.

*(After Task 7 the Task 15 spike can run.)*

---

### Task 8: Worker consent and on-device profile

**Files:**
- Create: `frontend/src/features/profile/{schema.ts,store.ts,ConsentPanel.tsx,ProfileForm.tsx}`, `frontend/src/app/[locale]/(worker)/worker/setup/page.tsx`
- Test: `frontend/tests/unit/features/profile/{schema,store}.test.ts`, `frontend/tests/unit/features/profile/ProfileForm.test.tsx`

**Interfaces:**
- Consumes: `RiskPolicy` (`workload_classes`, `clothing_options`) via `useQuery(["risk-policy"])`, and `Site[]`.
- Produces:
  - `ProfileSchema` (zod): `{ consentVersion: "2026-11-11"; consentedAt: string; siteId: string; crewId: string | null; workloadClass: "light" | "moderate" | "heavy"; heatWorkStartDate: string /* YYYY-MM-DD, not in the future */; clothingCode: string }`.
  - `useProfile()` is a zustand store persisted to `localStorage` key `sb-profile-v1` (try/catch; corrupt data → treated as no profile). It exposes `profile | null`, `save(p)`, `revoke()` and `push: {serverId, endpoint, siteId} | null`.
  - `revoke()` clears the profile and the push state, calls `unsubscribe` (Task 7), and deletes the `sb-api` cache entries.
  - `ConsentPanel` states, in `profile.consent.*` keys:
    - what is stored (the three fields), and that it is stored only on this phone;
    - what the server gets (an anonymous alert subscription for the site, only if alerts are enabled);
    - that nothing is used for discipline or employment decisions;
    - that the worker can revoke at any time from Alerts.
  - `ProfileForm` uses react-hook-form with `zodResolver(ProfileSchema)`. Clothing options come only from `risk-policy`; codes not in the policy are not offered.

- [ ] **Step 1: Write failing tests.**
  - schema: rejects a future `heatWorkStartDate`, an unknown `workloadClass` and an empty `siteId`.
  - store: `save` then a reload (re-import with the same storage) restores the profile; corrupt JSON in storage → `profile === null` without throwing; `revoke()` empties the storage key and calls an injected `unsubscribe` once.
  - form: the submit button is disabled until consent is ticked; the clothing select lists only `work_clothes` with the mock policy.
  Run them: FAIL.
- [ ] **Step 2: Implement**, then run `pnpm test`: PASS.
- [ ] **Step 3: Commit.** `git add frontend` then `git commit -m "feat(frontend): worker consent and on-device profile"`.

---

### Task 9: On-device personal risk (Tier B)

**Files:**
- Create: `frontend/src/features/risk/{niosh.ts,exceedance.ts,personal.ts}`
- Test: `frontend/tests/unit/features/risk/{niosh,exceedance,personal}.test.ts`

**Interfaces:**
- Produces:
  - `rel(metabolicRateW: number): number` = `56.7 - 11.5 * Math.log10(M)`, and `ral(M)` = `59.9 - 14.1 * Math.log10(M)` (ADR 0006, °C-WBGT). Both throw `RangeError` when M is not a finite number > 0.
  - `exceedanceProbability(q: {p05: number; p50: number; p95: number}, limit: number): number` returns P(WBGT > limit) by piecewise-linear interpolation of the CDF through the points (p05, 0.05), (p50, 0.50), (p95, 0.95). It returns **0.95 when limit ≤ p05**, documented as a lower bound, and **0.05 when limit ≥ p95** (conservative upper bound). Equal quantiles are handled without division by zero. If quantiles are out of order, sort them first.
  - `personalLevel(input: { hour: HourForecast; profile: Profile; policy: RiskPolicy; today: string }): { level: Level; probability: number; limitC: number; acclimatised: boolean } | null`. It returns null when any quantile is null, or the workload or clothing code is not in the policy.
    - acclimatised = `daysBetween(heatWorkStartDate, today) >= policy.acclimatisation_days_required`
    - limit = acclimatised ? `rel(M)` : `ral(M)`
    - quantiles shifted by `+adjustment_c`
    - level = the band with the highest `min_exceedance_probability ≤ p`
  - `displayedLevel(site: Level | null, personal: Level | null): Level | null` returns the more severe of the two. This is the safety-first rule; flag it for B3 to confirm.
- This module mirrors B3's engine on the device. Parity is enforced later through a shared vector file that B3 publishes. Until then, these tests use ADR 0006's vectors.

- [ ] **Step 1: Write failing tests.**
  - `niosh.test.ts`, with `toBeCloseTo(…, 2)`: `rel(180)` 30.76, `ral(180)` 28.10, `rel(300)` 28.21, `ral(300)` 24.97, `rel(415)` 26.59, `ral(415)` 22.99. `rel(0)` throws.
  - `exceedance.test.ts`, q = {p05: 26, p50: 28, p95: 30}:
    - limit 28 → 0.50
    - limit 27 → 0.725
    - limit 29.5 → 0.1625
    - limit 25 → 0.95
    - limit 31 → 0.05
    - q all 28, limit 28 → 0.50 (no NaN)
  - `personal.test.ts`, mock policy, moderate (300 W), start date 2026-11-01, today 2026-11-11 (10 days ≥ 7 → acclimatised, limit 28.21):
    - hour q {26, 28, 30} → p ≈ 0.452 (`toBeCloseTo(0.452, 3)`) → `orange` (≥ 0.30, < 0.60)
    - same with start 2026-11-09 → RAL 24.97 → p = 0.95 → `red`
    - a null p50 → null
    - `displayedLevel("amber","green") === "amber"`
    - `displayedLevel(null,"red") === "red"`
  Run them: FAIL.
- [ ] **Step 2: Implement.** Run `pnpm test`: PASS.
- [ ] **Step 3: Commit.** `git add frontend` then `git commit -m "feat(frontend): on-device niosh limit and exceedance-based personal level"`.

---

### Task 10: Worker "Today" screen (four states)

**Files:**
- Create: `frontend/src/features/today/{freshness.ts,useSiteToday.ts,TodayView.tsx}`, `frontend/src/components/level/{LevelBadge,LevelHero,ShadeBand}.tsx`, `frontend/src/app/[locale]/(worker)/worker/{page,loading}.tsx`
- Test: `frontend/tests/unit/features/today/freshness.test.ts`, `frontend/tests/unit/features/today/TodayView.test.tsx`, `frontend/tests/unit/components/level/ShadeBand.test.tsx`, `frontend/tests/e2e/today.spec.ts`

**Interfaces:**
- Consumes: `apiClient`, `call`, `useProfile`, `personalLevel`, `displayedLevel`, the level components, the state components.
- Produces:
  - `freshness(generatedAt: string, now: Date): "fresh" | "stale"` (stale when older than 3 h).
  - `currentHour(hours: HourForecast[], now: Date): HourForecast | null` (the hour whose `[starts_at, +1h)` contains now).
  - `useSiteToday(siteId)` uses TanStack Query with key `["today", siteId]`. Fetching is client-side so the SW's `sb-api` cache serves it offline; no `useEffect` fetching.
  - `LevelHero({ level, source, actions })` shows a large level block: fill colour, pattern, pictogram, numeral `levelIndex`, level name, and up to three action texts from `actions.<code>`. `source` is `"personal" | "site"`, with its explanation line.
  - `ShadeBand({ hours, timeZone, nowIso })` renders a `<ol>`, one `<li>` per hour, with a visible hour label (latn digits), the pattern, the numeral, `aria-label` "13:00, Orange, level 3", the current hour marked `aria-current="time"`, a hatched "no data" cell for null levels, and a ban-hours outline when `ban_active`. Its order follows the document direction.
  - `TodayView` states:
    - **loading**: `loading.tsx` plus the Hero and Band skeletons, at the same dimensions as the loaded state (no CLS).
    - **empty, no profile**: `EmptyState`, title `today.empty.title`, reason "Set up once so we can work out your own heat limit — about a minute", primary → `/worker/setup`, secondary → "See today's site level without setup" (`?view=site`).
    - **error**: `ErrorState` with `problem.request_id` and retry → `refetch()`.
    - **partial**: `StaleBanner` when `freshness === "stale"` or the query is served from cache while offline. If `personalLevel` is null, the hero shows the site level with `source="site"` and a one-line reason. Null hours appear as "no data" cells.
    - **success**: the hero shows `displayedLevel(site, personal)`, a band, a link to Alerts, the closed-app limitation line, the policy version in the footer ("Levels: policy mock-0") and the `DraftBadge`.

- [ ] **Step 1: Write failing tests.**
  - `freshness.test.ts`: 2 h59m old → fresh; 3 h01m → stale.
  - `ShadeBand.test.tsx`: renders 15 `li`. The `13:00` item's accessible name includes `Orange` and `3`. In an `ar` render the hour label text is `13:00` (Western digits). The null-level hour is named by `states.noData`.
  - `TodayView.test.tsx` (MSW + a seeded profile store):
    - no profile → link to `/en/worker/setup`;
    - `problemOnce(...,500)` → the request id text is shown, then Retry → success;
    - `staleToday()` → a banner with `Last updated`;
    - with the Task 9 profile and fixtures at frozen time 13:30 Dubai → the hero shows `Orange`, source personal.
  Run them: FAIL.
- [ ] **Step 2: Implement.** Run `pnpm test`: PASS.
- [ ] **Step 3: Write the e2e** `today.spec.ts`: the worker happy path (setup → today shows the hero and band); and `offline reload shows stale banner` (visit online with the profile seeded via `addInitScript`, set offline, reload; the hero and band still render from cache and the banner is visible once the clock is advanced past 3 h with `page.clock`). Run it: PASS.
- [ ] **Step 4: Commit.** `git add frontend` then `git commit -m "feat(frontend): worker today screen with personal level and four states"`.

---

### Task 11: Supervisor crew list and crew timeline skeleton (four states)

**Files:**
- Create: `frontend/src/features/supervisor/{CrewList.tsx,CrewTimeline.tsx}`, `frontend/src/app/[locale]/(supervisor)/supervisor/{page,loading}.tsx`, `frontend/src/app/[locale]/(supervisor)/supervisor/crews/[crewId]/{page,loading}.tsx`, `frontend/public/templates/crew-template.csv`
- Test: `frontend/tests/unit/features/supervisor/{CrewList,CrewTimeline}.test.tsx`, `frontend/tests/e2e/supervisor.spec.ts`

**Interfaces:**
- Consumes: `serverApiClient`, `call` (RSC, returning `Result`, never throwing, so the request id survives production error sanitisation), `ShadeBand`, the state components.
- Produces:
  - `/supervisor?site=<id>` (RSC). `site` defaults to the first site; a site picker uses `<select>` and navigation.
  - `CrewList({ crews, siteId })`: one row per crew with name, member count and a link to its timeline.
  - `/supervisor/crews/[crewId]?date=` (RSC) → `CrewTimeline({ timeline, timeZone })`: a `ShadeBand` of `crew_level`, a row of `share_above_amber` as whole percentages, and ban-window outlines.
  - Supervisor states:
    - **loading**: row and band skeletons in `loading.tsx`.
    - **empty** (site has no crews): reason "Crews appear here once they are added for this site", primary "Open the demo yard" → `?site=site-demo-mussafah`, secondary "Download the crew template (CSV)" → `/templates/crew-template.csv` (columns `crew_name,member_count`, no personal fields).
    - **error**: `ErrorState` with `request_id` and a client "Retry" calling `router.refresh()`.
    - **partial**: when `suppressed` is true, the band shows the crew level only, the share row is replaced by `supervisor.suppressed` ("Fewer than {k} people — detail hidden to protect privacy"), and null hours are "no data".
  - No component in `features/supervisor` reads any field outside the `CrewTimeline` allowlist from Task 5.

- [ ] **Step 1: Write failing tests.**
  - `CrewList`: renders 2 rows for the fixture; an empty array renders the empty state with both CTAs.
  - `CrewTimeline`: `crew-a` shows `share_above_amber` 0.42 as `42%`; `crew-b` (suppressed) has no percentage text and shows the suppression message with `k=5`.
  Run them: FAIL.
- [ ] **Step 2: Implement.** Run `pnpm test`: PASS.
- [ ] **Step 3: Write the e2e** `supervisor.spec.ts`:
  - list → crew-a timeline renders;
  - `?site=site-demo-empty` → the empty state;
  - crew-b → the suppression message;
  - an MSW `problemOnce` on the timeline (via a `x-sb-mock-scenario: error` request header the mock server honours) → the request id is visible.
  Run it: PASS.
- [ ] **Step 4: Commit.** `git add frontend` then `git commit -m "feat(frontend): supervisor crew timeline skeleton with k-suppression and four states"`.

---

### Task 12: Full e2e suite, axe, visual snapshots, Lighthouse CI, CI wiring

**Files:**
- Create/Modify: `frontend/playwright.config.ts`, `frontend/tests/e2e/a11y.spec.ts`, `frontend/tests/e2e/visual.spec.ts`, `frontend/lighthouserc.json`
- Modify: `.github/workflows/ci.yml` (`frontend` job only)

**Interfaces:**
- Produces:
  - Playwright `webServer` is an array: `pnpm mock:api` (port 4010), then `pnpm start` (port 3000, env `API_ORIGIN=http://127.0.0.1:4010`, `VAPID_PUBLIC_KEY=<test key>`). Tests run against the production build.
  - Projects: `mobile-chromium` (Pixel 7) and `desktop-chromium`.
  - Visual snapshots run only inside `mcr.microsoft.com/playwright:v1.65.0-noble` (script `e2e:visual` uses `docker run`; CI uses that container for the step), so baselines are Linux-rendered. Check the tag exists on MCR first; if the `-noble` suffix differs, use the documented tag for 1.65.0.

- [ ] **Step 1: a11y spec.** For `/en/worker` (empty and seeded), `/ar/worker` (seeded), `/ur/worker/alerts`, `/en/supervisor`, `/en/supervisor/crews/crew-a`, `/en/supervisor/crews/crew-b` and `/en/hse`, run `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()` and expect `violations` to equal `[]`.
- [ ] **Step 2: visual spec.** Full-page snapshots at 390×844:
  - worker today seeded in `en`, `ar`, `ur` × light and dark;
  - worker empty `en`;
  - supervisor crew-a and crew-b `en` and `ar`.
  Generate baselines with `pnpm e2e:visual --update-snapshots` in the container and commit them.
- [ ] **Step 3: Lighthouse CI.** `lighthouserc.json` collects `/en/worker` and `/en/supervisor` from `pnpm start` (mobile preset, 3 runs). Assert `categories:performance ≥ 0.9`, `categories:accessibility = 1`, `largest-contentful-paint ≤ 2500`, `cumulative-layout-shift ≤ 0.1`, `total-blocking-time ≤ 200` (lab proxy for INP), and `resource-summary:script:size ≤ 174080` (170 KB) on `/en/worker`.
- [ ] **Step 4: CI.** Append to the `frontend` job:
  - `pnpm exec playwright install --with-deps chromium`
  - `pnpm build`
  - `pnpm e2e` (excluding visual)
  - a step running the visual spec inside the Playwright container (`docker run --rm -v $PWD:/w -w /w/frontend mcr.microsoft.com/playwright:v1.65.0-noble pnpm e2e:visual`, with pnpm installed in the container via `npm i -g pnpm@12.18.0`)
  - `pnpm dlx @lhci/cli@0.16.0 autorun`
  - `pnpm design:lint`
  - upload `playwright-report/` on failure with `actions/upload-artifact@v7.0.2`
  Run the whole job locally, steps in order. Expected: green.
- [ ] **Step 5: Commit.** `git add frontend .github/workflows/ci.yml` then `git commit -m "test(frontend): e2e, axe, rtl visual snapshots and lighthouse budgets in ci"`.

---

### Task 13: Deployed-environment readiness (handshake with I1)

**Files:**
- Modify: `frontend/next.config.ts` (security headers), `frontend/src/app/[locale]/layout.tsx` (no change if already correct)
- Test: `frontend/tests/e2e/headers.spec.ts`

**Interfaces:**
- Consumes: I1 sets `API_ORIGIN`, `VAPID_PUBLIC_KEY` and `APP_VERSION` on the `web` container app. I1's health gate calls `GET /api/healthz` on port 3000.
- Produces: response headers on all pages: `Content-Security-Policy` (`default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. `'unsafe-inline'` for scripts stays until nonces are wired (parked with trigger "before any pilot").

- [ ] **Step 1: Write the failing e2e** `headers.spec.ts`: `/en/worker` returns each header above; the SW script responds 200 with a JavaScript content-type. Run it: FAIL.
- [ ] **Step 2: Implement** via `headers()` in `next.config.ts`. Run it: PASS. Rebuild the Docker image and re-run the Task 1 Step 5 curl.
- [ ] **Step 3: Commit.** `git add frontend` then `git commit -m "feat(frontend): security headers for deployment"`.

---

### Task 14: Design gate (render, critique, fix), then "done"

**Files:**
- Create: `docs/design/f1/critique.md`, `docs/design/f1/*.png`

- [ ] **Step 1: Render.** With `pnpm build && pnpm start` and the mock API, capture 390×844 and 1280×800 screenshots of every state:
  - worker today: empty, loading (throttled), error, partial/stale, success;
  - alerts: unsupported, denied, subscribed, iOS install card;
  - supervisor: list, empty, error, crew-a, crew-b suppressed;
  - hse;
  - each in `en`, `ar` and `ur` × light and dark.
  Save them to `docs/design/f1/`.
- [ ] **Step 2: Critique.** Dispatch the `design-craft:visual-critic` agent (Sonnet) on these routes with DESIGN.md as ground truth. Ask it to score the 12-criterion rubric. Before it flags any contrast issue on a tinted background, it must run a composite contrast check (known over-flagging; see memory). The gate passes when no criterion scores below "meets" and there are zero WCAG AA failures.
- [ ] **Step 3: Fix and re-gate.** Apply the fixes as token or component changes, never one-off literals. Re-render and re-score. Record before/after in `critique.md`.
- [ ] **Step 4: Verification before completion.** Run `pnpm lint && pnpm typecheck && pnpm api:check && pnpm test && pnpm build && pnpm e2e && pnpm design:lint` and paste the summary lines into `critique.md`.
- [ ] **Step 5: Commit.** `git add docs/design/f1 frontend` then `git commit -m "docs(frontend): f1 design gate evidence"`.

---

### Task 15 (standalone, Ali, 3 hours, finish by Fri 13 Nov): Real-phone Web Push spike

**Purpose:** prove or disprove the riskiest integration (ADR 0004; roadmap risk "Web Push fails on real phones") on real hardware before F2 builds on it. This runs on the Task 7 build. It does not need the backend.

**Prerequisites (Ali):**
- Phones:
  - **P1** a cheap Android (any OEM below about USD 200, Chrome current);
  - **P2** a second Android from a different OEM, Samsung or Xiaomi preferred (both rated aggressive background-killers by dontkillmyapp.com; their effect on web push is unverified, research §4);
  - **P3** an iPhone on iOS ≥ 16.4.
- An HTTPS URL for the web app. Either the deployed `web` from I1 (Task 6 there sets `VAPID_PUBLIC_KEY`), or a local `pnpm build && pnpm start` exposed with `cloudflared tunnel --url http://localhost:3000` (install: `winget install --id Cloudflare.cloudflared`; the quick-tunnel URL changes per run, so re-install the PWA on the phones if it changes).
- VAPID keys: `pnpm dlx web-push@4.0.0 generate-vapid-keys --json`. Put the public key in the web env (`VAPID_PUBLIC_KEY`) and both keys plus `VAPID_SUBJECT=mailto:<an address you choose>` in `frontend/.env.spike.local`. Store the same pair in GitHub (I1 Task 0) so the backend later sends with it.

**Procedure (per phone):**
1. Open `<url>/en/worker/alerts?debug=push`. On P3 use Share → Add to Home Screen first, then open from the Home Screen icon.
2. Tap Enable and allow notifications. Copy the subscription JSON (Copy or Share), send it to the laptop, and save it as `frontend/spike/p{1,2,3}.json` (gitignored).
3. For each case below, send `pnpm push:send --sub spike/pN.json --level amber`. Note the printed send time and the arrival time shown on the phone. Repeat each case 3 times.

| # | Case | P1 | P2 | P3 |
|---|---|---|---|---|
| C1 | App in foreground | | | |
| C2 | App in background (home screen) | | | |
| C3 | App closed (swiped away) | | | |
| C4 | Screen locked ≥ 5 min | | | |
| C5 | Battery saver on, screen locked ≥ 5 min | | | |
| C6 | Phone offline 2 min, then online (TTL 3600) | | | |
| C7 | Tap notification opens `/en/worker` (or `/ar/...` after switching the app to Arabic once) | | | |
| C8 | Arabic: switch the app to `ar`, send `--level red`; the title is Arabic and the vibration pattern is felt | | | |

**Pass / fail:**
- **PASS (Web Push is the Tier A demo path):** P1 receives C1–C4 in 3/3 sends each with arrival ≤ 60 s, and C7 opens the correct locale. P3 receives C1–C3 in at least 2/3 when installed. No crash or uncaught error in the alerts page on any phone.
- **CONDITIONAL:** P1 passes but P2 fails C3–C5. Document the OEM setting that fixes it (for example, battery "unrestricted" for Chrome) and add that setting to the iOS/Android install card copy in F2.
- **FAIL:** P1 fails any of C1–C4. Same day: try the hand-written SW fallback (ADR 0003) once. If it still fails, F2 makes in-app polling plus supervisor crew relay the primary demo path, and Web Push becomes "specified, partially verified" in the limitations (roadmap risk table).
- Record every cell (latency in seconds or ✗), phone model, OS and browser versions, and battery settings in `docs/research/2026-11-13-web-push-spike.md` (Ali writes it or dictates it to a subagent). Commit with `docs(research): real-phone web push spike results`.

---

## Parked (add to `docs/parking-lot.md` in Task 14's commit)

| What | Why parked | Revisit when |
|---|---|---|
| Storybook 10.6.7 component stories (frontend-discipline rule 12) | Nine-day window. State coverage comes from Vitest component tests plus Playwright visual snapshots per state | After 20 Nov, or when a second developer joins |
| Pre-rendered alert audio player, "I feel unwell" offline queue, crew-relay mode, break-things panel | F2 scope (roadmap 15–17 Nov) | F2 plan |
| Recharts / maps in supervisor and HSE | No F1 need; the shade band covers the timeline | F2 HSE aggregate view |
| CSP nonces (drop `'unsafe-inline'`) | Needs nonce plumbing through RSC | Before any pilot |
| `openapi-typesafe` fork (TS 6/7 native) | 9 days old, RC, single maintainer | If openapi-typescript stays without TS 6 support past the TS 7 migration |
| Motion library (`motion` 14.12.0) | No animation in F1 | First animated interaction |
| Minimal config screen (ADR 0010): the active version with its effective tunables and ranges, activation history with actor and reason, a version diff, and "propose / activate / roll back" with a required reason. The admin token is entered per session, kept in memory only and forwarded by the BFF as `Authorization`; it is never put in storage. Read-only without a token | Admin API ships in B3 (16 Nov) | F2, 17 Nov (roadmap §1; stretch item 5a) |
| Clothing options beyond work clothes | Values must come from NIOSH Table 3-2 through B3's policy endpoint (ADR 0006) | B3 publishes the policy |

## Execution

Execution method already chosen: **subagent-driven** (superpowers:subagent-driven-development). Sonnet implements each task, a fresh Sonnet reviewer checks it, and an Opus whole-branch review runs at the end. Order: 1 → 2 (Ali gate) → 3 → 4 → 5 → 6 → 7 (spike may start) → 8 → 9 → 10 → 11 → 12 → 13 → 14. Task 15 is Ali's and runs as soon as Task 7 is merged and an HTTPS URL exists. Target: Tasks 1–7 by end of Thu 12 Nov, 8–14 by end of Fri 13 Nov. The roadmap's F2 then regenerates `schema.d.ts` from B3's spec on 14 Nov. Per ADR 0009 §5 the source is the committed file `backend/openapi/v1.json` (not a live `/openapi.json` fetch), so `api:check` stays deterministic in CI; `api:gen` gains that second source and the mock spec is deleted once B3's spec covers every path above. Backend breaking changes are caught by the backend job's oasdiff step.
