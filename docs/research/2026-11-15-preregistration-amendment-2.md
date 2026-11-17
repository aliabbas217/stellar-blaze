# Pre-registration amendment 2: calibration-window rule reads all four variables

- **Date:** 2026-11-15, written before any 2026 scoring and before the "2026 go" marker.
- **Amends:** `2026-11-12-preregistration-2026-evaluation.md` §6.4 (calibration window selection). The original file is unchanged; the protocol lock hashes it and this amendment.
- **Decided by:** Ali, in chat, 2026-11-15.

## What was ambiguous

§6.4 selects the calibration window by a 90% interval coverage rule on the hottest tercile of forecast WBGT (floor 0.85, leads 1-3), but does not say whose interval the rule applies to. H2 (the 2026 hypothesis) requires coverage between 0.85 and 0.95 per stratum for temperature (T), dew point (Td), wind and WBGT.

## What happened first

On 2026-11-14 the B2 controller ruled, before any run (ledger R50), that the rule applies to the WBGT interval only. The first real development run (2024-2025 data only, 217,952 out-of-fold rows, 278 days, "dev run 1") then produced, for the hottest tercile at leads 1-3:

| Variable | Coverage, leads 1/2/3 |
|---|---|
| WBGT | 0.892 / 0.892 / 0.883 |
| T | 0.757 / 0.760 / 0.770 |
| Td | 0.779 / 0.754 / 0.751 |
| Wind | 0.862 / 0.865 / 0.862 |

Under the WBGT-only reading the window stays `september`; under the all-variables reading it switches to `weeks_4_8_12_16`. With `september`, H2 would very likely fail for T and Td on 2026.

## Decision

The rule applies to **all four variables**: the selected window is the one that satisfies the 0.85 floor on the hottest tercile for T, Td, wind and WBGT (the same floor and strata H2 tests); ties and the fallback follow §6.4 as written. Reason: the rule exists to choose honest uncertainty, and understated uncertainty on the hottest days is the failure that matters for worker safety.

## Disclosure

- This reading was fixed **after** seeing development results (2024-2025 only). It was not informed by any 2026 number; no 2026 outcome has been scored or looked at for this choice.
- The pre-run WBGT-only reading and its result stay recorded in the B2 ledger (R50) and the dev-run-1 selection file, and will be reported alongside the final result as the reading made before any run.
- Effect: one extra leave-one-cluster-out calibration run inside the re-run (about 25 minutes). `selection.json` records the reading used (`calibration_targets: all`).

## Obligations

The protocol lock must also hash this file; the 2026 gate refuses to run unless the pre-registration, amendment 1 and amendment 2 all match.
