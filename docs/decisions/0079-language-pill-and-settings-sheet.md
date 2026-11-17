# ADR 0079: One header language pill opens a settings sheet; "Screen colors" replaces the Sun toggle

- **Status:** Accepted (owner decision, 2026-11-17, D4). "Change crew" and the lazy loading of the sheet's body ([ADR 0088](0088-settings-sheet-body-loads-on-first-open.md), built) are the architect's (owner informed in the controller's report of 2026-11-18).
- **Date:** 2026-11-18
- **Deciders:** Ali (owner); the architect (Claude)
- **Supersedes / superseded by:** replaces the six always-visible language chips and the "Sun mode" button (F1/F2). Amends root `DESIGN.md` §6 (written in `cb7e4fa`). The sheet's weight on every route is treated in [ADR 0088](0088-settings-sheet-body-loads-on-first-open.md).
- **Evidence:** slice S5, `cb7e4fa` (merge `0dc6fc6`); `frontend/src/components/shell/SettingsSheet.tsx`, `ScreenColors.tsx`; `04-visual-fixes.md` §3.2.

## Context
Six scripts in the header cost width and attention on every screen. "Sun mode: on" explained nothing.

## Decision
1. **One pill** in the header shows the current language in its own name and script, with a chevron. It opens the settings sheet.
2. **The sheet is a native `<dialog>` opened with `showModal()`.** No library, no new client dependency: the browser supplies the top layer, the focus trap, Escape and the backdrop. Focus returns to the pill on close. Right-to-left follows the document direction; heights are `min-height` so Nastaliq grows a row.
3. **Contents.** Language: six rows of 56 px (`--target-stop`) in endonyms, which are never translated; each is a plain link that loads a new document (the `[locale]` layout owns `<html>`, so a soft navigation would lose `data-theme`). Screen colors: Automatic, Bright, Night, kept until the next local midnight; Automatic hands the choice back to the sun. "Change crew": only where the shell is given one (the worker app); it releases the pin as the page leaves.
4. **Removed:** `LanguageChips`, `SunToggle`. No six-chip control remains in the built app. The plan's idea of chips on first-run and join screens is not built (S6b, [ADR 0082](0082-deferrals-after-the-redesign.md)).
5. **Strings:** 9 new Tier 1 (six languages, machine drafts), 6 removed.

## Consequences
- A language change costs one more tap than before. The plan reasoned that choosing the language at join makes a wrong language unlikely; join's language step is not built, so today the worker changes it through the pill. Not tested with workers.
- **Cost of being wrong:** a worker who cannot find the pill stays in the wrong language; the pill shows the current language in its own script. The sheet is client code on every field route, which caused a budget overrun on `/hse`.

## Revisit trigger
A worker test finds the pill missed; a route fails its budget because of the sheet (see 0088); S6b is built and the join flow takes over the language choice.

## Links
[ADR 0077](0077-control-system-two-radii-and-four-tiers.md) · [0088](0088-settings-sheet-body-loads-on-first-open.md) · [0082](0082-deferrals-after-the-redesign.md) · [04-visual-fixes](../design/redesign-2026-11-17/04-visual-fixes.md)
