"""Versioned rules as data: the schema of a ruleset file (ADR 0009 section 1, amended by ADR 0010).

A ruleset is the part of the system a regulator, an employer or a guideline edition could change without the science
changing: ADOSH zone edges, the withdrawal-limit switch and values, NIOSH Table 3-2 clothing adjustments. Physics
(the REL and RAL equations, Liljegren, the TWL solver) stays in code. Every model is frozen, forbids unknown keys and
rejects NaN and infinity, so a typo or ``nan`` in a file fails at startup instead of silently disabling a limit.

B3 adds sections (labour windows, ADOSH cycles, acclimatization, workload, privacy, clauses, alert templates) and
tunables additively, in a new ruleset id (``ae-heat-2026.1``); every new floor field carries a ``Floor`` comparator and
every new section derives from ``RulesetSection``. The new sections are typed ``X | None = None`` so that the released
``ae-heat-0.1``, which predates them, still loads; ``Ruleset.require`` is how code that needs one says so.
"""

import re
from datetime import date, time
from types import UnionType
from typing import Annotated, ClassVar, Literal, Self, Union, get_args, get_origin

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from stellar_blaze.domain.physics.niosh import Clothing
from stellar_blaze.domain.rules.floors import Floor

# `ae-heat-2026.1`: jurisdiction, year, serial. `ae-heat-0.1` is the pre-calendar seed ruleset (year part `0`).
RULESET_ID = re.compile(r"^[a-z]{2}-heat-(?:\d{4}|0)\.\d+$")


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class Source(_Model):
    """Where a value was read: a citation that an auditor can follow."""

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    url: str = Field(min_length=1)  # a URL, or a repository path for a document in this repository
    clause: str | None = None
    accessed: date


class RulesetMeta(_Model):
    """Identity, effective range and status of a ruleset."""

    id: str
    effective_from: date
    effective_to: date | None = None  # exclusive; None is open-ended
    status: Literal["draft", "released"]
    jurisdiction: str = Field(min_length=1)
    # Released files are immutable, so a correction is a new file that supersedes the old id.
    supersedes: tuple[str, ...] = ()

    @field_validator("id")
    @classmethod
    def _id_follows_the_naming_scheme(cls, value: str) -> str:
        if not RULESET_ID.fullmatch(value):
            msg = f"id {value!r} must look like 'ae-heat-2026.1' (jurisdiction, year, serial) or the seed 'ae-heat-0.1'"
            raise ValueError(msg)
        return value

    @model_validator(mode="after")
    def _range_is_not_empty_and_supersedes_not_self(self) -> Self:
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            msg = f"effective_to ({self.effective_to}) must be after effective_from ({self.effective_from})"
            raise ValueError(msg)
        if self.id in self.supersedes:
            msg = f"a ruleset cannot supersede itself ({self.id})"
            raise ValueError(msg)
        return self


class RulesetSection(_Model):
    """A section of values with one cited source.

    Every numeric, boolean or window field of a subclass carries a ``Floor`` comparator, or is named in
    ``NON_FLOOR_FIELDS``: a test enforces it for every section of ``Ruleset``.
    """

    NON_FLOOR_FIELDS: ClassVar[frozenset[str]] = frozenset()

    source: str


class ClothingAdjustments(RulesetSection):
    """NIOSH (2016) Table 3-2 adjustments in degrees C WBGT, keyed by ``Clothing`` value (zero for work clothes)."""

    values_c: dict[str, Annotated[float, Floor(safer="higher"), Field(ge=0.0)]]

    @field_validator("values_c")
    @classmethod
    def _keys_are_exactly_the_clothing_ensembles(cls, value: dict[str, float]) -> dict[str, float]:
        expected = {c.value for c in Clothing}
        unknown = sorted(set(value) - expected)
        missing = sorted(expected - set(value))
        if unknown or missing:
            msg = f"values_c must have exactly the Clothing keys; unknown: {unknown}, missing: {missing}"
            raise ValueError(msg)
        return value


class TwlZones(RulesetSection):
    """ADOSH TWL zone edges in W/m2: at or above ``low_min`` is Low risk, down to ``medium_min`` Medium, below High.

    The bias margin is not here: it is a tunable (ADR 0010), so that moving it never touches a legal edge.
    """

    low_min_w_m2: Annotated[float, Floor(safer="higher"), Field(gt=0.0)]
    medium_min_w_m2: Annotated[float, Floor(safer="higher"), Field(gt=0.0)]

    @model_validator(mode="after")
    def _edges_descend(self) -> Self:
        if self.low_min_w_m2 <= self.medium_min_w_m2:
            msg = f"low_min_w_m2 ({self.low_min_w_m2}) must be greater than medium_min_w_m2 ({self.medium_min_w_m2})"
            raise ValueError(msg)
        return self


class WithdrawalLimits(RulesetSection):
    """The withdrawal limits on TWL: a cap that applies in very hot conditions, and the switch that turns it on."""

    enabled: Annotated[bool, Floor(safer="true")]
    dry_bulb_c: Annotated[float, Floor(safer="lower")]
    natural_wet_bulb_c: Annotated[float, Floor(safer="lower")]
    cap_w_m2: Annotated[float, Floor(safer="lower"), Field(gt=0.0)]


def _is_month_day(value: str) -> bool:
    """True for a zero-padded ``MM-DD`` that names a real calendar day (29 February counts: the year is not known)."""
    if not re.fullmatch(r"\d{2}-\d{2}", value):
        return False
    month, day = int(value[:2]), int(value[3:])
    try:
        date(2024, month, day)  # 2024 is a leap year
    except ValueError:
        return False
    return True


class LabourRules(RulesetSection):
    """UAE labour-law and Ministry of Human Resources midday-ban values (ADR 0011 section 4, P-H1 to P-H6).

    Hours are hours, not minutes: the planner multiplies by 12 for 5-minute ticks. The two ``art18_*_counts_as_break``
    switches are PROTECTIVE READINGS (counsel Q1): both are off, and a floor, so no pinned ruleset can switch one on.
    """

    # P-H1 (MR 44/2022 Art. 3): no outdoor work in this local window on the dates of ``ban_season`` (inclusive).
    ban_window: Annotated[tuple[time, time], Floor(safer="wider")]
    ban_season: Annotated[tuple[str, str], Floor(safer="wider")]  # zero-padded "MM-DD", inclusive local dates
    # P-H2 (Decree-Law Art. 17(1), 19(1); Executive Regulations Art. 15).
    normal_hours_per_day: Annotated[float, Floor(safer="lower"), Field(gt=0.0)]
    normal_hours_per_week: Annotated[float, Floor(safer="lower"), Field(gt=0.0)]
    overtime_hours_per_day: Annotated[float, Floor(safer="lower"), Field(ge=0.0)]
    total_hours_per_3_weeks: Annotated[float, Floor(safer="lower"), Field(gt=0.0)]
    # P-H3 (Decree-Law Art. 18).
    art18_max_run_h: Annotated[float, Floor(safer="lower"), Field(gt=0.0)]
    art18_break_h: Annotated[float, Floor(safer="higher"), Field(gt=0.0)]
    art18_ban_gap_counts_as_break: Annotated[bool, Floor(safer="false")]
    art18_adosh_rest_counts_as_break: Annotated[bool, Floor(safer="false")]
    # P-H5 (Decree-Law Art. 5(2)): juveniles.
    juvenile_max_h: Annotated[float, Floor(safer="lower"), Field(gt=0.0)]
    juvenile_max_run_h: Annotated[float, Floor(safer="lower"), Field(gt=0.0)]
    juvenile_window: Annotated[tuple[time, time], Floor(safer="narrower")]
    # P-H6 (Executive Regulations Art. 15(2)): normal hours are reduced by this much in Ramadan.
    ramadan_reduction_h: Annotated[float, Floor(safer="higher"), Field(ge=0.0)]

    @model_validator(mode="after")
    def _windows_are_ordered_and_seasons_are_dates(self) -> Self:
        for name in ("ban_window", "juvenile_window"):
            start, end = getattr(self, name)
            if start >= end:
                msg = f"{name} must start before it ends, got ({start}, {end})"
                raise ValueError(msg)
        start_day, end_day = self.ban_season
        for day in (start_day, end_day):
            if not _is_month_day(day):
                msg = f"ban_season entries must be zero-padded MM-DD calendar days, got {day!r}"
                raise ValueError(msg)
        if start_day > end_day:
            msg = f"ban_season must not run past the end of the year, got ({start_day}, {end_day})"
            raise ValueError(msg)
        return self


class AdoshCycles(RulesetSection):
    """ADOSH Technical Guideline Table 1 work/rest cycles in minutes (ADR 0011 section 2, P-H7).

    Low zone has no imposed cycle; Medium has one for heavy work only; High has one for light and one for heavy work.
    Moderate work uses the heavy column (ADR 0046 decision 6, a PROTECTIVE READING and a floor).
    """

    medium_heavy_work_min: Annotated[int, Floor(safer="lower"), Field(gt=0)]
    medium_heavy_rest_min: Annotated[int, Floor(safer="higher"), Field(gt=0)]
    high_light_work_min: Annotated[int, Floor(safer="lower"), Field(gt=0)]
    high_light_rest_min: Annotated[int, Floor(safer="higher"), Field(gt=0)]
    high_heavy_work_min: Annotated[int, Floor(safer="lower"), Field(gt=0)]
    high_heavy_rest_min: Annotated[int, Floor(safer="higher"), Field(gt=0)]
    moderate_uses_heavy: Annotated[bool, Floor(safer="true")]
    # Table 1: "Working alone to be avoided" (Medium), "No person to work alone" (High): at least this many.
    lone_work_min_headcount: Annotated[int, Floor(safer="higher"), Field(ge=2)]


REACCLIMATISATION_BANDS = ("lt4", "4-5", "6-12", "12-20", "gt20")  # days away; the Technical Guideline section 3 rows


class Acclimatisation(RulesetSection):
    """Technical Guideline section 3: the share of the full assignment a worker may do, by day (ADR 0011, P-H8).

    A lower percentage is more protective. ``reacclimatisation_pct`` is flattened to ``"<band>.<day>"`` because a
    floor table is one level deep; the bands are the days-away rows of the guideline (``REACCLIMATISATION_BANDS``).
    """

    new_ramp_pct: dict[str, Annotated[int, Floor(safer="lower"), Field(ge=1, le=100)]]
    experienced_ramp_pct: dict[str, Annotated[int, Floor(safer="lower"), Field(ge=1, le=100)]]
    reacclimatisation_pct: dict[str, Annotated[int, Floor(safer="lower"), Field(ge=1, le=100)]]
    # "Unacclimatised" = new, or away more than this many days (a smaller number protects more people).
    unacclimatised_after_days_away: Annotated[int, Floor(safer="lower"), Field(gt=0)]
    # Heavy work only after this many days (the protective end of CoP 3.2(b)(i) "5-7 days").
    heavy_work_after_days: Annotated[int, Floor(safer="higher"), Field(gt=0)]

    @field_validator("new_ramp_pct", "experienced_ramp_pct")
    @classmethod
    def _ramps_are_days_one_to_five(cls, value: dict[str, int]) -> dict[str, int]:
        if set(value) != {"1", "2", "3", "4", "5"}:
            msg = f"a ramp must have exactly the days '1' to '5', got {sorted(value)}"
            raise ValueError(msg)
        return value

    @field_validator("reacclimatisation_pct")
    @classmethod
    def _keys_are_band_dot_day_with_consecutive_days(cls, value: dict[str, int]) -> dict[str, int]:
        days: dict[str, list[int]] = {}
        for key in value:
            band, _, day = key.rpartition(".")
            if band not in REACCLIMATISATION_BANDS or not day.isdecimal():
                msg = f"reacclimatisation_pct key {key!r} must be '<band>.<day>' with band in {REACCLIMATISATION_BANDS}"
                raise ValueError(msg)
            days.setdefault(band, []).append(int(day))
        missing = [band for band in REACCLIMATISATION_BANDS if band not in days]
        gaps = [band for band, found in days.items() if sorted(found) != list(range(1, len(found) + 1))]
        if missing or gaps:
            msg = f"reacclimatisation_pct needs every band with days 1..n; missing bands: {missing}, gaps in: {gaps}"
            raise ValueError(msg)
        return value


class Workload(RulesetSection):
    """Metabolic rate in watts per workload class (the values of ADR 0006); a higher rate is more protective."""

    metabolic_w: dict[str, Annotated[float, Floor(safer="higher"), Field(gt=0.0)]]

    @field_validator("metabolic_w")
    @classmethod
    def _keys_are_the_workload_classes(cls, value: dict[str, float]) -> dict[str, float]:
        if set(value) != {"light", "moderate", "heavy"}:
            msg = f"metabolic_w must have exactly light, moderate and heavy, got {sorted(value)}"
            raise ValueError(msg)
        return value


class Privacy(RulesetSection):
    """Small-cell suppression floors by data class (ADR 0050, ADR 0011 section 7.6): a tunable may not go below them."""

    k_health_floor: Annotated[int, Floor(safer="higher"), Field(ge=1)]
    k_exposure_floor: Annotated[int, Floor(safer="higher"), Field(ge=1)]


class ClauseRef(_Model):
    """The clause behind one planner or validator rule: a declared source id and the clause as cited."""

    source: str = Field(min_length=1)
    clause: str = Field(min_length=1)


# The rule ids the planner and the validator cite (ADR 0011 section 4, plus the policy stops and the fallback).
REQUIRED_CLAUSE_IDS = frozenset(
    {
        "P-H1",
        "P-H1a",
        "P-H2.daily",
        "P-H2.weekly",
        "P-H3",
        "P-H4",
        "P-H5.hours",
        "P-H5.run",
        "P-H5.window",
        "P-H5.ban_season",
        "P-H7.cap60",
        "P-H7.run",
        "P-H7.lone",
        "P-H7.unacclimatised",
        "P-H8.ramp",
        "P-H8.heavy7",
        "P-H10",
        "STOP.red",
        "STOP.no_acclimatised",
        "FALLBACK.high",
    }
)


class Clauses(RulesetSection):
    """Rule id to the clause that backs it. Citations, not floors: ``entries`` has no comparator."""

    NON_FLOOR_FIELDS: ClassVar[frozenset[str]] = frozenset({"entries"})

    entries: dict[str, ClauseRef]

    @model_validator(mode="after")
    def _every_rule_id_has_an_entry(self) -> Self:
        missing = sorted(REQUIRED_CLAUSE_IDS - set(self.entries))
        if missing:
            msg = f"clauses.entries lacks the rule ids {missing}"
            raise ValueError(msg)
        return self


ALERT_LEVELS = ("green", "amber", "orange", "red")


class AlertCatalog(RulesetSection):
    """Alert template ids and the action codes shown at each level (ADR 0058). Content, not floors."""

    NON_FLOOR_FIELDS: ClassVar[frozenset[str]] = frozenset({"template_ids", "action_codes_by_level"})

    template_ids: tuple[str, ...] = Field(min_length=1)
    action_codes_by_level: dict[str, tuple[str, ...]]

    @field_validator("action_codes_by_level")
    @classmethod
    def _every_level_has_actions(cls, value: dict[str, tuple[str, ...]]) -> dict[str, tuple[str, ...]]:
        if set(value) != set(ALERT_LEVELS) or not all(value.values()):
            msg = f"action_codes_by_level needs exactly {ALERT_LEVELS}, each with at least one code, got {value}"
            raise ValueError(msg)
        return value


class TunableSpec(_Model):
    """A runtime-tunable value: its ruleset default and the reviewed range a live change must stay inside."""

    source: str
    default: float
    min: float
    max: float
    # Which end of the range is more protective: "higher", "lower", or "none". Informational; the golden file pins it.
    safer: Literal["higher", "lower", "none"]

    @model_validator(mode="after")
    def _default_lies_in_the_range(self) -> Self:
        if not self.min <= self.default <= self.max:
            msg = f"need min <= default <= max, got min={self.min}, default={self.default}, max={self.max}"
            raise ValueError(msg)
        return self


class RulesetIncompleteError(LookupError):
    """A ruleset lacks a section the caller needs: it is older than the feature (``ae-heat-0.1`` has no ``labour``)."""


def section_type(annotation: object) -> type[RulesetSection] | None:
    """The section class an annotation names: ``X`` or ``X | None`` with ``X`` a ``RulesetSection``; else ``None``."""
    if isinstance(annotation, type) and issubclass(annotation, RulesetSection):
        return annotation
    if get_origin(annotation) in (Union, UnionType):
        arguments = [a for a in get_args(annotation) if a is not type(None)]
        if len(arguments) == 1:
            return section_type(arguments[0])
    return None


class Ruleset(_Model):
    """One versioned ruleset: metadata, cited sources, floors in sections, and the tunables with their ranges.

    Every field except those in ``NON_SECTION_FIELDS`` is a ``RulesetSection``, or ``None`` for a section that an older
    ruleset predates: the source check, the golden file and the floor comparison all work on sections, so a value
    field of any other shape (a table or tuple of sections, a bare model) would escape all three, and is refused here
    and by a structural test. A section absent from a ruleset is ``None``, never a default: code that needs one calls
    ``require``.
    """

    # The fields that are not value sections: identity, citations, and the tunables (which have ranges, not floors).
    NON_SECTION_FIELDS: ClassVar[frozenset[str]] = frozenset({"meta", "sources", "tunables"})

    meta: RulesetMeta
    sources: tuple[Source, ...]
    niosh_clothing: ClothingAdjustments
    twl_zones: TwlZones
    twl_withdrawal: WithdrawalLimits
    tunables: dict[str, TunableSpec]

    # B3 sections (ae-heat-2026.1). None on a ruleset that predates them, so the released ae-heat-0.1 still loads.
    labour: LabourRules | None = None
    adosh_cycles: AdoshCycles | None = None
    acclimatisation: Acclimatisation | None = None
    workload: Workload | None = None
    privacy: Privacy | None = None
    clauses: Clauses | None = None
    alerts: AlertCatalog | None = None

    @model_validator(mode="after")
    def _every_source_is_declared(self) -> Self:
        ids = [s.id for s in self.sources]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            msg = f"duplicate source ids: {duplicates}"
            raise ValueError(msg)
        declared = set(ids)
        cited: dict[str, str] = {}
        for name, info in type(self).model_fields.items():
            if name in self.NON_SECTION_FIELDS:
                continue
            if section_type(info.annotation) is None:
                msg = f"{name} is neither a RulesetSection nor listed in NON_SECTION_FIELDS"
                raise ValueError(msg)
            section = getattr(self, name)
            if section is not None:
                cited[name] = section.source
        cited.update({f"tunables.{name}": spec.source for name, spec in self.tunables.items()})
        if self.clauses is not None:
            cited.update({f"clauses.entries.{rule}": ref.source for rule, ref in self.clauses.entries.items()})
        for where, source in cited.items():
            if source not in declared:
                msg = f"{where} cites source {source!r}, not declared in [[sources]] (declared: {sorted(declared)})"
                raise ValueError(msg)
        return self

    def require(self, *names: str) -> None:
        """Check that every named section is present.

        Raises:
            RulesetIncompleteError: A named section is ``None`` (this ruleset predates it).
            ValueError: A name is not a field of ``Ruleset``.
        """
        unknown = [name for name in names if name not in type(self).model_fields]
        if unknown:
            msg = f"not a ruleset field: {unknown}"
            raise ValueError(msg)
        missing = [name for name in names if getattr(self, name) is None]
        if missing:
            raise RulesetIncompleteError(f"ruleset {self.meta.id} has no section {', '.join(missing)}")

    def covers(self, d: date) -> bool:
        """True when ``d`` lies in ``[effective_from, effective_to)``."""
        return self.meta.effective_from <= d and (self.meta.effective_to is None or d < self.meta.effective_to)
