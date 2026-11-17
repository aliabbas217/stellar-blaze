# ADR 0077: Control system: two radii by function, pill chips, four control tiers, Stop as the one ink slab

- **Status:** Accepted (owner decision, 2026-11-17): the owner approved the redesign direction and the button-sheet prototype, and decided D3 (Stop is an ink slab, not red).
- **Date:** 2026-11-18
- **Deciders:** Ali (owner); the architect (Claude)
- **Supersedes / superseded by:** amends the root `DESIGN.md` §5.1 (written in the same commit as the tokens, `8ba3bde`), and the §11 radius row and §12 table. "2 px everywhere" is superseded. The colour palette, spacing, type family and motion are unchanged.
- **Evidence:** `04-visual-fixes.md` §1 and §2; `8ba3bde`, `808db3d`, `115a336` (merge `efbfcb5`); `frontend/scripts/contrast.mjs` and `tests/unit/styles/tokens.test.ts`, which re-compute every hover, pressed and busy fill in both themes (all above 4.5:1 per the message of `8ba3bde`).

## Context
The owner's review: every primary was a hard slab, every secondary a hairline rectangle, and selection, navigation and action shared one shape.

## Decision
1. **Two radii by function.** `--r-ctl` 12 px for every control a hand presses; `--r-card` 16 px for panels, sheets, dialogs and drawers; `--r-pill` 999 px for selection chips and the tab pill. `--r` 2 px stays for data marks only (spine cells, the slot, level marks, scale segments, table rules, stamps). The rule: what you read is cut, what you press is rounded. This is a design rationale (gloved hands), not tested with workers.
2. **Four tiers.** Primary: `signal` fill with `on-signal` text, 52 px (44 px in dense desk views). Secondary: `raised` fill with a 1.5 px `edge` ring, same size. Quiet: text only, 44 px hit area. **Stop**: `ink` fill with `ground` text, 56 px, full width, always with a glyph, the only solid ink slab on a screen ("Stop work", "I feel unwell"), never red. One primary per screen; Stop is never counted as the primary.
3. **Why not red.** ISO 3864 uses red for stop, but `--lv-red` already means the Red level, so a red Stop bar on an Orange screen reads as an escalation of the level, and colour is reserved for data.
4. **Selection** is a filled pill with a check mark and weight 600, never colour alone. Tabs are a segmented pill.
5. **States** (`--mix-*` tokens, `--dur-press` 120 ms) are tokens with a unit test, not hand-picked colours.

## Consequences
- The change touches every screen: the full browser e2e must run before the branch merges ([ADR 0084](0084-full-browser-e2e-leaves-the-per-push-ci.md)).
- **Cost of being wrong:** a Stop that is not red might be missed by someone who expects red. It is differentiated by being the only solid slab, by its glyph and by its fixed position. If a comprehension test shows otherwise, change one tier, not the system.

## Revisit trigger
A worker comprehension test of Stop and "I feel unwell"; a contrast failure in a new state; the owner reverses D3.

## Links
Root `DESIGN.md` §5.1 · [ADR 0045](0045-f2-scope-core-demo-path.md) · [0065](0065-unwell-flow-reconciles-with-cop-3-1-2e.md) · [04-visual-fixes](../design/redesign-2026-11-17/04-visual-fixes.md)
