# Build brief for the v2-final prototype (shared by every builder)

Read, in order: `../DESIGN.md` (Qaylula), `../critique/inner-screens-gap.md` (the four inner-screen rules),
`../ux/v2-journeys.md` (§3-§7 journeys, §10 screens + states, §12 addendum), `../research/friction.md` §12
requirements, `worker-today.html` (**the reference inner screen**: hero spine, one primary action, states, sun mode),
`assets/kit.js` + `assets/base.css` + `assets/tokens.css` (shared kit: use it, do not edit it; put page CSS in the page
and list any kit change you need in your report), `assets/heat.js` (data helpers and ramps).
Content and logic to carry over (the substance was right in v1; the look was not): `../../prototype/*.html` (v1) and
`../../HANDOFF.md`. Real data only from `data/*.json`; pending scored numbers read "scored 12 Nov" or show the pending
state; never invent a value.

## Every screen must
1. Have **one hero object** from real data owning ≥ 35 % of the first fold at its main width.
2. Have **one primary action** (filled `.btn.primary` or `.btn.signal`), at most one secondary. Worker "I feel unwell"
   in the dock is the permanent emergency control and does not count.
3. Draw **time** with the shared `spine()` (or the same visual grammar): now → next break → end, the day, the
   season or the week. The qaylula slot is drawn when the ban is in force on the shown date (the replay day is
   Thu 3 Sep 2026, so yes; live November dates: no slot on worker screens, dashed labelled outline on desktop).
4. Link to the previous screen with View Transitions: shared `view-transition-name` values `wordmark`, `spine`,
   `level` where the element exists on both pages.
5. Ship four states through `data-when` (+ `boot({ states: [...] })`): ideal, loading, empty (actionable), error,
   plus stale / offline / partial / refused where the journeys doc lists them.
6. Follow DESIGN.md: Archivo with tabular figures, IBM Plex Mono **only** for codes / coordinates / hashes, 12 px
   floor, 2 px radius, no shadows, no hatch, heat colour only on data, level = word + thin scale + small mark, tags
   only where the tag is the information, copy that tells (verb + number) with explanations behind "Why?" or the
   proof drawer. No em or en dashes in visible copy.
7. Field surfaces (worker, supervisor phone) call `boot({ surface: 'field', at: <replay time> })` so sun mode applies;
   desktop surfaces use `boot({ surface: 'desk' })`.

## Verify before you report
- Serve: `http://127.0.0.1:8766/prototype/` (root = `docs/design/v2`). If it is down, start
  `python -m http.server 8766 --bind 127.0.0.1` in `docs/design/v2` and stop it when done.
- Screenshot every page and state you own with
  `node "C:/Users/LEGION/AppData/Local/Temp/claude/c9efb48f6f935e8c/014d9cea-9854-40c1-ad4e-9698e91ae2e0/scratchpad/dshot.mjs" "<url>" D:/dev/stellar-blaze-f1/docs/design/v2/gate/after/<page>[-<state>] <widths> [full]`
  (worker / supervisor phone pages at 390; desktop pages at 1440 and 390). It must print overflow 0 and no console
  errors. LOOK at every PNG; at least two render-look-fix rounds per page.
- Run no git. Write only your own pages (and your PNGs in `../gate/after/`).
