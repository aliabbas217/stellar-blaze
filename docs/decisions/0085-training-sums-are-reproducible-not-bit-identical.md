# ADR 0085: Training float sums are made reproducible; claims say "reproducible", never "bit-identical"

- **Status:** Accepted by the architect (owner informed in the controller's report of 2026-11-18). One open item (`evaluate.py`) is recorded, not resolved.
- **Date:** 2026-11-18
- **Deciders:** the architect (Claude)
- **Supersedes / superseded by:** none. Resolves the parking-lot row "Polars float aggregation order makes some fold statistics non-bit-reproducible under CPU load", whose proposed remedy (`maintain_order=True`) was wrong.
- **Evidence:** `f79d7fa` (the fix and its test), merged by `465f532` (on `origin/main`); `backend/src/stellar_blaze/domain/forecast/features.py` `_group_sum`; `backend/tests/unit/forecast/test_features.py::test_fold_stats_are_bit_identical_whatever_the_partitioning_and_thread_count_of_polars`.

## Context
`fit_fold_stats` summed floats with a bare `pl.col(c).sum()` inside `group_by`. Polars may run that as a partitioned group-by: partial sums per partition, then a merge whose association changes from run to run and with the thread count. Two fits of the same rows differed in the last digits of the pooled climatology, and some tests were flaky on a 2-vCPU runner. `maintain_order=True` fixes the order of groups, not this sum. Measured on the `weeks_4_8_12_16` fixture over 30 trainings per thread count: before, 2 to 6 distinct model fingerprints at 1, 2, 4 and 16 threads; after, one at every count.

## Decision
1. **`_group_sum(column)` is the one way to sum a float in a fold group-by.** It returns `pl.col(column).drop_nulls().sum()`. The `drop_nulls` changes no value (a sum skips nulls) but stops the expression being a plain column aggregate, so each group is summed over its own rows. The result equals the old code under `POLARS_NO_PARTITION=1`.
2. **Guard.** A fresh interpreter with `POLARS_FORCE_PARTITION=1` at 1, 2 and 16 threads must give the digest of the in-process fit. The test fails 3 of 3 on the old code. (Setting the variable inside a running interpreter does nothing, so a subprocess is required.)
3. **Wording.** Claims say **"reproducible"**, never "bit-identical", even though the test's name uses it for the fold statistics. The station climatology is unchanged; the pooled climatology moves by at most 1.4e-14 against the old output, which itself depended on the machine's thread count (`f79d7fa` message).
4. **The released model is untouched.** Training outputs before 2026-11-17 were machine-dependent in the last digits; a retrain gets a new model id. The 2026 scored files are not claimed to be bit-reproducible by a re-run.

## Open item: not audited
`backend/src/stellar_blaze/ml/evaluate.py` line 736 has a similar pattern: `frame.group_by(key, maintain_order=True).agg(_aggregates(models, frame))`, with a comment ("Polars' float mean of a large group is run-to-run nondeterministic otherwise") that names the same wrong remedy. It has **not** been audited. Nothing in this ADR says it is safe.

## Consequences
- **Cost of being wrong:** a reviewer re-runs training or evaluation and sees last-digit differences in a place not covered. The wording rule and the open item are the mitigation.

## Revisit trigger
An audit of `evaluate.py` and the other train-side aggregates; a Polars release that fixes or documents the partitioned sum; any new float `group_by`.

## Links
[ADR 0005](0005-data-truth-features-and-validation.md) · [0007](0007-ml-quantile-corrector-conformal.md) · [0008](0008-backend-stack.md) · [parking lot](../parking-lot.md)
