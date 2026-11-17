# ADR 0040: The gold-dataset regression gate is stricter than the B1 brief: 1e-6 tolerance, exact group sets, and a WBGT check that cannot pass with the axis dead

- **Status:** Accepted-by-controller (B1 ruling, awaiting Ali's review)
- **Date:** 2026-11-12
- **Deciders:** the B1 controller (Claude); recorded for the architect (Claude); Ali's review pending
- **Supersedes / superseded by:** none. Departs from the wording of B1 plan Task 11 (`0.005` tolerance; `NONFINITE_INPUT` exempt); the plan carries a dated note. Implements the "a mismatch stops B2" sentence of [ADR 0005](0005-data-truth-features-and-validation.md) Consequences
- **Evidence:** B1 controller rulings 25, 26, 27, 28 (`b1-summary.md`, deleted after merge; the paths below last); `backend/tests/regression/test_gold_dataset.py` (commit `a98a9ea`); `docs/research/2026-11-12-gold-dataset-manifest.json` (`code_version` 64efe24, output sha256 `8124c86c…a1db`); Task 10 offline parity run (commit `bb2f4ab`); Task 11 review of the first version of the test

## Context
ADR 0005 requires B1's dataset build to reproduce the research's pair counts and pooled raw MAEs exactly, and stops B2 on a mismatch. The B1 brief turned that into three assertions: identical `n` and `|mae - csv| <= 0.005`, `|bias - csv| <= 0.005` per row of `baseline_errors_pooled.csv`; the exact pair counts; and a WBGT check in which, among rows whose inputs are all present, only reject codes other than `NONFINITE_INPUT` count against a 0.1% limit.

Two measurements show those assertions are looser than the evidence allows:
1. **Tolerance.** Task 10 served the research's own downloads through the real adapters offline: 64 of 64 pair-count groups exact and 192 raw-error groups within 1.8e-15. The live run later measured about 1e-15. A tolerance of 0.005 is thirteen orders of magnitude above what identical inputs produce, so it would accept a real, small drift.
2. **WBGT axis.** The Task 11 review showed the brief's WBGT check passes with the axis dead: setting every `wbgt_fc_reject` to 1 (`NONFINITE_INPUT`) still passed, because that code was exempt. On the live data no complete-input row has `NONFINITE_INPUT`, so the exemption did no work except hide a failure.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Keep the brief's 0.005 and the `NONFINITE_INPUT` exemption | Both pass on a broken pipeline (above) | Rejected |
| Tolerance 1e-9 | Task 10 noted 1e-9 would also pass on identical inputs (measured agreement ≈1e-15) | Not chosen: preflight ruling F15 had already adopted 1e-6, which is about 3.7 orders stricter than the brief's 0.005 and leaves room for a float summation-order change in a library bump (the reasoning, not a measurement) |
| 1e-6, exact group sets, only OK counts in the WBGT check, recomputed from the parquet (chosen) | Measured agreement ≈1e-15; mutants (all rejects, null codes, OK with NaN, 0.2% offenders) fail | Accepted |

## Decision
The gate as committed in `a98a9ea` is the B1 exit criterion (`uv run pytest -m regression -v -rs` → 3 passed, 0 skipped):
1. **Pair counts:** `joint` and `joint_daytime` equal data doc §5.1 for exactly the expected 64 (model, summer, lead) groups (IFS and GFS: 2024-2026; AIFS: 2025-2026; leads 0-7). A missing or extra group fails.
2. **Raw errors:** `n` identical, and bias, MAE and RMSE each within **1e-6** of the research CSV, for every CSV row; a group in the dataset but not in the CSV fails. A NaN on either side is a difference.
3. **Recomputed, not read:** every number is recomputed from `gold/pairs.parquet` with `summarize_pairs`. The expected values come from the research CSV and the data doc, never from the manifest or the code under test: a manifest that vouches for its own dataset proves nothing.
4. **WBGT:** for each of `wbgt_obs_c`, `wbgt_fc_c`, `wbgt_fc_refrad_c`, among rows whose six solver inputs are all non-null, a row counts as accepted only if its reject code is `OK` **and** its WBGT is finite. Any other code (`NONFINITE_INPUT` included), a null code, or `OK` with a non-finite value counts against the 0.1% limit. A dataset with no complete-input row fails.
5. **No silent skip:** a missing dataset skips each of the three tests visibly, with the resolved path in the reason. The exit criterion is zero skips.
6. **Procedure checks the test cannot make** (run by the controller, recorded in the SDD ledger): `job_run` has a `succeeded` row for each of the six commands and none `skipped_locked`; the manifest lists 112 inputs and 48 `observation_qc` entries; `SB_GIT_SHA` is set; the run uses a `git archive` snapshot so later edits cannot touch it; the advisory-lock key is the command plus its source or model, so `ingest-observations:iem` and `:ghcnh` never share one key.

**Result, 12 Nov:** 3 passed, 0 skipped. 1,708,032 rows from 112 inputs. All 64 pair-count groups exact. All 192 raw-error groups have identical `n` and agree within 1e-6. `wbgt_fc_c` and `wbgt_fc_refrad_c` are `OK` in all 1,708,032 rows; `wbgt_obs_c` has 9,200 `NONFINITE_INPUT` rows, none among rows with all inputs present. Four earlier `job_run` rows are `failed` (two `gfs_seamless`, two `ecmwf_aifs025_single`: client timeouts and Open-Meteo HTTP 429 "Too many concurrent requests") and stay in the table; the cause was orphaned server-side requests after the 60 s client timeout, not the daily quota (ruling 27).

## Consequences
- A stricter gate fails loudly. Two legitimate failure modes are documented in the test's docstring: an IEM or Open-Meteo archive revision (exact `n` then differs with no code change; compare the `inputs` SHA-256s of `gold/manifest.json` with the build that passed: different hashes are input drift, equal hashes are code drift), and a future dataset with a legitimate `NONFINITE_INPUT` among complete rows (it fails and gets explained, never exempted).
- Adding a model or summer means updating the expected set deliberately.
- **Cost of being wrong:** a stricter gate fails loudly and costs one investigation; a looser gate would have cost an undetected drift under B2's models. The first is cheaper.

## Revisit trigger
An upstream archive revision breaks exact `n`; a model or summer is added; B2 reuses the gate for its own training-data check; Polars is bumped past 2.0.0 (ADR 0008) and the 1e-6 margin is exercised.

## Links
[ADR 0005](0005-data-truth-features-and-validation.md) · [ADR 0006](0006-physics-wbgt-phs-niosh-twl.md) · [manifest](../research/2026-11-12-gold-dataset-manifest.json) · [B1 plan, Task 11](../superpowers/plans/2026-11-11-b1-backend-foundation.md)
