# Model card: corrector-20261114-d327987-6edafa

- Created: 2026-11-14T22:03:12.846603+00:00
- Code: git d327987afbfea3ced3dc362156f394934ac77162
- Training config: `training/configs/corrector-v1.toml` (SHA-256 6edafab285256fc66e6fe356d297a953f6a906a16f6cca0fe64f5be1e58c1571)
- Dependency lock SHA-256: 6bfb8cb18d1bc28be09d9bed67a9e1b549bd509fdf81053f2d13fb8928de144e
- Calibrated pairs: 0.05/0.95, 0.1/0.9, 0.15/0.85, 0.2/0.8, 0.25/0.75, 0.3/0.7, 0.35/0.65, 0.4/0.6, 0.45/0.55

## Data

- Gold pair dataset manifest SHA-256: 1b50744bcc4eba4fe897f6adfcb9143a234ecedfebc56ba416a75aba929951e3
- Forecasts: ECMWF IFS 0.25 degree (corrected backbone) and GFS (feature), previous runs, leads 1-7 days.
- Truth: IEM METAR observations binned to the nearest UTC hour (whole-degree).
- Modelled hours: 02-15 UTC (06:00-19:59 GST); one calendar date in UTC and GST.
- Summers: 2024, 2025
- Stations: OMAA, OMAD, OMAL, OMDB, OMDW, OMFJ, OMRK, OMSJ
- Fit rows: 131712; calibration rows: 43904; rows without a usable joint WBGT grid: 0

## Splits and regimes

- Fit: 15 May to 31 August of each training summer (pre-registration 2.3).
- Calibration (conformal offsets and copulas): window `weeks_4_8_12_16`, disjoint in time from the fit.
- The climatology features are fitted on the fit and calibration rows together, so they are in-sample for both sets. A fit row within 7 days of a calibration day reads that day's truth through the climatology, and a fit row after a calibration day reads it through the station history (`bias7_*`, which is legal: it uses only truth before the issue day). The boosters can therefore move when a calibration-day truth moves; the conformal offsets are fitted on the calibration rows' own errors regardless.
- Regime (a): known sites, new summer (final model, all clusters). Regime (c): a new cluster and a new summer (cold feature set). Regime (b): new cluster, known summers (leave-one-cluster-out on 2024-2025).
- Folds are whole clusters (Abu Dhabi, Dubai/Sharjah, Al Maktoum, Al Ain, Fujairah, Ras Al Khaimah); random splits and leave-one-station-out are not used.

## Features

- Feature set: `cold` (24 features)
- Columns: `lead_days`, `hour_utc`, `doy`, `fc_t_c`, `fc_td_c`, `fc_wind_ms`, `fc_sw_wm2`, `fc_direct_wm2`, `fc_pressure_hpa`, `fc_dewpoint_depression_c`, `fc_rh_pct`, `wbgt_fc_c`, `gfs_t_c`, `gfs_td_c`, `gfs_wind_ms`, `ifs_minus_gfs_t_c`, `ifs_minus_gfs_td_c`, `ifs_minus_gfs_wind_ms`, `station_elev_m`, `grid_elev_m`, `elev_diff_m`, `clim_t`, `clim_td`, `clim_wbgt`
- WBGT uncertainty: `joint`
- Station history (`bias7_*`, station climatology) uses only truth up to the day before the issue day.

## Metrics per regime (dev, 2024-2025 only)

| regime | b0 | b2d | corrector |
|---|---|---|---|
| loco_crps_t | 1.70052 | 1.29515 | 1.1087 |
| loco_crps_td | 3.70982 | 2.72203 | 2.50823 |
| loco_crps_wbgt | 1.048 | 0.789799 | 0.71337 |
| loco_crps_wind | 1.34808 | 0.967743 | 0.826909 |

## Calibration strata

Lead x hour-block strata (7 leads x 3 blocks = 21 per target); n counts rows, not independent days.

| target | strata | n min | n median | n max | lead-pooled fallbacks | negative offsets |
|---|---|---|---|---|---|---|
| t | 21 | 1791 | 2230 | 2237 | 0 | 84 |
| td | 21 | 1791 | 2230 | 2237 | 0 | 42 |
| wbgt | 21 | 1791 | 2230 | 2237 | 0 | 64 |
| wind | 21 | 1791 | 2230 | 2237 | 0 | 45 |

- Copula fallbacks (lead-pooled correlation): none

## Selection (2024-2025, leave-one-cluster-out)

- allow_dirty: `false`
- applied: `true`
- calibration_targets: `"all"`
- chosen_configuration: `{"calibration_window": "weeks_4_8_12_16", "config_fingerprint": "bc1923a2b7560c72992115448b20f3f452bab627d82d7d36df5e42db17fbef82", "feature_set": "cold", "fingerprint_of": "derived_configuration", "lgbm": {"bagging_fraction": 0.8, "bagging_freq": 1, "deterministic": true, "feature_fraction": 0.8, "lambda_l2": 1.0, "learning_rate": 0.05, "min_child_samples": 1000, "n_estimators": 150, "num_leaves": 7, "num_threads": 8, "seed": 20261112}, "name": "corrector-v1-selected", "wbgt_method": "joint"}`
- counts: `{"calibration_window_rerun": 1, "dev_pairs_rows": 435904, "hyperparameter_configurations": 8, "loco_runs": 4, "oof_days": 278, "oof_rows": 217952, "summer_split_rows": 217952}`
- decisions: `[{"choice": "num_leaves=7,min_child_samples=1000,n_estimators=150", "evidence": {"best_score": 0.8237723995940498, "chosen_score": 0.8237723995940498, "min_child_samples": 1000.0, "n_configs": 8.0, "n_estimators": 150.0, "n_within_1pct": 1.0, "num_leaves": 7.0, "relative_gap": 0.0, "tolerance": 0.01, "used_min_child_rule": 0.0}, "rule": "6.1 hyperparameters", "tie_broken": false}, {"choice": "cold", "evidence": {"heldout_null_sclim_t_rows": 59769.0, "heldout_null_sclim_t_share": 1.0, "heldout_rows_t": 59769.0, "min_improvement": 0.01, "t_crps_cold": 1.112725169751028, "t_crps_site": 1.478861134656913, "t_diff_hi": 0.40586370451858916, "t_diff_lo": 0.32766372156597295, "t_improvement_rel": -0.32904438118157037, "t_interval_available": 1.0, "td_crps_cold": 2.565495929615905, "td_crps_site": 2.4501749610690586, "td_diff_hi": -0.07557102350263618, "td_diff_lo": -0.15388789269836406, "td_improvement_rel": 0.04495075093107309, "td_interval_available": 1.0}, "rule": "6.2 feature set", "tie_broken": false}, {"choice": "joint", "evidence": {"crps_direct": 0.7257238149125116, "crps_joint": 0.7257045100897501, "direct_improvement_rel": -2.660149205780786e-05, "tolerance": 0.01}, "rule": "6.3 wbgt method", "tie_broken": true}, {"choice": "weeks_4_8_12_16", "evidence": {"decides_t": 1.0, "decides_td": 1.0, "decides_wbgt": 1.0, "decides_wind": 1.0, "deciding_targets": 4.0, "floor": 0.85, "min_top_coverage": 0.7514450867052023, "top_coverage_t_lead1": 0.7565235914367877, "top_coverage_t_lead2": 0.7595304759853543, "top_coverage_t_lead3": 0.77017769214301, "top_coverage_td_lead1": 0.7786771754180424, "top_coverage_td_lead2": 0.7542537152702994, "top_coverage_td_lead3": 0.7514450867052023, "top_coverage_wbgt_lead1": 0.8917882628607946, "top_coverage_wbgt_lead2": 0.892095627826836, "top_coverage_wbgt_lead3": 0.8832155855277243, "top_coverage_wind_lead1": 0.8622856534242198, "top_coverage_wind_lead2": 0.8651733792806375, "top_coverage_wind_lead3": 0.8622350674373795, "top_n_t_lead1": 9389.0, "top_n_t_lead2": 9286.0, "top_n_t_lead3": 9342.0, "top_n_td_lead1": 9389.0, "top_n_td_lead2": 9286.0, "top_n_td_lead3": 9342.0, "top_n_wbgt_lead1": 9389.0, "top_n_wbgt_lead2": 9286.0, "top_n_wbgt_lead3": 9342.0, "top_n_wind_lead1": 9389.0, "top_n_wind_lead2": 9286.0, "top_n_wind_lead3": 9342.0}, "rule": "6.4 calibration window", "tie_broken": false}]`
- exports: `{"dev_skill.json": "bb37dc9b1472ca74e4be091f832349482eccd204d38ce584879e2911e4499dd5", "oof_samples_abu_dhabi.manifest.json": "3ccf038cbc782cae20c2ab9eab3ba0bb98cc51df92b402fa1a0b3bb7cd50e953", "oof_samples_abu_dhabi.parquet": "ee2727ac9254ec37e0433b199c589d1f455d67957ec1041352309377745d6e95"}`
- git_clean: `true`
- grid_scores: `{"columns": ["num_leaves", "min_child_samples", "n_estimators", "pinball_t", "pinball_td", "score", "n_rows_t", "n_rows_td"], "rows": [[7, 200, 150, 0.655745261625, 1.034453957949, 0.845099609787, 59769, 59769], [7, 200, 400, 1.118951487374, 1.074434079973, 1.096692783674, 59769, 59769], [7, 1000, 150, 0.610104648892, 1.037440150296, 0.823772399594, 59769, 59769], [7, 1000, 400, 0.96156805545, 1.089472266549, 1.025520160999, 59769, 59769], [15, 200, 150, 0.744726744398, 1.038464282908, 0.891595513653, 59769, 59769], [15, 200, 400, 1.246144262481, 1.108580187321, 1.177362224901, 59769, 59769], [15, 1000, 150, 0.683144679159, 1.043548710941, 0.86334669505, 59769, 59769], [15, 1000, 400, 1.018409083606, 1.12102903912, 1.069719061363, 59769, 59769]]}`
- inputs: `{"coverage_by_forecast_tercile": {"columns": ["target", "lead_days", "tercile", "n", "covered", "coverage", "edge_low", "edge_high"], "rows": [["t", 1, "high", 9389, 7103, 0.756523591437, 30.151072590246, 32.605026800643], ["t", 1, "low", 2912, 2427, 0.833447802198, 30.151072590246, 32.605026800643], ["t", 1, "mid", 7622, 6163, 0.808580425085, 30.151072590246, 32.605026800643], ["t", 2, "high", 9286, 7053, 0.759530475985, 30.151072590246, 32.605026800643], ["t", 2, "low", 2968, 2497, 0.841307277628, 30.151072590246, 32.605026800643], ["t", 2, "mid", 7669, 6236, 0.813143825792, 30.151072590246, 32.605026800643], ["t", 3, "high", 9342, 7195, 0.770177692143, 30.151072590246, 32.605026800643], ["t", 3, "low", 3015, 2523, 0.836815920398, 30.151072590246, 32.605026800643], ["t", 3, "mid", 7566, 6084, 0.80412371134, 30.151072590246, 32.605026800643], ["td", 1, "high", 9389, 7311, 0.778677175418, 30.151072590246, 32.605026800643], ["td", 1, "low", 2912, 2432, 0.835164835165, 30.151072590246, 32.605026800643], ["td", 1, "mid", 7622, 6313, 0.828260299134, 30.151072590246, 32.605026800643], ["td", 2, "high", 9286, 7004, 0.75425371527, 30.151072590246, 32.605026800643], ["td", 2, "low", 2968, 2482, 0.836253369272, 30.151072590246, 32.605026800643], ["td", 2, "mid", 7669, 6228, 0.812100665015, 30.151072590246, 32.605026800643], ["td", 3, "high", 9342, 7020, 0.751445086705, 30.151072590246, 32.605026800643], ["td", 3, "low", 3015, 2508, 0.83184079602, 30.151072590246, 32.605026800643], ["td", 3, "mid", 7566, 6059, 0.800819455459, 30.151072590246, 32.605026800643], ["wbgt", 1, "high", 9389, 8373, 0.891788262861, 30.151072590246, 32.605026800643], ["wbgt", 1, "low", 2912, 2635, 0.904876373626, 30.151072590246, 32.605026800643], ["wbgt", 1, "mid", 7622, 6831, 0.896221464183, 30.151072590246, 32.605026800643], ["wbgt", 2, "high", 9286, 8284, 0.892095627827, 30.151072590246, 32.605026800643], ["wbgt", 2, "low", 2968, 2655, 0.894541778976, 30.151072590246, 32.605026800643], ["wbgt", 2, "mid", 7669, 6859, 0.894379971313, 30.151072590246, 32.605026800643], ["wbgt", 3, "high", 9342, 8251, 0.883215585528, 30.151072590246, 32.605026800643], ["wbgt", 3, "low", 3015, 2697, 0.894527363184, 30.151072590246, 32.605026800643], ["wbgt", 3, "mid", 7566, 6662, 0.880518107322, 30.151072590246, 32.605026800643], ["wind", 1, "high", 9389, 8096, 0.862285653424, 30.151072590246, 32.605026800643], ["wind", 1, "low", 2912, 2484, 0.853021978022, 30.151072590246, 32.605026800643], ["wind", 1, "mid", 7622, 6524, 0.855943321963, 30.151072590246, 32.605026800643], ["wind", 2, "high", 9286, 8034, 0.865173379281, 30.151072590246, 32.605026800643], ["wind", 2, "low", 2968, 2519, 0.84871967655, 30.151072590246, 32.605026800643], ["wind", 2, "mid", 7669, 6557, 0.855000651975, 30.151072590246, 32.605026800643], ["wind", 3, "high", 9342, 8055, 0.862235067437, 30.151072590246, 32.605026800643], ["wind", 3, "low", 3015, 2502, 0.829850746269, 30.151072590246, 32.605026800643], ["wind", 3, "mid", 7566, 6481, 0.85659529474, 30.151072590246, 32.605026800643]]}, "feature_set_cold": {"columns": ["target", "crps", "n_rows", "n_days"], "rows": [["t", 1.112725169751, 59769, 278], ["td", 2.565495929616, 59769, 278]]}, "feature_set_site": {"columns": ["target", "crps", "n_rows", "n_days", "diff", "diff_lo", "diff_hi"], "rows": [["t", 1.478861134657, 59769, 278, 0.366135964906, 0.327663721566, 0.405863704519], ["td", 2.450174961069, 59769, 278, -0.115320968547, -0.153887892698, -0.075571023503]]}, "wbgt_direct": {"columns": ["target", "crps", "n_rows", "n_days", "diff", "diff_lo", "diff_hi"], "rows": [["wbgt", 0.725723814913, 59769, 278, 1.9304823e-05, -0.008846224698, 0.0081799388]]}, "wbgt_joint": {"columns": ["target", "crps", "n_rows", "n_days"], "rows": [["wbgt", 0.72570451009, 59769, 278]]}}`
- mode: `"grid"`
- provenance: `{"data_sha256": "8124c86c6f3ff55c40184f85be06b54a9ed289cdba1a625347efe4809544a1db", "function": "run_dev_selection", "generated_at": "2026-11-14T21:58:57.346774Z", "git_sha": "ffece93782fc7cbbab6bbef8d1469e26754c266d", "label": "REAL", "model_id": null, "protocol_anchor": "#6-selection-rules-on-2024-2025-loco-out-of-fold-only", "protocol_path": "docs/research/2026-11-12-preregistration-2026-evaluation.md", "script": "stellar_blaze.ml.selection"}`
- samples_rows: `5004`

## Limitations

- 8 stations ≈ 4.2-4.6 independent sites; about 1,000-1,300 effective station-days in total. OMAA-only rows rest on one site-summer.
- All stations are **airports**. The claim is "held-out airport clusters", never "any worksite".
- WBGT and TWL truth are **derived** (A2): observed T, Td and wind with modelled lead-0 radiation. There is no globe or wet-bulb instrument.
- Whole-degree METAR truth (about 0.29 °C noise).
- 2026 is a new IFS cycle (50r1, from 12 May 2026), so regime (a) also tests robustness to a model upgrade. A failure there may be the upgrade, not the method.
- Open-Meteo free tier, non-commercial; data CC BY 4.0 (ADR 0005).
- The crew is **SIMULATED**; the weather is **REAL**.
- TWL is "aligned with ADOSH zones", not certified; the port reads +3.9 to +7.0 W/m² high (ADR 0006).

## Intended use

Probabilistic (19 quantiles, 5% to 95%) correction of the IFS forecast of temperature, dew point, wind speed and WBGT at UAE airport METAR stations, 1 to 7 days ahead, for 06:00-19:59 GST, as an input to worker heat safety planning. It is a research and demonstration model: its intervals are calibrated on past summers and are not a regulatory or medical determination.

## Not validated for non-airport sites

This model is not validated for non-airport sites. Every station is an airport; a worksite's microclimate (surface, shade, urban heat) is not represented. The claim is held-out airport clusters, never any worksite.
