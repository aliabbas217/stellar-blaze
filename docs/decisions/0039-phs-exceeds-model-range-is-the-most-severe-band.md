# ADR 0039: A PHS result above 42 °C is `exceeds_model_range`, the most severe band, never "missing"

- **Status:** Accepted-by-controller (B1 ruling, awaiting Ali's review)
- **Date:** 2026-11-12
- **Deciders:** the B1 controller (Claude); recorded for the architect (Claude); Ali's review pending
- **Supersedes / superseded by:** refines the PHS output guard of [ADR 0006](0006-physics-wbgt-phs-niosh-twl.md) (its decision text is unchanged; it carries a dated amendment). Nothing is superseded
- **Evidence:** B1 controller ruling 21 (`b1-summary.md`, deleted after the branch merges, so the paths below are the lasting evidence); `backend/src/stellar_blaze/domain/physics/phs.py` (`check_phs_output`, `RejectionReason`, module docstring); commits `eca0477` (Task 14) and `5a38284` (fix round 1) on `feat/b1-backend-foundation`; the Task 14 review probe: 154 of 3,249 validator-accepted nominal inputs (4.7%); parking-lot row "PHS `exceeds_model_range`"

## Context
ADR 0006 says "Outputs with rectal temperature outside 36-42 °C are rejected", and says PHS is advisory: "NIOSH and TWL drive levels when PHS is unavailable". Read together, a hot result and a missing result look the same to a consumer: a rejection, therefore "PHS unavailable", therefore ignored.

The Task 14 review measured what the upper side of that band holds. Of 3,249 inputs that the validator accepts (nominal ranges), 154 (4.7%) gave a predicted rectal temperature of 42.2-45 °C, with the 38 °C limit reached after 27-39 minutes. The input window allows predictions up to about 49 °C (tdb 45 °C, tr 100 °C, 3.5 met). These are the most dangerous valid cases. The first implementation rejected them as `implausible_output`, with a docstring that falsely said a validated input never produces that reason.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Keep one reason, `implausible_output`, for everything outside 36-42 °C (ADR 0006 as written) | Maps the hottest valid 4.7% to "bad data"; a consumer that falls back to NIOSH/TWL on any rejection drops the stop-work signal exactly when strain is highest | Rejected |
| Widen the accepted band to about 49 °C and return the number | A prediction above 42 °C is outside the range the guard trusts (stack doc §6.3); returning it as an ordinary result presents it as a calibrated prediction | Rejected |
| Split the reasons: below 36 °C `implausible_output`, above 42 °C `exceeds_model_range`, non-finite `nan_output` (chosen) | One `Literal` value more; each reason has one meaning | Accepted |

## Decision
1. `check_phs_output` returns, in this order: a non-finite field → `PhsRejected(reason="nan_output")`; finite `t_re_c` below 36 °C → `implausible_output` (kernel garbage, for example the 0.0 it returns for a zero height); finite `t_re_c` above 42 °C → `PhsRejected(reason="exceeds_model_range")` whose `detail` ends with "(rectal-temperature limit reached after N min)" from `d_lim_t_re_min`. The reason set is now `invalid_input`, `out_of_scope`, `timeout`, `nan_output`, `implausible_output`, `exceeds_model_range`, `worker_crashed`.
2. **`exceeds_model_range` means "strain beyond what the model can describe: treat it as the most severe band, never as missing data".** This is written in the type's docstring, the module docstring and the detail string, and a test pins a validated hot case.
3. **Binding on every consumer (B3 risk logic and any later caller):** `exceeds_model_range` maps to the most severe band. It must never be handled as "PHS unavailable" and must never trigger the NIOSH/TWL fallback. B3 carries a test for this mapping. B1 has no PHS consumer, so the mapping is B3's to build.
4. For a validated input only `exceeds_model_range` is expected. `nan_output` or `implausible_output` then mean the kernel changed or failed, and `check_phs_output`'s docstring asks for a log line at warning level or above. As built, the runner (`adapters/compute/phs_process.py`) logs worker kills, replacements and crashes but not these two reasons, so the B3 consumer logs them.

## Consequences
- ADR 0006 gets a dated amendment (2026-11-12) pointing here, and the parking-lot row gets a resolution note. ADR 0006's decision text stays as written: its rejection still happens, only the reason splits.
- Two other facts from the same review that B3 must respect: `t_re_c` is not monotone in radiant load while the worker is compensable, so it must not be used alone as a severity scale; and the first-call latency of the PHS worker is the startup plus the call timeout (about 70 s worst case with the defaults, parking-lot row `PhsRunner.start`).
- **Cost of being wrong:** one `Literal` value to rename. If the split were wrong the other way (a hot result that should be an ordinary number), the loss is a conservative band, never a missed warning.

## Revisit trigger
B3 consumes PHS (the mapping and its test must exist before it ships); ISO 7933:2023 is obtained, so the 36-42 °C band and the body-size window can be sourced; pythermalcomfort closes #524/#523 and the guard is re-tested.

## Links
[ADR 0006](0006-physics-wbgt-phs-niosh-twl.md) · [parking lot](../parking-lot.md) · [B1 plan, Task 14](../superpowers/plans/2026-11-11-b1-backend-foundation.md)
