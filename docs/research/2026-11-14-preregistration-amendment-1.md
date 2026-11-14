# Pre-registration amendment 1: three B3 decisions and one erratum

- **Written:** 2026-11-14 (Sat), by the architect (Claude) for Ali, **before any 2026 result exists** (§0).
- **Amends:** `docs/research/2026-11-12-preregistration-2026-evaluation.md` (committed `661b373`, SHA-256 `ce116fe64a00b8b5509ae567a72973e85d1cf2120af725127b970bdb8885b7b8`), called "the pre-registration" below. **That file is not edited.** It is committed, and the §9 gate compares its SHA-256 with `protocol.lock.toml`.
- **Proposed id for the gate:** `amendment-1`. This file takes the place of a row in the pre-registration's §13 amendment log. A row written inside that file would change its hash and stop the gate from opening, so the §13 table stays empty and the amendment is hashed by the lock instead (last section).
- **Decided by:** Ali, in chat, 2026-11-14. He accepted ADRs 0046-0058 (all 13). Three of them touch what the pre-registration fixes before scoring: [0046](../decisions/0046-warning-level-policy.md), [0047](../decisions/0047-twl-margin-withdrawal-and-mrt.md) and [0057](../decisions/0057-plans-row-baselines-and-crew-fixture.md). Each ADR gets a dated amendment note pointing here.
- **Not changed by this amendment:** the hypotheses H1-H7, the splits and regimes, the corrector and its features, the baselines, the §6 selection rules (including the θ rule of §6.5), the metrics and counters of §7, the bootstrap of §8, the issue-time wording of §4, and the disclosure of §10. ADRs 0048-0056 and 0058 change no pre-registered definition or frozen value. ADR 0058's fallback for a missing or stale forecast is a product behaviour; scoring still follows §2.1 (rows with missing inputs are not scored and not imputed), and this amendment does not change that.

## 0. Written before any 2026 scoring: what was and was not scored

| Part | 2026 number computed? | Evidence (checked 2026-11-14 by file listing; no git command was run) |
|---|---|---|
| `forecast` | **No** | The B2 worktree (`D:\dev\stellar-blaze-b2`) has no `artifacts/eval/` directory. Its `backend/training/protocol.lock.toml` holds only `protocol_path`, `protocol_sha256` and `protocol_commit`: there is no `model_id`, and the §9 gate refuses to run without a released one. |
| `warnings` | **No** | The freeze addendum (§11) does not exist, and the §9 gate refuses `warnings` without it. B3 has not started: the roadmap's 14 Nov status lists B3 Task 0 as not started, and the B3 plan is dated today and unexecuted. |
| `plans` | **No** | Same as `warnings`. The fixture `backend/fixtures/demo_site.toml` does not exist yet (B3 Task 7). |

- **2026 information seen:** exactly the four items of §10.1, unchanged. The "never computed on 2026" list of §10.1 (any corrector, quantile or conformal output; any TWL zone, warning or plan; any WBGT-threshold event probability; any choice of θ, margin or day) is still true to the author's knowledge.
- **Where the new values come from, and that none comes from 2026:** ADR 0046's Red edge is derived from assumed metabolic rates and a body surface area (ADR 0046 §5) and ADOSH Table 1. ADR 0047's margin is the B1 port's measured bias against Miller and Bates Table 2 (ADR 0006); its MRT method comes from thermofeel 2.3.0's function signatures. ADR 0057's roster is the L1 template and the ban window of the pre-registration; its crew is synthetic. The truth-Red share that ADR 0046 asks B3 to report is computed on 2024-2025 and is information, not a selection input.
- **Limit of this statement:** it rests on the file listing above and on the roadmap, not on a repository history check. If any 2026 development diagnostic has been run since the pre-registration, the controller discloses it in the freeze addendum.
- **Consequence under §11:** "If any §11 value is changed after a 2026 Warnings or Plans number exists, that row is reported as 'not pre-registered' and loses its headline." No such number exists, so the rows keep their headlines.

## 1. The three changes at a glance

Only the third changes how a pre-registered sentence reads. The first two fill slots that §11.1 left open for the freeze addendum, or define terms the file used without defining. They are recorded here so that nothing frozen is settled silently.

| # | ADR | What the pre-registration fixed | Nature of the change | Rows affected |
|---|---|---|---|---|
| 1 | 0046 | §7.2 P3 and the truth danger hour in terms of "High"; §7.3 plan (d) at the 10th percentile; "Red" used in §7.3 but never defined; the ruleset SHA-256 as a §11.1 value | Definitions added: the level rule and a Red edge. No §7 text is altered | Warnings: no counter changes. Plans: Red ticks stop work |
| 2 | 0047 | §11.1 slots `⟨margin_w_m2⟩` and `⟨withdrawal_limits⟩`; §10.2 names a margin of 7 W/m² | Slots filled now, from regulation and the B1 port measurement. The MRT method is fixed. The runtime minimum of the margin becomes 7 | Warnings and Plans: every truth and forecast zone |
| 3 | 0057 | §7.3 plans (a) naive and (b) ban only; §11.1 slot `⟨demo_site_sha256⟩` | **Presentation of (a) and (b) changes.** The fixture's content is fixed | Plans |

## 2. Change 1: the warning-level policy and the Red edge (ADR 0046)

**What the pre-registration said**
- §7.2, truth danger hour: "truth TWL in the ADOSH High zone (< 115 W/m²)".
- §7.2, P3: "warn when P(High) ≥ θ_protect (also shown at θ_balanced). P(High) comes from the corrected joint samples through TWL (or the direct method, per §6.3)."
- §7.3, plan (d): "rule plan from the corrected protective quantile, defined as the 10th percentile of TWL from the corrected joint samples (one-sided 90% protection; fixed now)."
- §7.3, counter 3: "missed protection (truth High or Red ticks scheduled at a lighter cycle)". "Red" is used and not defined anywhere in the file.
- §11.1: "Ruleset id and SHA-256 (`ae-heat-2026.1`)". The Red edge and the level rule live in that ruleset, so their values are inside the hash that §11.1 freezes.

**What changes, and why** (ADR 0046; evidence there)
1. **One level rule** for the push, the site level, the crew level and P3: the level of an hour is the most severe zone `z` such that the share of finite samples in zone `z` or worse is at least θ (a tie escalates). With θ = 0.10 and `method="inverted_cdf"`, the level and the q10 plan agree hour by hour.
2. **A fourth zone, Red (stop work).** ADOSH Table 1 has three zones and no stop. Red is `twl_eff < red_twl_w_m2`, with `twl_eff = TWL − margin` (change 2). The edge is a ruleset tunable. A probability-only Red was rejected: it would stop work on most summer afternoons at OMAA, far past the regulator.
3. **"High" in §7.2 is read as "High or Red", that is `twl_eff < 115`.** A truth hour in Red is a danger hour. This is the reading under which ADR 0046 §3 says the Orange decision is "exactly P3". It is stated here so Red does not drop out of the danger hours.
4. **Plan (d) is unchanged on the scoreboard.** It stays the pre-registered q10 plan. The product's plan has one extra rule (a tick is never milder than its hour's level); that clamp is not applied to the scoreboard.
   - **Standing condition from ADR 0046 §4, not amended here:** if the frozen θ_protect is below 0.10, the clamp can bind, and the deck must say the product plan is the stricter of the two. Ali can instead amend §7.3 before the plans run. This amendment does neither.
5. Moderate work uses the heavy column of Table 1 (a protective reading, a ruleset floor).

**Effect on the rows**
- **Warnings:** no counter, policy or hypothesis definition changes. P1 and P0 are unaffected. P2 warns when the raw-IFS `twl_eff < 115`. The share of truth-Red working hours at OMAA in 2024-2025 is reported in the freeze addendum as information.
- **Plans:** the validator scores against truth zones, and a truth tick in Red is a tick where any work breaks the rule `STOP.red`. Plans that work through a truth-Red tick (ban only, and the raw-IFS plan where it misses the tick) therefore collect rule-violation minutes there (counter 1) and missed-protection ticks (counter 3). Plan (d) schedules stopped time in a tick whose q10 is in Red. How many truth-Red ticks 2026 holds is not known.

**New frozen values** (all inside the `ae-heat-2026.1` SHA-256 recorded in the freeze addendum)

| Item | Value |
|---|---|
| Zone edges on `twl_eff` | Low `≥ 140`, Medium `≥ 115`, High `≥ red_twl_w_m2`, Red below it; each edge belongs to the milder zone |
| `red_twl_w_m2` | default 85.0 W/m², range [60, 115], `safer = "higher"`, POLICY tunable |
| Level rule | share of finite samples at zone `≥ z` is `≥ θ`; no finite sample means no level |
| Planner tick zone (product only) | `max(zone(q10 tick), zone(level of the hour))` |
| Plan (d) on the scoreboard | unclamped q10, `np.quantile(twl_eff, 0.10, method="inverted_cdf")`, as §7.3 |
| Moderate workload | uses the heavy column (`moderate_uses_heavy = true`) |

## 3. Change 2: TWL margin, withdrawal limits and MRT (ADR 0047)

**What the pre-registration said**
- §11.1: "This fixes the TWL margin `⟨margin_w_m2⟩` and the withdrawal-limit switch `⟨withdrawal_limits⟩` (ADR 0006)." Both are slots for the freeze addendum.
- §7.2: "TWL comes from the B1 port (ADR 0006), using the margin and the withdrawal-limit decision of the frozen ruleset (§11.1). Sensitivity (fixed, always reported): truth zones under margin {0, 7} W/m² × withdrawal limits {off, on}, a 2 × 2 table."
- §10.2: "the TWL margin of 7 W/m² from the Miller & Bates port bias (ADR 0006)". §10.4: "the port reads +3.9 to +7.0 W/m² high (ADR 0006)".
- §6.5: "TWL needs B3's weather-to-TWL pipeline (MRT and body-level wind, ADR 0006) and the frozen margin." The MRT method is not specified.

**What changes, and why** (ADR 0047; evidence there)
1. **Margin 7.0 W/m²** and **withdrawal limits off**, both decided now from regulation and the B1 measurement, with no 2026 data. The margin is the largest measured port bias, so no runtime value can zone above the published table values. The withdrawal limits stay off because their only source is a code comment in a third-party library; ADOSH Table 1 does not contain them.
2. **The margin's runtime minimum is raised from 0 to 7** (range [7, 20]). This is a change to the tunable's allowed range, not to a scored value. The offline 2 × 2 sensitivity still computes margin 0; it is an analysis, not a runtime setting.
3. **MRT method fixed** for forecast and truth TWL alike: globe temperature from `thermofeel.liljegren.solve_globe` with the same inputs the Liljegren WBGT uses, then `calculate_mrt_from_bgt` (thermofeel 2.3.0). Truth TWL uses observed T, Td and wind with the IFS lead-0 radiation and pressure (assumption A2, ADR 0005). Body-level wind is `body_level_wind_ms` (B1).
4. **Order if withdrawal is ever enabled:** cap first, then subtract the margin.

**Effect on the rows**
- **Warnings and Plans:** every truth zone, every P2 and P3 zone, and every plan zone is computed with margin 7 and withdrawal off. These are the headline numbers. The headline cell of the §7.2 2 × 2 table is therefore (margin 7, withdrawal off); the other three cells are reported unchanged. No counter definition changes.

**New frozen values** (recorded in the freeze addendum)

| Item | Value |
|---|---|
| `twl_margin_w_m2` | default 7.0, min 7.0, max 20.0, `safer = "higher"` |
| `[twl_withdrawal]` | `enabled = false`, thresholds unchanged from `ae-heat-0.1` |
| MRT | `solve_globe` then `calculate_mrt_from_bgt`, thermofeel 2.3.0, with the Liljegren WBGT inputs |
| Headline sensitivity cell | margin 7, withdrawal off |

## 4. Change 3: naive and ban only are the same plan; the crew fixture (ADR 0057)

**What the pre-registration said**
- §7.3, plans compared: "(a) naive schedule (every shift minute outside the ban); (b) ban only; (c) rule plan from raw IFS; (d) rule plan from the corrected protective quantile".
- §7.3, roster: "L1 legal default, 06:00-11:00 + 15:00-18:00 GST, with the crew of the frozen fixture (§11.1). It is labelled SIMULATED."
- §7.2: "the assumed crew of 20 doing heavy work". §1, H6: the rule plan from the corrected forecast against ban only.
- §11.1: "The crew fixture `backend/fixtures/demo_site.toml` SHA-256 `⟨demo_site_sha256⟩` (SIMULATED; the B3 notes §5)."

**What changes, and why** (ADR 0057; evidence there)
1. **(a) and (b) are one plan on L1, by construction.** The ban window (12:30-15:00) lies inside L1's 11:00-15:00 gap, and L1's runs are 5 h and 3 h, so neither the ban nor Art. 18 changes a minute of L1. The Plans row shows one row labelled "Ban only (= working every shift minute; the legal roster already avoids the ban)", then (c) and (d). The result file keeps both keys with identical values and a field `identical_by_construction: ["naive", "ban_only"]`, so nothing is dropped silently. Using the illegal B0 roster for (a) was rejected: its extra violations are the law's gain (ADR 0034 §6), not ours.
2. **The fixture's content is fixed.** Site `site-demo-mussafah` (OMAA, lat 24.36, lon 54.50, Asia/Dubai, 6 days a week, commute 45 min); four crews all on L1; **`crew-b`, 20 members, all experienced adults, heavy work, is the scored crew** (the "crew of 20 doing heavy work" of §7.2); the other crews exist for the supervisor views and are not scored. The file is created in B3 Task 7.
3. **No SHA existed before.** The §11.1 slot was empty, so this change sets the fixture's SHA-256; it does not overturn a recorded one. The SHA itself is computed when the file is committed and goes into the freeze addendum. Any byte changed after that makes the Plans row "not pre-registered".

**Effect on the rows**
- **Plans:** three distinct plans are shown instead of four. All counters are unchanged in definition. Counter 4, "rest minutes added vs naive", is zero for ban only by construction. H6 ((d) against ban only) and H7 are unaffected.
- **Warnings:** none. The scored crew only sets the "assumed crew of 20" worker-hours multiplier of §7.2, which is unchanged.

**New frozen values**

| Item | Value |
|---|---|
| Plans presented | ban only (= naive on L1), rule plan on raw IFS, rule plan on the corrected q10 |
| Result file | both keys kept, `identical_by_construction: ["naive", "ban_only"]` |
| Scored crew | `crew-b` of `backend/fixtures/demo_site.toml` as specified in ADR 0057 §2 |
| `⟨demo_site_sha256⟩` | computed at the commit that adds the file; recorded in the freeze addendum |

## 5. Erratum E1: the ECMWF 06 UTC dissemination window (§0 item 1)

**What the pre-registration says.** §0 item 1 (cited as "§0.1" in §4 and §14): "ECMWF disseminates the 12 UTC IFS run from about 17:45 to 19:34 UTC, which is 21:45-23:34 GST. The 06 UTC run goes out from about 11:45 to 13:34 UTC, which is 15:45-17:34 GST (ECMWF dissemination schedule, Confluence "Dissemination schedule", Set I)." The §4 table's strict row repeats the same arithmetic: "a run published by about 01:34 UTC on D-1 at the latest".

**What the schedule shows.** Read on 2026-11-14 at https://confluence.ecmwf.int/display/DAC/Dissemination+schedule through the fetch tool. The tool summarises the page and could not reproduce the table verbatim, so the figures below are the tool's reading of the 06 UTC column; they match the figure the B2 controller reported (11:45-12:27 UTC).
- Set I, `ifs-ens-cf` (oper, forecast stream), **06 UTC run: 11:45 to 12:12 UTC** for steps 0-90, then **12:12 to 12:27 UTC** for steps 93-144. Its wave stream has the same times. The `ssd` stream runs 11:45 to 12:27. The `pproc` (post-processed) stream is listed at **13:00 UTC**.
- So the 06 UTC window is **11:45-12:27 UTC (15:45-16:27 GST)**, not 11:45-13:34 (15:45-17:34 GST). The post-processed products at 13:00 UTC (17:00 GST) are still before 18:00 GST.
- The 12 UTC run starts at 17:45 UTC, as the pre-registration says. For steps 0-90 the page shows 17:45 to 18:12, not 19:34. The end for steps to 144 was not fetched; by the 06 UTC pattern it would be about 18:27.
- The pre-registration's end times (13:34, 19:34 and, in §4, 01:34) each sit about 67 minutes after the schedule's forecast-stream end (12:27; the 12 UTC and 18 UTC equivalents are inferred from the same pattern, not fetched).

**Conclusion unchanged.** 18:00 GST on D-1 is 14:00 UTC. The 06 UTC run is complete well before that under either window, and the 12 UTC run starts at 17:45 UTC (21:45 GST), after it. So the newest run anyone could hold at 18:00 GST on D-1 is the 06 UTC run of D-1, as §0 item 1 concludes. The lead-1 wording ("forecast made about 24 hours ahead"), the lead-2 strict stamp, and every number and hypothesis are unchanged. In §4 the strict row's "01:34 UTC on D-1" is 05:34 GST, far before 18:00 GST, whichever figure is right. Nothing in code depends on these dissemination times.

## 6. Protocol lock: to be extended by the B2 controller

`backend/training/protocol.lock.toml` in the B2 branch hashes the pre-registration only (`protocol_path`, `protocol_sha256`, `protocol_commit`). It must be extended to hash this amendment as well, so that the §9 gate refuses to run unless:
- this file's SHA-256 equals the lock's recorded amendment hash, and
- the commit that added this file is an ancestor of HEAD and this file at that commit has the same hash.

The field names and the gate change are the B2 controller's to choose; the B2 controller will do it. This file is committed before the lock is extended, and before any 2026 run. The freeze addendum (§11, B3 Task 14) cites this amendment next to the ruleset, fixture and θ hashes.
