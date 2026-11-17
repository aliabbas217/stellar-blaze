# ADR 0088: Settings sheet body loads on first open; a misplaced import is fixed; the 170 KB product budget stands

- **Status:** Accepted by the architect (owner informed in the controller's report of 2026-11-18). Built and measured: decision 1 in `c8ea751`, decision 3 in `46db54e`; `pnpm bundle:check` passes for every route.
- **Date:** 2026-11-18
- **Deciders:** the architect (Claude), on the controller's measurements; Ali (owner) informed
- **Supersedes / superseded by:** none. Amends [ADR 0069](0069-per-route-budget-exception-for-data-routes.md) by pointer. No ceiling changed.
- **Evidence:** `pnpm bundle:check` on the merged `integration/redesign` tree (slices S1 to S7 and S6a merged), gzip first-load JS, at three points (below); the build output in `frontend/.next` (the chunk `20ilta620o5aq.js`, read by the architect, which held a whole `LevelSign` module); commits `cdff137` (the safety view's own lazy chunks), `c8ea751`, `46db54e`; `SettingsSheet.tsx`, `SettingsSheetBody.tsx`, `FieldShell.tsx`, `states/Skeletons.tsx`, `level/level-sign-height.ts`.

## Context
After the redesign slices were merged, `pnpm bundle:check` failed on `/hse` and left `/supervisor/enter` 241 B of headroom. Two things were in `/hse`'s first load that the page does not need: the settings sheet's body (statically imported by `FieldShell`, so every field route paid for it) and a whole level-sign module (the `Pictogram` glyph paths, `LevelSign`, `LevelMark`, `LevelScale`, 5,471 B raw), pulled in because `states/Skeletons.tsx` imported one constant, `LEVEL_SIGN_HEIGHT`, from `level/LevelSign.tsx`. A bundler includes whole modules.

| Route | Merged tree | After decision 1 | After decision 3 | Limit |
|---|---|---|---|---|
| `/[locale]/hse` | 174,740 B (660 B over) | 174,160 B (80 B over) | **172,472 B** | 174,080 B |
| `/[locale]/supervisor/enter` | 173,839 B | 172,919 B | 172,919 B | 174,080 B |
| `/[locale]/supervisor` | 195,229 B | 194,309 B | 194,340 B | 199,680 B |
| `/[locale]/worker` | 190,325 B | 189,665 B | 189,701 B | 199,680 B |
| `/[locale]/worker/join` | 163,370 B | 163,370 B | 162,569 B | 174,080 B |

(The small movements on `/supervisor` and `/worker` after decision 3 are chunk grouping, not content.)

## Decision
1. **The sheet body loads on first open (built, `c8ea751`).** The header keeps the pill and the `<dialog>` with its title and Close. The language rows, "Screen colors" and "Change crew" are `SettingsSheetBody.tsx`, loaded with `React.lazy` on first open and fetched in the browser's idle time before that (skipped when the phone asks to save data). A body that cannot be loaded leaves the sheet open with its title and Close, and the page behind it intact (an error boundary). Saving: about 580 B on every route with the shared header. Checked in a real build with Playwright: the body is requested before any tap and the sheet shows six languages and the colours; with the chunk blocked and service workers off, the sheet opens with its title, Close works and the pill stays usable (a `ChunkLoadError` is logged). jsdom does not show a rejected lazy module to a boundary, so the unit test proves only that the sheet stays usable.
2. **No ceiling is raised and `/hse` does not join the data-screen class.** The 170 KB product budget is "never edited" (`check-bundle-size.ts`). The exemption of ADR 0069 rests on the data layer being needed with no byte-neutral lever left; here a lever existed.
3. **A misplaced import is fixed (built, `46db54e`).** `LEVEL_SIGN_HEIGHT` and the line-height expressions it uses (`KICKER_LINE`, `HEADER_LINE`, `WORD_LINE`, `WORD_TRIM`) moved unchanged into `components/level/level-sign-height.ts`, a leaf module with no imports. `LevelSign.tsx` imports them and re-exports `LEVEL_SIGN_HEIGHT`, so every existing import keeps working; `Skeletons.tsx` imports the leaf. Result: `/hse` 172,472 B, 1,608 B under its ceiling; the architect's estimate was 172.3 KB. Two unit tests keep the mechanism visible (the sign re-exports the same object, `Skeletons.tsx` does not import the sign, the leaf imports nothing); `bundle:check` is the real guard.

## Options considered
- **A. Put `/hse` in the 195 KB class** (CEILINGS and REQUIRED, a Lighthouse row, a 0069 amendment). Rejected: it would loosen a route by about 25 KB for good and leave the defect in every other route that shows a skeleton. Kept as the fallback if the structural fix had left under 1 KB of headroom; it did not.
- **Trim `/hse`'s own code further.** Already split into lazy chunks in `cdff137`; the remaining client shell is small.

## Consequences
- **Cost of being wrong:** a later change adds weight to `/hse` and it is over again: the gate fails the build, and the answer is another structural trim or a ruling with a bundle diff, as before. Headroom is 1,608 B on `/hse` and 1,161 B on `/supervisor/enter`; routes within 2 KB of a ceiling should be watched.
- **Risks of decision 1:** offline, a chunk the service worker never fetched cannot load, so "Screen colors" may not open unless the idle prefetch ran while online (the language rows need the network anyway); nothing safety-critical is in the sheet (Stop and "I feel unwell" live elsewhere).

## Amendments owed to ADR 0069 (verified)
- The ceilings in `check-bundle-size.ts` match the ADR (174,080 B; 199,680 B for the five routes). `/hse` stays in the default class.
- The ADR says "every other route keeps 0.9, 2.5 s, 200 ms", but `lighthouserc.json` holds the landing at 0.8 and 3.0 s (ADR 0037 §3).
- The Lighthouse matrix landed in `88938f1` and runs only in the manual workflow ([ADR 0084](0084-full-browser-e2e-leaves-the-per-push-ci.md)); "stays red until Task 25" is stale.
- `/start`, `/tour`, `/hse`, `/hse/enter`, `/supervisor/enter` and `/worker/join` have no Lighthouse row (14 URLs).
- **Not drafted, evidence not found:** the idle-host re-measure of Task 25; `docs/design/f2/gate/budget.md` (absent). The Node image bump is already done (24.22.3 by digest in `fb8adcf`); 0069 says nothing about Node.

## Revisit trigger
Any route within 1 KB of its ceiling; the HSE weekly table (H1) is built, when `/hse` will probably need the data-screen class and should be ruled then with a bundle diff.

## Links
[ADR 0069](0069-per-route-budget-exception-for-data-routes.md) · [0079](0079-language-pill-and-settings-sheet.md) · [0081](0081-un-defer-safety-view-tour-start-and-worker-join.md) · [0084](0084-full-browser-e2e-leaves-the-per-push-ci.md) · [0087](0087-continuous-deployment-from-main.md)
