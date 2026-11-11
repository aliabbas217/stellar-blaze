# ADR 0007: ML: LightGBM quantile corrector with conformalised quantile regression

- **Status:** Accepted (Ali, 2026-11-11)
- **Evidence:** `docs/research/2026-11-11-backend-ml-stack.md` §1 findings 6 and 8, §6.1, §6.2, §6.11; `docs/research/2026-11-11-data-availability.md` §5.3, §6, §7; plan §8.3 and Part E1

## Context
Day-1 IFS daytime dew point is 1.4-1.9 °C too dry and biases are large and site-specific (data doc §6). With about 1,000-1,300 effective station-days, gradient boosting is within a few percent of neural post-processors (plan E1). CRPS from only 3 quantiles is biased by -28.5% on a calibrated forecast; 19 levels gives +4.8% (stack doc §6.2). Hourly weather is not exchangeable and the May 2026 model upgrade breaks exchangeability further.

## Decision
- **Targets:** forecast error of T and Td (and wind) per lead; corrected values are pushed back through Liljegren (ADR 0006), so physics stays intact.
- **Model:** `lightgbm` 4.7.0, one `LGBMRegressor(objective="quantile", alpha=q)` per level, **19 levels: 0.05, 0.10, ..., 0.95**; lead is a feature (one model over leads); small, regularised capacity. Crossing quantiles are sorted at prediction time.
- **Calibration:** **conformalised quantile regression** with `mapie` 1.6.0 (`ConformalizedQuantileRegressor`, `prefit=True`, estimators in the order `[lower, upper, median]`), applied to each symmetric pair (0.05/0.95 ... 0.45/0.55) **per lead and hour band**, on **time-blocked** calibration windows cut by hand (last 30 days of each training summer). Serving applies persisted offsets with our own symmetric implementation, with MAPIE as the test oracle.
- **WBGT uncertainty:** joint samples of corrected T/Td (from the calibrated quantile grids, coupled across variables) propagated through Liljegren, **or** direct post-processing of WBGT; B2 runs both and reports which wins.
- **Scores:** `scoringrules` 0.12.0: CRPS on the 19-level grid (comparable only between models on the same grid), `crps_ensemble` for WBGT samples, pinball loss, interval score, coverage, PIT; MAE/RMSE; POD/FAR/CSI per level and lead (thresholds set in B3).
- **Baselines:** raw NWP (IFS, GFS, AIFS); simple bias correction (per-station, per-lead, per-hour-band additive mean from training data) and linear MOS. Climatology and persistence are reported if B2 has time (plan §8.3 listed them).
- **Comparator:** a small DRN on the `drn` group (torch 2.15.0 CPU) is a **stretch**.
- **Artefacts:** boosters saved as LightGBM text, conformal offsets as JSON, `params.json`, metrics Parquet, data manifest (SHA-256 of inputs), git SHA, `uv.lock` hash, `model_card.md`. No MLflow.

## Consequences
- Calibration strata are bounded by the effective sample: B2 sets hour-band edges from data and reports n per stratum; wide strata beat empty ones.
- The corrector will look strong under regime (a) by memorising station bias; regime (b) is the honest "new site" number and is headlined next to (a).
- MAPIE logs "ill-sorted" predictions to the root logger; B2 routes that logger through structlog.
- An adaptive (online) conformal arm is a B2 stretch (data doc §7 item 7).

## Rejected options
| Option | Why rejected |
|---|---|
| 3-level (5/50/95) model with CRPS | CRPS biased by -28.5% |
| Deep learning as the main model | No data-derived reason at about 1,000-1,300 effective samples |
| `train_conformalize_test_split` | Random split; wrong sizes for float fractions (issue #1018) |
| MLflow | +18 to +48 packages and a server for under 100 runs; artefacts suffice |
| xgboost / catboost | No data-derived reason to leave LightGBM |

## Revisit trigger
More stations or years (DRN becomes competitive); a coverage failure on 2026 per stratum; MAPIE or LightGBM API changes on a bump.
