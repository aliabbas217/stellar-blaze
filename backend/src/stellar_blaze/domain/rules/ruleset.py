"""Versioned rules as data: the schema of a ruleset file (ADR 0009 section 1, amended by ADR 0010).

A ruleset is the part of the system a regulator, an employer or a guideline edition could change without the science
changing: ADOSH zone edges, the withdrawal-limit switch and values, NIOSH Table 3-2 clothing adjustments. Physics
(the REL and RAL equations, Liljegren, the TWL solver) stays in code. Every model is frozen, forbids unknown keys and
rejects NaN and infinity, so a typo or ``nan`` in a file fails at startup instead of silently disabling a limit.

B3 adds sections (labour windows, alert bands, acclimatization, planner, privacy) and tunables additively, in a new
ruleset id; every new floor field carries a ``Floor`` comparator and every new section derives from ``RulesetSection``.
"""

import re
from datetime import date
from typing import Annotated, ClassVar, Literal, Self

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


class Ruleset(_Model):
    """One versioned ruleset: metadata, cited sources, floors in sections, and the tunables with their ranges."""

    meta: RulesetMeta
    sources: tuple[Source, ...]
    niosh_clothing: ClothingAdjustments
    twl_zones: TwlZones
    twl_withdrawal: WithdrawalLimits
    tunables: dict[str, TunableSpec]

    @model_validator(mode="after")
    def _every_source_is_declared(self) -> Self:
        ids = [s.id for s in self.sources]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            msg = f"duplicate source ids: {duplicates}"
            raise ValueError(msg)
        declared = set(ids)
        cited: dict[str, str] = {
            name: value.source
            for name in type(self).model_fields
            if isinstance(value := getattr(self, name), RulesetSection)
        }
        cited.update({f"tunables.{name}": spec.source for name, spec in self.tunables.items()})
        for where, source in cited.items():
            if source not in declared:
                msg = f"{where} cites source {source!r}, not declared in [[sources]] (declared: {sorted(declared)})"
                raise ValueError(msg)
        return self

    def covers(self, d: date) -> bool:
        """True when ``d`` lies in ``[effective_from, effective_to)``."""
        return self.meta.effective_from <= d and (self.meta.effective_to is None or d < self.meta.effective_to)
