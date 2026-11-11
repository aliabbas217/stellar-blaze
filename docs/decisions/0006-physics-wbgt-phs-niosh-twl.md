# ADR 0006: Physics: Liljegren WBGT, guarded ISO 7933 PHS, in-house NIOSH RAL/REL, TWL ported from an MIT reference

- **Status:** Accepted (Ali, 2026-11-11), with one correction to the brief (TWL, below)
- **Evidence:** `docs/research/2026-11-11-backend-ml-stack.md` §1 findings 2, 4, 5, §6.3-6.6; `docs/research/2026-11-11-claims-verification.md` §2, §3, §6; `D:\dev\future-health-challenge\scripts\audit_wbgt.py`

## Context
Abu Dhabi's code (ADOSH-SF CoP 11.0 v4.0) keys controls to TWL zones; NIOSH 2016 keys limits to WBGT and metabolic rate; PHS predicts strain and duration limits. Each tool has a defect or gap that shapes the code.

## Decision
- **WBGT:** `thermofeel` 2.3.0 `calculate_wbgt_liljegren` (returns K), with solar geometry **ported verbatim from `audit_wbgt.py`** (`cos_zenith`, `mean_cos_zenith_prev_hour`; 5.0e-5 max |Δcos z| vs pvlib). Open-Meteo radiation is the mean over the preceding hour. Never `calculate_wbgt_simple`. Elements with non-finite inputs, incoherent radiation (radiation while the sun is below the horizon all hour), non-convergence, or a result outside [T-30, T+10] °C become NaN with a reason code.
- **PHS (ISO 7933:2023):** `pythermalcomfort` 4.8.1 `phs`, behind (1) input validation (finite; applicability window 15<tdb<50, 0<tr-tdb<60, 0<v<3, 0.1<clo<1, 0.96-4.3 met; positive height/weight) and (2) a **hard timeout in a separate process** (a numba kernel cannot be interrupted from a thread; NaN input hangs forever, issues #524/#523, reproduced on 4.8.1). Outputs with rectal temperature outside 36-42 °C are rejected.
- **NIOSH RAL/REL:** in-house: REL = 56.7 - 11.5·log10(M), RAL = 59.9 - 14.1·log10(M), M in whole-body watts (NIOSH 2016 ch. 8.1, verbatim). Test vectors: M=180 W → REL 30.76, RAL 28.10; 300 W → 28.21, 24.97; 415 W → 26.59, 22.99. Clothing adjustments from **NIOSH Table 3-2** (ACGIH-derived), labelled as such.
- **TWL:** in-house **port of `vorpalvorpal/meteoHazard` `solve_twl_single`** (Brake & Bates 2002 Appendix 1, three-zone evaporation), pinned to commit `5633d5719225d15d84f2608189e2b3d654dba73d`, labelled **"aligned with ADOSH TWL zones"**, never "ADOSH-compliant". **ADOSH zones: ≥140 W/m² Low risk (unrestricted), 115-140 Medium (cautionary), <115 High** (Technical Guideline Table 1, printed as "140 - 220 <", "115 - 140", "< 115"; the boundary convention is ours: exactly 140 → Low, exactly 115 → Medium). Test vectors: **Miller & Bates 2007 Table 2** (11 chamber sessions).

## Correction to the brief: an open TWL implementation exists
The stack doc (finding 5) searched Python code, PyPI and GitHub code search and found none. The claims doc (§3) found the R package above, which the stack doc's searches did not cover. I checked it on 2026-11-11: `DESCRIPTION` says `License: MIT + file LICENSE`; `LICENSE` is the standard CRAN MIT stub (`YEAR: 2026`, `COPYRIGHT HOLDER: TWL authors`); last commit 2026-09-29; single maintainer; its DOI is wrong (`...317070947`; the paper is `10.1080/104732202753438261`). Porting with the MIT notice and attribution is permitted. The B1 plan keeps a licence re-verification step before the port. If the licence changes, implement from the published equations instead.

## Consequences
- **Measured bias, safety-relevant:** an independent scratch port (2026-11-11, WMO psychrometer conversion from the published wet-bulb values, MRT = dry bulb, 0.12 clo, vapour permeability 0.45, 101.3 kPa) reads **+3.9 to +7.0 W/m² (mean +6.2) above** the 11 published values; the claims doc measured +5.7 mean / 6.5 max. A higher TWL is **less protective**, and zone edges are 25 W/m² apart. **B3 must decide** how to handle readings within this band of 115 and 140 (recommendation: zone on TWL minus 7 W/m² and say so).
- The reference code also caps TWL at 115 W/m² when dry bulb > 44 °C or natural wet bulb > 32 °C ("withdrawal limits") and clamps to [60, 380]. The primary source of the two caps is not verified. B1 ports them as a separate function; **B3 decides** whether to apply them (dry bulb above 44 °C is common in UAE summer afternoons, so this choice moves many hours into the High zone).
- TWL needs mean radiant temperature (from radiation, via thermofeel's MRT routine in B3) and body-level wind (10 m wind × ln(1/0.01)/ln(10/0.01) ≈ 0.667; clamp 0.2-4.0 m/s).
- PHS returns NaN outside its window, including heavy work above 250 W/m² and heavy PPE; about 19.6% NaN even inside nominal ranges (cause not investigated). PHS is therefore advisory; NIOSH and TWL drive levels when PHS is unavailable.
- No published Liljegren test vector was located; WBGT correctness rests on port fidelity (golden values from the FHC functions), the pvlib solar oracle and physical properties.
- Every number and table here is cited in the model card and the technical document.

## Rejected options
| Option | Why rejected |
|---|---|
| `pythermalcomfort.work_capacity_niosh` | Bröde et al. productivity curve, not RAL/REL |
| `pythermalcomfort.wbgt` | ISO 7243 from measured wet-bulb/globe, not weather-model inputs |
| Mapping WBGT bands onto ADOSH zones | A guess; TWL can be computed directly |
| `heatstress` 0.1.1 | Two days old |
| Calling PHS in the request path unguarded | Hangs the safety engine on one missing hour |

## Revisit trigger
Brake & Bates 2002 Appendix 1 obtained (verify the port); pythermalcomfort closes #524/#523 (re-test, then drop the guard); ADPHC publishes an official TWL calculator or equation; the meteoHazard licence changes.
