# Second opinion: taste-direction on Arish Signal rev2 (run once, 2026-11-11)

Invoked explicitly, once, as an independent read of `docs/design/DESIGN.md`. design-craft owns the direction;
this file records what the second opinion said and what we did with it. No competing direction was produced.

**Its design read (§0.B):** "Trust-first, accessibility-critical safety product for low-literacy outdoor workers,
supervisors and a judging panel, with a signage language, leaning toward native CSS tokens + shadcn on Base UI."
Its dial preset for trust-first / public-sector is VARIANCE 3, MOTION 2, DENSITY 5. Arish Signal already sits there
(one grid, static except the scrubber, medium density). **Agreement.**

**Scope caveat it states itself (§13):** the skill is for landing pages and portfolios, "not dashboards, dense
product UI". The worker, supervisor, HSE and admin views are product UI, so most of its landing-page rules
(hero stack, bento, logo walls, real photography) do not apply. Only the demo surfaces are presentation-like.

## Findings and dispositions

| # | Finding (taste-direction section) | Applies? | Disposition |
|---|---|---|---|
| T1 | Warm paper / cream background + espresso near-black text is the #2 AI tell (§4.2, hex family `#fbf8f1`, `#1a1714`) | Partly. Our `surface` `#fbf6ee` and `ink` `#140e09` sit in that family. The ban targets premium-consumer briefs with brass accents; ours is a desert-sand neutral from the domain with a teal action and signage fills | **Kept, with the challenge recorded.** The sand is domain-derived (the *arish* and the site), and a slightly warm off-white reduces glare against pure white. Identity is carried by the hatch, the rim, the condensed numerals and the level fills, not by the background. Re-check at the critique gate: if the rendered page reads as "generic warm paper" without the signage elements in view, the empty states are the risk (fixed by putting a level element or pictogram in every empty state) |
| T2 | Zero em-dashes in visible copy (§9.G) | Yes, cheaply. Several F1 strings use "—" | **Adopted.** Added to DESIGN.md Do's and Don'ts and to HANDOFF (string audit). k-suppressed cells show the words "fewer than k", never a dash glyph |
| T3 | Never hand-roll SVG icons; use Phosphor / Tabler (§3.C) | No | **Rejected.** The four level pictograms and four flow pictograms are signage on a 24-unit grid with mitred joins; they *are* the identity, and a friendly icon library would read as app chrome. They are few, reviewed, and must be native-speaker tested either way. Utility icons (close, copy, chevron) may come from one library in F2 (Tabler, stroke 2, square caps, to match) |
| T4 | Section-number eyebrows (`01 LEVELS`) are a tell (§9.F) | Yes, the F1 specimen uses them | **Adopted** for product screens: no numbered eyebrows. The specimen page can keep them (it is a specimen) |
| T5 | No decorative status dots (§9.F) | Yes | **Adopted.** State is shown by the level sign, a stamp or words; the only dots are station-truth data points in the day chart |
| T6 | No filled-track progress bars as comparison visuals (§9.F) | Yes, on the scoreboard | **Adopted.** Scoreboard compares with numbers + interval text; the season ribbon is the one comparison graphic |
| T7 | Fake-precise numbers are banned unless labelled mock (§4.9) | Yes | **Already our rule** (`⟨slot⟩` + PLACEHOLDER stamp) |
| T8 | Middle dot rationed to one per line (§9.F) | Yes | **Adopted** in stamps and metadata lines |
| T9 | Respect `prefers-color-scheme` unless the brand insists (§6.C, §8.C) | Conflicts with R2 (worker defaults to light) | **Kept R2** on evidence (positive polarity in bright surroundings, DESIGN.md §1.6), with a visible toggle; supervisor / HSE / demo follow the system |
| T10 | No pure `#fff` (§8.B) | Marginal | **Rejected** for `on-primary` and `on-level-red/green`: white gives the contrast (5.79, 6.63, 5.18); off-white would cost it |
| T11 | Skeletons that match layout; empty states that say how to populate; `:active` press feedback (§4.5) | Yes | **Adopted**; press feedback = `transform: translateY(1px)` only, disabled under reduced motion |
| T12 | One accent, locked (§4.2) | Yes | **Already** (falaj teal only; R6 is the same hue at low chroma, not a second accent) |

**Net effect on the direction:** none of the findings breaks the direction or its gate; T1 is the one real
challenge and is kept with a stated reason and a check at the gate. T2, T4, T5, T6, T8 and T11 became rules.
