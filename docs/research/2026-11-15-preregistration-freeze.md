# Pre-registration freeze addendum (section 11)

- **Written:** 2026-11-15, by the B3 controller (Claude), **before any 2026 Warnings or Plans number exists** and before the "2026 go" marker.
- **Fills:** `docs/research/2026-11-12-preregistration-2026-evaluation.md` section 11 (SHA-256 `ce116fe64a00b8b5509ae567a72973e85d1cf2120af725127b970bdb8885b7b8`), amended by `2026-11-14-preregistration-amendment-1.md` and `2026-11-15-preregistration-amendment-2.md`. Neither is edited.
- **Bound by the lock:** the architect adds `freeze_path` and `freeze_sha256` to `backend/training/protocol.lock.toml` after this file is committed and approved. The gate (`open_gate`, `_check_freeze`) then refuses `warnings` and `plans` unless this file's hash matches, and `frozen_inputs` refuses unless the SHA-256 of `theta.json`, of the ruleset file and of `demo_site.toml` appear below (and unless `theta.json` records the same ruleset id and SHA-256).
- **Status:** final for the lock. The open decisions of the first draft are settled: the Red edge (amendment 3 section 2), the stamp reading (amendment 3 section 3) and the secondary Warnings rows (amendment 3 section 1). Any later edit changes the lock and voids a signed go marker. Every value in sections 1 and 2 is computed from 2024-2025 data or from regulation and policy, none from 2026 (the roster export of section 3 item 10 is not a frozen value).

## 0. What was and was not run on 2026, and the order of decisions (the disclosure amendment 1 section 0 asks for)

- **B3 code that reads 2026 data was never run.** `sb-jobs evaluate-2026` (any part) was not run by the B3 controller or by any B3 agent; the real gate was never opened; `artifacts/eval/2026/` was not read. B3's tests use synthetic gold, series, models and a fake git (B2's `GatedWorld`), including a synthetic end-to-end test of both runners.
- **2026 information seen by the B3 controller:** none beyond what the pre-registration's section 10.1 records (B2's raw-forecast diagnostics and the roster research).
- **Development runs that were made (2024-2025 only, labelled "DEV 2025, LOCO out-of-fold: not the result"):** `sb-jobs freeze theta` on B2's exported out-of-fold samples (section 2) and `sb-jobs scoreboard dev --summer 2025`, whose files are committed beside `theta.json`. They exist so the frontend builds on real shapes and so the range of theta is known. **They are not results.** The 2025 development scoreboard exists in the repository; a reader may compare it with the 2026 run. Its outcome is negative under the registered rules (H4 not supported on the P1 side, H5 not supported), and it is negative under every reading in section 3.
- **Order of decisions, so that nothing reads as chosen after a number:**
  - Before any theta or scoreboard was computed on any data: the hour weighting of theta (the Task 12 brief), the H5 point-estimate reading and the H4 "at least as good on both" reading (Task 13 brief and its first implementation, commit 8a41ab9), the withdrawal sensitivity definition, the demo-day rule.
  - A development scoreboard on the real out-of-fold file already existed when later changes were made: the Task 13 implementer ran `sb-jobs scoreboard dev --summer 2025` once (timing and a regression test, commit 8a41ab9), before the review. The later changes, the `H4-lead2` verdict, the replicate rule of section 3 item 6 and the wording and description fixes (commit bd587e0), were decided from the pre-registration text, the section 13 table and a code and test review, not from a development number, and none of them changes a point estimate. The replicate rule changes only whether a sparse policy's interval is null (it touches no point estimate).
  - The Red edge ruling of section 2 was made after the 2024-2025 development share was computed (it is a decision to keep a value frozen by amendment 1, not a new value), before any 2026 scoring.
  - theta_protect and theta_balanced are the outputs of the section 6.5 rules plus the weighting clarification, which was fixed before theta was computed on any data. The unweighted alternative is published in section 2.

## 1. Section 11.1 values (regulation and policy; no 2026 data)

| Slot | Value | Source |
|---|---|---|
| `ruleset_id` | `ae-heat-2026.1` | `backend/rulesets/ae-heat-2026.1.toml` |
| `ruleset_sha256` | `cff47102285ef8da9ee2db720c55498ce31d786a08cf88acfa40a22779b25c8e` | SHA-256 of that file's bytes (LF); recorded in `backend/rulesets/lock.json` |
| `margin_w_m2` | 7 | ADR 0047 (range 7 to 20; the frozen value is the minimum) |
| `withdrawal_limits` | off | ADR 0047, ADR 0006 |
| TWL zone edges | Low at or above 140 W/m2, Medium 115 to 140, High below 115; Red edge 85 W/m2 | ADOSH Table 1; ADR 0046 decision 5 |
| Ban window (ruleset `[labour]`) | 12:30 to 15:00 GST, 15 June to 15 September | Ministerial Resolution 44/2022 Art. 3 |
| Juvenile ban-season clause | `P-H5.ban_season` (added to this ruleset's hash; planner and validator cite it) | Decree-Law 33/2021 Art. 5(2)(e), verbatim quote with the product reading labelled (R-AC; ADR 0011) |
| `demo_site_sha256` | `e76e930fa1cb1c0fb1f1b3716d3edea6504535ba0cd09eba2852f4969fe3a83f` | `backend/fixtures/demo_site.toml` (SIMULATED; identical as read and with CRLF read as LF) |
| Scored crew and roster | `crew-b` (concrete pour, heavy work, 20 experienced adults, 6 days a week), roster L1: 06:00-11:00 and 15:00-18:00 GST | the fixture (SIMULATED crew); label "REAL weather + assumed crew" |

## 2. Section 11.2 values (2024-2025 only)

| Slot | Value |
|---|---|
| `model_id` | `corrector-20261114-d327987-6edafa` (manifest SHA-256 `cfe27f6894133f805682fe5bccfccd4c18877c6775413937f89fb6d2b712989b`, in the lock) |
| `selection_sha256` | `635ba0f9619e8720fcb9a70909e74d9448670443696485113833c488b5f6a8ee` (`artifacts/eval/dev/selection.json`) |
| `theta_protect` | **0.30** (largest theta on {0.05, ..., 0.95} whose hour-weighted POD for truth-High hours is at least 0.90; POD 0.906) |
| `theta_balanced` | **0.45** (maximum hour-weighted Peirce skill score, 0.5936) |
| `theta.json` SHA-256 | `3f82084c7b4e31841e411b5402ba8d9673bb6654625b2e7c528cd49e69b3a408` (`artifacts/eval/dev/theta.json`; it records the ruleset id and SHA-256 above and the weighting text) |
| Inputs of theta | B2's out-of-fold samples `oof_samples_abu_dhabi.parquet`, SHA-256 `ee2727ac9254ec37e0433b199c589d1f455d67957ec1041352309377745d6e95`: abu_dhabi cluster held out (OMAA, OMAD), lead 1, hours 06-14 UTC, 2024-2025; 4,256 hours with a positive ban weight (the weight-0 hours 09Z and 10Z in the ban season are not counted); computed with the ruleset above at commit `bd587e013ccbfd20009638c4c39acef37372850b` (`sb-jobs freeze theta --oof <B2 file>`) |

**The weighting clarification (not in section 6.5; an architect clarification, Ali informed and free to overrule).** Section 6.5 says "POD for truth-High hours". Each hour carries its section 7.2 ban weight (08Z in the ban season 0.5, 09Z and 10Z 0, 11Z 1, off season 1), so that the 0.90 target describes the same hour-weighted quantity that the Warnings row later scores, and 0.30 is the more protective operating point. **The literal reading with every hour weighing 1.0 gives theta_protect 0.35 and theta_balanced 0.55** (`sb-jobs freeze theta --unweighted --oof <the same file>`: print-only, writes nothing, same ruleset and commit). Both pairs are published here so that either can be compared with the 2026 run.

**Standing condition (amendment 1 section 2.4 and ADR 0046 section 4):** it applies only if theta_protect is below 0.10. It is 0.30, so the condition is not triggered.

**Truth-Red share, reported as information (amendment 1 section "Effect on the rows"; ADR 0046 Consequences) and ADR 0046's revisit trigger.** The share of working hours whose truth effective TWL is below the Red edge (85 W/m2, margin 7 applied), from the same out-of-fold hours as theta (2024-2025, lead 1, 06-14 UTC), each hour weighted by its section 7.2 ban weight:

| Station | Weighted share (2024-2025) | 2024 | 2025 | Unweighted share, all 06-14 UTC hours |
|---|---|---|---|---|
| OMAA (the ADR's measure) | 0.103 | 0.138 | 0.069 | 0.139 |
| OMAD | 0.192 | 0.219 | 0.165 | 0.238 |
| OMAA and OMAD (the theta frame) | 0.148 | | | 0.189 |

ADR 0046's revisit trigger reads "the 2024-2025 truth-Red share is above 10% of working hours". **It has fired:** OMAA is 10.3% weighted (13.9% unweighted), and the share differs by summer (13.8% in 2024, 6.9% in 2025). Amendment 1 (decided by Ali) froze the Red edge at 85 W/m2 and asked only for this report. **Decision (the architect, recorded in amendment 3 section 2; Ali informed): the Red edge stays 85 for the pre-registered evaluation**, because the edge is frozen by amendment 1 and a change would need a new ruleset hash, a new theta and a new addendum. The ADR's stated cost of a Red edge that is too high is that crews stop more than needed (productivity, labelled POLICY), never less protection than ADOSH's own cycles. The edge is to be revisited after the evaluation, with the 2026 share as a further input. The weighted OMAA figure is above the trigger by 0.3 percentage points only; the unweighted figure and the OMAD figure are clearly above it. (The earlier draft of this file labelled 0.148 as a share of truth-High hours; that was wrong, and the table above replaces it.)

## 3. Readings and definitions fixed here (each is a clarification before scoring; none changes a registered hypothesis)

The architect confirmed items 1 to 6 (R-AN, R-AM, R-AO, R-AQ) on 2026-11-15, with the cost if wrong shown.

1. **H5 "+25% false alarms"** is read as a point-estimate rule: FA(P3) is at most 1.25 times FA(P2), together with fewer missed danger hours with a paired interval that excludes zero. The pre-registration gives no interval rule for the allowance. *Cost if wrong:* a stricter interval reading could turn a supported H5 into an unsupported one; H5 is secondary and never a headline.
2. **H4 "If P2 is at least as good as P3"** (the outcome text when H4 fails) is read as P2 at least as good on both missed danger hours and false-alarm hours, by point estimates. *Cost if wrong:* the sentence "our AI did not beat the regulator's own zones" would appear in a case a reader would not read that way, or the reverse; the H4 verdict itself does not depend on it.
3. **Section 13, lead 2 (strict) versus lead 1 on H4 (R-AM, settled by the architect in amendment 3 section 3):** the file carries an extra verdict `H4-lead2` (the same rule, paired bootstrap, blocks and seed at lead 2). The stamp "issued by 18:00 GST the evening before" is carried only if H4 holds at BOTH leads 1 and 2. If H4 holds at lead 1 but not at lead 2 the stamp is dropped from the video and the strict number is shown, as section 13 prescribes; if H4 fails at lead 1 the stamp is not carried either, whatever lead 2 shows. *Cost if wrong:* the stamp is withheld in a case where lead 2 alone would have supported it.
4. **The withdrawal sensitivity cell "on" (R-AO)** applies the dry-bulb leg only (above 44 C): no natural wet-bulb source exists, so the second leg of the meteoHazard rule (ADR 0006) is not applied, and the cell likely understates the effect on humid afternoons. The headline uses the frozen switch (off). *Cost if wrong:* a sensitivity cell, never a headline.
5. **Plans row counters (section 7.3):** rule-violation minutes count the 5-minute ticks with at least one validator violation against the truth timeline, times 5. Missed protection (counter 3) counts truth High or Red worked ticks scheduled at a lighter cycle, as the pre-registration says.
6. **Bootstrap (section 8) and R-AQ:** paired 7-day block bootstrap, B = 2000, seed 20261112, percentile intervals. A ratio metric with an undefined replicate (a zero denominator) drops only that replicate; the interval is null when more than 5% of the replicates (more than 100 of 2000) are undefined. The pre-registration is silent on this. *Cost if wrong:* intervals of sparse policies differ slightly from the conservative "any undefined replicate nulls the interval" rule.
7. **Monte Carlo:** the scored probabilities come from ONE draw of 50 joint samples per hour (seed 20261112), made once over all scored rows (sorted by valid time, then lead). One standard error of a share of 50 samples is about 0.07 at a probability of 0.5, and two independent draws differ by about 0.10 (one standard deviation), so the scoreboard and the live product must not be shown side by side as if identical.
8. **The demo day** is selected by the section 7.4 rule from truth columns and one boolean (all lead-1 inputs present, which section 7.4 step 1 requires), with ban-weighted danger hours, ties to the earliest date. No forecast value enters the selection; the test pins this.
9. **Not computed by B3: the section 7.2 secondary rows** "pooled over all 8 stations, regime (a), and regime (c) at OMAA". B2's corrected series is OMAA-only (regime (a)), so B3 cannot compute them. **Ali decided "Amend: not run" (amendment 3 section 1):** the report prints "not computed" where those rows would be, and the Warnings and Plans results make no claim beyond OMAA in an unseen summer. *Cost if wrong:* no policy-level evidence outside OMAA; revisit trigger: a later B2 export of those corrected series.
10. **The roster frontier export** (`artifacts/eval/static/roster_frontier.json`) is research output and is **not a frozen value and not a scored 2026 row**. Its source is the roster research of 11 November (`docs/research/scripts/roster/results/roster_frontier.json`, byte for byte), which uses 2024-2026 station WBGT truth with leave-one-summer-out folds, as the pre-registration's section 10.1 row 3 already discloses. Its label says "REAL climatology (station obs WBGT, 2024-2026, LOSO); commute, buffer and bedtime are assumptions". The export keeps the research key `B0_common_practice_non_compliant` verbatim (it describes the legality of the old practice roster); the wording check of the product copy exempts that data key by name, and the frontend never renders export keys as copy.

## 4. Amendments in force

| Amendment | File | SHA-256 |
|---|---|---|
| 1 | `docs/research/2026-11-14-preregistration-amendment-1.md` | `35595fbc7fbeb6b207f468d9b0c81286431e446930fb77f3828cc01c599a7272` |
| 2 | `docs/research/2026-11-15-preregistration-amendment-2.md` | `ae0b5d7bff9335617407d3a78448f5abd64284ff5ce8866781c4230eff05c8ad` |
| 3 | `docs/research/2026-11-15-preregistration-amendment-3.md` | `13ac01642df067da778e58dbe3f1c5a33bbe5889c5fd870369a524c2f527484f` (committed in 60a2713) |

Amendment 3 records the secondary-row decision, the Red edge ruling and the clarifications of section 3 above; the lock hashes amendments 1 to 3 and this addendum.

## 5. Run order and what changes this file

1. This file, `theta.json` (hashed above), the development scoreboards and the roster export (committed, not hashed here) and then the lock's `freeze_path`, `freeze_sha256` and amendment 3 are committed, and Ali signs the "2026 go" marker (the marker binds the lock hash, so it is written after the lock keys). The gate requires a clean tree.
2. `sb-jobs evaluate-2026 --part forecast`, then `--part warnings`, then `--part plans`, each from a clean tree, each once. The results log of the pre-registration (section 12) is filled from the files.
3. **If any value above is changed after a 2026 Warnings or Plans number exists, that row is reported as "not pre-registered" and loses its headline (section 11).** A change before that point needs a new addendum and a new lock hash.
