# Evaluation report: the held-out 2026 evaluation of Stellar Blaze

> **DRAFT.** Numbers independently re-computed from the raw files by a second agent on 2026-11-15, zero mismatches. The claims table (section 7) was amended on that agent's findings and accepted by the architect on 2026-11-15. The H1, H2 and H3 outcomes are applications of the stated rules (section 3), not runner verdicts.

- **Written:** 2026-11-15, by the B2 controller (Claude), on the B2 branch `feat/b2-forecast-corrector`.
- **What this is:** the pre-registration's section 12 results log and section 12.1 headline slots, filled from the 2026 result files only, plus the section 13 negative-results table, the pre-run record, and a claims table for the deck. The pre-registration itself is not edited (its section 13 says every change is a new row in the amendment log, and a text edit would change the hash the lock pins).
- **Where the numbers come from:** the committed result files `artifacts/eval/2026/*` of B3's commits `5fffa2c` (forecast), `ec823dd` (warnings) and `36c465a` (plans), read with `git show <commit>:<path>`; the development files `artifacts/eval/dev/*` of this branch; and the committed documents quoted below. Every table in this report was produced by a throwaway script that reads those files and formats the values; no number was typed by hand. Values are rounded for display (counts to 1 decimal, CRPS and differences to 3 decimals, minutes to integers); the files hold the full values.
- **Where a slot has no number in the files:** it says "not computed" and gives the reason.
- **Not changed by this report:** no lock, gate, model or guard file.
- **Independent re-check:** the numbers in this report were independently re-computed from the raw files by a second agent on 2026-11-15, with zero mismatches. The claims table (section 7) and sections 2.3, 2.4, 3.1-3.3, 4, 5, 8 and 9 were amended on that agent's findings, as relayed by the architect; every amended number was recomputed from the files.

## 0. Outcomes at a glance

Outcome words for H4 to H7 are the runner's (`outcome` in the files). For H1, H2, H3, H1-raw and H1-run the files carry numbers and no verdict, so the outcome below is **my application of the stated rule** (section 3 gives the rule and the cells); the architect should check the reading.

| Hypothesis | Outcome | Who decided / rule | Details |
|---|---|---|---|
| H1 (primary) | supported | this report: paired 95% interval of CRPS(corrector) - CRPS(B2d) is below zero and the difference is at least 0.1 in absolute value (section 8 noise floor), in each of T and Td at each of leads 1, 2, 3 | section 3.1 |
| H1-raw (secondary) | supported | this report: same rule against B0 | section 3.1 |
| H1-run (secondary) | supported | this report: same rule against B3d | section 3.1 |
| H2 (primary) | holds | this report: every one of the 48 strata (4 targets x leads 1-3 x 4 hour blocks) has 90%-pair coverage in [0.85, 0.95]; range 0.8594 to 0.9302; the same holds for the 36 strata without the `working` block, with the same minimum and maximum | section 3.2 |
| H3 (secondary) | not supported | this report: Brier skill score positive against both references, for both events, at leads 1-3 (point estimates; the file has no interval for BSS) | section 3.3 |
| H4 (primary) | supported | runner | section 3.4 |
| H4 at lead 2 (`H4-lead2`) | supported | runner | section 3.4 |
| H5 (secondary) | negative | runner | section 3.4 |
| H6 (primary) | supported | runner | section 3.5 |
| H7 (secondary) | supported | runner | section 3.5 |

## 1. Results log (pre-registration section 12)

"Commit" is the git SHA the part ran at (`provenance.git_sha` in the file). "Committed in" is the B3 commit that holds the result files. Output hashes are SHA-256 of the file bytes (for `forecast`, they equal the `files` block of `run_meta.json`).

| Part | Commit | Run at (UTC) | Output SHA-256 | Notes |
|---|---|---|---|---|
| forecast | `a848821c4c88aac7642ccdd09f9227bc5b7d8270` | `2026-11-15T08:41:28.912191Z` | `forecast_skill.json` `ffda39863657c8a6df8f59681aa215839a793ef709c540ca2894290bd371d226`<br>`reliability.json` `a97a3d33cf5f9609714b363db71a7d012f48cb92f6357c157d4f371be018f458`<br>`corrected_series_OMAA.manifest.json` `e621d990e7cfd9bd46f661c5a501ccf974ad685063eadd3841d2574e3b25cd1d`<br>`corrected_series_OMAA.parquet` `f21d78bbe21736a3d4fc5526dede761d1b5eb73b670e0f16914cc95831204428` (untracked; hash from `run_meta.json`)<br>`run_meta.json` `b4dbeffd57f60aca9d7458012d4831838a4a7d53d941c25d147915b2789cd655` | committed in `5fffa2c`. `regime_b_all`: "not run" (`run_meta.json`) |
| warnings | `5fffa2c8b7188477fb3b5be698f715dddb66e94e` | `2026-11-15T08:45:55.711322Z` | `policy_scoreboard.json` `be82c0045f0a78f17866318e5c51fa92c85fc67834a95f079097c4e85cbead22`<br>`demo_day.json` `6c38d7e65c94c8a015bae005b79b07ad3ce7c54c84262d227e70b8a79d61be54` | committed in `ec823dd`. Secondary rows (pooled over 8 stations; regime (c) at OMAA): not computed (amendment 3, item 1) |
| plans | `ec823dd24b7e37ca3006965abd1a3d3c67b15fbc` | `2026-11-15T08:48:27.836126Z` | `plan_scoreboard.json` `ae28956ffd95cfce4f943882105d916838492edad64341b1ce12c20fd86517bc` | committed in `36c465a` |

What the files record about the run (all from `run_meta.json` unless said otherwise):

- Model `corrector-20261114-d327987-6edafa`; gold SHA-256 `8124c86c6f3ff55c40184f85be06b54a9ed289cdba1a625347efe4809544a1db`; protocol SHA-256 `ce116fe64a00b8b5509ae567a72973e85d1cf2120af725127b970bdb8885b7b8` (commit `661b373b3bf8257e997cf5cebb8691ddc9e9d693`).
- Amendments hashed by the lock at the run: `2026-11-14-preregistration-amendment-1.md` `35595fbc7fbeb6b207f468d9b0c81286431e446930fb77f3828cc01c599a7272`; `2026-11-15-preregistration-amendment-2.md` `ae0b5d7bff9335617407d3a78448f5abd64284ff5ce8866781c4230eff05c8ad`; `2026-11-15-preregistration-amendment-3.md` `13ac01642df067da778e58dbe3f1c5a33bbe5889c5fd870369a524c2f527484f`.
- Freeze addendum `docs/research/2026-11-15-preregistration-freeze.md` SHA-256 `038fae2a6acfcb0b4a2c7722d2f814cc69d2da309cd41e61c5874e3a0799c7dd` (hashed by the lock as `freeze_sha256`; `run_meta.json` lists the amendments but not the freeze addendum, so this hash is the lock's, read from HEAD of this branch).
- Go marker SHA-256 `3f818deffaae5207acc0093dc82fc421b932a80821c5edc663f9a6ebbf1e3729`; `dev_skill.json` SHA-256 `bb37dc9b1472ca74e4be091f832349482eccd204d38ce584879e2911e4499dd5`; `uv.lock` SHA-256 `37d7b43522f967de27e75bfe6166c35b1de0db87bd2e322a1f1874f27de2ca7e`; library versions: lightgbm 4.7.0, numpy 2.5.4, polars 2.0.0, scipy 1.18.1.
- Ruleset `ae-heat-2026.1` SHA-256 `cff47102285ef8da9ee2db720c55498ce31d786a08cf88acfa40a22779b25c8e` (the Warnings and Plans files agree); crew fixture SHA-256 `e76e930fa1cb1c0fb1f1b3716d3edea6504535ba0cd09eba2852f4969fe3a83f`; margin 7 W/m2; withdrawal limits off; theta_protect 0.3, theta_balanced 0.45.
- Labels in the files: forecast `REAL`; warnings `REAL` (crew: "assumed crew of 20 doing heavy work (ASSUMED)"); plans `REAL weather + assumed crew` (crew: "SIMULATED crew: 20 experienced adults, heavy work").
- Serving path statuses: t:ok 108976, td:ok 108976, wbgt:ok 108976, wind:ok 108976 rows.
- Bootstrap: 95% percentile intervals, 2000 replicates, blocks of 7 days, seed 20261112. Tercile edges (from 2024-2025 forecasts only): 30.151 and 32.605 (`artifacts/eval/dev/dev_skill.json (key tercile_edges), 2024-2025 forecasts only`).
- The lock at the run was `d9b9130a824c1861a9a28831b687a0b4a9208762c39afcc7ef946f45a6d09b92` (per the architect's message; the lock file is not among the result files).

## 2. Headline slots (pre-registration section 12.1)

Forecast slots are regime (a) (known sites, new summer), the released model through the serving path, pooled over the 8 stations, working daytime (06-14 UTC), lead 1 unless a lead is named. `Delta` is CRPS(corrector) minus CRPS(comparator); negative favours the corrector. All forecast CRPS values are on the 19-level grid.

### 2.1 Forecast

| Target | Lead | Rows scored | Days | CRPS corrector | CRPS B2d | Delta | 95% interval of Delta |
|---|---|---|---|---|---|---|---|
| T | 1 | 9,999 | 139 | 0.824 | 1.030 | -0.205 | [-0.252, -0.159] |
| T | 2 | 9,999 | 139 | 0.871 | 1.073 | -0.202 | [-0.245, -0.157] |
| T | 3 | 9,999 | 139 | 0.928 | 1.121 | -0.193 | [-0.235, -0.151] |
| Td | 1 | 9,999 | 139 | 2.114 | 2.463 | -0.350 | [-0.444, -0.252] |
| Td | 2 | 9,999 | 139 | 2.185 | 2.612 | -0.427 | [-0.508, -0.339] |
| Td | 3 | 9,999 | 139 | 2.338 | 2.848 | -0.509 | [-0.613, -0.404] |

- Coverage of the 90% pair per stratum (section 3.2): minimum 0.8594 (T, lead 1, block late, 5,547 rows) to maximum 0.9302 (wind, lead 3, block peak, 5,560 rows).
- BSS for WBGT >= 32 C, working daytime (no interval in the file): lead 1: against the 2024-2025 climatological base rate 0.5132, against B2d 0.0162; lead 2: against the 2024-2025 climatological base rate 0.4952, against B2d 0.0232; lead 3: against the 2024-2025 climatological base rate 0.4655, against B2d 0.0360.
- `obs_freq_at_70` (corrector, WBGT >= 32 C, lead 1, working daytime, bin 0.65-0.75, pooled over all stations): observed frequency **0.5852** at a mean forecast probability of 0.6999, 769 forecasts in the bin (hollow: no).

### 2.2 Warnings (OMAA, 2026, working daytime 06:00-14:59 UTC; margin 7 W/m2, withdrawal limits off)

**lead 1 (about 24 hours ahead).** Truth danger hours: 252.5 [191.5, 315.5] ; 139 days. Intervals are 95% paired block-bootstrap percentile intervals; hours carry their ban weight.

| Policy | Missed danger hours | False-alarm hours | POD | FAR | CSI | Alerts per worker-shift |
|---|---|---|---|---|---|---|
| P0 | 252.5 [191.5, 315.5] | 0 [0, 0] | 0.000 [0.000, 0.000] | not defined (no warnings issued) | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| P1 | 19 [7.5, 34] | 276.5 [224.5, 325] | 0.925 [0.870, 0.971] | 0.542 [0.476, 0.613] | 0.441 [0.372, 0.503] | 1.345 [1.072, 1.604] |
| P2 | 80.5 [53.5, 110] | 74.5 [50, 103] | 0.681 [0.602, 0.763] | 0.302 [0.218, 0.398] | 0.526 [0.451, 0.600] | 0.878 [0.669, 1.108] |
| P3_protect (theta 0.3) | 45.5 [27, 66] | 183.5 [135.5, 233.5] | 0.820 [0.754, 0.883] | 0.470 [0.366, 0.581] | 0.475 [0.381, 0.560] | 1.360 [1.115, 1.590] |
| P3_balanced (theta 0.45) | 96.5 [65.5, 130.5] | 73.5 [53.5, 92.5] | 0.618 [0.530, 0.708] | 0.320 [0.241, 0.418] | 0.479 [0.399, 0.552] | 0.978 [0.755, 1.194] |

**lead 2 (strict: issued by 18:00 GST the evening before).** Truth danger hours: 252.5 [191.5, 315.5] ; 139 days. Intervals are 95% paired block-bootstrap percentile intervals; hours carry their ban weight.

| Policy | Missed danger hours | False-alarm hours | POD | FAR | CSI | Alerts per worker-shift |
|---|---|---|---|---|---|---|
| P0 | 252.5 [191.5, 315.5] | 0 [0, 0] | 0.000 [0.000, 0.000] | not defined (no warnings issued) | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| P1 | 15.5 [5.5, 27.5] | 266 [219.5, 312] | 0.939 [0.896, 0.976] | 0.529 [0.468, 0.594] | 0.457 [0.394, 0.513] | 1.353 [1.094, 1.597] |
| P2 | 80.5 [54.5, 108] | 83 [58, 110] | 0.681 [0.600, 0.762] | 0.325 [0.236, 0.422] | 0.513 [0.432, 0.590] | 0.928 [0.727, 1.144] |
| P3_protect (theta 0.3) | 50.5 [31, 71] | 190.5 [153, 226.5] | 0.800 [0.735, 0.869] | 0.485 [0.403, 0.573] | 0.456 [0.383, 0.523] | 1.345 [1.101, 1.568] |
| P3_balanced (theta 0.45) | 97 [66.5, 128] | 91 [65.5, 115.5] | 0.616 [0.528, 0.702] | 0.369 [0.276, 0.467] | 0.453 [0.378, 0.526] | 1.022 [0.770, 1.273] |

### 2.3 Demo day

- `demo_date` **2026-06-14** (station OMAA, lead 1); candidates 138; `demo_high_h` (observed High-or-Red working hours) 7; `demo_high_outside_ban_h` 7; `demo_raw_hits` 5; `demo_p3_hits` 6.
- Runner-up in the file: 2026-09-26 with score 7; the selection score of the pick is 7, so the pick is a tie broken to the earliest date, as section 7.4 says.
- The file's rule text: "Pre-registration 7.4, on truth only: candidates are the dates with all 9 working hours (06-14 UTC) observed, unrejected and forecast at lead 1; the score is the observed High-or-Red hours outside the ban window (partial ban hours count their non-ban fraction); the maximum wins and ties go to the earliest date."

| Hour | Truth zone | Raw zone (P2) | P(High) from the corrected samples | Warned by | Truth WBGT (C) | Raw WBGT (C) | Corrected WBGT p05 / p50 / p95 (C) |
|---|---|---|---|---|---|---|---|
| 06:00Z | red | high | 0.580 | P1, P2, P3_protect, P3_balanced | 33.716 | 33.700 | 30.8 / 32.8 / 34.5 |
| 07:00Z | red | high | 0.500 | P1, P2, P3_protect, P3_balanced | 34.089 | 33.720 | 30.8 / 33 / 35.6 |
| 08:00Z | red | high | 0.560 | P1, P2, P3_protect, P3_balanced | 34.495 | 33.031 | 30.4 / 32.4 / 35.2 |
| 09:00Z | high | high | 0.540 | P1, P2, P3_protect, P3_balanced | 33.913 | 32.963 | 30.5 / 32.7 / 35.8 |
| 10:00Z | high | red | 0.620 | P1, P2, P3_protect, P3_balanced | 33.315 | 35.372 | 31.9 / 33.9 / 36.7 |
| 11:00Z | medium | high | 0.540 | P1, P2, P3_protect, P3_balanced | 32.185 | 33.887 | 31.3 / 33.1 / 34.8 |
| 12:00Z | red | medium | 0.400 | P1, P3_protect | 33.898 | 33.164 | 30.5 / 32.9 / 34.7 |
| 13:00Z | high | low | 0.100 | P1 | 32.374 | 32.066 | 29.9 / 32.1 / 33.9 |
| 14:00Z | low | low | 0.000 | none | 31.012 | 30.636 | 28.6 / 30.9 / 32.8 |

- Counted from the hourly rows above (derived by me; the file stores only `raw_hits` and `p3_hits`): the day has 7 truth High-or-Red hours; P1 (naive, WBGT >= 32 on the raw forecast) warned 7 of them and warned 1 hour(s) that were not High or Red.
- The "6 of 7" holds for P3 at theta_protect (0.3) only. P3_balanced (theta 0.45) warned 5 of 7, the same as P2 (5). The one High-or-Red hour that P3_protect did not warn, 13:00Z, had truth effective TWL 113.7 W/m2, 1.3 W/m2 below the 115 W/m2 High edge (freeze addendum section 1); P(High) from the corrected samples was 0.10.
- One day is an illustration, not evidence of skill. It was picked on truth only, before any P3 output for it was read (section 7.4).

### 2.4 Plans (OMAA, roster L1 06:00-11:00 + 15:00-18:00 GST, crew `crew-b`)

The crew is **SIMULATED** ("SIMULATED crew: 20 experienced adults, heavy work"); the weather is **REAL**. Ban only and naive are the same plan on L1 by construction (`identical_by_construction`: naive, ban_only; amendment 1, change 3), so they share one row. 138 days. Intervals are 95% paired block-bootstrap percentile intervals.

| Plan | Truth rule-violation minutes per season (file field `violation_minutes_per_season`) | Share of truth-High heavy-work minutes cycled 20/40 | Missed-protection ticks | Rest minutes added vs naive (SIMULATED) |
|---|---|---|---|---|
| Ban only (= naive; `naive` is identical by construction) | 33,875 [27,425, 40,211] | 0.000 [0.000, 0.000] (n = 2,219 ticks) | 2,219 [1,525, 2,998] | 0 [0, 0] |
| Rule plan on raw IFS | 15,225 [11,350, 19,221] | 0.608 [0.493, 0.716] (n = 2,219 ticks) | 675 [405, 1,005] | 13,560 [10,454, 16,736] |
| Rule plan on the corrected protective quantile (q10) | 2,140 [700, 3,835] | 0.948 [0.909, 0.983] (n = 2,219 ticks) | 89 [19, 183] | 31,680 [27,450, 35,135] |

- Arithmetic on the file values (no interval is in the file for these two differences, so none is claimed): the corrected rule plan adds 18,120 more rest minutes than the raw-IFS rule plan (31,680 against 13,560), and has 13,085 fewer rule-violation minutes (2,140 against 15,225).
- **Unit (derived from the scoring code and the fixture, not only from the file's field names).** Each minute figure is for ONE homogeneous crew plan: the scored crew has one plan for all 20 members, so the minutes are not multiplied by the headcount and are not per worker. They are summed over the 138 scored days. A day is scored only if truth, raw and corrected forecasts have a value on every roster tick, and the scoring does not read the fixture's `days_per_week` (6), so weekly rest days are not removed (`plans_scoreboard` in `backend/src/stellar_blaze/ml/scoreboards.py` at `36c465a`, in B3's tree). Ticks are 5 minutes; violation minutes are the ticks with at least one validator violation against the truth timeline, times 5 (freeze addendum section 3 item 5). The verdict string's wording "per worker-season" is therefore loose; the exact unit is "crew-plan minutes summed over 138 scored days".
- **Denominator for the rest cost, derived.** The crew's shift in `backend/fixtures/demo_site.toml` (SHA-256 `e76e930fa1cb1c0fb1f1b3716d3edea6504535ba0cd09eba2852f4969fe3a83f`) is 06:00-11:00 and 15:00-18:00: 480 scheduled minutes per day. The naive plan works every shift tick outside the ban, and ban only is identical to it (`identical_by_construction`; the ban window does not intersect the roster), so the scheduled minutes are 480 x 138 scored days = 66,240. Rest added vs naive is then 47.8% of scheduled minutes for the corrected rule plan against 20.5% for the raw rule plan (arithmetic on file values; no interval is in the file). The shift comes from the fixture and the day count from the file's `n_days`; if either were different the shares would change.

## 3. Hypothesis verdicts and the rule applied

### 3.1 H1, H1-raw, H1-run (Forecast; T and Td; regime (a); pooled over 8 stations; working daytime)

**Rule applied** (the files give no verdict for these). Pre-registration section 1: "beats" means the paired 95% block-bootstrap interval of the difference excludes zero in the stated direction; section 8: a CRPS difference below 0.1 C is reported as "not distinguishable" even if its interval excludes zero. Section 1 says "pooled over the 8 stations, leads 1-3", and `forecast_skill.json` has one row per lead and no single row pooled over leads 1-3, so a pooled-over-leads interval is **not computed**. I read the hypothesis as holding only if it holds at each of leads 1, 2 and 3, for T and for Td. That is a reading, flagged for the architect.

**H1 against B2d (static bias correction, dressed).**

| Target | Lead | CRPS corrector | CRPS B2d | Delta | 95% interval | Interval below zero | abs(Delta) >= 0.1 |
|---|---|---|---|---|---|---|---|
| T | 1 | 0.824 | 1.030 | -0.205 | [-0.252, -0.159] | yes | yes |
| T | 2 | 0.871 | 1.073 | -0.202 | [-0.245, -0.157] | yes | yes |
| T | 3 | 0.928 | 1.121 | -0.193 | [-0.235, -0.151] | yes | yes |
| Td | 1 | 2.114 | 2.463 | -0.350 | [-0.444, -0.252] | yes | yes |
| Td | 2 | 2.185 | 2.612 | -0.427 | [-0.508, -0.339] | yes | yes |
| Td | 3 | 2.338 | 2.848 | -0.509 | [-0.613, -0.404] | yes | yes |

**H1-raw against B0 (raw IFS, deterministic CRPS = MAE).**

| Target | Lead | CRPS corrector | CRPS B0 | Delta | 95% interval | Interval below zero | abs(Delta) >= 0.1 |
|---|---|---|---|---|---|---|---|
| T | 1 | 0.824 | 1.897 | -1.072 | [-1.160, -0.983] | yes | yes |
| T | 2 | 0.871 | 1.982 | -1.111 | [-1.192, -1.021] | yes | yes |
| T | 3 | 0.928 | 2.081 | -1.152 | [-1.247, -1.044] | yes | yes |
| Td | 1 | 2.114 | 3.593 | -1.480 | [-1.662, -1.287] | yes | yes |
| Td | 2 | 2.185 | 3.913 | -1.727 | [-1.919, -1.532] | yes | yes |
| Td | 3 | 2.338 | 4.329 | -1.991 | [-2.232, -1.738] | yes | yes |

**H1-run against B3d (running 7-day bias correction, dressed).**

| Target | Lead | CRPS corrector | CRPS B3d | Delta | 95% interval | Interval below zero | abs(Delta) >= 0.1 |
|---|---|---|---|---|---|---|---|
| T | 1 | 0.824 | 1.032 | -0.207 | [-0.264, -0.158] | yes | yes |
| T | 2 | 0.871 | 1.068 | -0.197 | [-0.252, -0.143] | yes | yes |
| T | 3 | 0.928 | 1.118 | -0.189 | [-0.241, -0.136] | yes | yes |
| Td | 1 | 2.114 | 2.582 | -0.469 | [-0.584, -0.361] | yes | yes |
| Td | 2 | 2.185 | 2.706 | -0.520 | [-0.618, -0.428] | yes | yes |
| Td | 3 | 2.338 | 2.905 | -0.567 | [-0.683, -0.457] | yes | yes |

Result under the rule: H1 supported (interval-only reading, without the 0.1 floor: supported); H1-raw supported; H1-run supported (interval-only reading: supported).

**All four targets against every model, leads 1-3, working daytime (descriptive; not hypotheses).** CRPS on the 19-level grid; B0 is the MAE; B3d is not defined for WBGT (`b3d`: "built (t, td, wind; WBGT has no bias7)").

| Target | Lead | Corrector | B0 | B0d | B2d | B3d | B4 (ridge MOS) | Delta vs B4 [95% interval] |
|---|---|---|---|---|---|---|---|---|
| T | 1 | 0.824 | 1.897 | 1.327 | 1.030 | 1.032 | 0.966 | -0.142 [-0.171, -0.110] |
| T | 2 | 0.871 | 1.982 | 1.389 | 1.073 | 1.068 | 1.026 | -0.155 [-0.191, -0.118] |
| T | 3 | 0.928 | 2.081 | 1.463 | 1.121 | 1.118 | 1.086 | -0.157 [-0.190, -0.124] |
| Td | 1 | 2.114 | 3.593 | 2.707 | 2.463 | 2.582 | 2.345 | -0.231 [-0.286, -0.172] |
| Td | 2 | 2.185 | 3.913 | 2.890 | 2.612 | 2.706 | 2.468 | -0.283 [-0.340, -0.224] |
| Td | 3 | 2.338 | 4.329 | 3.170 | 2.848 | 2.905 | 2.628 | -0.290 [-0.359, -0.218] |
| wind | 1 | 0.688 | 1.281 | 0.879 | 0.849 | 0.838 | 0.740 | -0.053 [-0.069, -0.038] |
| wind | 2 | 0.714 | 1.310 | 0.903 | 0.875 | 0.859 | 0.763 | -0.049 [-0.065, -0.035] |
| wind | 3 | 0.744 | 1.348 | 0.938 | 0.914 | 0.896 | 0.794 | -0.050 [-0.071, -0.032] |
| WBGT | 1 | 0.663 | 0.985 | 0.771 | 0.761 | not computed | 0.669 | -0.005 [-0.028, 0.018] |
| WBGT | 2 | 0.690 | 1.031 | 0.798 | 0.785 | not computed | 0.700 | -0.010 [-0.034, 0.012] |
| WBGT | 3 | 0.735 | 1.112 | 0.854 | 0.839 | not computed | 0.746 | -0.011 [-0.038, 0.014] |

Against B4 (a baseline that is not a pre-registered hypothesis), the interval of the difference includes or exceeds zero in 17 of 80 regime-(a) cells (target x lead x block); in the working-daytime block at leads 1-3 that is WBGT at every lead and no other target. Against B2d, B3d and B0 no regime-(a) cell has an interval that reaches zero (checked over all targets, leads 1, 2, 3, 5, 7 and the four blocks).

**Baseline fallbacks (regime (a); `forecast_skill.json` `regimes.a.fallbacks`).** B3d and B4 fall back on rows where their own inputs are missing; the file records the counts and not the fallback rule. Every comparison with them above includes those rows.

| Target | Baseline | Rows | Fell back | Share |
|---|---|---|---|---|
| T | B3d | 108,976 | 3,920 | 3.6% |
| T | B4 | 108,976 | 14,896 | 13.7% |
| Td | B3d | 108,976 | 3,920 | 3.6% |
| Td | B4 | 108,976 | 14,896 | 13.7% |
| WBGT | B4 | 108,976 | 14,896 | 13.7% |
| wind | B3d | 108,976 | 3,920 | 3.6% |
| wind | B4 | 108,976 | 14,896 | 13.7% |

B3d fell back on 3,920 of 108,976 rows (3.6%) of each of T, Td and wind; B4 on 14,896 (13.7%) of each of its four targets.

### 3.2 H2 (calibration; regime (a))

**Rule applied.** Pre-registration section 1: the 90% pair (0.05/0.95) covers 2026 truth with empirical coverage inside [0.85, 0.95] in every lead (1-3) x hour-block stratum, for T, Td, wind and WBGT. Section 7.1 lists four hour blocks (early, peak, late, working daytime 06-14 UTC), so I tested all four. Coverage is a point estimate; the file has no interval for it. The file's `cov_90` is the coverage of the calibrated 0.05/0.95 pair.

| Target | Hour block | Rows (each lead) | Coverage, lead 1 | Coverage, lead 2 | Coverage, lead 3 |
|---|---|---|---|---|---|
| T | early | 4,438 | 0.9011 | 0.9139 | 0.9207 |
| T | peak | 5,560 | 0.9085 | 0.9068 | 0.9153 |
| T | late | 5,547 | 0.8594 | 0.8781 | 0.8725 |
| T | working | 9,999 | 0.8855 | 0.8938 | 0.8957 |
| Td | early | 4,438 | 0.9178 | 0.9200 | 0.8979 |
| Td | peak | 5,560 | 0.9011 | 0.9117 | 0.9165 |
| Td | late | 5,547 | 0.8816 | 0.8954 | 0.8927 |
| Td | working | 9,999 | 0.8933 | 0.9057 | 0.9062 |
| wind | early | 4,438 | 0.8948 | 0.9009 | 0.9101 |
| wind | peak | 5,560 | 0.9261 | 0.9228 | 0.9302 |
| wind | late | 5,547 | 0.9126 | 0.9187 | 0.9189 |
| wind | working | 9,999 | 0.9196 | 0.9219 | 0.9248 |
| WBGT | early | 4,438 | 0.9031 | 0.9004 | 0.9146 |
| WBGT | peak | 5,560 | 0.8980 | 0.9085 | 0.9041 |
| WBGT | late | 5,547 | 0.9127 | 0.9178 | 0.9026 |
| WBGT | working | 9,999 | 0.9065 | 0.9147 | 0.9048 |

Result under the rule: 48 of 48 strata (4 variables x 3 leads x 4 blocks, including `working`) are inside [0.85, 0.95]; without the `working` block it is 36 of 36 (4 x 3 x 3), with the same minimum and maximum; H2 **holds**. Smallest 0.8594 (T, lead 1, late), largest 0.9302 (wind, lead 3, peak). The smallest margin to the floor is 0.0094.

**Coverage conditional on forecast-WBGT tercile (working daytime, leads 1-3; descriptive, edges from 2024-2025).**

| Target | Forecast-WBGT tercile | Lead 1 | Lead 2 | Lead 3 |
|---|---|---|---|---|
| T | low | 0.8508 (n = 1,307) | 0.8598 (n = 1,362) | 0.8515 (n = 1,468) |
| T | mid | 0.8829 (n = 3,688) | 0.8923 (n = 3,768) | 0.8896 (n = 3,713) |
| T | high | 0.8965 (n = 5,004) | 0.9045 (n = 4,869) | 0.9139 (n = 4,818) |
| Td | low | 0.8783 (n = 1,307) | 0.9009 (n = 1,362) | 0.8903 (n = 1,468) |
| Td | mid | 0.8940 (n = 3,688) | 0.9087 (n = 3,768) | 0.9092 (n = 3,713) |
| Td | high | 0.8967 (n = 5,004) | 0.9047 (n = 4,869) | 0.9087 (n = 4,818) |
| wind | low | 0.8921 (n = 1,307) | 0.8979 (n = 1,362) | 0.8835 (n = 1,468) |
| wind | mid | 0.9140 (n = 3,688) | 0.9225 (n = 3,768) | 0.9257 (n = 3,713) |
| wind | high | 0.9309 (n = 5,004) | 0.9281 (n = 4,869) | 0.9367 (n = 4,818) |
| WBGT | low | 0.8822 (n = 1,307) | 0.8833 (n = 1,362) | 0.8801 (n = 1,468) |
| WBGT | mid | 0.9046 (n = 3,688) | 0.9145 (n = 3,768) | 0.9060 (n = 3,713) |
| WBGT | high | 0.9143 (n = 5,004) | 0.9236 (n = 4,869) | 0.9114 (n = 4,818) |

The pre-registered expected risk (section 13: the `late` block or the top heat tercile) did not turn into a failure in regime (a). The cell closest to the floor is in the `late` block (0.8594), as the pre-registration expected, but it is above 0.85; the top tercile is 0.8965 at the lowest. The lowest tercile for T is 0.8508, 0.8598, 0.8515 at leads 1-3 (tercile cells are not H2 strata).

### 3.3 H3 (event probabilities; WBGT; regime (a); working daytime; leads 1-3)

**Rule I applied.** Pre-registration section 1: for the events WBGT >= 30 C and WBGT >= 32 C the corrector's event probability has a positive Brier skill score against the 2024-2025 climatological base rate and against B2d's event probability, leads 1-3, working daytime, pooled. Section 8 says no p-values; the file carries no interval for BSS, so I used the sign of the point estimate. H3 is read as holding only if all twelve numbers are positive (2 events x 3 leads x 2 references).

| Event | Lead | Event rows | Rows scored | Brier corrector | Brier B2d | Brier climatology | BSS vs climatology | BSS vs B2d |
|---|---|---|---|---|---|---|---|---|
| >= 30 C | 1 | 8,672 | 9,999 | 0.0543 | 0.0511 | 0.1156 | 0.5304 | -0.0619 |
| >= 30 C | 2 | 8,672 | 9,999 | 0.0548 | 0.0542 | 0.1156 | 0.5256 | -0.0121 |
| >= 30 C | 3 | 8,672 | 9,999 | 0.0571 | 0.0584 | 0.1156 | 0.5064 | 0.0237 |
| >= 32 C | 1 | 5,919 | 9,999 | 0.1153 | 0.1172 | 0.2368 | 0.5132 | 0.0162 |
| >= 32 C | 2 | 5,919 | 9,999 | 0.1195 | 0.1224 | 0.2368 | 0.4952 | 0.0232 |
| >= 32 C | 3 | 5,919 | 9,999 | 0.1266 | 0.1313 | 0.2368 | 0.4655 | 0.0360 |

Result under the rule: BSS against the climatological base rate is positive in all six cells; BSS against B2d is not positive in 2 cell(s): WBGT >= 30 at lead 1 (-0.0619), WBGT >= 30 at lead 2 (-0.0121). H3 is therefore **not supported as pre-registered**.

Indicative only, and not part of the sign rule: the mean of the three BSS point estimates against B2d for WBGT >= 30 (working daytime, leads 1-3) is -0.017.

**BSS by hour block (descriptive).** The blocks are the file's `report_hour_blocks`; the sign can differ by block.

| Block | Event | Lead 1 (vs clim / vs B2d) | Lead 2 (vs clim / vs B2d) | Lead 3 (vs clim / vs B2d) |
|---|---|---|---|---|
| early | >= 30 C | 0.5925 / 0.1466 | 0.5612 / 0.1270 | 0.5165 / 0.1151 |
| early | >= 32 C | 0.5335 / 0.2580 | 0.4832 / 0.2342 | 0.4320 / 0.2132 |
| peak | >= 30 C | 0.4960 / -0.1419 | 0.4933 / -0.0970 | 0.4779 / -0.0387 |
| peak | >= 32 C | 0.5056 / -0.0609 | 0.4870 / -0.0452 | 0.4532 / -0.0217 |
| late | >= 30 C | 0.5633 / 0.0222 | 0.5520 / 0.0645 | 0.5348 / 0.0800 |
| late | >= 32 C | 0.5543 / 0.0931 | 0.5383 / 0.0902 | 0.5172 / 0.0938 |

**Reliability (regime (a), lead 1, working daytime hours 06-14 UTC, pooled over stations; bins with fewer than 50 forecasts are hollow and never quoted).**

WBGT >= 30 C (8,672 event rows of 9,999).

| Bin | n corrector | Mean p corrector | Observed frequency corrector | Hollow | n B2d | Mean p B2d | Observed frequency B2d |
|---|---|---|---|---|---|---|---|
| 0.00-0.05 | 170 | 0.007 | 0.012 | no | 221 | 0.009 | 0.036 |
| 0.05-0.15 | 162 | 0.099 | 0.031 | no | 208 | 0.099 | 0.082 |
| 0.15-0.25 | 111 | 0.199 | 0.108 | no | 170 | 0.201 | 0.153 |
| 0.25-0.35 | 137 | 0.303 | 0.153 | no | 139 | 0.297 | 0.230 |
| 0.35-0.45 | 119 | 0.400 | 0.303 | no | 177 | 0.402 | 0.345 |
| 0.45-0.55 | 161 | 0.502 | 0.348 | no | 209 | 0.502 | 0.488 |
| 0.55-0.65 | 177 | 0.599 | 0.441 | no | 207 | 0.600 | 0.517 |
| 0.65-0.75 | 281 | 0.704 | 0.577 | no | 310 | 0.705 | 0.729 |
| 0.75-0.85 | 463 | 0.805 | 0.680 | no | 562 | 0.804 | 0.804 |
| 0.85-0.95 | 1,271 | 0.911 | 0.866 | no | 1,322 | 0.908 | 0.922 |
| 0.95-1.00 | 6,947 | 0.996 | 0.991 | no | 6,474 | 0.996 | 0.992 |

WBGT >= 32 C (5,919 event rows of 9,999).

| Bin | n corrector | Mean p corrector | Observed frequency corrector | Hollow | n B2d | Mean p B2d | Observed frequency B2d |
|---|---|---|---|---|---|---|---|
| 0.00-0.05 | 814 | 0.007 | 0.005 | no | 994 | 0.009 | 0.033 |
| 0.05-0.15 | 628 | 0.099 | 0.048 | no | 768 | 0.097 | 0.078 |
| 0.15-0.25 | 518 | 0.197 | 0.083 | no | 563 | 0.197 | 0.153 |
| 0.25-0.35 | 489 | 0.304 | 0.188 | no | 469 | 0.300 | 0.237 |
| 0.35-0.45 | 464 | 0.401 | 0.291 | no | 487 | 0.399 | 0.324 |
| 0.45-0.55 | 493 | 0.502 | 0.361 | no | 514 | 0.498 | 0.449 |
| 0.55-0.65 | 641 | 0.602 | 0.456 | no | 462 | 0.600 | 0.504 |
| 0.65-0.75 | 769 | 0.700 | 0.585 | no | 660 | 0.701 | 0.630 |
| 0.75-0.85 | 999 | 0.802 | 0.740 | no | 809 | 0.803 | 0.732 |
| 0.85-0.95 | 1,712 | 0.905 | 0.886 | no | 1,420 | 0.904 | 0.868 |
| 0.95-1.00 | 2,472 | 0.991 | 0.987 | no | 2,853 | 0.993 | 0.970 |

### 3.4 H4, H5 and H4 at lead 2 (Warnings; OMAA)

These carry the runner's verdicts. The runner's strings, quoted verbatim from `policy_scoreboard.json`:

- **H4** (`outcome`: `supported`, primary: yes): "H4 supported at lead 1: P3 has fewer missed danger hours than P0 (ban only) (-207.0 h, 95% interval [-261.5, -154.5]) and fewer false-alarm hours than P1 (WBGT >= 32 on raw IFS) (-93.0 h, 95% interval [-148.5, -37.0])."
- **H5** (`outcome`: `negative`, primary: no): "H5 not supported at lead 1 (secondary): P3 minus P2 missed danger hours -35.0 h, 95% interval [-54.0, -19.5]; false-alarm hours P3 183.5 h against P2 74.5 h (above P2 + 25%)."
- **H4-lead2** (`outcome`: `supported`, primary: no): "H4 holds at lead 2 (issued by 18:00 GST the evening before): P3 has fewer missed danger hours than P0 (-202.0 h, 95% interval [-255.0, -150.5]) and fewer false-alarm hours than P1 (-75.5 h, 95% interval [-119.0, -32.5]). The stamp "issued by 18:00 GST the evening before" may be carried: H4 holds at lead 1 and at lead 2."

Paired differences behind them (95% paired block-bootstrap intervals; P3 is the theta_protect operating point):

| Verdict | Comparison | Metric | Difference (hours) [95% interval] |
|---|---|---|---|
| H4 | P3_protect minus P0 | missed_danger_hours | -207 [-261.5, -154.5] |
| H4 | P3_protect minus P1 | false_alarm_hours | -93 [-148.5, -37] |
| H5 | P3_protect minus P2 | missed_danger_hours | -35 [-54, -19.5] |
| H5 | P3_protect minus P2 | false_alarm_hours | 109 [67.5, 160] |
| H4-lead2 | P3_protect minus P0 | missed_danger_hours | -202 [-255, -150.5] |
| H4-lead2 | P3_protect minus P1 | false_alarm_hours | -75.5 [-119, -32.5] |

**What the runner's verdicts do not say, from the same file (lead 1; arithmetic on the file's values, no paired interval in the file for these):**

- P1 (naive WBGT >= 32 on the raw forecast) has fewer missed danger hours than P3 at theta 0.3: 19 against 45.5; it also has more false-alarm hours: 276.5 against 183.5.
- P2 (ADOSH zones on the raw forecast) has far fewer false-alarm hours than P3 at theta 0.3: 74.5 against 183.5 (paired difference P3 minus P2: 109 [67.5, 160]), while P3 has fewer missed danger hours than P2 (45.5 against 80.5).
- At theta 0.45 (P3_balanced): missed 96.5 [65.5, 130.5] and false alarms 73.5 [53.5, 92.5], against P2 missed 80.5 [53.5, 110] and false alarms 74.5 [50, 103]. The file has no paired interval for P3_balanced against P2; the marginal intervals overlap in both counters; P2 has 16 fewer missed hours and P3_balanced has 1 fewer false-alarm hour(s) (point estimates).

**The Warnings row at every lead** (point estimate and 95% interval; leads 5 and 7 are report-only):

| Lead | Policy | Missed danger hours | False-alarm hours |
|---|---|---|---|
| 1 | P0 | 252.5 [191.5, 315.5] | 0 [0, 0] |
| 1 | P1 | 19 [7.5, 34] | 276.5 [224.5, 325] |
| 1 | P2 | 80.5 [53.5, 110] | 74.5 [50, 103] |
| 1 | P3_protect | 45.5 [27, 66] | 183.5 [135.5, 233.5] |
| 1 | P3_balanced | 96.5 [65.5, 130.5] | 73.5 [53.5, 92.5] |
| 2 | P0 | 252.5 [191.5, 315.5] | 0 [0, 0] |
| 2 | P1 | 15.5 [5.5, 27.5] | 266 [219.5, 312] |
| 2 | P2 | 80.5 [54.5, 108] | 83 [58, 110] |
| 2 | P3_protect | 50.5 [31, 71] | 190.5 [153, 226.5] |
| 2 | P3_balanced | 97 [66.5, 128] | 91 [65.5, 115.5] |
| 3 | P0 | 252.5 [191.5, 315.5] | 0 [0, 0] |
| 3 | P1 | 15.5 [7, 27] | 282 [220.5, 341.5] |
| 3 | P2 | 90.5 [63.5, 120] | 88.5 [61, 119.5] |
| 3 | P3_protect | 61 [38, 89] | 209 [161, 256] |
| 3 | P3_balanced | 102.5 [67.5, 142] | 102 [75, 127.5] |
| 5 (report only) | P0 | 252.5 [191.5, 315.5] | 0 [0, 0] |
| 5 (report only) | P1 | 42.5 [19.5, 69] | 287.5 [216, 355] |
| 5 (report only) | P2 | 105 [76, 138] | 127 [81.5, 175] |
| 5 (report only) | P3_protect | 66.5 [42, 94] | 252 [189, 310.5] |
| 5 (report only) | P3_balanced | 102 [70, 136] | 132 [92.5, 171] |
| 7 (report only) | P0 | 252.5 [191.5, 315.5] | 0 [0, 0] |
| 7 (report only) | P1 | 46 [22.5, 71] | 312.5 [243, 378] |
| 7 (report only) | P2 | 114 [80, 148.5] | 119.5 [85, 155.5] |
| 7 (report only) | P3_protect | 58 [33, 85] | 273.5 [220, 322] |
| 7 (report only) | P3_balanced | 114.5 [78.5, 152.5] | 136 [100, 174] |

**Sensitivity (section 7.2, always reported): truth zones under margin {0, 7} W/m2 x withdrawal limits {off, on}, lead 1.** The headline cell is margin 7, withdrawal off. The "on" cells apply the dry-bulb leg only (freeze addendum section 3 item 4), so they likely understate the effect.

| Margin (W/m2) | Withdrawal limits | Truth danger hours | P1 missed / false alarm | P2 missed / false alarm | P3 theta_protect missed / false alarm | P3 theta_balanced missed / false alarm |
|---|---|---|---|---|---|---|
| 7 | off | 252.5 [191.5, 315.5] | 19 / 276.5 | 80.5 / 74.5 | 45.5 / 183.5 | 96.5 / 73.5 |
| 7 | on | 274.5 [208, 343.5] | 20 / 255.5 | 99.5 / 71.5 | 54.5 / 170.5 | 112.5 / 67.5 |
| 0 | off | 213 [159.5, 268.5] | 17 / 314 | 60.5 / 94 | 34.5 / 212 | 75 / 91.5 |
| 0 | on | 213 [159.5, 268.5] | 17 / 314 | 60.5 / 94 | 34.5 / 212 | 75 / 91.5 |

The secondary Warnings rows of section 7.2 (the same counters pooled over all 8 stations, regime (a); and regime (c) at OMAA) are **not computed**: B2's corrected series covers OMAA only, and amendment 3 item 1 (decided by Ali, "Amend: not run") says the report prints "not computed" where those rows would be.

### 3.5 H6 and H7 (Plans; OMAA; SIMULATED crew, REAL weather)

The runner's strings, quoted verbatim from `plan_scoreboard.json`:

- **H6** (`outcome`: `supported`, primary: yes): "H6 supported: the rule plan on the corrected forecast has 31735 fewer rule-violation minutes per worker-season than ban only (95% interval of the difference [-37415, -25844]). SIMULATED crew, real weather."
- **H7** (`outcome`: `supported`, primary: no): "H7 supported (secondary): 586 fewer missed-protection ticks than the raw-IFS rule plan (95% interval of the difference [-830, -367])."

| Verdict | Comparison | Metric | Difference [95% interval] |
|---|---|---|---|
| H6 | rule_corrected minus ban_only | violation_minutes_per_season | -31,735 [-37,415, -25,844] |
| H7 | rule_corrected minus rule_raw | missed_protection_ticks | -586 [-830, -367] |

Pre-registration section 10.3 item 2 expected H7 to tie ("We therefore expect H7 to tie, and say so now"). It did not tie in this file. That expectation was recorded before the run; nothing was changed after it.

## 4. Section 13 table: which outcomes occurred

Every row of the section 13 table, marked triggered or not, with the evidence. "Triggered" means the outcome in the left column occurred. **None of the 5 rows that section 13 labels Negative was triggered; the one row labelled Expected occurred.** Findings that are negative or unsupported but are not rows of that table follow it.

| Outcome on 2026 | Status | Evidence from the files |
|---|---|---|
| H1 fails (interval vs B2d includes 0 or favours B2d) | **Not triggered** | T and Td, leads 1-3: all six intervals below zero, all abs(Delta) >= 0.1 (section 3.1). |
| H2 fails in some strata (coverage < 0.85) | **Not triggered** | Regime (a): all 48 strata in [0.85, 0.95]; minimum 0.8594 (section 3.2). Regime (c) is a different regime: its T coverage is 0.7839, 0.7957, 0.8031 and Td 0.8395, 0.8430, 0.8486 at leads 1-3 (working daytime), below 0.85 (not an H2 stratum; reported in section 6). |
| H4 fails on the P0 side or the P1 side | **Not triggered** | H4 supported at lead 1: P3 has fewer missed danger hours than P0 (ban only) (-207.0 h, 95% interval [-261.5, -154.5]) and fewer false-alarm hours than P1 (WBGT >= 32 on raw IFS) (-93.0 h, 95% interval [-148.5, -37.0]). The "P2 is the recommended policy" sentence of that row applies only when H4 fails; under the freeze addendum reading (P2 at least as good on both counters by point estimates) P2 is not at least as good as P3 at theta 0.3 (P2 misses 80.5 against 45.5) nor at theta 0.45 (P2 has 74.5 false-alarm hours against 73.5). |
| H6 fails | **Not triggered** | H6 supported: the rule plan on the corrected forecast has 31735 fewer rule-violation minutes per worker-season than ban only (95% interval of the difference [-37415, -25844]). SIMULATED crew, real weather. |
| Regime (c) much worse than regime (a) | **Triggered (expected)** | Regime (c) is worse than regime (a). CRPS ratio (c) / (a), working daytime, leads 1-3: T 1.41-1.44; Td 1.29-1.30; wind 1.11-1.12; WBGT 1.08-1.09. Calibration: 23 of 48 regime-(c) strata (4 variables x 3 leads x 4 blocks) have 90% coverage below 0.85; the lowest is 0.7415 (T, lead 1, late block), and the WBGT cells below 0.85 are early block lead 1 (0.842), early block lead 2 (0.848). Both regimes are shown side by side (section 6); "new site" claims quote regime (c) only. |
| Lead 2 (strict) contradicts lead 1 on H4 | **Not triggered** | H4 holds at lead 2 (issued by 18:00 GST the evening before): P3 has fewer missed danger hours than P0 (-202.0 h, 95% interval [-255.0, -150.5]) and fewer false-alarm hours than P1 (-75.5 h, 95% interval [-119.0, -32.5]). The stamp "issued by 18:00 GST the evening before" may be carried: H4 holds at lead 1 and at lead 2. |

**Findings that are negative or unsupported but are not rows of the section 13 table** (reported here so that none is omitted):

1. **H5 is not supported** (secondary; runner: `negative`): P3 at theta 0.3 has 183.5 false-alarm hours against 74.5 for P2, above P2 + 25%.
2. **H3 is not supported as pre-registered** (secondary; the rule of section 3.3): BSS against B2d is not positive for WBGT >= 30 at lead 1, WBGT >= 30 at lead 2 (working daytime).
3. **Reliability:** at a corrector probability of about 0.70 for WBGT >= 32 C the observed frequency is 0.5852 (769 forecasts). The corrector's observed frequency is below its mean forecast probability in every bin of the WBGT >= 32 diagram with at least 50 forecasts (section 3.3 tables); B2d's probabilities are closer to the observed frequencies in that bin. At WBGT >= 30, 10 of 11 bins are also below.
4. **P1 (naive WBGT >= 32 on the raw forecast) misses fewer danger hours than P3 on point estimates** at lead 1 (19 against 45.5), at the cost of more false-alarm hours. No paired interval exists in the file for this difference, and the marginal intervals overlap ([7.5, 34] against [27, 66]).
5. **Regime (b-all)** was not run (`regime_b_all`: "not run"); pre-registration section 2.4 fixed that outcome in advance.

## 5. The pre-run record, next to the 2026 numbers

What was decided and seen before any 2026 number existed, from the committed development files (2024-2025 data only), amendment 2 and the freeze addendum.

### 5.1 Dev run 1 (the WBGT-only reading of rule 6.4) and amendment 2

- **Dev run 1** (`artifacts/eval/dev/run1-wbgt-only/selection.json`, code `56571b2`, generated 2026-11-14T19:20:23.125640Z): the B2 controller read rule 6.4 as applying to the WBGT interval only (ledger R50, ruled before any run). Result: calibration window **`september`** (rule 6.4 decision `september`). Hottest-tercile 90% coverage in the 2024-2025 leave-one-cluster-out run, leads 1/2/3:

| Variable | Coverage, leads 1 / 2 / 3 (floor 0.85) |
|---|---|
| WBGT | 0.892 / 0.892 / 0.883 |
| T | 0.757 / 0.760 / 0.770 |
| Td | 0.779 / 0.754 / 0.751 |
| wind | 0.862 / 0.865 / 0.862 |

- **Amendment 2** (`docs/research/2026-11-15-preregistration-amendment-2.md`, SHA-256 `ae0b5d7bff9335617407d3a78448f5abd64284ff5ce8866781c4230eff05c8ad`; decided by Ali on 2026-11-15, written before any 2026 scoring): rule 6.4 applies to **all four variables**. Its stated reason: "the rule exists to choose honest uncertainty, and understated uncertainty on the hottest days is the failure that matters for worker safety." Its disclosure: the reading was fixed **after** seeing development results (2024-2025 only), "not informed by any 2026 number".
- **Dev run 2** (`artifacts/eval/dev/selection.json`, code `ffece93`, `calibration_targets` = `all`): rule 6.4 switched the window to **`weeks_4_8_12_16`** (`min_top_coverage` 0.7514 is the coverage of the PRE-switch `september` window that triggered the switch, against the floor 0.85; it is not the released window's coverage. `selection.json` holds only the pre-switch coverage. The released window's own development coverage in the same stratum, hottest tercile, working daytime, leads 1-3, all four variables, is at least 0.784, from `dev_skill.json` (table below)), with the same decisions for rules 6.1-6.3 as dev run 1 (num_leaves 7, min_child_samples 1000, n_estimators 150; cold features; joint WBGT). The released model uses `weeks_4_8_12_16`.

Hottest-tercile 90% coverage, working daytime, leads 1/2/3, after the switch: the final development run (2024-2025 leave-one-cluster-out, `dev_skill.json`) against the 2026 test (regime (a)). The two are different regimes and models (development is out-of-fold on held-out clusters; 2026 is the released model on known sites), so this is a side-by-side, not a like-for-like comparison.

| Variable | Development after the switch | 2026, regime (a) |
|---|---|---|
| T | 0.784 / 0.787 / 0.806 | 0.896 / 0.904 / 0.914 |
| Td | 0.868 / 0.867 / 0.885 | 0.897 / 0.905 / 0.909 |
| WBGT | 0.913 / 0.911 / 0.913 | 0.914 / 0.924 / 0.911 |
| wind | 0.888 / 0.891 / 0.892 | 0.931 / 0.928 / 0.937 |

The 2026 run under the pre-switch window (`september`) was not made, so no counterfactual is claimed about what H2 would have shown without amendment 2.

### 5.2 The running-bias baseline B3d: development against 2026

Development (2024-2025, leave-one-cluster-out, working daytime; `dev_skill.json`) against 2026 (regime (a), working daytime). Delta is CRPS(corrector) minus CRPS(B3d); positive means B3d was better.

| Target | Lead | Development: corrector vs B3d, Delta [95% interval] | 2026: corrector vs B3d, Delta [95% interval] |
|---|---|---|---|
| T | 1 | 1.056 vs 1.005: 0.051 [0.013, 0.091] | 0.824 vs 1.032: -0.207 [-0.264, -0.158] |
| T | 2 | 1.100 vs 1.079: 0.022 [-0.016, 0.059] | 0.871 vs 1.068: -0.197 [-0.252, -0.143] |
| T | 3 | 1.170 vs 1.168: 0.002 [-0.039, 0.042] | 0.928 vs 1.118: -0.189 [-0.241, -0.136] |
| Td | 1 | 2.392 vs 2.495: -0.103 [-0.183, -0.021] | 2.114 vs 2.582: -0.469 [-0.584, -0.361] |
| Td | 2 | 2.506 vs 2.663: -0.156 [-0.241, -0.075] | 2.185 vs 2.706: -0.520 [-0.618, -0.428] |
| Td | 3 | 2.626 vs 2.881: -0.255 [-0.347, -0.163] | 2.338 vs 2.905: -0.567 [-0.683, -0.457] |
| wind | 1 | 0.800 vs 0.885: -0.085 [-0.107, -0.062] | 0.688 vs 0.838: -0.150 [-0.176, -0.125] |
| wind | 2 | 0.828 vs 0.933: -0.105 [-0.129, -0.080] | 0.714 vs 0.859: -0.145 [-0.169, -0.123] |
| wind | 3 | 0.853 vs 0.955: -0.103 [-0.128, -0.078] | 0.744 vs 0.896: -0.152 [-0.172, -0.131] |

**In development under leave-one-cluster-out, B3d beat the corrector on T CRPS at lead 1 (1.005 against 1.056; Delta 0.051 [0.013, 0.091]).** On 2026 the corrector has the lower T CRPS than B3d at lead 1 (0.824 against 1.032; Delta -0.207 [-0.264, -0.158]). The 2026 H1-run result (section 3.1) is: supported under the rule of section 3.1. The development finding was a different regime (held-out clusters, out-of-fold) from the 2026 regime (a) (known sites); the development result did not repeat in 2026, and this report makes no claim about why.

Pre-registration section 10.3 item 1 disclosed that the 2026 IFS warm bias was known before the corrector was built and that B3d was pre-registered as the baseline that could track it. Which claims depend on B3d: only H1-run (secondary) and the section 10.3 mitigation sentence.

### 5.3 The 2025 development scoreboard

`artifacts/eval/dev/policy_scoreboard.2025.json` (B3 commit `36c465a`; label "DEV 2025, LOCO out-of-fold: not the result") was run before the 2026 run and is not a result. I read it for this report. Under the registered rules H4 was `negative` and H5 was `negative` on it: "H4 not supported at lead 1. Failing: the P1 side (false-alarm hours, P3 minus P1: +6.0 h, 95% interval [-38.5, +50.0]). The scoreboard is shown as it is."; "H5 not supported at lead 1 (secondary): P3 minus P2 missed danger hours -51.0 h, 95% interval [-68.0, -34.5]; false-alarm hours P3 306.0 h against P2 125.0 h (above P2 + 25%)." The freeze addendum records the same outcome.

P3 minus P1 false-alarm hours at lead 1 was +6.0 [-38.5, +50.0] on the 2025 development scoreboard against -93.0 [-148.5, -37.0] on 2026. P3's false-alarm hours at lead 1 were 306 in 2025 against 183.5 in 2026. On 2026 the runner reports H4 `supported` and H5 `negative`. **H4 passed on 2026 but failed on the 2025 development data, so H4 is not presented as a stable result.**

## 6. Regime (c) beside regime (a), per cluster, and the raw comparison

### 6.1 Regime (c) (new cluster, new summer: six cold models, each refit without the held-out cluster) beside regime (a)

Working daytime, pooled over the 8 stations, leads 1-3. Delta against B2d and B3d is CRPS(corrector) minus CRPS(baseline). Regime (c) may score T, Td and wind on different rows than regime (a) (the file's notes); here the counts are `n_rows` of each row.

| Target | Lead | CRPS corrector (a) | CRPS corrector (c) | B2d (a) | B2d (c) | B3d (a) | B3d (c) | Coverage 90% (a) | Coverage 90% (c) |
|---|---|---|---|---|---|---|---|---|---|
| T | 1 | 0.824 (n = 9,999) | 1.191 (n = 9,999) | 1.030 | 1.405 | 1.032 | 1.046 | 0.8855 | 0.7839 |
| T | 2 | 0.871 (n = 9,999) | 1.247 (n = 9,999) | 1.073 | 1.470 | 1.068 | 1.082 | 0.8938 | 0.7957 |
| T | 3 | 0.928 (n = 9,999) | 1.308 (n = 9,999) | 1.121 | 1.551 | 1.118 | 1.130 | 0.8957 | 0.8031 |
| Td | 1 | 2.114 (n = 9,999) | 2.744 (n = 9,999) | 2.463 | 2.786 | 2.582 | 2.604 | 0.8933 | 0.8395 |
| Td | 2 | 2.185 (n = 9,999) | 2.851 (n = 9,999) | 2.612 | 2.981 | 2.706 | 2.726 | 0.9057 | 0.8430 |
| Td | 3 | 2.338 (n = 9,999) | 3.016 (n = 9,999) | 2.848 | 3.272 | 2.905 | 2.929 | 0.9062 | 0.8486 |
| wind | 1 | 0.688 (n = 9,999) | 0.771 (n = 9,999) | 0.849 | 0.892 | 0.838 | 0.839 | 0.9196 | 0.8936 |
| wind | 2 | 0.714 (n = 9,999) | 0.794 (n = 9,999) | 0.875 | 0.915 | 0.859 | 0.861 | 0.9219 | 0.9004 |
| wind | 3 | 0.744 (n = 9,999) | 0.823 (n = 9,999) | 0.914 | 0.949 | 0.896 | 0.897 | 0.9248 | 0.9009 |
| WBGT | 1 | 0.663 (n = 9,999) | 0.717 (n = 9,999) | 0.761 | 0.778 | not computed | not computed | 0.9065 | 0.9109 |
| WBGT | 2 | 0.690 (n = 9,999) | 0.749 (n = 9,999) | 0.785 | 0.806 | not computed | not computed | 0.9147 | 0.9132 |
| WBGT | 3 | 0.735 (n = 9,999) | 0.794 (n = 9,999) | 0.839 | 0.863 | not computed | not computed | 0.9048 | 0.9068 |

Regime (c) paired differences (the corrector minus each baseline):

| Target | Lead | Delta vs B2d [95% interval] | Delta vs B3d [95% interval] |
|---|---|---|---|
| T | 1 | -0.214 [-0.268, -0.160] | 0.145 [0.075, 0.212] |
| T | 2 | -0.223 [-0.271, -0.175] | 0.165 [0.097, 0.231] |
| T | 3 | -0.244 [-0.286, -0.197] | 0.177 [0.121, 0.235] |
| Td | 1 | -0.041 [-0.148, 0.071] | 0.140 [0.014, 0.257] |
| Td | 2 | -0.129 [-0.220, -0.038] | 0.125 [0.007, 0.236] |
| Td | 3 | -0.256 [-0.365, -0.152] | 0.087 [-0.046, 0.214] |
| wind | 1 | -0.121 [-0.138, -0.102] | -0.068 [-0.096, -0.039] |
| wind | 2 | -0.121 [-0.143, -0.100] | -0.067 [-0.094, -0.041] |
| wind | 3 | -0.126 [-0.149, -0.102] | -0.075 [-0.100, -0.051] |
| WBGT | 1 | -0.061 [-0.096, -0.020] | not defined for WBGT (no bias7) |
| WBGT | 2 | -0.058 [-0.089, -0.023] | not defined for WBGT (no bias7) |
| WBGT | 3 | -0.069 [-0.105, -0.031] | not defined for WBGT (no bias7) |

### 6.2 Per cluster and per station (descriptive; no interval, as section 8 says)

Rows are pooled over all modelled hours (the `by_cluster` and `by_station` tables carry no hour-block column), lead 1, regime (a) and (c).

| Regime | Target | Cluster | Rows | CRPS corrector | CRPS B2d | CRPS B3d | Coverage 90% |
|---|---|---|---|---|---|---|---|
| (a) | T | abu_dhabi | 2,500 | 0.813 | 0.883 | 0.859 | 0.8780 |
| (a) | T | al_ain | 1,251 | 0.654 | 0.721 | 0.696 | 0.9049 |
| (a) | T | al_maktoum | 1,248 | 0.768 | 0.778 | 0.806 | 0.9062 |
| (a) | T | dubai_sharjah | 2,500 | 0.780 | 0.958 | 0.969 | 0.8940 |
| (a) | T | fujairah | 1,251 | 1.136 | 2.033 | 2.038 | 0.8513 |
| (a) | T | ras_al_khaimah | 1,249 | 0.851 | 1.021 | 1.056 | 0.8775 |
| (a) | Td | abu_dhabi | 2,500 | 2.426 | 2.319 | 2.313 | 0.8600 |
| (a) | Td | al_ain | 1,251 | 1.870 | 1.943 | 2.002 | 0.9369 |
| (a) | Td | al_maktoum | 1,248 | 2.166 | 2.073 | 2.160 | 0.8766 |
| (a) | Td | dubai_sharjah | 2,500 | 1.982 | 2.106 | 2.189 | 0.9004 |
| (a) | Td | fujairah | 1,251 | 1.795 | 4.317 | 4.862 | 0.9432 |
| (a) | Td | ras_al_khaimah | 1,249 | 2.263 | 2.522 | 2.629 | 0.8687 |
| (c) | T | abu_dhabi | 2,500 | 0.933 | 1.150 | 0.872 | 0.8572 |
| (c) | T | al_ain | 1,251 | 1.694 | 0.797 | 0.708 | 0.8641 |
| (c) | T | al_maktoum | 1,248 | 0.874 | 0.913 | 0.809 | 0.8542 |
| (c) | T | dubai_sharjah | 2,500 | 0.878 | 1.141 | 0.974 | 0.8604 |
| (c) | T | fujairah | 1,251 | 2.487 | 3.879 | 2.098 | 0.2518 |
| (c) | T | ras_al_khaimah | 1,249 | 0.851 | 1.065 | 1.059 | 0.8663 |
| (c) | Td | abu_dhabi | 2,500 | 2.808 | 3.019 | 2.337 | 0.8100 |
| (c) | Td | al_ain | 1,251 | 4.221 | 1.961 | 2.008 | 0.9544 |
| (c) | Td | al_maktoum | 1,248 | 2.182 | 2.293 | 2.165 | 0.8926 |
| (c) | Td | dubai_sharjah | 2,500 | 2.058 | 2.177 | 2.192 | 0.8868 |
| (c) | Td | fujairah | 1,251 | 3.557 | 5.115 | 4.967 | 0.6179 |
| (c) | Td | ras_al_khaimah | 1,249 | 2.260 | 2.522 | 2.632 | 0.8575 |

Per-cluster 90% coverage for T and Td at lead 1: regime (a) from 0.8513 (T, fujairah) to 0.9432 (Td, fujairah); regime (c) from 0.2518 (T, fujairah) to 0.9544 (Td, al_ain). Per-cluster results are described, not tested (section 8).

### 6.3 Raw model comparison (IFS, AIFS, GFS; leads 1-3)

From `forecast_skill.json` `raw_comparison`: MAE and bias of the raw models by summer. Rows are as the file defines them (not restricted to the working block).

| Target | Summer | Lead | Model | Rows | MAE | Bias |
|---|---|---|---|---|---|---|
| T | 2025 | 1 | ecmwf_aifs025_single | 15,477 | 1.775 | 0.130 |
| T | 2025 | 1 | ecmwf_ifs025 | 15,477 | 1.595 | 0.238 |
| T | 2025 | 1 | gfs_seamless | 15,477 | 1.707 | 0.172 |
| T | 2025 | 2 | ecmwf_aifs025_single | 15,477 | 1.814 | 0.024 |
| T | 2025 | 2 | ecmwf_ifs025 | 15,477 | 1.670 | 0.193 |
| T | 2025 | 2 | gfs_seamless | 15,477 | 1.780 | 0.329 |
| T | 2025 | 3 | ecmwf_aifs025_single | 15,477 | 1.860 | -0.025 |
| T | 2025 | 3 | ecmwf_ifs025 | 15,477 | 1.771 | 0.171 |
| T | 2025 | 3 | gfs_seamless | 15,477 | 1.889 | 0.494 |
| T | 2026 | 1 | ecmwf_aifs025_single | 15,545 | 1.930 | 0.597 |
| T | 2026 | 1 | ecmwf_ifs025 | 15,545 | 1.737 | 0.654 |
| T | 2026 | 1 | gfs_seamless | 15,545 | 1.785 | 0.257 |
| T | 2026 | 2 | ecmwf_aifs025_single | 15,545 | 1.948 | 0.559 |
| T | 2026 | 2 | ecmwf_ifs025 | 15,545 | 1.835 | 0.654 |
| T | 2026 | 2 | gfs_seamless | 15,545 | 1.895 | 0.495 |
| T | 2026 | 3 | ecmwf_aifs025_single | 15,545 | 1.971 | 0.554 |
| T | 2026 | 3 | ecmwf_ifs025 | 15,545 | 1.933 | 0.674 |
| T | 2026 | 3 | gfs_seamless | 15,545 | 1.983 | 0.694 |
| Td | 2025 | 1 | ecmwf_aifs025_single | 15,477 | 2.995 | 1.096 |
| Td | 2025 | 1 | ecmwf_ifs025 | 15,477 | 3.157 | -1.435 |
| Td | 2025 | 1 | gfs_seamless | 15,477 | 4.455 | -3.768 |
| Td | 2025 | 2 | ecmwf_aifs025_single | 15,477 | 3.105 | 1.128 |
| Td | 2025 | 2 | ecmwf_ifs025 | 15,477 | 3.406 | -1.499 |
| Td | 2025 | 2 | gfs_seamless | 15,477 | 4.848 | -4.212 |
| Td | 2025 | 3 | ecmwf_aifs025_single | 15,477 | 3.169 | 1.192 |
| Td | 2025 | 3 | ecmwf_ifs025 | 15,477 | 3.663 | -1.524 |
| Td | 2025 | 3 | gfs_seamless | 15,477 | 5.117 | -4.467 |
| Td | 2026 | 1 | ecmwf_aifs025_single | 15,545 | 3.291 | 1.175 |
| Td | 2026 | 1 | ecmwf_ifs025 | 15,545 | 3.377 | -1.221 |
| Td | 2026 | 1 | gfs_seamless | 15,545 | 4.676 | -3.906 |
| Td | 2026 | 2 | ecmwf_aifs025_single | 15,545 | 3.362 | 1.115 |
| Td | 2026 | 2 | ecmwf_ifs025 | 15,545 | 3.684 | -1.500 |
| Td | 2026 | 2 | gfs_seamless | 15,545 | 5.220 | -4.484 |
| Td | 2026 | 3 | ecmwf_aifs025_single | 15,545 | 3.434 | 1.035 |
| Td | 2026 | 3 | ecmwf_ifs025 | 15,545 | 4.125 | -1.700 |
| Td | 2026 | 3 | gfs_seamless | 15,545 | 5.484 | -4.722 |
| WBGT | 2025 | 1 | ecmwf_aifs025_single | 15,477 | 1.214 | 0.727 |
| WBGT | 2025 | 1 | ecmwf_ifs025 | 15,477 | 1.011 | -0.232 |
| WBGT | 2025 | 1 | gfs_seamless | 15,477 | 1.611 | -1.371 |
| WBGT | 2025 | 2 | ecmwf_aifs025_single | 15,477 | 1.229 | 0.695 |
| WBGT | 2025 | 2 | ecmwf_ifs025 | 15,477 | 1.087 | -0.252 |
| WBGT | 2025 | 2 | gfs_seamless | 15,477 | 1.694 | -1.468 |
| WBGT | 2025 | 3 | ecmwf_aifs025_single | 15,477 | 1.254 | 0.708 |
| WBGT | 2025 | 3 | ecmwf_ifs025 | 15,477 | 1.164 | -0.284 |
| WBGT | 2025 | 3 | gfs_seamless | 15,477 | 1.725 | -1.471 |
| WBGT | 2026 | 1 | ecmwf_aifs025_single | 15,545 | 1.314 | 0.893 |
| WBGT | 2026 | 1 | ecmwf_ifs025 | 15,545 | 1.053 | 0.012 |
| WBGT | 2026 | 1 | gfs_seamless | 15,545 | 1.688 | -1.476 |
| WBGT | 2026 | 2 | ecmwf_aifs025_single | 15,545 | 1.320 | 0.868 |
| WBGT | 2026 | 2 | ecmwf_ifs025 | 15,545 | 1.113 | -0.076 |
| WBGT | 2026 | 2 | gfs_seamless | 15,545 | 1.783 | -1.574 |
| WBGT | 2026 | 3 | ecmwf_aifs025_single | 15,545 | 1.336 | 0.850 |
| WBGT | 2026 | 3 | ecmwf_ifs025 | 15,545 | 1.215 | -0.138 |
| WBGT | 2026 | 3 | gfs_seamless | 15,545 | 1.815 | -1.564 |
| wind | 2025 | 1 | ecmwf_aifs025_single | 15,477 | 1.311 | -0.577 |
| wind | 2025 | 1 | ecmwf_ifs025 | 15,477 | 1.274 | -0.681 |
| wind | 2025 | 1 | gfs_seamless | 15,477 | 1.354 | 0.321 |
| wind | 2025 | 2 | ecmwf_aifs025_single | 15,477 | 1.347 | -0.643 |
| wind | 2025 | 2 | ecmwf_ifs025 | 15,477 | 1.346 | -0.742 |
| wind | 2025 | 2 | gfs_seamless | 15,477 | 1.398 | 0.322 |
| wind | 2025 | 3 | ecmwf_aifs025_single | 15,477 | 1.365 | -0.667 |
| wind | 2025 | 3 | ecmwf_ifs025 | 15,477 | 1.362 | -0.697 |
| wind | 2025 | 3 | gfs_seamless | 15,477 | 1.423 | 0.284 |
| wind | 2026 | 1 | ecmwf_aifs025_single | 15,545 | 1.289 | -0.422 |
| wind | 2026 | 1 | ecmwf_ifs025 | 15,545 | 1.212 | -0.527 |
| wind | 2026 | 1 | gfs_seamless | 15,545 | 1.374 | 0.563 |
| wind | 2026 | 2 | ecmwf_aifs025_single | 15,545 | 1.291 | -0.501 |
| wind | 2026 | 2 | ecmwf_ifs025 | 15,545 | 1.236 | -0.521 |
| wind | 2026 | 2 | gfs_seamless | 15,545 | 1.435 | 0.600 |
| wind | 2026 | 3 | ecmwf_aifs025_single | 15,545 | 1.298 | -0.552 |
| wind | 2026 | 3 | ecmwf_ifs025 | 15,545 | 1.278 | -0.494 |
| wind | 2026 | 3 | gfs_seamless | 15,545 | 1.489 | 0.609 |

## 7. Claims table: what a deck may say

Three columns: the claim a deck may make, the numbers behind it, and the wording that is **not** allowed. Every number is from the files and is the same number as in sections 2 and 3. Labels from the files must travel with the claim ("REAL weather + assumed crew", "SIMULATED crew", "assumed crew of 20 doing heavy work (ASSUMED)").

| Claim a deck may make | Numbers behind it (from the files) | Wording that is NOT allowed |
|---|---|---|
| **Forecast vs static correction.** On 2026 at the eight airports (known sites, an unseen summer), the corrected forecast has a lower CRPS than a static bias correction (B2d) for temperature and dew point at 1, 2 and 3 days ahead. | T, lead 1 working: 0.824 against 1.030, Delta -0.205 [-0.252, -0.159]; Td, lead 1: 2.114 against 2.463, Delta -0.350 [-0.444, -0.252]; all six T and Td cells at leads 1-3 in section 3.1. H1 supported under the rule of section 3.1. **Caveat that travels with this claim:** the 2026 IFS warm bias was known before the corrector was built (pre-registration section 10.3 item 1: "Risk: our feature design benefits from hindsight"); B3d was pre-registered as the baseline that could track it. | "Beats every baseline"; "beats the best baseline"; any claim at a pooled-over-leads interval (none computed); stating the result without the hindsight disclosure; the claim that it beats a plain linear model for WBGT (against B4, WBGT leads 1-3 working: the interval includes zero, section 3.1); "AI beats simple correction" without naming B2d; **"WBGT forecast improved over static correction"**: the WBGT CRPS difference against B2d (corrector minus B2d) is -0.098, -0.095, -0.104 at leads 1, 2, 3; below the 0.1 floor in absolute value at lead(s) 1, 2, so at those leads it is under the section 8 floor ("not distinguishable"). |
| **Forecast vs running correction.** On 2026 the corrector also had a lower T and Td CRPS than a running 7-day bias correction (B3d) at leads 1-3 (secondary result). | T, lead 1: 0.824 against 1.032, Delta -0.207 [-0.264, -0.158]. In development (held-out clusters) B3d was better on T at lead 1: 1.005 against 1.056 (section 5.2). In regime (c), against B3d (section 6.1): T: point estimates favour B3d at leads 1-3, the interval excludes zero at lead(s) 1, 2, 3; Td: point estimates favour B3d at leads 1-3, the interval excludes zero at lead(s) 1, 2 and includes zero at lead(s) 3. Baseline fallbacks (section 3.1): B3d fell back on 3,920 of 108,976 rows (3.6%), B4 on 14,896 (13.7%). | "Always beats a running correction"; any statement that omits that B3d won on T in development and in regime (c); "beats every baseline"; quoting B3d or B4 comparisons without the fallback shares. |
| **Interval calibration.** The 90% intervals held their level on 2026 in regime (a): coverage was 86-93% per time-of-day and lead stratum (nominal 90%). | 0.8594 to 0.9302 over 48 strata (4 variables x 3 leads x 4 blocks including `working`); 36 strata without the `working` block, same minimum and maximum (section 3.2). H2 holds under the rule of section 3.2. Point estimates only; no interval on coverage. | "Calibrated everywhere" or "calibrated at new sites": in regime (c) 23 of 48 strata are below 0.85 (lowest 0.7415: T, lead 1, late; WBGT cells below 0.85: early lead 1 0.842, early lead 2 0.848; section 6.1). "The bands were tuned on 2026": they were not, but amendment 2 was fixed after development results (section 5.1). |
| **Event probabilities.** The corrector's probabilities rank hours well: Brier skill about +0.47 to +0.53 against a constant base rate (WBGT >= 30 and >= 32, leads 1-3, working daytime). They are **overstated, not calibrated**: in every populated bin of WBGT >= 32 the event occurred less often than forecast (58.5% when 65-75% was forecast, n = 769); at WBGT >= 30, 10 of 11 bins are also below. | BSS vs climatology (working, leads 1-3): >= 30: 0.5304, 0.5256, 0.5064; >= 32: 0.5132, 0.4952, 0.4655. Against B2d (not better everywhere): >= 30: -0.0619, -0.0121, 0.0237; >= 32: 0.0162, 0.0232, 0.0360. Reliability tables: section 3.3. | **"Calibrated probabilities"**; "when we say 70% it happens 70% of the time" (the observed frequency in the 0.65-0.75 bin of WBGT >= 32 is 0.5852, n = 769); "better probabilities than the static correction" (H3 not supported); a reliability claim that omits the diagram. |
| **Warnings vs ban only and vs a naive WBGT rule (OMAA, 2026, lead 1).** Stellar Blaze at theta 0.3 raised fewer false-alarm hours than a naive WBGT >= 32 rule on the raw forecast, and missed fewer danger hours than the midday ban alone (H4 supported). The comparison with ban only is a baseline by construction, not evidence of skill (section 3.4). | False-alarm hours: P3 183.5 [135.5, 233.5] against P1 276.5 [224.5, 325]. Missed danger hours: P3 45.5 [27, 66] against P0 252.5 [191.5, 315.5]. **P0 (ban only) warns nothing on a worked hour**: its POD is 0.000, so H4's P0 side is near-tautological and must not be presented as skill. Paired differences: H4 supported at lead 1: P3 has fewer missed danger hours than P0 (ban only) (-207.0 h, 95% interval [-261.5, -154.5]) and fewer false-alarm hours than P1 (WBGT >= 32 on raw IFS) (-93.0 h, 95% interval [-148.5, -37.0]). | "Beats every policy"; "fewer false alarms AND fewer misses" (P1 misses fewer than P3: 19 against 45.5 danger hours, at 276.5 against 183.5 false-alarm hours); presenting the win over ban only as skill; "beats ADOSH on the raw forecast" or "beats the regulator's zones" (H5 not supported: P2 has 74.5 false-alarm hours against 183.5 for P3 at theta 0.3); any statement at theta 0.45 that P3 is better than P2 (P3 96.5 [65.5, 130.5] missed and 73.5 [53.5, 92.5] false alarms against P2 80.5 [53.5, 110] and 74.5 [50, 103]: no paired interval, the two are not distinguishable on these numbers). |
| **Detection rate.** P3 at theta 0.3 warned 82% of the danger hours at lead 1 and 80% at lead 2 on 2026 (hour-weighted POD), against the design target of at least 90%. | Design target at theta_protect 0.3: POD >= 0.90 (development, hour-weighted, 2024-2025 abu_dhabi out-of-fold: POD 0.906, `artifacts/eval/dev/theta.json`). On 2026: P3_protect POD 0.820 [0.754, 0.883] at lead 1 and 0.800 [0.735, 0.869] at lead 2. P1's POD at lead 1 is 0.925 [0.870, 0.971]. | "Catches 90% of danger hours" (or "nine in ten"): that was the design target, not the 2026 result. |
| **False-alarm hours only.** The comparison of Stellar Blaze with the naive rule may be made on false-alarm hours (see the Warnings row above). It may not be extended to alerts, FAR or CSI. | Alerts per worker-shift at lead 1: P3_protect 1.360, P1 1.345. CSI at lead 1, highest first: P2 0.526 [0.451, 0.600], P3_balanced 0.479 [0.399, 0.552], P3_protect 0.475 [0.381, 0.560], P1 0.441 [0.372, 0.503]; all four CSI intervals overlap: yes. FAR intervals at lead 1: P3_protect [0.366, 0.581] overlaps P1 [0.476, 0.613] and P2 [0.218, 0.398]; P1 and P2 do not overlap each other. | "Fewer alerts than the naive rule" (P3_protect 1.360 against P1 1.345 alerts per worker-shift); "best overall"; "highest CSI" (P2 has the highest point estimate and the intervals overlap); a FAR ranking. |
| **Stability of the Warnings result.** H4 holds on 2026, and it must not be presented as a stable result. | On the 2025 development scoreboard (label "DEV 2025, LOCO out-of-fold: not the result"), H4 was `negative` and H5 `negative`: P3 minus P1 false-alarm hours +6.0 [-38.5, +50.0] (2026: -93.0 [-148.5, -37.0]); P3 false-alarm hours at lead 1: 306 in 2025 against 183.5 in 2026 (section 5.3). | "The warning policy reliably beats the naive rule"; any statement of H4 as a repeated or robust finding. |
| **The evening-before stamp.** The strict (lead 2) numbers may carry "issued by 18:00 GST the evening before", because H4 holds at lead 1 and at lead 2 (runner's verdict). | H4 holds at lead 2 (issued by 18:00 GST the evening before): P3 has fewer missed danger hours than P0 (-202.0 h, 95% interval [-255.0, -150.5]) and fewer false-alarm hours than P1 (-75.5 h, 95% interval [-119.0, -32.5]). The stamp "issued by 18:00 GST the evening before" may be carried: H4 holds at lead 1 and at lead 2. | The stamp on lead 1 numbers (lead 1 is worded "about 24 hours ahead", pre-registration section 4); the stamp on any number that is not the lead-2 row. |
| **Plans (OMAA, roster L1; SIMULATED crew, REAL weather).** The rule plan from the corrected forecast has far fewer truth-zone rule-violation minutes than ban only, and it adds more rest minutes than the rule plan from the raw forecast. Both numbers go together. | Unit: one homogeneous crew plan (all 20 members share it; not multiplied by headcount), summed over 138 scored days. Violation minutes: ban only 33,875 [27,425, 40,211], raw rule plan 15,225 [11,350, 19,221], corrected rule plan 2,140 [700, 3,835]. Rest minutes added vs naive: raw rule plan 13,560 [10,454, 16,736], corrected rule plan 31,680 [27,450, 35,135] (the corrected plan adds 18,120 more than the raw plan). Rest cost as a share of scheduled minutes (66,240 = 480 min per day from the fixture shift x 138 scored days; section 2.4): corrected 47.8%, raw rule plan 20.5%. Missed-protection ticks: 2,219 / 675 / 89. H6 supported: the rule plan on the corrected forecast has 31735 fewer rule-violation minutes per worker-season than ban only (95% interval of the difference [-37415, -25844]). SIMULATED crew, real weather. **Ban only is naive by construction on L1** (identical rows), so H6 compares the rule engine with doing nothing: it is near-tautological and must not be presented as forecast skill; the like-for-like forecast comparison is H7. | "Minutes avoided" or "illness prevented" (ADR 0034); a violation-minutes figure without the rest-minutes figure and the rest share beside it; presenting the H6 win over ban only as forecast skill; presenting the crew as real (it is SIMULATED: 20 experienced adults, heavy work); a claim about productivity; "the forecast alone does the protecting" (the zone engine and validator do the protecting; the forecast sets how much rest is scheduled); quoting the minutes as per-worker or per-day figures. |
| **Plans, corrected vs raw rule plan (secondary).** The corrected rule plan has fewer missed-protection ticks than the raw rule plan (H7 supported). | H7 supported (secondary): 586 fewer missed-protection ticks than the raw-IFS rule plan (95% interval of the difference [-830, -367]). | Presenting H7 as a headline (it is secondary and was pre-registered as an expected tie); omitting that the corrected plan also adds more rest minutes. |
| **Demo day.** 2026-06-14 at OMAA was selected by the pre-registered truth-only rule; on that day the corrected-forecast policy P3 at theta 0.3 warned 6 of the 7 High-or-Red hours and the raw-ADOSH policy P2 warned 5. | `demo_day.json`: score 7, runner-up 2026-09-26 also 7 (tie to the earliest date); hourly table in section 2.3. The "6 of 7" holds for theta_protect only: P3_balanced (theta 0.45) warned 5 of 7, the same as P2. The naive policy P1 warned 7 of the 7 (counted from the hourly rows). The hour P3_protect did not warn (13:00Z) was a truth-High hour by 1.3 W/m2 (truth effective TWL 113.7 against the 115 edge); P(High) there was 0.10. | "The day proves the system works" or any statement of skill from one day; "6 of 7" without "at theta 0.30" (P3_balanced warned 5 of 7); hiding that P1 warned all of the High-or-Red hours that day; choosing a different day after seeing results (section 7.4 forbids it). |
| **New sites (regime (c)).** Held-out airport clusters, a new summer: the corrector still beats the static correction on CRPS at T, wind and WBGT (Td at leads 2-3), but its coverage falls short, and B3d has the lower CRPS on T and Td at the point estimates. | CRPS ratio regime (c) / regime (a), working daytime, leads 1-3: T 1.41-1.44; Td 1.29-1.30; wind 1.11-1.12; WBGT 1.08-1.09. Coverage: 23 of 48 regime-(c) strata below 0.85 (lowest 0.7415). Against B3d: T: point estimates favour B3d at leads 1-3, the interval excludes zero at lead(s) 1, 2, 3; Td: point estimates favour B3d at leads 1-3, the interval excludes zero at lead(s) 1, 2 and includes zero at lead(s) 3. | "Calibrated at new sites"; "works at any airport"; any new-site claim quoted from regime (a); "new site" for OMAA (a known site). |
| **Scope.** All warning and plan results are for one known site (OMAA, regime (a): the site is in the 2024-2025 training data) in an unseen summer, 2026. 2026 is disclosed as not untouched. | Pre-registration sections 0.2, 0.3 and 10; amendment 3 item 1 (pooled 8-station and regime (c) at OMAA policy rows: not computed); `regime_b_all`: "not run"; truth WBGT and TWL are derived (assumption A2), not instrument readings; the 2026 IFS cycle changed (50r1, from 12 May 2026), so a failure may be the upgrade. | "Any worksite", "any airport", "new site" (only regime (c) is a new-site claim); "2026 was never looked at" (raw-forecast diagnostics on 2026 were read on 11-12 Nov, section 10.1); "the warnings generalise"; "certified" (TWL is aligned with ADOSH zones, not certified). |

## 8. Caveats that travel with every headline (pre-registration section 10.4)

- 8 stations are about 4.2-4.6 independent sites; OMAA-only rows rest on one site-summer (pre-registration section 8: about 139 days and roughly 20 effective 7-day blocks): wide intervals.
- All stations are airports. The claim is "held-out airport clusters", never "any worksite".
- WBGT and TWL truth are derived (assumption A2). METAR truth is whole-degree (about 0.29 C noise); a CRPS difference below 0.1 C is "not distinguishable" even if the interval excludes zero (WBGT vs B2d, Delta -0.098, -0.095, -0.104 at leads 1, 2, 3; below the 0.1 floor in absolute value at lead(s) 1, 2; the interval vs B4 includes zero; see section 3.1).
- 2026 is a new IFS cycle (50r1, from 12 May 2026): a failure in regime (a) may be the upgrade.
- **Hindsight (pre-registration section 10.3 item 1):** the 2026 bias shift (IFS warmer in 2026) was known before the corrector was built, so "our feature design benefits from hindsight". B3d was pre-registered as a baseline that could track the shift. Every forecast-skill claim travels with this disclosure.
- B3d fell back on 3.6% of regime-(a) rows and B4 on 13.7% (section 3.1); comparisons with them include those rows.
- Selection rotated clusters, not summers (leave-one-cluster-out over 2024-2025). Clusters share days, so development estimates are optimistic for a new summer, and one test summer is one draw of summer-to-summer variability. Development against 2026 differed in both directions: B3d beat the corrector on T in development and not on 2026; hottest-tercile T coverage was 0.784 to 0.806 in development and every H2 stratum was in [0.85, 0.95] on 2026; H4 was negative on the 2025 development scoreboard and supported on 2026 (ADR 0070). Numbers: development T at lead 1, B3d 1.005 against the corrector 1.056 (Delta 0.051 [0.013, 0.091]), and 2026 T at lead 1, the corrector 0.824 against B3d 1.032 (section 5.2); the 2026 H2 range is 0.8594 to 0.9302 (section 3.2); the dev-versus-2026 H4 differences are in section 5.3.
- The crew is SIMULATED; the weather is REAL. TWL is aligned with ADOSH zones, not certified.
- One Monte Carlo draw of 50 joint samples per hour made the scored probabilities (freeze addendum section 3 item 7): the scoreboard and the live product must not be shown side by side as if identical.
- The Red edge stayed at 85 W/m2 although ADR 0046's revisit trigger fired (freeze addendum section 2; amendment 3 section 2).

## 9. For the architect to verify

1. The hypothesis outcomes that are mine, not the runner's (H1, H1-raw, H1-run, H2, H3): the rules in sections 3.1-3.3. In particular: the per-lead reading of H1 (no pooled-over-leads row exists), the 0.1 noise floor applied to H1, all four hour blocks used for H2, and the sign-only reading of H3 (the file has no BSS interval).
2. The unit and the rest-cost denominator of the Plans minutes (section 2.4): derived from the scoring code in B3's tree and the fixture. The 138 scored days are the file's `n_days`; the roster is counted as the full shift on every scored day because the scoring does not read `days_per_week`.
3. Derived quantities that are arithmetic on file values and are labelled so: the differences in section 2.4, the P3_balanced against P2 point differences in section 3.4, the demo-day P1 counts in section 2.3.
4. Section 5.3 reads the 2025 development scoreboard from B3's tree (commit `36c465a`).
5. Day counts differ between files: the Warnings file has 139 days, the Plans file 138 (`n_days`), and the demo-day file 138 candidate days. Cause, from the scoring code in B3's tree (`ml/scoreboards.py` at `36c465a`): the Warnings count is the days with at least one usable hour; the Plans row scores a day only if truth, raw and corrected forecasts have a value on every roster tick; the demo-day rule needs all nine working hours observed, unrejected and forecast. The dropped date is not recorded in the result files, and the Plans totals are over 138 days.
6. In the sensitivity table of section 3.4 the margin-0 cell with withdrawal limits on equals the margin-0 cell with them off, while the two margin-7 cells differ. The equality is structural, and I checked it against the ruleset and the runner code in B3's tree (commit `36c465a`). The withdrawal cap is 115 W/m2 and applies where the dry bulb is strictly above 44 C (`backend/rulesets/ae-heat-2026.1.toml` `[twl_withdrawal]`, line 174; `dry_bulb_c` line 177, `cap_w_m2` line 179; the ruleset's own switch is off, and the sensitivity cell "on" uses `frozen_withdrawal`, `ml/twl_rows.py` line 134, the dry-bulb leg only). The cap is applied before the margin: `effective_twl` in `backend/src/stellar_blaze/domain/risk/twl_samples.py` (line 119) calls `apply_withdrawal_limits` at line 141, then subtracts the margin at line 142; `apply_withdrawal_limits` in `backend/src/stellar_blaze/domain/physics/twl.py` (line 402) takes `np.minimum(twl, cap)` at line 432. The zone rule gives Medium for an effective TWL at or above 115 W/m2 (`zone_of` in `backend/src/stellar_blaze/domain/risk/levels.py`, line 82, the comparison at line 89), so exactly 115 W/m2 is not a danger hour. At margin 0 the cap leaves at most 115 W/m2, never below 115, so it cannot create a danger hour: the margin-0 cells are equal (213 weighted truth danger hours in both). At margin 7 the cap leaves 108 W/m2, which is below 115, so every hour with a dry bulb above 44 C becomes a danger hour: 274.5 weighted truth danger hours with the cap on against 252.5 with it off (headline cell). In every cell the policies' warnings are the headline ones and only the truth danger hours change (`_rows_for(h, cell_danger, warned, thetas)`, `ml/scoreboards.py` line 706; the cell's truth uses `effective_twl` with `frozen_withdrawal` at line 423), so the policy columns move with the truth and not with their own forecasts.
7. Not in any file and therefore not in this report: a pooled-over-leads H1 interval, intervals on BSS and on coverage, a paired P3_balanced-against-P2 interval, regime (b-all), and the pooled and regime-(c) policy rows.

