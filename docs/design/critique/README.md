# Critique gate record (2026-11-11)

Render-and-critique gate for `../prototype/` (20 pages). Folders:

| Path | What |
|---|---|
| `gate/` | design-gate round 1: every page × {390, 768, 1440} × {light, dark}, full-page + viewport PNGs, `metrics.json`, axe, verdict JSON |
| `gate-r2/` | round 2 after the fix batch (same matrix); **the current evidence** |
| `screens/` | 19 curated screenshots (worker en/ur/dark, supervisor dark, HSE, every main replay page at 1440, season at 390/768/dark) |
| `taste-direction-second-opinion.md` | the one taste-direction run on the direction, with dispositions |
| `contrast.mjs` | the OKLCH → sRGB → WCAG contrast calculator used for every number in DESIGN.md |

Command per page: `node design-gate.mjs http://127.0.0.1:8765/<page>.html --src prototype --out critique/gate-r2/<page> --json`,
against a short-lived `python -m http.server` (stopped after the run).

## Gate result

| Round | Pass | Blockers |
|---|---|---|
| r1 | 0 / 20 | touch-target on every page (prototype control-bar links 16 px tall, breadcrumb and list links); season ribbon `role="img"` without a name; worker targets partly under the sticky dock |
| r2 (final) | **17 / 20** | worker-today, worker-alerts, worker-data: axe `target-size` "partially obscured" ×1 at 390 (768 for worker-data) |

Source gate (design-lint): 0 blocking, 0 advisory on every page. No horizontal overflow at any width or theme.
Distinct radii 1, shadows 0, all type on the scale.

**The 3 remaining failures are one accepted exception, for Ali to confirm.** In the captured frame (scroll 0) one
control sits half under the sticky worker dock (bottom tab bar + "I feel unwell"). It becomes fully exposed on scroll;
`scroll-padding-block-end` keeps any focused control clear of the dock (WCAG 2.2 2.4.11). The only structural fix
is an inner scroll container, which breaks mobile address-bar collapse and pull-to-refresh, so it was rejected.
The same failure on the "I feel unwell" screen was **not** accepted: there the hidden control was the second call
button, so the screen was reordered (call buttons first) and now passes.

## Second opinions

### impeccable critique (run once, dual-agent)

Method: dual-agent (A: design review, Opus; B: detector + browser evidence, Sonnet), isolated, in parallel.
Deviations from the impeccable protocol, stated: the snapshot was not persisted to `.impeccable/critique/` (that
writes outside `docs/design/`, which this phase may not do), and the closing questions go to Ali through this
file and `../HANDOFF.md` instead of an interactive prompt (this phase ran as a delegated agent).

**A. Design review: 27/40 (Acceptable, close to Good) before fixes.** Specificity verdict: "clearly authored for
this product": the hatched rimmed sign, the shade band reused as the season ribbon, the clause-cited plan strip,
"What you cannot see here", the 403 next to the worker's audit row. Sameness on desktop: four equal tile grids.
Heuristic table and walkthrough: `../ux/04-heuristic-review.md`.

**B. Detector:** 114 static findings, of which most were false positives against the declared system (hatch
patterns = "repeating stripes"; skeleton shimmer = "marquee"; dark-theme tokens not listed in DESIGN.md prose;
jsdom-only tight leading). Real: 11 over-long lines, 6 long uppercase stamps, stamp vertical padding, 12 px chart
axis text, one stamp at 1.1 leading. **cream-palette** fired on every page.

### taste-direction (run once, on the direction, before the prototype)

12 findings, 7 adopted as rules, 3 rejected with reasons, 2 already ours. See `taste-direction-second-opinion.md`.

### Reconciliation (where the three agree, disagree, and what won)

- **Warm paper.** taste-direction T1 and the impeccable detector (cream-palette) independently flag the sand
  surface as close to the AI "warm paper" default; impeccable A, judging the rendered pages, calls the design
  "clearly authored". **Kept**: the sand is domain-derived and identity lives in the signage elements, which A
  confirmed carry it. Guard rail added: every empty state shows a level element. **Revisit trigger:** if the
  built screens read as generic in the 18 Nov polish pass, move `surface` one step cooler (hue 80 → 95) before
  touching anything else.
- **Red spent on statistics.** A (P1) found four red-filled counters with no focal point; this contradicted the
  direction's own rule that saturation is rationed. **Changed** (DESIGN.md §8 Counter): ink counters, a small rimmed
  danger marker, and the pre-registered outcome sentence promoted to a framed verdict block above the scoreboard.
- **Uppercase stamps.** DESIGN R4 said uppercase; the detector flagged 35-56 character uppercase runs. **Changed:**
  uppercase only up to three words; longer stamps in sentence case.
- **Hand-drawn pictograms.** taste-direction says use an icon library; the detector did not flag them; A praised
  the redundant level coding. **Kept** (signage is the identity), utility icons may come from one library in F2.

## Changes made in response (fix batch, then round 2)

| # | Finding (source) | Severity | Change |
|---|---|---|---|
| 1 | Plans key/value pairs collapse to ~10 px at 1440 (A) | P0 | `.card` is a size container; `.kv` stacks under 22rem card width |
| 2 | Four red counters, no focal point, verdict sentence tiny (A) | P1 | ink counters + rimmed danger marker; verdict block above the ribbon; POD/FAR/CSI defined inline |
| 3 | Worker action pictograms orphaned on their own line at 390 (A) | P1 | `actions-list` grid with 48 px pictogram plates |
| 4 | Validator "4 rules" vs 3 rule ids (A) | P2 | "N violations across M rules" |
| 5 | Replay rail shows no order (A) | P2 | numbered steps via a CSS counter |
| 6 | Refused request styled as the "ours" highlight (A) | P2 | `card--refused`: neutral raised surface + sign rim |
| 7 | Band hour labels and sign time too small for glare (A, Rafiq) | P2 | hour labels at body size 600; sign time at title size |
| 8 | Touch targets under 24 px; ribbon without a name (gate) | blocker | 24 px minimum on chrome, breadcrumb and list links; `aria-label` on the ribbon; scrubber on its own row on phones |
| 9 | Second call button hidden under the dock on "I feel unwell" (gate + looking at the pixels) | blocker | call buttons moved directly under the step heading |
| 10 | Over-long lines, long uppercase stamps, stamp padding, 12 px axis text, 1.1 leading (B) | minor | `.desk p` capped at 66ch; sentence-case long stamps; stamp padding; axis at label size |
| 11 | Latin text in Urdu pages rendering in a serif fallback (looking at the pixels) | minor | `[dir=rtl] [lang=en]` rule + `lang="en"` on Latin islands |
| 12 | Builders' reports: `.stack-1/.stack-4` undefined, ban hatch never painted, nested `lang="ur"` not switching font, `[hidden]` overridden | defects | fixed in `assets/proto.css` / `proto.js` |

## Open (not fixed in the prototype; carried to HANDOFF)

- Supervisor plan page is long (≈ 3,200 px at 768); F2 adds an in-page index and collapses the clause table by default.
- No "withdraw sign-off" path after signing; F2 adds it with a reason and an audit row.
- Stop work has an undo toast but no "crew notified" confirmation moment.
- Urdu action lines all read "wording awaits review" (the real F1 key); native short labels needed.
- Judges' glossary (parked); the day chart's inverted TWL axis relies on its caption.
