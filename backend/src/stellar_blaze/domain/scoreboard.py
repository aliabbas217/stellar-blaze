"""Shapes of the pre-registered evaluation artefacts the frontend imports at build time (ADR 0051 decision 3).

``artifacts/eval/2026/{policy_scoreboard,plan_scoreboard,demo_day}.json`` and ``artifacts/eval/dev/theta.json`` are
written offline by ``ml/`` (B3 Tasks 12 and 13) from these models and read by F2 as static files; ``export_openapi``
adds the same models to ``openapi/v1.json`` so one ``pnpm api:gen`` types them. Every number a scoreboard row or the
demo day shows has a typed field here. The counters of the two scoreboards are ``Metric`` values (value, interval,
sample size, protocol anchor); the demo day, the theta grid and the runner-up hold plain numbers, because they describe
one day or one selection step rather than a bootstrapped estimate.

Definitions are the pre-registration's (``docs/research/2026-11-12-preregistration-2026-evaluation.md`` sections 7.2 to
7.4 and 13, with amendment 1). The words "minutes avoided" and "illness prevented" appear nowhere in these shapes or in
any label the exporters write (ADR 0034).

Additive changes are possible after the v1 freeze; renames are not.
"""

import datetime as dt
from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class ProvenanceLabel(StrEnum):
    """What a number rests on (pre-registration section 12)."""

    REAL = "REAL"
    REAL_WEATHER_ASSUMED_CREW = "REAL weather + assumed crew"
    SIMULATED = "SIMULATED"


class Provenance(BaseModel):
    """Where an exported number came from: protocol section, script and function, commit, data hash, model, label.

    This is a local stand-in with exactly the fields of B2 Task 13's ``domain/provenance.py``; it is replaced by an
    import from there when that task is merged. The class and field names stay identical so the OpenAPI component
    names do not change.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    protocol_path: str = Field(description="Repository path of the pre-registration the metric is defined in.")
    protocol_anchor: str = Field(description="Heading slug inside the protocol, for example `#72-warnings-row`.")
    script: str = Field(description="Module path of the script that wrote the file.")
    function: str = Field(description="Function inside the script that computed the numbers.")
    git_sha: str = Field(description="Commit the numbers were produced from.")
    data_sha256: str = Field(description="SHA-256 of the input data (the gold pairs file, or the OOF export for DEV).")
    model_id: str | None = Field(description="Id of the released corrector model; null when no model was involved.")
    label: ProvenanceLabel = Field(
        description="REAL, REAL weather + assumed crew, or SIMULATED. Shown with the number."
    )
    generated_at: AwareDatetime = Field(description="UTC instant the file was written.")


class ArtifactModel(BaseModel):
    """Base of every artefact shape: immutable, no unknown members, every field present."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class Interval(ArtifactModel):
    """A 95% percentile interval of the paired moving-block bootstrap (7-day blocks, B = 2,000, seed 20261112)."""

    lo: float = Field(description="Lower end of the interval, in the unit of the metric it belongs to.")
    hi: float = Field(description="Upper end of the interval, in the unit of the metric it belongs to.")


class Metric(ArtifactModel):
    """One number with its uncertainty, sample size and protocol anchor."""

    value: float = Field(description="Point estimate, in the unit the field name or description states.")
    ci: Interval | None = Field(description="95% bootstrap interval; null where none is defined (a total, a constant).")
    n: int = Field(description="Number of observations behind the value (days, hours or ticks, as the field says).")
    anchor: str = Field(description="Heading slug of the pre-registration section that defines this metric.")


EvaluationSet = Literal["dev_2025", "scored_2026"]
PolicyId = Literal["P0", "P1", "P2", "P3_protect", "P3_balanced"]
PlanId = Literal["naive", "ban_only", "rule_raw", "rule_corrected"]
Outcome = Literal["supported", "negative"]
ZoneName = Literal["low", "medium", "high", "red"]


class WbgtQuantiles(ArtifactModel):
    """A WBGT range in degrees Celsius: the 5th, 50th and 95th percentile of the corrected forecast."""

    p05: float | None = Field(
        description="5th percentile of the corrected WBGT, degrees Celsius; null with no forecast."
    )
    p50: float | None = Field(description="Median of the corrected WBGT, degrees Celsius; null with no forecast.")
    p95: float | None = Field(
        description="95th percentile of the corrected WBGT, degrees Celsius; null with no forecast."
    )


class PairedComparison(ArtifactModel):
    """One paired difference between a policy or plan and its baseline, as a hypothesis uses it."""

    metric: str = Field(description="Metric the difference is of, for example `missed_danger_hours`.")
    subject: str = Field(description="Policy or plan id that is being tested, for example `P3_protect`.")
    baseline: str = Field(description="Policy or plan id it is compared with, for example `P0`.")
    difference: Metric = Field(description="subject minus baseline; negative means fewer. `ci` is of the difference.")


class HypothesisVerdict(ArtifactModel):
    """The pre-registered verdict on one hypothesis. Negative results are shown as they are (section 13)."""

    id: str = Field(description="Hypothesis id of the pre-registration: H4 or H5 (Warnings), H6 or H7 (Plans).")
    primary: bool = Field(description="True for the one primary hypothesis of the row.")
    statement: str = Field(description="The hypothesis as pre-registered, in words.")
    outcome: Outcome = Field(description="`supported` when every interval excludes zero in the stated direction.")
    comparisons: list[PairedComparison] = Field(description="The paired differences the verdict is computed from.")
    text: str = Field(
        description="The sentence the scoreboard shows, per section 13 (names the failing side on a negative)."
    )


# --- Warnings row (pre-registration 7.2) -------------------------------------------------------------------------


class PolicyRow(ArtifactModel):
    """One warning policy at one lead: the counters of section 7.2, each with an interval."""

    policy: PolicyId = Field(description="P0 ban only, P1 raw WBGT >= 32, P2 ADOSH zones on raw, P3 Stellar Blaze.")
    label: str = Field(description="Display name of the policy.")
    rule: str = Field(description="One-line definition of when the policy warns an hour.")
    theta: float | None = Field(description="Warning threshold on P(High) for the P3 rows; null for P0, P1 and P2.")
    missed_danger_hours: Metric = Field(
        description="Truth-High (or Red) worked hours not warned, weighted by non-ban fraction."
    )
    false_alarm_hours: Metric = Field(
        description="Warned hours whose truth is not High or Red, weighted by non-ban fraction."
    )
    pod: Metric = Field(description="Probability of detection of danger hours, 0 to 1.")
    far: Metric = Field(description="False-alarm ratio, 0 to 1.")
    csi: Metric = Field(description="Critical success index, 0 to 1.")
    alerts_per_shift: Metric = Field(description="Warned runs per day: how many alerts one shift receives.")
    missed_danger_crew_hours: Metric = Field(description="Missed danger hours times the assumed crew size (ASSUMED).")
    false_alarm_crew_hours: Metric = Field(description="False-alarm hours times the assumed crew size (ASSUMED).")


class LeadResult(ArtifactModel):
    """Every policy at one forecast lead."""

    lead_days: int = Field(
        description="Forecast lead in days: 1 headline, 2 strict-availability, 3, and 5 and 7 report-only."
    )
    label: str = Field(
        description="How the lead may be worded: lead 1 `about 24 hours ahead`; lead 2 `issued by 18:00 GST the "
        "evening before`."
    )
    headline: bool = Field(description="True for lead 1, the pre-registered headline lead.")
    report_only: bool = Field(
        description="True for leads 5 and 7, which are reported in the report only, never headlined."
    )
    truth_danger_hours: Metric = Field(
        description="Weighted truth danger hours in the season at this lead: the denominator of POD."
    )
    rows: list[PolicyRow] = Field(description="P0, P1, P2 and P3 at theta_protect and theta_balanced, in that order.")


class SensitivityCell(ArtifactModel):
    """One cell of the always-reported 2 x 2 truth sensitivity: margin {0, 7} x withdrawal limits {off, on}."""

    margin_w_m2: float = Field(description="TWL margin subtracted from the truth TWL, in W/m2 (0 or 7).")
    withdrawal_limits: bool = Field(description="Whether the withdrawal-limit cap was applied to the truth TWL.")
    headline: bool = Field(description="True for the frozen setting (margin 7, withdrawal off): the headline numbers.")
    lead_days: int = Field(description="Lead the cell is scored at (the headline lead, 1).")
    truth_danger_hours: Metric = Field(description="Weighted truth danger hours under this truth definition.")
    rows: list[PolicyRow] = Field(description="Every policy re-scored against this truth definition.")


class PolicyScoreboard(ArtifactModel):
    """The Warnings row (``artifacts/eval/2026/policy_scoreboard.json``)."""

    evaluation_set: EvaluationSet = Field(
        description="`scored_2026` for the pre-registered held-out run; `dev_2025` for the 2025 out-of-fold "
        'development run, which must be labelled "DEV 2025, LOCO out-of-fold: not the result".'
    )
    evaluation_label: str | None = Field(
        default=None,
        description='Words shown with a development file, "DEV 2025, LOCO out-of-fold: not the result"; null for the '
        "scored 2026 file.",
    )
    station: str = Field(description="ICAO id of the demo station the row is computed at (OMAA).")
    season_start: dt.date = Field(description="First local date of the scored season (15 May 2026).")
    season_end: dt.date = Field(description="Last local date of the scored season (30 Sep 2026).")
    working_hours_utc: str = Field(description="Scored working hours, for example `06:00-14:59 UTC (10:00-18:59 GST)`.")
    n_days: int = Field(description="Days in the scored season with all inputs present.")
    ruleset_id: str = Field(description="Frozen ruleset id the zones come from.")
    ruleset_sha256: str = Field(description="SHA-256 of that ruleset, as recorded in the freeze addendum.")
    theta_protect: float = Field(
        description="Frozen warning threshold of the protective P3 policy (pre-registration 6.5)."
    )
    theta_balanced: float = Field(
        description="Frozen warning threshold of the balanced P3 policy (maximum Peirce score)."
    )
    margin_w_m2: float = Field(description="Frozen TWL margin in W/m2 (7).")
    withdrawal_limits: bool = Field(description="Frozen withdrawal-limit switch (off).")
    assumed_crew_size: int = Field(description="Crew size used for worker-hours: 20, ASSUMED, never a measured crew.")
    assumed_crew_label: str = Field(
        description="The words shown next to every worker-hour number, for example `assumed crew of 20`."
    )
    leads: list[LeadResult] = Field(description="One entry per lead 1, 2, 3, 5, 7, in that order.")
    sensitivity: list[SensitivityCell] = Field(
        description="The four cells of the 2 x 2 truth sensitivity, headline cell included."
    )
    verdicts: list[HypothesisVerdict] = Field(description="H4 (primary) and H5 (secondary) at the headline lead.")
    provenance: Provenance = Field(description="Where the numbers in this file came from.")


# --- Plans row (pre-registration 7.3) ----------------------------------------------------------------------------


class PlanRow(ArtifactModel):
    """One plan scored by the independent validator against truth zones (section 7.3)."""

    plan: PlanId = Field(
        description="naive, ban_only, rule_raw (zones from raw IFS) or rule_corrected (q10 of corrected samples)."
    )
    label: str = Field(description="Display name; naive and ban_only share the label `Ban only` (ADR 0057).")
    violation_minutes_per_season: Metric = Field(
        description="Ticks with at least one rule violation times 5 minutes, per worker, over the season."
    )
    high_cycled_share: Metric = Field(
        description="Share of truth-High-or-Red on-shift heavy ticks whose plan zone is High or worse, 0 to 1."
    )
    missed_protection_ticks: Metric = Field(
        description="Worked ticks whose plan zone is milder than the truth zone (5-minute ticks)."
    )
    rest_minutes_added_vs_naive: Metric = Field(
        description="Rest minutes the plan adds compared with naive, per worker-season (SIMULATED)."
    )


class PlanScoreboard(ArtifactModel):
    """The Plans row (``artifacts/eval/2026/plan_scoreboard.json``)."""

    evaluation_set: EvaluationSet = Field(
        description="`scored_2026` for the pre-registered held-out run; `dev_2025` for the 2025 out-of-fold "
        'development run, which must be labelled "DEV 2025, LOCO out-of-fold: not the result".'
    )
    evaluation_label: str | None = Field(
        default=None,
        description='Words shown with a development file, "DEV 2025, LOCO out-of-fold: not the result"; null for the '
        "scored 2026 file.",
    )
    station: str = Field(description="ICAO id of the weather station (OMAA).")
    site_id: str = Field(description="Id of the SIMULATED demo site whose crew is scored (ADR 0057).")
    crew_id: str = Field(description="The one scored crew (crew-b).")
    crew_label: str = Field(
        description="Words shown with the row, for example `SIMULATED crew: 20 experienced adults, heavy work`."
    )
    headcount: int = Field(description="Crew size of the scored crew (20), simulated.")
    roster: str = Field(description="The roster in words, for example `L1: 06:00-11:00 + 15:00-18:00 GST`.")
    season_start: dt.date = Field(description="First local date of the scored season.")
    season_end: dt.date = Field(description="Last local date of the scored season.")
    n_days: int = Field(description="Days in the scored season with all inputs present.")
    ruleset_id: str = Field(description="Frozen ruleset id.")
    ruleset_sha256: str = Field(description="SHA-256 of that ruleset.")
    fixture_sha256: str = Field(description="SHA-256 of `backend/fixtures/demo_site.toml` (frozen, ADR 0057).")
    rows: list[PlanRow] = Field(description="naive, ban_only, rule_raw, rule_corrected, in that order.")
    identical_by_construction: list[PlanId] = Field(
        description="Plan ids whose rows are identical by construction; [naive, ban_only] on L1."
    )
    verdicts: list[HypothesisVerdict] = Field(description="H6 (primary) and H7 (secondary).")
    provenance: Provenance = Field(description="Where the numbers in this file came from.")


# --- Demo day (pre-registration 7.4) -----------------------------------------------------------------------------


class DemoDayHour(ArtifactModel):
    """One working hour of the demo day: the truth, what the raw forecast said, and what each policy did."""

    starts_at: AwareDatetime = Field(description="UTC start of the hour; the hour covers [starts_at, starts_at + 1 h).")
    ban_weight: float = Field(
        description="Non-ban fraction of the hour, 0 to 1 (0.5 for the hour 08:00 UTC, which holds 30 minutes of ban)."
    )
    truth_wbgt_c: float = Field(description="Observed WBGT in degrees Celsius.")
    truth_twl_eff_w_m2: float = Field(description="Effective TWL of the observation in W/m2 (after the margin).")
    truth_zone: ZoneName = Field(description="ADOSH zone of the truth TWL; High and Red are danger hours.")
    raw_wbgt_c: float | None = Field(description="Raw IFS WBGT forecast in degrees Celsius; null when missing.")
    raw_twl_eff_w_m2: float | None = Field(
        description="Effective TWL of the raw IFS forecast in W/m2; null when missing."
    )
    raw_zone: ZoneName | None = Field(description="ADOSH zone of the raw forecast (the P2 basis); null when missing.")
    corrected_wbgt_c: WbgtQuantiles | None = Field(
        description="Corrected WBGT range (5th, 50th, 95th percentile) in degrees Celsius; null when no finite sample."
    )
    p_high: float | None = Field(
        description="P(High or worse) from the corrected joint samples, 0 to 1; null when no finite sample."
    )
    protective_twl_w_m2: float | None = Field(
        description="10th percentile of the corrected effective TWL in W/m2 (the plan quantile)."
    )
    warned_by: list[PolicyId] = Field(description="Policies that warned this hour.")


class RunnerUp(ArtifactModel):
    """The second-best candidate day, kept so the selection can be audited."""

    date: dt.date = Field(description="Local date of the runner-up.")
    score: float = Field(description="Its score under the same rule.")


class DemoDay(ArtifactModel):
    """The demo day (``artifacts/eval/2026/demo_day.json``), chosen on truth alone before any P3 output was read."""

    evaluation_set: EvaluationSet = Field(
        description="`scored_2026` for the pre-registered held-out run; `dev_2025` for the 2025 out-of-fold "
        'development run, which must be labelled "DEV 2025, LOCO out-of-fold: not the result".'
    )
    evaluation_label: str | None = Field(
        default=None,
        description='Words shown with a development file, "DEV 2025, LOCO out-of-fold: not the result"; null for the '
        "scored 2026 file.",
    )
    station: str = Field(description="ICAO id of the demo station (OMAA).")
    date: dt.date = Field(description="Selected local date.")
    score: float = Field(
        description="The pre-registration 7.4 selection score: observed High-zone working hours outside the ban "
        "window, weighted by the non-ban fraction. It equals `high_hours_outside_ban`; it is kept under this name "
        "because it is the quantity the selection rule maximizes."
    )
    high_hours: float = Field(
        description="Observed High-or-Red working hours on the date, ban hours included (demo_high_h)."
    )
    high_hours_outside_ban: float = Field(
        description="High-or-Red working hours outside the ban window, weighted (demo_high_outside_ban_h); "
        "equals `score`."
    )
    raw_hits: float = Field(description="Danger hours the raw-forecast policy P2 warned (demo_raw_hits).")
    p3_hits: float = Field(description="Danger hours P3 at theta_protect warned (demo_p3_hits).")
    candidates: int = Field(description="Number of candidate dates that satisfied the pre-registered conditions.")
    runner_up: RunnerUp | None = Field(description="Second-best candidate; null when there was only one.")
    lead_days: int = Field(description="Lead of the forecasts shown (1).")
    rule: str = Field(description="The selection rule in words (pre-registration 7.4); ties go to the earliest date.")
    hours: list[DemoDayHour] = Field(description="The nine working hours 06:00-14:59 UTC in order.")
    provenance: Provenance = Field(description="Where the numbers in this file came from.")


# --- theta (pre-registration 6.5) --------------------------------------------------------------------------------


class ThetaGridPoint(ArtifactModel):
    """Skill of the P(High) warning at one threshold on the 2024-2025 out-of-fold samples."""

    theta: float = Field(description="Threshold on P(High), from the grid 0.05 to 0.95.")
    pod: float = Field(description="Probability of detection at this threshold, weighted by non-ban fraction.")
    far: float = Field(description="False-alarm ratio at this threshold.")
    pss: float = Field(description="Peirce skill score (POD minus probability of false detection).")
    n_hours: int = Field(description="Number of hours behind the point.")


class ThetaDecision(ArtifactModel):
    """The warning thresholds chosen by the pre-registered rule (``artifacts/eval/dev/theta.json``)."""

    theta_protect: float = Field(description="Largest theta with POD >= 0.90; 0.05 when none reaches it.")
    theta_balanced: float = Field(description="Theta with the maximum Peirce score; ties go to the smaller theta.")
    grid: list[ThetaGridPoint] = Field(description="Every grid point, ascending in theta.")
    red_hour_share: float = Field(
        description="Weighted share of truth hours in Red, 0 to 1 (information only, ADR 0046)."
    )
    n_hours: int = Field(description="Hours in the 2024-2025 selection set.")
    rule: Literal["preregistration §6.5"] = Field(description="The rule that produced the thresholds.")
    provenance: Provenance = Field(description="Where the numbers in this file came from.")
