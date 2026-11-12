# B2 Forecast Corrector and Honest Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a calibrated probabilistic corrector for IFS forecasts of T, Td, wind and WBGT at UAE airport stations, and an evaluation harness. The harness proves the corrector's value on 2024-2025 and then scores 2026 exactly once, under the pre-registration. B2 also ships the model artefact, the replay source and the provenance-carrying exports that B3, F2 and the deck consume.

**Architecture:**
- **Pure forecast vocabulary** in `domain/forecast/`: quantile grid, hour-blocks, features, conformal application, joint sampling, corrected-forecast schema.
- **Serving** through a new `ForecastCorrector` port. The `LightGbmCorrector` adapter needs only `lightgbm` + numpy; the train group is not in the image.
- **Offline package** `stellar_blaze/ml/`: training, baselines, metrics, bootstrap, selection, the 2026 gate, exporters. It may import the train group (`mapie`, `scikit-learn`, `scoringrules`) and is reachable only from `sb-jobs` commands that import it lazily.
- **2026 isolation:** 2026 rows can be read only through a gate token. The token is minted only when the pre-registration commit is an ancestor of a clean HEAD.

**Tech Stack:** Python 3.13, Polars 2.0.0, LightGBM 4.7.0, MAPIE 1.6.0 (test oracle only), scoringrules 0.12.0, scikit-learn 1.9.1, thermofeel 2.3.0 (via B1 `wbgt_liljegren`), Typer 0.29.0, pytest 9.2.0 + hypothesis 6.170.15. **No new dependency.**

**Spec:**
- `docs/research/2026-11-12-preregistration-2026-evaluation.md`: the binding evaluation design. Its §2-§9 are the spec for every metric, split, rule and gate here.
- ADR 0005, 0007, 0009 §3, 0010 §1(a) and §5, 0019, 0020, 0034.
- `docs/research/2026-11-11-backend-ml-stack.md` §6.1-§6.2: the MAPIE and scoringrules gotchas are authoritative.
- Roadmap §4.
- B1 code at `5f00cbe`: `domain/weather/schemas.py` (`GOLD_PAIRS_SCHEMA`, `FORECAST_SCHEMA`, `OBS_HOURLY_SCHEMA`), `domain/weather/stations.py` (clusters), `domain/config/models.py` (`ModelManifest`, `ModelRegistry`, `MODEL_ID`), `adapters/config/models.py` (`scan_models`), `domain/physics/wbgt.py` (`wbgt_liljegren`), `composition.py` (`FORECAST_SOURCES`, `Sources`), `jobs/cli.py` + `jobs/runner.py` (`run_job`).

**Branch:** `feat/b2-forecast-corrector` from `feat/b1-backend-foundation` @ `5f00cbe`. Gold data: `SB_DATA_DIR=D:\dev\sb-task11-run\data` (`gold/pairs.parquet`, SHA-256 `8124c86c…a1db`).

## Global Constraints

- **Write scope:**
  - anything under `backend/`;
  - `artifacts/eval/dev/**` and `artifacts/eval/2026/**` (exports);
  - `docs/research/2026-11-13-previous-runs-issue-time-audit.md` and `docs/research/scripts/issue_time_audit.py` (Task 2 only);
  - `docs/research/2026-11-14-evaluation-report.md` (Task 15 only);
  - `docs/parking-lot.md` (append rows only).
  - Never edit the pre-registration text. Changes go to its amendment log, by Ali.
- **Pins:** do not bump any pin and do not add a dependency (all needed packages are already locked). Training code may use the `train` group; nothing under `api/`, `application/`, `domain/`, `ports/` or `adapters/` may import `mapie`, `sklearn`, `scoringrules` or `stellar_blaze.ml` (Task 1 adds the import-linter contract). `lightgbm` is imported only in `adapters/compute/lgbm_corrector.py` and in `ml/`.
- **The `sb-jobs` entry point must import and run `--help` in the API image,** which has no train group. ML commands live in `jobs/ml_cli.py` and import `stellar_blaze.ml` inside each command body.
- **mypy:** `--strict` + `pydantic.mypy` on `src` and `tests`. `mapie`, `sklearn` and `scoringrules` are imported only inside one facade module each: `ml/_mapie.py` (tests' oracle only), `ml/_sklearn.py`, `ml/metrics.py`.
- **Tests:** exactly one tier marker each (`unit`, `integration`, `regression`), plus `slow` above 5 s. Unit tests use the synthetic generator of Task 1 (`tests/fixtures/forecast/synthetic.py`), never the gold file. Tests on real data are `regression` + `slow` + `skipif` the gold file is absent (B1 pattern). `filterwarnings = ["error"]` stays:
  - pass LightGBM `verbosity=-1`;
  - feed LightGBM the same container type (numpy `float64` arrays plus a fixed feature-name list) at fit and predict, so scikit-learn emits no feature-name `UserWarning`.
- **Time:** all timestamps are UTC-aware. Modelled hours are UTC 02-15 (`MODELLED_HOURS_UTC`); every modelled hour has the same calendar date in UTC and GST (UTC+4). GST appears only in prose and labels.
- **Pre-registration values are copied verbatim, never re-derived:** the 19 levels, 9 pairs, hour-blocks `early` 02-05 / `peak` 06-10 / `late` 11-15, leads 1-7 (headline 1-3, report 1/2/3/5/7), the hyperparameter grid, the selection thresholds (1%, 0.85, POD 0.90), the bootstrap (7-day blocks, B = 2,000, seed `20261112`), the leakage rules L1-L8, the baseline definitions B0/B0d/B2/B2d/B3/B3d/B4 and the protective quantile (TWL 10th percentile).
- **2026:** no code path outside `ml/protocol_gate.py` + `ml/data.load_test_pairs` may produce a frame containing `summer == 2026` from the gold file. **No subagent runs any 2026 scoring.** Task 15 is a controller step after Ali's approval.
- **Artefacts (ADR 0009 §3, ADR 0010 §1a/§5):**
  - model id `corrector-<yyyymmdd>-<gitsha7>-<cfg6>`;
  - `manifest.json` valid under B1's `ModelManifest`;
  - boosters stored as gzip-compressed LightGBM text (`*.txt.gz`; no pickle);
  - only the released model id goes under `backend/models/`; evaluation-only models go under `$SB_DATA_DIR/models-eval/`;
  - a model directory stays at or below 15 MB (test).
- **Commits and git:** Conventional Commits, one or more per task. Never `git stash`, `reset`, `rebase`, `checkout -- <path>` or `clean`. Never `--no-verify`. If the tree holds changes you did not make, stop and report. The controller commits (parallel lanes; pre-commit stashes).
- **US English** in identifiers (ADR convention). Any number written into an export comes from code, never by hand.
- **Evidence and conventions win over this plan.** If a step is wrong (an API name differs, a value contradicts the pre-registration or a cited source), stop, show the evidence and propose the fix. Being corrected is preferred to being obeyed.

## Review Focus

1. **Leakage across lead times or clusters.** A history feature that reads truth on or after the issue day (D − L), or a fold statistic (climatology, bias, dressing, copula, offsets) fitted with held-out-cluster or calibration rows, inflates every number silently. The rule is the pre-registration's L3/L4/L6/L7. Task 4 pins it with perturbation tests, Task 3 with the 2026 guard, Task 11 with fold-isolation tests.
2. **UTC/GST boundary errors.** A day key built in GST from a UTC timestamp, or the history window counted in GST days, shifts features by a day. Lag "days" are UTC dates; hour-blocks are UTC hours; demo-day and bootstrap days are the UTC date, which equals the GST date inside 02-15 UTC. Task 1 asserts that identity for every modelled hour; Task 4 tests the history window on a date boundary; Task 13 tests the replay clock.
3. **NaN and missing hours.** METAR gaps (OMDB/OMDW have 17 h gaps in 2026), NaN WBGT truth (9,200 `NONFINITE_INPUT` rows), first-week null history, a missing forecast hour at serving. Expected behaviour:
   - the row is excluded from that variable's target and score, and the count is reported;
   - history stays null, never filled;
   - the corrector returns `status = "missing_input"` with null quantiles, never a number.
   Tasks 4, 6, 10.
4. **Conformal coverage collapse at extreme heat.** Offsets calibrated on September (cooler) under-cover July-August peak hours, and thin strata give unstable offsets. Expected behaviour:
   - a stratum with n < 30 falls back to the lead-pooled offset and records it (Task 8);
   - coverage is reported by forecast-WBGT tercile;
   - selection rule 4 can switch the calibration window once, on 2024-2025 evidence (Task 12).
5. **A degenerate model that equals raw IFS** (all-zero error quantiles, a feature-pipeline bug feeding constants, early stopping at 0 trees). Expected behaviour:
   - a synthetic test with an injected +1.5 °C station bias must cut median MAE by at least half (Task 7);
   - `train` refuses to release a model whose corrected median equals raw on the warm-up fixture (Task 10);
   - the dev report always shows B0 and B2d beside the corrector (Task 12).

---

## File structure

```
backend/
  src/stellar_blaze/
    domain/forecast/__init__.py
    domain/forecast/grid.py           # LEVELS, PAIRS, HourBlock, hour_block, leads/hours constants, sort/apply-offsets/ppf/cdf
    domain/forecast/schemas.py        # CORRECTED_FORECAST_SCHEMA, QUANTILE_COLUMNS, CorrectionStatus
    domain/forecast/features.py       # Target, FeatureSet, BANNED_COLUMNS, FoldStats, fit_fold_stats, history_features, build_features
    domain/forecast/sampling.py       # fit_copula, sample_joint (Gaussian copula on quantile grids)
    domain/provenance.py              # Provenance, ProvenanceLabel, attach_provenance (shared with B3 exporters)
    ports/corrector.py                # ForecastCorrector Protocol
    adapters/fakes/corrector.py       # FakeCorrector (raw +/- fixed spread; model_id None)
    adapters/compute/lgbm_corrector.py# LightGbmCorrector, load_boosters, predict_grid (the only serving import of lightgbm)
    adapters/sources/replay.py        # ReplaySnapshot, ReplayForecastSource, ReplayObservationSource
    application/correct_forecast.py   # corrected_forecast use case
    ml/__init__.py                    # (exists, empty) offline package docstring
    ml/data.py                        # DEV_SUMMERS, load_dev_pairs, load_test_pairs, HoldoutViolationError
    ml/git.py                         # GitReader Protocol, SubprocessGit
    ml/protocol_gate.py               # ProtocolLock, Part, GateToken, open_gate, GateRefusedError
    ml/training_config.py             # LgbmParams, TrainingConfig, load_training_config
    ml/quantile_models.py             # fit_quantile_models
    ml/conformal.py                   # ConformalOffsets, fit_symmetric_offsets
    ml/baselines.py                   # static/running bias, dressing, linear MOS
    ml/metrics.py                     # scoringrules facade + coverage/PIT/Brier/reliability
    ml/bootstrap.py                   # Interval, block_bootstrap, paired_block_bootstrap
    ml/regimes.py                     # Fold, loco_folds, regime_c_folds
    ml/train.py                       # TrainedCorrector, train_corrector, wbgt grids two ways
    ml/artefacts.py                   # model_id, write_model, render_model_card
    ml/selection.py                   # the pre-registration section 6 rules
    ml/evaluate.py                    # evaluate_dev, evaluate_forecast_test
    ml/exporters.py                   # JSON/parquet writers with provenance
    ml/_sklearn.py, ml/_mapie.py      # typed facades (sklearn Ridge for B4; MAPIE oracle)
    jobs/ml_cli.py                    # train, evaluate-dev, evaluate-2026, replay build (lazy ml imports)
    jobs/evaluate_2026.py             # the single 2026 entry point (pre-registration section 12)
    jobs/cli.py                       # modify: add_typer(ml_app); module docstring lists the new commands
    composition.py                    # modify: register "replay" forecast + observation sources
    config.py                         # modify: replay_dir, replay_snapshot_id
  training/configs/corrector-v1.toml        # site features (dev selection may switch to cold)
  training/configs/corrector-cold-v1.toml   # cold features (regime c, and B3's new-site path)
  training/protocol.lock.toml               # written by the controller after the pre-registration commit
  models/corrector-<yyyymmdd>-<git7>-<cfg6>/  # released model only (Task 14)
  replay/<snapshot_id>/{snapshot.json, forecasts.parquet, observations.parquet}
  tests/fixtures/forecast/synthetic.py      # deterministic gold-like frames with injected biases
  tests/unit/forecast/…  tests/unit/ml/…  tests/regression/test_corrector_real_data.py
artifacts/eval/dev/{selection.json, dev_skill.json, oof_samples_abu_dhabi.parquet}
artifacts/eval/2026/{forecast_skill.json, reliability.json, corrected_series_OMAA.parquet}
```

---

### Task 1: Forecast vocabulary, corrected-forecast schema, corrector port and fake (interface freeze for B3)

**Files:**
- Create: `src/stellar_blaze/domain/forecast/{__init__,grid,schemas}.py`, `ports/corrector.py`, `adapters/fakes/corrector.py`, `tests/fixtures/forecast/{__init__,synthetic}.py`
- Modify: `pyproject.toml` (import-linter contract 6), `adapters/fakes/__init__.py`
- Test: `tests/unit/forecast/test_grid.py`, `tests/unit/forecast/test_corrector_fake.py`, `tests/unit/forecast/test_synthetic_fixture.py`

**Interfaces:**
- Produces (B3 codes against these from Fri 13 Nov):
  - `grid.LEVELS: Final[tuple[float, ...]]`: the 19 values `0.05…0.95`, built as `round(k * 0.05, 2)`.
  - `grid.PAIRS: Final[tuple[tuple[float, float], ...]]`: the 9 pairs `(0.05, 0.95) … (0.45, 0.55)`.
  - `class HourBlock(StrEnum)`: `EARLY = "early"`, `PEAK = "peak"`, `LATE = "late"`. `HOUR_BLOCKS: Mapping[HourBlock, range]` = `{EARLY: range(2, 6), PEAK: range(6, 11), LATE: range(11, 16)}`. `hour_block(hour_utc: int) -> HourBlock` raises `ValueError` outside 2..15.
  - `MODELLED_HOURS_UTC = range(2, 16)`, `MODEL_LEADS = range(1, 8)`, `HEADLINE_LEADS = (1, 2, 3)`, `REPORT_LEADS = (1, 2, 3, 5, 7)`.
  - `sort_grid(grid: F64) -> F64`, for `(n, 19)` arrays.
  - `apply_symmetric_offsets(grid: F64, offsets: Sequence[float]) -> F64`: offsets are aligned with `PAIRS`; returns `lo - q`, `hi + q`, median untouched, then re-sorted.
  - `ppf(grid: F64, u: F64) -> F64` and `cdf(grid: F64, x: F64) -> F64`: piecewise-linear between levels; outside 0.05/0.95, linear extension with the slope of the outermost segment.
  - `exceedance_probability(grid: F64, threshold: float) -> F64 = 1 - cdf(...)`.
  - `schemas.QUANTILE_COLUMNS = ("q05", "q10", …, "q95")`.
  - `class CorrectionStatus(StrEnum)`: `OK = "ok"`, `MISSING_INPUT = "missing_input"`, `UNCORRECTED = "uncorrected"`.
  - `CORRECTED_FORECAST_SCHEMA`: `station` String, `valid_time` Datetime(us, UTC), `lead_days` Int8, `variable` String (`t`, `td`, `wind`, `wbgt`), `raw` Float64, the 19 `q..` columns Float64 (calibrated, sorted; null unless `status == ok`), `status` String, `model_id` String (nullable).
  - `ports.corrector.ForecastCorrector` Protocol:
    - `model_id -> str | None` (property);
    - `correct(*, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> pl.DataFrame`, where `ifs`/`gfs` are `FORECAST_SCHEMA`, `history` is `OBS_HOURLY_SCHEMA` and the result is `CORRECTED_FORECAST_SCHEMA`, one row per input IFS row × variable;
    - `sample(corrected: pl.DataFrame, *, n_samples: int, seed: int) -> NDArray[np.float64]`: shape `(rows, n_samples, 3)` for (t, td, wind); B3 feeds it to TWL.
  - `FakeCorrector(spread_c: float = 0.0)`: quantiles = raw + `spread_c * Φ⁻¹(level)`; status `UNCORRECTED` when `spread_c == 0`; `model_id` None; `sample` = independent draws from those grids.
  - `synthetic.make_pairs(*, seed: int, summers: tuple[int, ...], station_bias_c: Mapping[str, float]) -> pl.DataFrame`: `GOLD_PAIRS_SCHEMA` rows for the 8 stations, models `ecmwf_ifs025` and `gfs_seamless`, leads 0-7, hours 0-23, with truth = forecast − bias + noise. Deterministic.

- [ ] **Step 1: Write the failing tests**
  - `test_levels_and_pairs`: `len(LEVELS) == 19`, `LEVELS[0] == 0.05`, `LEVELS[-1] == 0.95`, `PAIRS[0] == (0.05, 0.95)`, `len(PAIRS) == 9`.
  - `test_hour_block_edges`: `hour_block(2) is EARLY`, `5 → EARLY`, `6 → PEAK`, `10 → PEAK`, `11 → LATE`, `15 → LATE`; `1` and `16` raise.
  - `test_modelled_hours_share_utc_and_gst_date`: for every hour in `MODELLED_HOURS_UTC` and every day of the 2024-2026 summers, `(t + 4h).date() == t.date()`.
  - `test_apply_offsets_keeps_median_and_sorts`: hypothesis over random grids and offsets in [-2, 2]; column 9 unchanged; result monotone.
  - `test_ppf_cdf_roundtrip`: `cdf(grid, ppf(grid, u)) ≈ u` for u in [0.01, 0.99].
  - `test_fake_corrector_schema`: output conforms to `CORRECTED_FORECAST_SCHEMA`; spread 0 gives all quantiles == raw and status `uncorrected`.
  - `test_synthetic_is_deterministic_and_conforms`: same seed gives an identical frame; `conform(df, GOLD_PAIRS_SCHEMA)` passes; the injected bias is recoverable as `mean(fc - obs) ≈ bias ± 0.1`.
  - Import-linter contract 6 (`lint-imports`): "Serving layers do not import training code": sources `stellar_blaze.api`, `.application`, `.domain`, `.ports`, `.adapters`; forbidden `stellar_blaze.ml`, `mapie`, `sklearn`, `scoringrules`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/forecast -q`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the signatures above. `grid.py` is numpy only.
- [ ] **Step 4: Run** `uv run pytest -m unit tests/unit/forecast -q && uv run lint-imports && uv run mypy src tests`. Expected: PASS, 6 contracts kept.
- [ ] **Step 5: Commit** `feat(forecast): quantile grid, corrected-forecast schema and corrector port`. Then the controller notifies the B3 lane that the interfaces are frozen.

---

### Task 2: Previous Runs issue-time audit (research step; needs network; runs in parallel)

**Files:** Create `docs/research/scripts/issue_time_audit.py` and `docs/research/2026-11-13-previous-runs-issue-time-audit.md`.

**Interfaces:** Produces the finding that pre-registration §0.1 refers to. It changes no code or number.

- [ ] **Step 1:** For OMAA, valid dates 2025-07-10 to 2025-07-12, hours 02-15 UTC, request `temperature_2m_previous_day1` and `_previous_day2` (`ecmwf_ifs025`) and the Open-Meteo **Single Runs API** for each init 00/06/12/18 UTC of the two preceding days. Use `httpx2`, default TLS, at most 30 calls, and no 2026 dates.
- [ ] **Step 2:** For each valid hour, name the init whose value equals the `previous_dayN` value (tolerance 0.05 °C). Tabulate the init, the publication time from the ECMWF Set I schedule and "available by 18:00 GST D-1?".
- [ ] **Step 3:** Write the note with a verdict. One of:
  - (a) `previous_day1` is always available by 18:00 GST;
  - (b) not available for hours ≥ X UTC;
  - (c) the Single Runs API does not reach 2025, so the mapping is unverifiable and pre-registration §4 stands.
  The note quotes the raw responses' hashes.
- [ ] **Step 4: Commit** `docs(research): audit which IFS run feeds previous_day1`. The controller forwards the verdict to Ali (a possible amendment to the stamp wording only).

---

### Task 3: Holdout guard, dev loader and the 2026 protocol gate

**Files:**
- Create: `ml/data.py`, `ml/git.py`, `ml/protocol_gate.py`
- Test: `tests/unit/ml/test_data_guard.py`, `tests/unit/ml/test_protocol_gate.py`

**Interfaces:**
- Consumes: `GOLD_PAIRS_SCHEMA`, `MODELLED_HOURS_UTC`, `MODEL_LEADS` (Task 1).
- Produces:
  - `DEV_SUMMERS = frozenset({2024, 2025})`, `TEST_SUMMER = 2026`, `class HoldoutViolationError(RuntimeError)`.
  - `load_dev_pairs(path: Path, *, expected_sha256: str | None) -> pl.DataFrame`: lazy scan; filters `summer ∈ DEV_SUMMERS`, `lead_days ∈ MODEL_LEADS`, `hour_utc ∈ MODELLED_HOURS_UTC` and models `{ecmwf_ifs025, gfs_seamless}` **before** collect; raises `HoldoutViolationError` if any collected row has summer 2026; verifies the file hash when given.
  - `load_test_pairs(path: Path, *, token: GateToken, expected_sha256: str) -> pl.DataFrame`: the same filters with `summer ∈ {2024, 2025, 2026}`. A token for a different part, or a forged one, raises.
  - `class GitReader(Protocol)`: `head() -> str`, `is_clean() -> bool`, `is_ancestor(ancestor: str, descendant: str) -> bool`, `show(commit: str, path: str) -> bytes`. `SubprocessGit(repo_root: Path)` implements it with `git` via `subprocess.run([...], check=True)` and no shell.
  - `class Part(StrEnum)`: `FORECAST`, `WARNINGS`, `PLANS`.
  - `ProtocolLock` (frozen, `extra="forbid"`): `protocol_path: str`, `protocol_sha256: Sha256`, `protocol_commit: str`, `model_id: str | None`, `freeze_path: str | None`, `freeze_sha256: Sha256 | None`. Loaded from `training/protocol.lock.toml`.
  - `GateToken`: a frozen dataclass with fields `part`, `head`, `lock`. It is constructible only through `open_gate`: a module-private sentinel is checked in `__post_init__`.
  - `open_gate(*, repo_root: Path, lock_path: Path, part: Part, results_dir: Path, models_dir: Path, git: GitReader, amendment: str | None = None) -> GateToken`. It raises `GateRefusedError(reasons: tuple[str, ...])` listing **every** failed check from pre-registration §9:
    - the lock exists;
    - the file hash matches;
    - the commit is an ancestor of HEAD;
    - the protocol content at that commit matches the hash;
    - the tree is clean;
    - `model_id` is set and present in `models_dir`;
    - for WARNINGS/PLANS: `freeze_*` is set and matches;
    - there is no prior result file for the part unless `amendment` is given.

- [ ] **Step 1: Write the failing tests**
  - `test_dev_loader_never_returns_2026`: a synthetic gold with 2024-2026 written to `tmp_path`; the result has `summer.unique() ⊆ {2024, 2025}` and no lead 0.
  - `test_dev_loader_filters_before_collect`: patch `pl.LazyFrame.collect` to capture the plan; the plan string contains the summer filter (guards against collect-then-filter).
  - `test_dev_loader_rejects_hash_mismatch`.
  - `test_test_loader_requires_token`: calling with `object()` raises `TypeError`/`HoldoutViolationError`; constructing `GateToken(...)` directly raises.
  - `test_gate_refuses_each_failure`: a fake `GitReader` and parametrised cases, one per check, each asserting that check's reason string is in `exc.reasons`.
  - `test_gate_opens_when_all_hold`: returns a token whose `.head` is the fake head.
  - `test_gate_once_only`: an existing `artifacts/eval/2026/forecast_skill.json` refuses without `amendment`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_data_guard.py tests/unit/ml/test_protocol_gate.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. Hash with `hashlib.sha256` over file bytes. `SubprocessGit` uses `git rev-parse HEAD`, `git status --porcelain`, `git merge-base --is-ancestor`, `git show <c>:<p>`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): 2026 holdout guard and pre-registration gate`.

---

### Task 4: Feature builder, fold statistics and history features (leakage rules L1-L4, L6, L8)

**Files:**
- Create: `domain/forecast/features.py`
- Test: `tests/unit/forecast/test_features.py`, `tests/unit/forecast/test_leakage.py`

**Interfaces:**
- Consumes: Task 1 grid constants; `GOLD_PAIRS_SCHEMA`.
- Produces:
  - `class Target(StrEnum)`: `T = "t"`, `TD = "td"`, `WIND = "wind"`, `WBGT = "wbgt"`.
  - `TRUTH_COLUMN: Mapping[Target, str]` (`obs_t_c`, `obs_td_c`, `obs_wind_ms`, `wbgt_obs_c`) and `FORECAST_COLUMN: Mapping[Target, str]` (`fc_t_c`, `fc_td_c`, `fc_wind_ms`, `wbgt_fc_c`).
  - `class FeatureSet(StrEnum)`: `SITE = "site"`, `COLD = "cold"`. `feature_columns(feature_set: FeatureSet) -> tuple[str, ...]`, a fixed order (pre-registration §3.2 table).
  - `BANNED_COLUMNS: frozenset[str]` (L1 list, verbatim).
  - `@dataclass(frozen=True) FoldStats`: `pooled_climatology: pl.DataFrame` (keys `hour_utc`, `doy`; cols `clim_t`, `clim_td`, `clim_wbgt`) and `station_climatology: pl.DataFrame` (keys `station`, `hour_utc`, `doy`; cols `sclim_t`, `sclim_td`, `sclim_wbgt`).
  - `fit_fold_stats(train_pairs: pl.DataFrame) -> FoldStats`: ±7-day centred window on `doy`, means over truth rows of the IFS model at lead 1 (one truth per station-hour), from `train_pairs` only.
  - `history_features(pairs: pl.DataFrame) -> pl.DataFrame`, keyed (`station`, `valid_date`, `lead_days`, `hour_block`), columns `bias7_t`, `bias7_td`, `bias7_wind`. Built from IFS lead-1 rows: daily mean error (fc − obs) per station × hour-block × UTC date, then for target day D and lead L the mean over UTC dates [D − L − 7, D − L − 1] that have data. All 7 days missing gives null.
  - `build_features(pairs: pl.DataFrame, *, feature_set: FeatureSet, stats: FoldStats, history: pl.DataFrame | None) -> pl.DataFrame`: one row per IFS row (keys `station`, `cluster`, `summer`, `valid_time`, `lead_days`, `hour_utc`, `hour_block`, `valid_date`), the feature columns, `raw_{t,td,wind,wbgt}`, `y_{t,td,wind,wbgt}` (error = truth − forecast; null when truth is missing or `wbgt_obs_reject != 0`), and `fold_weight`-free. GFS joins on the identical (`station`, `valid_time`, `lead_days`); a missing GFS row gives null features, never a different lead. `history=None` is allowed only for `COLD`.

- [ ] **Step 1: Write the failing tests**
  - `test_feature_columns_exclude_banned`: `set(feature_columns(fs)) & BANNED_COLUMNS == ∅` for both sets; `COLD` has no `bias7_*`/`sclim_*`.
  - `test_targets_null_when_truth_missing`: a synthetic row with `has_joint_obs=False` gives null `y_t`; `wbgt_obs_reject=1` gives null `y_wbgt`.
  - `test_gfs_joins_same_lead`: a synthetic frame where GFS lead 2 differs from lead 1 by +10; the lead-1 IFS row carries the lead-1 GFS value.
  - **`test_history_ignores_truth_on_or_after_issue_day`** (hypothesis): for random (D, L), perturb `obs_*` on all UTC dates ≥ D − L by ±20 °C; every `bias7_*` for (D, L) is unchanged; perturbing date D − L − 1 changes it.
  - `test_history_date_boundary_utc`: a truth row at 2025-07-09 23:00 UTC belongs to UTC date 07-09 (not GST 07-10) in the window.
  - `test_history_null_in_first_week`: for 2025-05-15..05-22 at lead 1, `bias7_*` is null at least for D = 05-15.
  - **`test_fold_stats_ignore_heldout_rows`**: fit on pairs minus cluster `fujairah`; perturbing all `fujairah` truth leaves `FoldStats` identical.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/forecast/test_features.py tests/unit/forecast/test_leakage.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** in Polars expressions (domain stays I/O-free). `valid_date` is `valid_time.dt.date()` on the UTC column. RH and dew-point depression come from B1 `domain/physics/psychrometrics.relative_humidity_pct`.
- [ ] **Step 4: Run** the same command plus `uv run mypy src tests`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(forecast): leakage-safe features, fold statistics and history`.

---

### Task 5: Metrics facade and block bootstrap

**Files:**
- Create: `ml/metrics.py`, `ml/bootstrap.py`
- Test: `tests/unit/ml/test_metrics.py`, `tests/unit/ml/test_bootstrap.py`

**Interfaces:**
- Consumes: `LEVELS`, `PAIRS`, `cdf`, `exceedance_probability` (Task 1).
- Produces:
  - In `metrics.py` (the only `scoringrules` import), all row-wise:
    - `crps_grid(y: F64, grid: F64) -> F64` (`scoringrules.crps_quantile(y, grid, alpha=LEVELS)`);
    - `crps_deterministic(y: F64, x: F64) -> F64` (= |y − x|);
    - `pinball(y: F64, grid: F64, level: float) -> F64`;
    - `interval_score(y: F64, lo: F64, hi: F64, miscoverage: float) -> F64`;
    - `covered(y: F64, lo: F64, hi: F64) -> NDArray[np.bool_]`;
    - `pit(y: F64, grid: F64) -> F64` (via `cdf`);
    - `pit_histogram(pit: F64, bins: int = 10) -> NDArray[np.int64]`;
    - `brier(p: F64, event: NDArray[np.bool_]) -> F64`;
    - `brier_skill(bs: float, bs_ref: float) -> float`;
    - `reliability_bins(p: F64, event: NDArray[np.bool_], *, width: float = 0.1, min_count: int = 50) -> pl.DataFrame` with columns `bin_lo`, `bin_hi`, `n`, `mean_p`, `obs_freq`, `hollow` (n < 50).
    - Every function drops nothing: callers pass finite rows; a non-finite input raises `ValueError`.
  - In `bootstrap.py`:
    - `@dataclass(frozen=True) Interval(estimate: float, lo: float, hi: float, n_days: int, n_boot: int)`;
    - `block_bootstrap(daily: pl.DataFrame, *, value: str, weight: str, block_days: int = 7, n_boot: int = 2000, seed: int = 20261112) -> Interval`. `daily` has one row per UTC date (`day`) with a per-day sum (`value`) and count (`weight`). The statistic is the ratio of sums over resampled moving blocks of consecutive days (circular within the season).
    - `paired_block_bootstrap(daily_a: pl.DataFrame, daily_b: pl.DataFrame, *, value: str, weight: str, …) -> Interval`: the difference a − b on identical resamples.

- [ ] **Step 1: Write the failing tests**
  - `test_crps_grid_calibrated_normal`: 50,000 N(0,1) draws against the exact N(0,1) quantile grid; the mean CRPS is within +4.8% ± 1% of 0.5642 (stack doc §6.2: 19 levels give +4.8%).
  - `test_crps_deterministic_is_mae`.
  - `test_interval_score_matches_scoringrules` on a fixed vector.
  - `test_pit_uniform_for_calibrated` (chi-square p > 0.01 on 20,000 draws).
  - `test_reliability_marks_hollow_bins`.
  - `test_non_finite_raises`.
  - `test_block_bootstrap_deterministic` (same seed gives an identical interval).
  - `test_block_bootstrap_wider_than_iid_on_ar1`: on an AR(1) series with φ = 0.5, the 7-day block interval is wider than a 1-day block interval.
  - `test_paired_uses_same_resamples`: identical a and b give `Interval(0, 0, 0, …)`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_metrics.py tests/unit/ml/test_bootstrap.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Bootstrap with `numpy.random.default_rng(seed)`, block starts uniform, concatenated to the season length.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): scoring facade and moving-block bootstrap`.

---

### Task 6: Baselines B0, B0d, B2/B2d, B3/B3d, B4

**Files:**
- Create: `ml/baselines.py`, `ml/_sklearn.py`
- Test: `tests/unit/ml/test_baselines.py`

**Interfaces:**
- Consumes: `build_features` output (Task 4), `LEVELS`, `hour_block`.
- Produces `class Baseline(StrEnum)`: `B0`, `B0D`, `B2`, `B2D`, `B3`, `B3D`, `B4` (values `b0` … `b4`), and:
  - `fit_baselines(train: pl.DataFrame, *, target: Target, pooled: bool) -> BaselineModel`. `pooled=True` (regimes b and c) means the static bias is pooled over training stations per lead × hour-block. It stores the static bias table and the dressing quantiles (19 empirical quantiles of the training residual per lead × hour-block, for raw, static-BC and running-BC residuals separately), plus the B4 ridge (alpha 1.0, `cold` features, via `_sklearn.Ridge`).
  - `predict_baseline(model: BaselineModel, rows: pl.DataFrame, baseline: Baseline) -> F64`. Shape `(n,)` for deterministic B0/B2/B3; `(n, 19)` sorted for the dressed ones (B4 is dressed like B2d).
  - B3 = raw − `bias7_<target>`. Where `bias7` is null, it falls back to B2 for that row, and the row count is returned in `BaselineModel.fallback_counts`.

- [ ] **Step 1: Write the failing tests**
  - `test_static_bias_recovers_injected_bias`: synthetic with an OMFJ bias of +3.0 °C; B2's corrected median at OMFJ has mean error within ±0.15.
  - `test_pooled_bias_ignores_station`: with `pooled=True` the OMFJ correction equals the all-station mean.
  - `test_dressed_grid_sorted_and_19`.
  - `test_running_bias_uses_history_only`: B3 equals `raw - bias7` and falls back to B2 when `bias7` is null; the fallback count is correct.
  - `test_b4_fits_without_warnings` (filterwarnings=error catches sklearn feature-name warnings).
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_baselines.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): pre-registered baselines`.

---

### Task 7: Training config, LightGBM quantile models and the serving predictor

**Files:**
- Create: `ml/training_config.py`, `ml/quantile_models.py`, `adapters/compute/lgbm_corrector.py` (prediction half only), `training/configs/corrector-v1.toml`, `training/configs/corrector-cold-v1.toml`
- Test: `tests/unit/ml/test_training_config.py`, `tests/unit/ml/test_quantile_models.py`

**Interfaces:**
- Consumes: Task 4 features, `LEVELS`.
- Produces:
  - `LgbmParams` (frozen, `extra="forbid"`): `num_leaves`, `min_child_samples`, `n_estimators`, `learning_rate=0.05`, `feature_fraction=0.8`, `bagging_fraction=0.8`, `bagging_freq=1`, `lambda_l2=1.0`, `seed=20261112`, `num_threads: int`, `deterministic: Literal[True]`.
  - `TrainingConfig` (frozen, `extra="forbid"`): `name`, `feature_set: FeatureSet`, `levels: tuple[float, ...]` (validator: equals `LEVELS`), `leads: tuple[int, ...]` (⊆ `MODEL_LEADS`), `hours_utc` (= `MODELLED_HOURS_UTC`), `lgbm: LgbmParams`, `calibration_window: Literal["september", "weeks_4_8_12_16"]`, `wbgt_method: Literal["joint", "direct"]`, `n_joint_samples: int = 50`, `sample_seed: int = 20261112`.
  - `load_training_config(path: Path) -> tuple[TrainingConfig, str]`: returns `tomllib`-parsed config and the SHA-256 of the file bytes.
  - `fit_quantile_models(rows: pl.DataFrame, *, target: Target, cfg: TrainingConfig) -> tuple[lgb.Booster, ...]`: 19 boosters, rows with null `y_<target>` excluded, via `lgb.train` with `objective="quantile"`, `alpha=level` and `verbosity=-1`.
  - In `adapters/compute/lgbm_corrector.py`: `predict_grid(boosters: Sequence[lgb.Booster], x: F64) -> F64` (sorted `(n, 19)`), `dump_booster(b: lgb.Booster) -> bytes` (gzip of `model_to_string()`), `load_booster(data: bytes) -> lgb.Booster`.
  - Both TOMLs start from the middle of the grid (`num_leaves=15`, `min_child_samples=200`, `n_estimators=150`), with `calibration_window="september"` and `wbgt_method="joint"`. Task 12 rewrites them from `selection.json`. **No CLI hyperparameter override exists** (roadmap §4).

- [ ] **Step 1: Write the failing tests**
  - `test_config_rejects_unknown_key` and `test_config_rejects_wrong_levels`.
  - `test_config_hash_is_file_bytes`.
  - **`test_quantile_models_recover_bias`** (degenerate-model guard): synthetic with a +1.5 °C bias at two stations, small params (`n_estimators=40`); the corrected median MAE ≤ 0.5 × raw MAE on held-out synthetic rows.
  - `test_grid_sorted_and_coverage_sane`: the empirical coverage of q05-q95 on synthetic held-out rows is in [0.80, 0.97].
  - `test_booster_roundtrip_gzip`: `load_booster(dump_booster(b))` predicts identically (atol 0).
  - `test_deterministic_refit`: two fits with the same config give byte-identical `model_to_string()`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_training_config.py tests/unit/ml/test_quantile_models.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The feature matrix is `rows.select(feature_columns(cfg.feature_set)).to_numpy()` (float64) with `feature_name=list(feature_columns(...))` at both fit and predict.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): training config and LightGBM quantile grid`.

---

### Task 8: Conformalised quantile regression per lead × hour-block

**Files:**
- Create: `ml/conformal.py`, `ml/_mapie.py`
- Test: `tests/unit/ml/test_conformal.py`

**Interfaces:**
- Consumes: `PAIRS`, `apply_symmetric_offsets`, `hour_block`, `predict_grid`.
- Produces:
  - `ConformalOffsets` (frozen pydantic): `offsets: dict[str, dict[str, list[float]]]`, mapping target → stratum key `"<lead>|<block>"` → 9 offsets aligned with `PAIRS`; `n: dict[str, dict[str, int]]`; `fallback: dict[str, list[str]]` (strata that used the lead-pooled offset).
  - `fit_symmetric_offsets(grid_cal: F64, y_cal: F64, lead: NDArray[np.int8], block: Sequence[HourBlock], *, target: Target, min_n: int = 30) -> ConformalOffsets`. For each stratum and pair (α = lo + 1 − hi): `E = max(lo - y, y - hi)` and `q = quantile(E, min(1, ceil((n+1)(1-α))/n), method="higher")`. Strata with n < 30 use the lead-pooled q.
  - `apply_offsets(grid: F64, lead, block, offsets: ConformalOffsets, target: Target) -> F64`, which calls `domain.forecast.grid.apply_symmetric_offsets`.
  - `calibration_mask(rows: pl.DataFrame, window: Literal["september", "weeks_4_8_12_16"]) -> pl.Series`. `september` = valid date 1-30 Sep. `weeks_4_8_12_16` = days 22-28, 50-56, 78-84 and 106-112 after 15 May (1-based summer day).

- [ ] **Step 1: Write the failing tests**
  - **`test_matches_mapie_symmetric`**: synthetic, one stratum, pair 0.05/0.95. Our interval equals `ConformalizedQuantileRegressor(prefit=True)` with `symmetric_correction=True` to atol 5e-5 (stack doc §6.1). Estimators are passed in the order `[lower, upper, median]` as sklearn `LGBMRegressor` fitted on the same data.
  - `test_coverage_on_exchangeable_synthetic`: 90% pair coverage on a fresh draw in [0.88, 0.92].
  - `test_small_stratum_falls_back` (n = 10 → pooled, listed in `fallback`).
  - `test_median_never_moves`.
  - `test_calibration_mask_disjoint_from_fit`: the september mask has no 15 May-31 Aug dates; the weeks mask has 28 days per summer.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_conformal.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** `_mapie.py` wraps the one MAPIE call used by the oracle test. It routes MAPIE's root-logger "ill-sorted" INFO through structlog (ADR 0007).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): symmetric CQR offsets per lead and hour-block`.

---

### Task 9: Joint sampler and WBGT two ways

**Files:**
- Create: `domain/forecast/sampling.py`; `ml/train.py` (WBGT helpers only in this task)
- Test: `tests/unit/forecast/test_sampling.py`, `tests/unit/ml/test_wbgt_two_ways.py`

**Interfaces:**
- Consumes: `ppf`, `LEVELS`; B1 `wbgt_liljegren`; station lat/lon from `STATIONS`.
- Produces:
  - `fit_copula(pit: F64) -> F64`: for `pit` of shape `(n, 3)` with columns (t, td, wind) in (0, 1), returns the 3×3 correlation of `Φ⁻¹(clip(pit, 1e-4, 1 - 1e-4))`, nearest-PSD-projected.
  - `sample_joint(grids: Sequence[F64], corr: F64, *, n_samples: int, seed: int) -> F64`: three `(n, 19)` grids in, `(n, n_samples, 3)` out, via correlated normals → Φ → `ppf` per variable; td = min(td, t); wind = max(wind, 0).
  - In `ml/train.py`:
    - `wbgt_joint_grid(samples: F64, rows: pl.DataFrame) -> F64` (`(n, 19)`: Liljegren on every sample with that row's `fc_sw_wm2`, `fc_direct_wm2` and `fc_pressure_hpa`, never `ref_*`; then the 19 empirical sample quantiles; a row with any rejected sample uses the finite ones and records the count);
    - `wbgt_direct_grid(boosters, x) -> F64`.

- [ ] **Step 1: Write the failing tests**
  - `test_sample_marginals_match_grid` (the sample quantiles at the 19 levels are within 0.05 of the grid for n_samples = 20,000).
  - `test_sample_rank_correlation` (target 0.6 is recovered ± 0.05).
  - `test_td_never_exceeds_t` (hypothesis).
  - `test_sampling_deterministic_by_seed`.
  - **`test_wbgt_joint_uses_forecast_radiation`**: changing `ref_sw_wm2` leaves the output unchanged; changing `fc_sw_wm2` changes it.
  - `test_wbgt_joint_handles_rejects` (NaN samples are excluded and counted, never propagated as numbers).
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/forecast/test_sampling.py tests/unit/ml/test_wbgt_two_ways.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `numpy.random.default_rng(seed)` and `scipy.special.ndtri` / `ndtr` (scipy is already a lightgbm dependency; use `scipy-stubs`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(forecast): Gaussian-copula joint samples and WBGT two ways`.

---

### Task 10: `train_corrector`, artefacts, model card, the corrector adapter, the use case and `sb-jobs train`

**Files:**
- Create: `ml/train.py` (complete), `ml/artefacts.py`, `application/correct_forecast.py`, `jobs/ml_cli.py`
- Modify: `adapters/compute/lgbm_corrector.py` (`LightGbmCorrector`), `jobs/cli.py`
- Test: `tests/unit/ml/test_train.py`, `tests/unit/ml/test_artefacts.py`, `tests/unit/adapters/test_lgbm_corrector.py`, `tests/unit/application/test_correct_forecast.py`, `tests/unit/jobs/test_ml_cli_import.py`, `tests/integration/test_train_cli.py`

**Interfaces:**
- Consumes: Tasks 3-9; B1 `ModelManifest`, `scan_models`, `run_job`.
- Produces:
  - `@dataclass(frozen=True) TrainedCorrector`: `cfg`, `cfg_sha256`, `boosters: Mapping[Target, tuple[lgb.Booster, ...]]` (WBGT boosters only when `wbgt_method == "direct"`), `offsets: ConformalOffsets`, `copulas: Mapping[str, F64]` (keyed `"<lead>|<block>"`), `stats: FoldStats`, `train_rows: int`, `cal_rows: int`.
  - `train_corrector(pairs: pl.DataFrame, cfg: TrainingConfig, *, cfg_sha256: str) -> TrainedCorrector`. It fits fold stats and history from `pairs`, fits on non-calibration rows, calibrates on `calibration_mask` rows and fits the copulas on calibration-row PIT.
  - `model_id(created: date, git_sha: str, cfg_sha256: str) -> str`: matches B1 `MODEL_ID`.
  - `write_model(trained: TrainedCorrector, *, models_dir: Path, created_at: datetime, git_sha: str, uv_lock: Path, gold_manifest_sha256: str, cfg_path: str, dev_metrics: Mapping[str, Mapping[str, float]]) -> Path`. Layout: `boosters/<target>/q05.txt.gz …`, `conformal.json`, `copula.json`, `fold_stats/{pooled,station}.parquet`, `params.json` (resolved config), `model_card.md` and `manifest.json` (B1 schema; `calibrated_pairs` = `PAIRS`; `files[]` hashes everything else). It refuses if the directory would exceed 15 MB.
  - `render_model_card(manifest: ModelManifest, selection: Mapping[str, object] | None) -> str`. Sections: data (gold sha, summers, stations), splits and regimes, features, metrics per regime (dev), calibration strata n, limitations (verbatim from pre-registration §10.4), intended use, "not validated for non-airport sites".
  - `LightGbmCorrector.load(model: LoadedModel) -> LightGbmCorrector`, implementing `ForecastCorrector`. `correct` builds features with the persisted stats, predicts, applies offsets and returns `CORRECTED_FORECAST_SCHEMA`. A row with a null required forecast value gets `status = missing_input` and null quantiles.
  - `async def corrected_forecast(*, forecasts: WeatherForecastSource, observations: ObservationSource, corrector: ForecastCorrector, station: Station, valid_date: date, leads_days: Sequence[int]) -> pl.DataFrame`. It fetches IFS and GFS previous runs for `valid_date`, and IEM history for UTC dates `[valid_date - max(L) - 7, valid_date - min(L) - 1]`, binned with B1 `bin_to_nearest_hour`.
  - `sb-jobs train --config PATH [--release]`. It runs as `run_job` `train:<cfg name>`, loads dev pairs only (`load_dev_pairs`), trains, and writes to `$SB_DATA_DIR/models-eval/` or, with `--release`, to `backend/models/`. `--release` refuses a dirty tree (`SubprocessGit.is_clean`) and refuses when the release smoke check fails: on a 2025 warm-up fixture, the corrected median must not equal raw for every row (degenerate guard).

- [ ] **Step 1: Write the failing tests**
  - `test_train_corrector_end_to_end_synthetic`: small config; offsets exist for all 21 strata × 4 targets.
  - `test_written_manifest_validates`: `ModelManifest.model_validate_json(...)`, then `scan_models(tmp)` loads it and verifies the hashes.
  - `test_model_id_contains_git7_and_cfg6`.
  - `test_size_cap_refuses` (monkeypatched cap of 1 KB → raises).
  - `test_model_card_has_limitations` (contains "airport" and "derived").
  - `test_corrector_missing_input_status`: a null `fc_td_c` gives that row's `status == "missing_input"` and null quantiles.
  - `test_corrector_matches_offline_prediction`: equal to `apply_offsets(predict_grid(...))` (atol 1e-12).
  - `test_corrected_forecast_history_window` (fakes: the observation fake records the requested window; for leads 1-3 and D = 2025-07-20, the window is 07-10 .. 07-18).
  - **`test_sb_jobs_imports_without_train_group`**: run in a subprocess with `sys.modules['mapie'] = None`, `['sklearn'] = None`, `['scoringrules'] = None`; `stellar_blaze.jobs.cli` imports and `app` `--help` exits 0.
  - `test_release_refuses_dirty_tree` (fake `GitReader`).
  - Integration `test_train_cli_records_job_run` (testcontainers Postgres; synthetic gold in `tmp_path`): exit 0, a `job_run` row `train:corrector-v1` succeeded, and the model dir exists under `models-eval/`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_train.py tests/unit/ml/test_artefacts.py tests/unit/adapters/test_lgbm_corrector.py tests/unit/application/test_correct_forecast.py tests/unit/jobs/test_ml_cli_import.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `jobs/cli.py`, `app.add_typer(ml_app)`, and extend the module docstring command list. `ml_cli.py` has top-level imports of typer/stdlib/`stellar_blaze.config` only.
- [ ] **Step 4: Run** the unit command above, then `uv run pytest -m integration tests/integration/test_train_cli.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): train job, model artefacts, model card and LightGBM corrector`.

---

### Task 11: Regimes and the dev evaluation harness

**Files:**
- Create: `ml/regimes.py`, `ml/evaluate.py` (`evaluate_dev`)
- Test: `tests/unit/ml/test_regimes.py`, `tests/unit/ml/test_evaluate_dev.py`

**Interfaces:**
- Consumes: Tasks 4-10.
- Produces:
  - `@dataclass(frozen=True) Fold(name: str, train_clusters: frozenset[str], test_clusters: frozenset[str], train_summers: frozenset[int], test_summers: frozenset[int])`.
  - `loco_folds(summers: frozenset[int]) -> tuple[Fold, ...]`: 6 folds, cluster names from `STATIONS`.
  - `regime_c_folds() -> tuple[Fold, ...]` (train 2024-2025 on 5 clusters, test 2026 on the 6th).
  - `regime_b_all_folds() -> tuple[Fold, ...]`.
  - `split(pairs: pl.DataFrame, fold: Fold) -> tuple[pl.DataFrame, pl.DataFrame]`. It asserts that no test cluster or summer row is in train.
  - `@dataclass(frozen=True) OofPredictions`: frame keyed like features, with `grid_<target>_<model>` stored as 19 columns per target for the corrector and each baseline, plus `samples_*` for the joint WBGT draws.
  - `evaluate_dev(pairs: pl.DataFrame, cfg: TrainingConfig, *, cfg_sha256: str) -> OofPredictions`: LOCO out-of-fold for the corrector (fold-fitted stats, history and offsets) and baselines B0/B0d/B2d/B3d/B4 (`pooled=True` on held-out clusters).
  - `skill_table(oof: OofPredictions, *, leads: Sequence[int], hours: str, by: Sequence[str]) -> pl.DataFrame`: CRPS, MAE, RMSE, bias, pinball, interval score, coverage, PIT counts, Brier for WBGT ≥ 28/30/32, n rows, n days, with paired-bootstrap intervals of corrector − baseline.

- [ ] **Step 1: Write the failing tests**
  - `test_six_loco_folds_hold_out_whole_clusters` (`dubai_sharjah` holds out both OMDB and OMSJ).
  - **`test_split_raises_on_overlap`**.
  - **`test_fold_isolation`**: perturb the test cluster's truth in a synthetic run; the corrector's OOF predictions for that cluster are unchanged (the stats, offsets and copula cannot have seen them).
  - `test_evaluate_dev_never_sees_2026`: input containing 2026 raises `HoldoutViolationError`.
  - `test_skill_table_reports_counts`.
  - `test_coverage_by_forecast_tercile` (edges from training rows).
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_regimes.py tests/unit/ml/test_evaluate_dev.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): LOCO dev evaluation harness`.

---

### Task 12: Selection rules, dev exports, provenance and `sb-jobs evaluate-dev`

**Files:**
- Create: `ml/selection.py`, `ml/exporters.py`, `domain/provenance.py`
- Modify: `jobs/ml_cli.py`
- Test: `tests/unit/ml/test_selection.py`, `tests/unit/ml/test_exporters.py`, `tests/unit/test_provenance.py`

**Interfaces:**
- Consumes: Task 11.
- Produces:
  - `class ProvenanceLabel(StrEnum)`: `REAL = "REAL"`, `REAL_WEATHER_ASSUMED_CREW = "REAL weather + assumed crew"`, `SIMULATED = "SIMULATED"`.
  - `Provenance` (frozen, `extra="forbid"`): `protocol_path`, `protocol_anchor` (a heading slug such as `#7-metrics`), `script` (module path), `function`, `git_sha`, `data_sha256`, `model_id: str | None`, `label`, `generated_at: AwareDatetime`.
  - `attach_provenance(payload: Mapping[str, JsonValue], provenance: Provenance) -> dict[str, JsonValue]` (adds the key `provenance`; B3's exporters reuse it).
  - The selection functions implement pre-registration §6.1-§6.4 verbatim, each returning a pydantic `Decision(rule: str, choice: str, evidence: dict[str, float], tie_broken: bool)`:
    - `select_hyperparameters(grid_scores: pl.DataFrame) -> Decision`;
    - `select_feature_set(site: pl.DataFrame, cold: pl.DataFrame) -> Decision`;
    - `select_wbgt_method(joint: pl.DataFrame, direct: pl.DataFrame) -> Decision`;
    - `select_calibration_window(coverage_by_tercile: pl.DataFrame) -> Decision`.
  - Exporters:
    - `write_json(path: Path, payload: Mapping[str, JsonValue], provenance: Provenance) -> str` (returns the SHA-256; canonical JSON, sorted keys);
    - `write_dev_exports(oof, decisions, out_dir) -> dict[str, str]`, producing `selection.json`, `dev_skill.json` and `oof_samples_abu_dhabi.parquet` (pre-registration §6.5 input for B3; 2024-2025 rows only; it asserts that).
  - `sb-jobs evaluate-dev --config PATH [--grid]`: `run_job` `evaluate-dev`. `--grid` runs the 8 hyperparameter configurations on T/Td at levels {0.1, 0.5, 0.9} only (pre-registration §6.1 score), then the full LOCO with the chosen params for `site` and `cold`, then writes the exports. It prints the decisions.

- [ ] **Step 1: Write the failing tests**
  - `test_hyperparameter_tie_prefers_simpler` (two configs within 1% → fewer leaves wins).
  - `test_feature_set_needs_1pct_and_ci` (0.9% improvement → `cold`; 1.2% with CI excluding 0 → `site`; 1.2% with CI including 0 → `cold`).
  - `test_wbgt_tie_goes_to_joint`.
  - `test_calibration_switch_at_085` (0.849 → switch; 0.85 → keep).
  - `test_provenance_rejects_extra_and_naive_datetime`.
  - `test_write_json_is_canonical_and_hashed`.
  - `test_oof_export_refuses_2026_rows`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_selection.py tests/unit/ml/test_exporters.py tests/unit/test_provenance.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): pre-registered selection rules, provenance and dev exports`.

---

### Task 13: Replay sources and snapshot builder

**Files:**
- Create: `adapters/sources/replay.py`
- Modify: `composition.py`, `config.py`, `jobs/ml_cli.py` (`sb-jobs replay build`), `Dockerfile` (`COPY replay/ replay/`), `.dockerignore` check
- Test: `tests/unit/adapters/test_replay.py`, `tests/unit/test_composition_replay.py`, the B1 contract suites for both ports

**Interfaces:**
- Consumes: `WeatherForecastSource`, `ObservationSource` (B1 ports and contract suites), `FORECAST_SCHEMA`, `OBS_RAW_SCHEMA`.
- Produces:
  - `ReplaySnapshot` (pydantic, `snapshot.json`): `snapshot_id`, `created_at`, `stations`, `models`, `start`, `end`, `files[{path, sha256}]`, `provenance: Provenance`.
  - `ReplayForecastSource(snapshot_dir: Path)` implements `previous_runs` from `forecasts.parquet`: the same contract as Open-Meteo, including null-for-missing and `ValueError` for leads outside 0-7.
  - `ReplayObservationSource(snapshot_dir: Path)` (`name = "replay"`) serves `observations.parquet` rows in `OBS_RAW_SCHEMA`.
  - Both verify the file hashes on construction.
  - Settings `replay_dir: Path = Path("replay")` and `replay_snapshot_id: str | None = None`. A validator requires `replay_snapshot_id` when `forecast_source == "replay"`.
  - `FORECAST_SOURCES["replay"]` is registered. With `forecast_source == "replay"`, `build_sources` returns `observations={"iem": ReplayObservationSource(...)}` so the jobs code is unchanged.
  - `sb-jobs replay build --summer YEAR --station ICAO... --snapshot-id ID`: copies silver forecasts (IFS, GFS) and IEM raw observations for the window into `backend/replay/<id>/`. It writes forecasts and observations only, never corrected output or scores, so building the 2026 snapshot is not scoring. Budget check: ≤ 10 MB per snapshot (test).
  - **This moves the `replay` registration from B3 into B2.** Roadmap §5 and `config.py`'s comment say B3. Update that comment; B3 consumes it.

- [ ] **Step 1: Write the failing tests**
  - Run B1's `WeatherForecastSource` and `ObservationSource` contract suites against replay sources built from a small fixture snapshot (2025 dates).
  - `test_replay_rejects_tampered_file`.
  - `test_settings_require_snapshot_id_for_replay`.
  - `test_build_sources_replay_wires_both`.
  - `test_replay_valid_time_is_utc`: a valid time on 2025-07-10 20:00 UTC (00:00 GST 07-11) stays on UTC date 07-10.
  - `test_snapshot_size_budget`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/adapters/test_replay.py tests/unit/test_composition_replay.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the Dockerfile, `COPY replay/ replay/` sits next to `COPY models/ models/`; the directory starts with `.gitkeep`.
- [ ] **Step 4: Run** the same command, then `uv run lint-imports`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sources): replay forecast and observation sources with hashed snapshots`.

---

### Task 14: Controller step: dev run on real data, release the model, Docker check (no 2026)

**Files:** Modify `training/configs/corrector-v1.toml`, `training/configs/corrector-cold-v1.toml`. Create `artifacts/eval/dev/*`, `backend/models/<id>/`, `tests/regression/test_corrector_real_data.py`, `training/protocol.lock.toml` (the `model_id` field).

**Interfaces:**
- Consumes: everything above; Ali's pre-registration commit SHA.
- Produces: `artifacts/eval/dev/selection.json` (§11.2 input), the released `model_id` and `oof_samples_abu_dhabi.parquet` for B3's θ.

- [ ] **Step 1:** Write `tests/regression/test_corrector_real_data.py` (`regression`, `slow`, skipif no gold):
  - the dev loader returns exactly 8 × 139 × 14 = 15,568 `ecmwf_ifs025` rows per summer (2024, 2025) and lead (1-7). Gold holds one row per forecast row: 26,688 per model, summer and lead, restricted to hours 02-15;
  - LOCO corrector CRPS for T at lead 1, daytime, is ≤ B0 MAE (the sanity floor; not a claim).
- [ ] **Step 2:** Run `SB_DATA_DIR=D:\dev\sb-task11-run\data uv run sb-jobs evaluate-dev --config training/configs/corrector-v1.toml --grid`. Expected: the exports are written, and the decisions are printed and saved in `selection.json`.
- [ ] **Step 3:** Set both TOMLs' `lgbm`, `calibration_window` and `wbgt_method` from `selection.json`. Set `corrector-v1`'s `feature_set` to the §6.2 choice. Commit `chore(ml): apply pre-registered dev selection` (`selection.json` committed).
- [ ] **Step 4:** On a clean tree, run `uv run sb-jobs train --config training/configs/corrector-v1.toml --release`. Expected: `backend/models/<id>/` ≤ 15 MB and `scan_models` OK. Commit `feat(models): release corrector <id>` (if a booster file exceeds pre-commit's 500 KB limit even gzipped, add a scoped `exclude: ^backend/models/` to `check-added-large-files` and say so; roadmap §4).
- [ ] **Step 5:** `docker build -t sb-api:b2 backend/` (keep it lean: the train group is excluded and models and replay are small; run `docker image prune -f` after; Docker data was compacted on 11 Nov, so check free disk ≥ 10 GB first). Then `docker run --rm sb-api:b2 sb-jobs --help` (exit 0) and `docker run --rm -e SB_MODEL_ID=<id> sb-api:b2 python -c "…scan_models…"` (loads).
- [ ] **Step 6:** Add `model_id = "<id>"` to `training/protocol.lock.toml` and commit `chore(ml): freeze the model evaluated on 2026`.

---

### Task 15: The gated 2026 forecast evaluation (command by a subagent; the run by the controller)

**Files:**
- Create: `jobs/evaluate_2026.py`, `ml/evaluate.py` (`evaluate_forecast_test`)
- Modify: `jobs/ml_cli.py`
- Test: `tests/unit/ml/test_evaluate_forecast_test.py`, `tests/unit/jobs/test_evaluate_2026_gate.py`
- Then (controller): `artifacts/eval/2026/*`, `docs/research/2026-11-14-evaluation-report.md`

**Interfaces:**
- Consumes: `open_gate`, `load_test_pairs`, the released model, Tasks 5, 6, 11, 12.
- Produces:
  - `evaluate_forecast_test(pairs: pl.DataFrame, *, model: LightGbmCorrector, cold_cfg: TrainingConfig, token: GateToken) -> dict[str, JsonValue]`:
    - regime (a) with the released model on 2026;
    - regime (c) by training 6 `cold` models on 2024-2025 minus a cluster (to `models-eval/`);
    - regime (b-all) if time allows (pre-registration §2.4);
    - baselines B0/B0d/B2d/B3d/B4 fitted on 2024-2025;
    - every pre-registration §7.1 metric, with paired-bootstrap intervals;
    - the raw IFS/AIFS/GFS comparison (2025, 2026).
  - `sb-jobs evaluate-2026 --part forecast [--amendment ID]`: opens the gate first (refusing prints every reason and exits 2), then evaluates, then writes `forecast_skill.json`, `reliability.json` and `corrected_series_OMAA.parquet` (corrected grids + raw + truth for OMAA 2026, the input to B3's `demo_day`/`policy_scoreboard`), each with provenance (`protocol_anchor` = the §7.1 / §7.4 slugs; label REAL). `--part warnings|plans` exits 2 with "implemented in B3" until B3 adds them.

- [ ] **Step 1: Write the failing tests**
  - `test_command_refuses_without_lock` (exit 2, reasons listed).
  - `test_evaluate_forecast_test_on_synthetic_2026` (a synthetic "2026" with a fake token minted through `open_gate` with a fake `GitReader`; every §7.1 key is present; intervals are present; n rows are reported).
  - `test_outputs_carry_provenance_and_model_id`.
  - `test_second_run_refused`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_evaluate_forecast_test.py tests/unit/jobs/test_evaluate_2026_gate.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS. **Commit** `feat(ml): gated 2026 forecast evaluation`.
- [ ] **Step 5 (controller, only after the Task 14 commits and Ali's go):** on a clean tree, run `SB_DATA_DIR=D:\dev\sb-task11-run\data uv run sb-jobs evaluate-2026 --part forecast`. Record the commit, time and output hashes in the pre-registration results log through an amendment-log row (Ali). Commit the outputs: `feat(eval): 2026 forecast evaluation (pre-registered)`.
- [ ] **Step 6 (controller):** Write `docs/research/2026-11-14-evaluation-report.md` from the JSON only:
  - H1-H3 verdicts per pre-registration §13;
  - regimes (a), (b) dev and (c) side by side;
  - the per-stratum coverage table and the reliability diagram data;
  - the raw-model comparison;
  - every limitation in §10.4;
  - a negative result reported as the table says.

---

## Ordering, parallelism and hours

| Task | Est. h | Starts after | Parallel lane |
|---|---|---|---|
| 0. Ali approves and commits the pre-registration; controller writes `protocol.lock.toml` (protocol fields) | 0.5 | — | — |
| 1. Vocabulary, schema, port, fake (**B3 interface freeze**) | 2 | — | A |
| 2. Issue-time audit | 1 | — | C (any time; network) |
| 3. Holdout guard + gate | 2 | 1 | A |
| 4. Features + leakage | 3 | 1 | B |
| 5. Metrics + bootstrap | 2.5 | 1 | C |
| 6. Baselines | 1.5 | 4, 5 | C |
| 7. Config + quantile models | 2.5 | 4 | B |
| 8. CQR | 1.5 | 7 | B |
| 9. Sampler + WBGT | 1.5 | 7 | A |
| 10. Train, artefacts, adapter, use case, CLI | 3 | 3, 8, 9 | B |
| 11. Regimes + dev harness | 3 | 6, 10 | B |
| 12. Selection, provenance, exports, evaluate-dev | 2 | 11 | B |
| 13. Replay sources | 2 | 1 | A |
| 14. Dev run, release, Docker (controller) | 1.5 + ~1 compute | 12, 13 | — |
| 15. Gated command (subagent) + run + report (controller) | 2 + 2.5 | command: 12; run: 14 and Ali's go | A then — |
| **Total** | **≈ 34 h build + ~2 h compute** | | |

**Calendar:**
- **Thu 12 (evening):** 0, 1, 2, 3.
- **Fri 13:** 4, 5, 13, then 6, 7, 8, 9.
- **Sat 14:** 10, 11, 12, 15 (the command); 14 by about 17:00; the 15 run and report in the evening.

The critical path 1 → 4 → 7 → 8 → 10 → 11 → 12 → 14 → 15 is about 22 h.

**If behind at 14:00 on Sat 14, cut in this order** (each is already allowed by the pre-registration or the roadmap, and decided now):
1. B4 linear MOS (reported "not built");
2. regime (b-all) (reported "not run");
3. the direct-WBGT arm (the joint method only; the model card says so);
4. the Task 2 audit (pre-registration §4 stands).

**Never cut:** the gate, the leakage tests, B0/B2d/B3d, CQR, the regime (a) and (c) evaluation, provenance.

**B3 parallelism:**
- Once Task 1 is committed (Fri 13 morning), B3 codes the zone timeline, planner and validator against `ForecastCorrector` + `FakeCorrector` and `CORRECTED_FORECAST_SCHEMA`.
- B3 Task 0 (the OpenAPI v1 draft, Sat 14) can use the same schema for corrected-forecast responses.
- B3 needs from B2, by Sat 14 evening:
  - the released `model_id` (Task 14);
  - `oof_samples_abu_dhabi.parquet` (Task 12/14), for θ under pre-registration §6.5;
  - `corrected_series_OMAA.parquet` (Task 15);
  - `domain/provenance.py` (Task 12);
  - the replay registration (Task 13).
- B3 then writes the freeze addendum (pre-registration §11) **before** it adds `--part warnings|plans`.

## Exit criteria for B2
- CI green (unit + integration + lint-imports with 6 contracts + mypy). The regression test passes on the real gold data.
- The gate refuses every pre-registration §9 failure (unit-tested). No 2026 row is reachable from dev code (unit-tested).
- The released model is in `backend/models/`, ≤ 15 MB, its manifest validates, and its model card is complete. The image runs `sb-jobs --help` without the train group.
- `artifacts/eval/dev/selection.json` is committed before the 2026 run. `artifacts/eval/2026/forecast_skill.json` is committed with provenance; the evaluation report quotes only it.
- The `config.py` comment is updated for `replay` moving to B2 (Task 13). The roadmap §4/§5 line on `replay` and the pre-registration doc pointers (ADR 0034, Judges doc, B3 notes) are amended in a separate architect `docs:` commit, outside this plan's write scope.
