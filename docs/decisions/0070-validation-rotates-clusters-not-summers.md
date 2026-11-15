# ADR 0070: Validation rotates clusters, not summers, for the 2026 evaluation; summer-rotated validation is the design for the next model

- **Status:** Accepted by the architect (Ali's suggestion of 2026-11-15, researched; Ali informed and free to overrule)
- **Date:** 2026-11-15
- **Deciders:** the architect (Claude), on Ali's suggestion ("a held-out summer for test, rotating summers for validation so we don't overfit")
- **Supersedes / superseded by:** none; explains a limit of [ADR 0005](0005-data-truth-features-and-validation.md) and pre-registration §2.3 and §6, and sets the design for the next model
- **Evidence:** pre-registration `2026-11-12-preregistration-2026-evaluation.md` §2.3 (train, tune, test) and §6 (selection rules); the evaluation report `2026-11-15-evaluation-report.md` §5.2, §5.3 and §6 (development against 2026); freeze addendum §2 (truth-Red share by summer); web research of 2026-11-15: [Roberts et al. 2017, Ecography, cross-validation for data with temporal, spatial or hierarchical structure](https://www.biometrie.uni-freiburg.de/mitarbeiter/dormann/roberts-et-al-2017-ecography.pdf) (blocked cross-validation is nearly always more appropriate than random folds when the goal is prediction to new data), [Forecast Evaluation for Data Scientists, arXiv 2203.10716](https://arxiv.org/pdf/2203.10716) (final held-out period; tune on blocked folds), a wind-field downscaling study that chose whole consecutive years as validation folds so that daily correlation and seasonality do not leak ([arXiv 2008.12257](https://arxiv.org/pdf/2008.12257)), and a post-processing thesis that calibrated GFS ensembles with leave-one-year-out folds. No source found tests leave-one-year-out for post-processing with only two or three years, so what follows is a design argument, not a cited benchmark.

## Context
Ali's suggestion matches the shape of the protocol in one half and differs in the other:
1. **Test = a held-out summer: done.** 2026 is scored once, after the freezes (§2.3, §9).
2. **Validation = rotating folds: done over clusters, not summers.** Tuning and selection (§6) use leave-one-cluster-out (LOCO) over six clusters on 2024-2025 (random splits and leave-one-station-out banned).

What LOCO does not rotate is time. All clusters see the same days, so when one cluster is held out, the other clusters' training rows still contain the same weather days: day-level regimes (a heat wave, a dust event) leak across folds, and a held-out cluster is "a new place on days the model has seen". The estimate is therefore optimistic for "a new summer". The 2026 result shows the size of the gap in several places, in both directions: the running-bias baseline B3d beat the corrector on temperature in development (CRPS 1.005 against 1.056) but not on 2026 (1.032 against 0.824); the hottest-tercile temperature coverage was 0.784 to 0.806 in development but every H2 stratum was inside [0.85, 0.95] on 2026; H4 was negative on the 2025 development scoreboard and supported on 2026; the truth-Red share was 13.8% in 2024 and 6.9% in 2025. Summer-to-summer variation is large, so a development estimate from two summers is a noisy guide.

## Options
1. **Rotate summers now (leave-one-summer-out on 2024-2025).** Two folds, each trained on one summer (half the data) and validated on the other. Weak: thin training sets, two validation draws. It would also change the pre-registered selection after the test was scored, which would void the pre-registration. Rejected for the 2026 evaluation.
2. **Cluster-by-summer blocking** (hold out a cluster and a summer together). Needs more summers than we have.
3. **Keep the registered protocol for 2026 (chosen), disclose the limit, and design the next model with summer rotation.**
4. **An exploratory summer swap on 2024-2025 only** (train 2024, test 2025, and the reverse): no guard-file edit and no 2026 data, but a new fold type in the development harness and a weak (one-summer) training set. Parked below.

## Decision
- **2026 evaluation: unchanged.** Selection stays on cluster-LOCO and the test stays 2026. Nothing about the released model or any threshold changes.
- **Disclosure.** The evaluation report's caveats (section 8) gain one line: selection rotated clusters, not summers, so development estimates are optimistic for a new summer, and one test summer is one draw of summer-to-summer variability. The deck and video say "selected by cluster rotation on 2024 to 2025, tested once on the held-out summer 2026", and never imply that validation rotated summers.
- **Next model (after the submission).** Train on 2024 to 2026 and validate by leave-one-summer-out (three folds), keeping clusters blocked inside each fold when a new-site claim is made; nest the hyperparameter search inside the summer folds where the data allow, or keep the grid as narrow as the registered one (eight configurations) and report the finalist spread; hold the next summer (2027) out as the prospective test. This is the design Ali suggested, and it needs a third summer to be worth doing.
- **Parked: exploratory 2024-2025 summer swap.** Trigger: spare capacity after the F2 integration, with no guard-file edit. It is exploratory, not pre-registered, and changes nothing in the released model.

## Consequences
- **Cost of being wrong:** development numbers (including those in the evaluation report's pre-run record) may overstate how well a selection rule transfers to a new summer. The 2026 test, which is independent of the selection, is the claim; the development numbers are context.
- No new dependency, no code change.

## Revisit trigger
A third usable summer of data (the 2027 season, or a longer archive); a pilot site with its own history; the exploratory swap shows a rule flipping between summers.

## Links
[ADR 0005](0005-data-truth-features-and-validation.md) · [0007](0007-ml-quantile-corrector-conformal.md) · [0034](0034-demo-strategy.md)
