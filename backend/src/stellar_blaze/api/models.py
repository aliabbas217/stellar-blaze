"""Request and response bodies of the ``/api/v1`` contract (ADR 0051 and its 2026-11-14 amendments).

This module is the wire contract: ``backend/openapi/v1.json`` is generated from it and F2's TypeScript client is
generated from that file. After the v1 freeze only additive changes are allowed, so every field below is final.

Conventions, all of them part of the contract:
- Every instant is timezone-aware UTC (``Z`` on the wire). Every ``date`` and ``HH:MM`` is local to the site's
  ``timezone`` (Asia/Dubai for the demo site) unless the field says otherwise.
- Every body forbids unknown members. No model carries a per-member value or a personal level (ADR 0004, ADR 0050):
  the one member-like name in a request is ``DataRequestCreate.worker_ref``, which is write-only and never stored.
- A response field that is always sent is ``required`` in the schema, even when its value may be null.
- Each model carries one ``examples`` entry built from the demo fixture of ADR 0057 (site ``site-demo-mussafah``,
  crew-b, 2026-07-01, ``config_version`` 1); a unit test validates every example against its own model.
"""

import datetime as dt
from enum import StrEnum
from typing import Annotated, Any, ClassVar, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    GetJsonSchemaHandler,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.config import JsonDict
from pydantic.json_schema import JsonSchemaValue
from pydantic.types import JsonValue
from pydantic_core import CoreSchema

from stellar_blaze.api.push_validation import check_endpoint, check_expiration, check_key
from stellar_blaze.api.schemas import ResponseModel
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.domain.scoreboard import WbgtQuantiles
from stellar_blaze.errors import REVIEW_REQUIRED, ROSTER_INVALID, SHIFT_NOT_LEGAL, Problem

Level = AlertLevel
"""The heat level code of every wire contract: ``green``, ``amber``, ``orange``, ``red`` (never colour alone)."""

HHMM = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
MMDD = Annotated[str, StringConstraints(pattern=r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")]
PhoneNumber = Annotated[str, StringConstraints(pattern=r"^\+[1-9][0-9]{6,14}$")]
EntityId = Annotated[str, StringConstraints(min_length=1, max_length=100)]
Workload = Literal["light", "moderate", "heavy"]
SignoffState = Literal["unsigned", "signed", "changed_since_signed"]
PlanStatus = Literal["rule", "fallback"]
ForecastStatus = Literal["fresh", "stale", "fallback"]
ForecastMode = Literal["replay", "live"]

SITE_ID = "site-demo-mussafah"
CREW_ID = "crew-b"
REQUEST_ID = "00000000-0000-4000-8000-000000000001"
POLICY_VERSION = "ae-heat-2026.1"
MODEL_ID = "corrector-20261112-0000000-000001"
# Synthetic, low-entropy placeholders with the real lengths (87 and 22 base64url characters), not real keys.
P256DH_EXAMPLE = "B" + "A" * 86
AUTH_EXAMPLE = "A" * 22
BAN: JsonDict = {
    "start": "12:30",
    "end": "15:00",
    "season_start": "06-15",
    "season_end": "09-15",
    "timezone": "Asia/Dubai",
    "active_on_date": True,
    "starts_at": "2026-07-01T08:30:00Z",
    "ends_at": "2026-07-01T11:00:00Z",
}


BAN_WINDOW_DESCRIPTION = (
    "The midday ban in force at the site, as data. The values come from the ruleset in force "
    "(`labour.ban_window`, `labour.ban_season`); no client carries them as constants. `active_on_date` is for this "
    "response's own date. The object is always present: check `active_on_date` (and the null instants), never a null "
    "object."
)


MODE_DESCRIPTION = (
    "Whether the day was computed against the live clock and live forecasts or the fixed replay snapshot."
)
BANNER_DESCRIPTION = (
    'Always present on every plan payload: the client shows the floor banner ("Green is not permission to extend '
    'work. Legal and ADOSH minimums still apply. Advisory only; the employer remains the duty-holder.").'
)


EPOCH_SEMANTICS = (
    "A reset starts a new epoch (`epoch_id` increases by one). Plans, sign-offs, stop events, data requests, alert "
    "events and push subscriptions are scoped to the current epoch and resolved server-side; the audit chain is not "
    "epoch-scoped and records `demo_reset` (not visible to workers). Nothing is deleted."
)


class PlanState(StrEnum):
    """What a crew does in a stretch of the day (wire values of the planner's tick states)."""

    WORK = "work"
    ADOSH_REST = "adosh_rest"
    ART18_BREAK = "art18_break"
    BAN = "ban"
    STOPPED = "stopped"
    OFF = "off"


class PlanZone(StrEnum):
    """ADOSH heat zone of the effective TWL: Low, Medium, High, and Red (stop work, ADR 0046)."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    RED = "red"


class ApiRequest(BaseModel):
    """Base of every request body: unknown members are a 422, never silently ignored."""

    model_config = ConfigDict(extra="forbid")


class ApiResponse(ResponseModel):
    """Base of every response body: always-sent fields are ``required``; unknown members are forbidden."""

    model_config = ConfigDict(extra="forbid")


class OptionalMemberResponse(ApiResponse):
    """A response whose members named in ``wire_optional`` stay OPTIONAL in the OpenAPI schema (additive evolution).

    ``ResponseModel`` marks every field required, which is right for a member the contract always carries and wrong for
    one added later: a required new member is not additive for a generated client. A member listed here is declared
    ``X | None = None`` on the model; the API still always sends it, the schema leaves it out of ``required`` and shows
    the plain type (no ``null`` variant, no ``default``: present means a real value).
    """

    wire_optional: ClassVar[frozenset[str]] = frozenset()

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler) -> JsonSchemaValue:
        schema = handler.resolve_ref_schema(handler(core_schema))
        required = schema.get("required")
        if isinstance(required, list):
            schema["required"] = [name for name in required if name not in cls.wire_optional]
        properties = schema.get("properties", {})
        for name in cls.wire_optional:
            member = properties.get(name)
            if not isinstance(member, dict):
                continue
            variants = [v for v in member.get("anyOf", []) if v != {"type": "null"}]
            if len(variants) == 1:
                member.pop("anyOf")
                member.pop("default", None)
                member.update(variants[0])
        return schema


# --- sites, forecast, policy --------------------------------------------------------------------------------------


class Site(ApiResponse):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "id": SITE_ID,
                    "name": "Mussafah M-14 yard (synthetic)",
                    "timezone": "Asia/Dubai",
                    "synthetic": True,
                    "epoch_id": 1,
                    "supervisor_phone": "+12025550143",
                    "first_aider_phone": "+12025550144",
                }
            ]
        }
    )

    id: str
    name: str
    timezone: str = Field(description="IANA time zone of the site. Every local date and time of the API is in it.")
    synthetic: bool = Field(description="True for demo data. Only a synthetic site can be reset (`reset_demo_site`).")
    epoch_id: int | None = Field(
        description="Current demo epoch of a synthetic site (1 or more); null for a site that is not synthetic. "
        "Plans, sign-offs, stop events, data requests, alert events and push subscriptions are scoped to one epoch "
        "and resolved server-side; `reset_demo_site` starts the next."
    )
    supervisor_phone: PhoneNumber | None = Field(
        description="Site supervisor's number in E.164, for the worker's one-tap `tel:` call; null when the site has "
        "none. SYNTHETIC numbers from the site fixture config. Nothing is logged or sent when a worker calls, and no "
        "health data reaches any dashboard (CoP 3.1.2(e): workers report symptoms to their supervisor). Not personal "
        "data of a worker."
    )
    first_aider_phone: PhoneNumber | None = Field(
        description="Site first aider's number in E.164, for the same one-tap `tel:` call; null when the site has "
        "none. "
        "SYNTHETIC, from the site fixture config. Nothing is logged or sent when a worker calls."
    )


class BanWindow(ApiResponse):
    """The midday outdoor-work ban as data, so no client carries its constants."""

    model_config = ConfigDict(json_schema_extra={"examples": [BAN]})

    start: HHMM = Field(description="Site-local start of the daily ban, `HH:MM` (12:30).")
    end: HHMM = Field(description="Site-local end of the daily ban, `HH:MM`, exclusive (15:00).")
    season_start: MMDD = Field(description="First local date of the ban season, `MM-DD`, inclusive (06-15).")
    season_end: MMDD = Field(description="Last local date of the ban season, `MM-DD`, inclusive (09-15).")
    timezone: str = Field(description="IANA time zone `start`, `end` and the season dates are in.")
    active_on_date: bool = Field(description="True when the ban applies on the date of the response that carries it.")
    starts_at: AwareDatetime | None = Field(
        description="UTC instant the ban starts on the response's own date; null when `active_on_date` is false."
    )
    ends_at: AwareDatetime | None = Field(
        description="UTC instant the ban ends (exclusive) on the response's own date; null when "
        "`active_on_date` is false."
    )


_HOUR_EXAMPLE: JsonDict = {
    "starts_at": "2026-07-01T06:00:00Z",
    "wbgt_c": {"p05": 30.1, "p50": 32.4, "p95": 34.0},
    "site_level": "orange",
    "action_codes": ["rest_in_shade", "water_every_15_min"],
    "ban_active": False,
}


class HourForecast(ApiResponse):
    model_config = ConfigDict(json_schema_extra={"examples": [_HOUR_EXAMPLE]})

    starts_at: AwareDatetime = Field(description="UTC start of the hour; the hour covers [starts_at, starts_at + 1 h).")
    wbgt_c: WbgtQuantiles = Field(description="Corrected WBGT range of the hour, degrees Celsius.")
    site_level: Level | None = Field(
        description="The site's warning level for the hour (ADR 0046). Null when no usable forecast exists for the "
        "hour: "
        "treat it as the most protective workable plan (ADR 0058)."
    )
    action_codes: list[str] = Field(description="Ruleset action codes for the level; the client holds the words.")
    ban_active: bool = Field(description="True when the midday work ban is in force for any part of this hour.")


class SiteForecastToday(ApiResponse):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "site_id": SITE_ID,
                    "date": "2026-07-01",
                    "generated_at": "2026-06-30T14:00:00Z",
                    "policy_version": POLICY_VERSION,
                    "config_version": 1,
                    "mode": "replay",
                    "forecast_status": "fresh",
                    "model_id": MODEL_ID,
                    "lead_days": 1,
                    "ban_window": BAN,
                    "hours": [_HOUR_EXAMPLE],
                }
            ]
        }
    )

    site_id: str
    date: dt.date = Field(description="The site-local date the hours belong to.")
    generated_at: AwareDatetime = Field(
        description="UTC issue time of the forecast run behind the response; with no run at all, the time the response "
        "was computed."
    )
    policy_version: str = Field(
        description="Id of the ruleset in force (`ae-heat-<year>.<n>`). Shown verbatim, never parsed."
    )
    config_version: int = Field(
        description="Id of the active runtime configuration; 0 when the API runs without a database configuration."
    )
    mode: ForecastMode = Field(
        description="`replay` serves a fixed snapshot (never stale); `live` serves the newest run."
    )
    forecast_status: ForecastStatus = Field(
        description="`fresh`; `stale` (older than the stale limit, shown anyway); `fallback` (no usable forecast)."
    )
    model_id: str | None = Field(description="Id of the corrector model behind the numbers; null in fallback.")
    lead_days: int = Field(description="Forecast lead in days the run was issued ahead of the date.")
    ban_window: BanWindow = Field(description=BAN_WINDOW_DESCRIPTION)
    hours: list[HourForecast] = Field(description="Working-day hours in time order (06:00-19:00 site-local).")


class RiskBand(ApiResponse):
    level: Level = Field(description="The personal level the band starts at.")
    min_exceedance_probability: float = Field(
        description="Smallest probability of exceeding the NIOSH limit, 0 to 0.95, at which the level applies; "
        "a probability equal to the minimum takes the level (ADR 0049)."
    )


class WorkloadClass(ApiResponse):
    code: Workload = Field(description="Workload class code.")
    metabolic_rate_w: float = Field(description="Metabolic rate of the class in watts, used on the device.")


class ClothingOption(ApiResponse):
    code: str = Field(description="Clothing option code; the client holds the words.")
    adjustment_c: float = Field(description="WBGT adjustment in degrees Celsius added for this clothing.")
    source: str = Field(description="Where the adjustment comes from.")


class RiskPolicy(ApiResponse):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "version": POLICY_VERSION,
                    "config_version": 1,
                    "k_suppression": 5,
                    "k_health": 10,
                    "acclimatisation_days_required": 7,
                    "bands": [
                        {"level": "green", "min_exceedance_probability": 0.0},
                        {"level": "amber", "min_exceedance_probability": 0.1},
                        {"level": "orange", "min_exceedance_probability": 0.5},
                        {"level": "red", "min_exceedance_probability": 0.9},
                    ],
                    "workload_classes": [
                        {"code": "light", "metabolic_rate_w": 180.0},
                        {"code": "moderate", "metabolic_rate_w": 300.0},
                        {"code": "heavy", "metabolic_rate_w": 415.0},
                    ],
                    "clothing_options": [
                        {"code": "work_clothes", "adjustment_c": 0.0, "source": "ACGIH TLV clothing table"},
                        {"code": "double_layer_woven", "adjustment_c": 3.0, "source": "ACGIH TLV clothing table"},
                    ],
                }
            ]
        }
    )

    version: str = Field(description="Id of the ruleset in force. Shown verbatim, never parsed.")
    config_version: int = Field(
        description="Must equal the forecast's `config_version` before the device computes a level."
    )
    k_suppression: int = Field(
        description="Smallest crew size whose aggregates are shown (`k_exposure`, floor 5; ADR 0050)."
    )
    k_health: int = Field(
        description="Smallest count of any health-related figure that may be shown (floor 10; ADR 0050)."
    )
    acclimatisation_days_required: int = Field(
        description="Days of heat work before the device stops using the recommended alert limit (ADR 0049)."
    )
    bands: list[RiskBand] = Field(description="Ascending by probability; the first is green at 0.")
    workload_classes: list[WorkloadClass] = Field(description="The three workload classes and their metabolic rates.")
    clothing_options: list[ClothingOption] = Field(description="Clothing choices and their WBGT adjustments.")


# --- crews, timeline, day plan ------------------------------------------------------------------------------------


class ShiftWindow(ApiResponse):
    start: HHMM = Field(description="Site-local start of a published shift block, `HH:MM`.")
    end: HHMM = Field(description="Site-local end of the block, `HH:MM`, exclusive.")


class Crew(ApiResponse):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "id": CREW_ID,
                    "site_id": SITE_ID,
                    "name": "Crew B",
                    "task_label": "Concrete pour",
                    "workload": "heavy",
                    "member_count": 20,
                    "shift": [{"start": "06:00", "end": "11:00"}, {"start": "15:00", "end": "18:00"}],
                    "signoff_state": "unsigned",
                    "plan_status": "rule",
                    "stopped": False,
                    "active_stop_id": None,
                    "stopped_at": None,
                }
            ]
        }
    )

    id: str
    site_id: str
    name: str
    task_label: str = Field(description="What the crew does, for example `Concrete pour`.")
    workload: Workload = Field(description="The crew's workload class; ADOSH Table 1 cycles follow it.")
    member_count: int = Field(description="Head count of the crew. An aggregate; the crew is suppressed below `k`.")
    shift: list[ShiftWindow] = Field(
        description="The published shift blocks, site-local; work outside them is never planned."
    )
    signoff_state: SignoffState = Field(
        description="Sign-off of the plan for the response date: `unsigned`; `signed`; or `changed_since_signed` (a "
        "plan was signed earlier that day and the current rule plan differs from the signed one)."
    )
    plan_status: PlanStatus = Field(
        description="Status of the plan for the response date: `rule` (from the forecast) or `fallback` (no fresh "
        "forecast: protective plan)."
    )
    stopped: bool = Field(
        description="True while a crew-lead stop is active at the time of the response. Equivalent to "
        "`active_stop_id` being non-null."
    )
    active_stop_id: str | None = Field(
        description="Id of the active stop, to pass to `delete_crew_stop` after a reload; null when `stopped` is false."
    )
    stopped_at: AwareDatetime | None = Field(
        description="UTC time the active stop was recorded; null when `stopped` is false."
    )


_CREW_HOUR_EXAMPLE: JsonDict = {"starts_at": "2026-07-01T06:00:00Z", "crew_level": "orange", "ban_active": False}


class CrewHour(ApiResponse):
    model_config = ConfigDict(json_schema_extra={"examples": [_CREW_HOUR_EXAMPLE]})

    starts_at: AwareDatetime = Field(description="UTC start of the hour; the hour covers [starts_at, starts_at + 1 h).")
    crew_level: Level | None = Field(
        description="The crew's level for this hour: the site level, raised to red by a crew-lead stop. Derived only "
        "from "
        "server-held inputs for the site and the crew, never from personal risk reported by a device (ADR 0004: "
        "personal risk is never sent to the server). It carries no member-derived information, which is why it is also "
        "returned for a suppressed crew. Null when there is no data."
    )
    ban_active: bool = Field(description="True when the midday work ban is in force for any part of this hour.")


class TimeRange(ApiResponse):
    starts_at: AwareDatetime = Field(description="UTC start of the range.")
    ends_at: AwareDatetime = Field(description="UTC end of the range, exclusive.")


class CrewTimeline(OptionalMemberResponse):
    wire_optional = frozenset({"mode"})
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "crew_id": CREW_ID,
                    "crew_name": "Crew B",
                    "site_id": SITE_ID,
                    "date": "2026-07-01",
                    "suppressed": False,
                    "k": 5,
                    "forecast_status": "fresh",
                    "signoff_state": "unsigned",
                    "shift": [
                        {"starts_at": "2026-07-01T02:00:00Z", "ends_at": "2026-07-01T07:00:00Z"},
                        {"starts_at": "2026-07-01T11:00:00Z", "ends_at": "2026-07-01T14:00:00Z"},
                    ],
                    "ban_window": BAN,
                    "hours": [_CREW_HOUR_EXAMPLE],
                    "mode": "replay",
                }
            ]
        }
    )

    crew_id: str
    crew_name: str
    site_id: str
    date: dt.date = Field(description="The site-local date the hours belong to.")
    suppressed: bool = Field(
        description="True when the crew has fewer than k members. Suppression withholds member-derived fields only "
        "(the restricted head count of the day plan); `crew_level` carries no member-derived information and is "
        "returned either way. Nothing in the response may single out a member."
    )
    k: int = Field(description="The suppression threshold in force (`k_exposure`, ADR 0050).")
    forecast_status: ForecastStatus = Field(
        description="`fresh`, `stale` (shown anyway, label it) or `fallback` (no usable forecast; hours may be null)."
    )
    signoff_state: SignoffState = Field(
        description="Sign-off of the crew's plan for this date: `unsigned`, `signed` or `changed_since_signed`."
    )
    shift: list[TimeRange] = Field(
        description="The crew's published shift blocks on this date as UTC instants, in time order."
    )
    ban_window: BanWindow = Field(description=BAN_WINDOW_DESCRIPTION)
    hours: list[CrewHour] = Field(description="Working-day hours in time order (06:00-19:00 site-local).")
    mode: ForecastMode | None = Field(default=None, description=MODE_DESCRIPTION)


class PlanSegment(ApiResponse):
    starts_at: AwareDatetime = Field(description="UTC start of the segment.")
    ends_at: AwareDatetime = Field(description="UTC end of the segment, exclusive; equals the next segment's start.")
    state: PlanState = Field(description="What the crew does in this segment.")
    zone: PlanZone | None = Field(
        description="ADOSH zone of the segment; null for `off` and for a segment with no zone data."
    )
    rule_id: str = Field(description="Id of the rule that produced the segment, for example `P-H7.cap60`.")
    clause: str = Field(description="Text of the legal or policy clause behind the rule, from the ruleset.")


class Violation(ApiResponse):
    rule_id: str = Field(description="Id of the violated rule, for example `P-H3`.")
    clause: str = Field(description="Text of the clause the rule comes from, from the ruleset.")
    source_id: str = Field(description="Id of the legal or policy source of the clause.")
    ranges: list[TimeRange] = Field(description="Where the plan violates the rule, in time order.")
    detail: str = Field(description="What the plan does wrong, in one sentence.")


class ValidatorResult(ApiResponse):
    passed: bool = Field(description="True when no rule is violated.")
    violations: list[Violation] = Field(description="Violated rules; empty when `passed`.")
    checked_rules: list[str] = Field(description="Every rule the validator evaluated, including the ones that passed.")


class ZoneHour(ApiResponse):
    starts_at: AwareDatetime = Field(description="UTC start of the hour.")
    zone: PlanZone | None = Field(
        description="ADOSH zone of the hour at the protective quantile; null with no forecast."
    )
    level: Level | None = Field(description="Warning level of the hour; null with no forecast.")


class AckItem(ApiResponse):
    """One acknowledgement tick: a run of consecutive work and ADOSH-rest segments at the same zone above Low."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "id": "high-0600",
                    "zone": "high",
                    "starts_at": "2026-07-01T02:00:00Z",
                    "ends_at": "2026-07-01T03:00:00Z",
                    "text_code": "cycle.high.heavy.20-40",
                }
            ]
        }
    )

    id: str = Field(
        description="Format `<zone>-<HHMM>`: the zone, then the zero-padded 24-hour LOCAL (site time zone) start of "
        "the "
        "run, for example `high-0600` or `medium-1500`. Send it back in `acknowledged_items`."
    )
    zone: Literal["medium", "high", "red"] = Field(description="The zone of the run; Low runs need no acknowledgement.")
    starts_at: AwareDatetime = Field(description="UTC start of the run.")
    ends_at: AwareDatetime = Field(description="UTC end of the run, exclusive.")
    text_code: str = Field(
        description="Ruleset action code of the run's cycle for the crew's workload and the run's zone, for example "
        "`cycle.medium.heavy.45-15` or `cycle.high.heavy.20-40`; the client maps it to copy."
    )


_SEGMENTS_EXAMPLE: list[JsonValue] = [
    {
        "starts_at": "2026-07-01T02:00:00Z",
        "ends_at": "2026-07-01T02:20:00Z",
        "state": "work",
        "zone": "high",
        "rule_id": "P-H7.cycle",
        "clause": "ADOSH Technical Guideline Table 1, High zone, heavy work: 20 minutes of work, 40 minutes of rest.",
    },
    {
        "starts_at": "2026-07-01T02:20:00Z",
        "ends_at": "2026-07-01T03:00:00Z",
        "state": "adosh_rest",
        "zone": "high",
        "rule_id": "P-H7.cycle",
        "clause": "ADOSH Technical Guideline Table 1, High zone, heavy work: 20 minutes of work, 40 minutes of rest.",
    },
    {
        "starts_at": "2026-07-01T08:30:00Z",
        "ends_at": "2026-07-01T11:00:00Z",
        "state": "ban",
        "zone": None,
        "rule_id": "P-H1",
        "clause": "Ministerial Resolution 44 of 2022: no outdoor work 12:30-15:00 from 15 June to 15 September.",
    },
]


class DayPlan(OptionalMemberResponse):
    wire_optional = frozenset({"mode"})
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "crew_id": CREW_ID,
                    "date": "2026-07-01",
                    "status": "rule",
                    "signoff_state": "unsigned",
                    "signoff_label_code": "plan.unsigned_fallback",
                    "banner_code": "plan.floor_banner",
                    "segments": _SEGMENTS_EXAMPLE,
                    "zone_hours": [{"starts_at": "2026-07-01T02:00:00Z", "zone": "high", "level": "orange"}],
                    "validator": {
                        "passed": True,
                        "violations": [],
                        "checked_rules": ["P-H1", "P-H2.daily", "P-H3", "P-H7.cap60", "P-H7.run", "STOP.red"],
                    },
                    "ack_items": [
                        {
                            "id": "high-0600",
                            "zone": "high",
                            "starts_at": "2026-07-01T02:00:00Z",
                            "ends_at": "2026-07-01T03:00:00Z",
                            "text_code": "cycle.high.heavy.20-40",
                        }
                    ],
                    "suppressed": False,
                    "restricted_headcount": 0,
                    "restrictions": [],
                    "signed_at": None,
                    "signed_by_role": None,
                    "forecast_status": "fresh",
                    "ban_window": BAN,
                    "policy_version": POLICY_VERSION,
                    "config_version": 1,
                    "model_id": MODEL_ID,
                    "mode": "replay",
                }
            ]
        }
    )

    crew_id: str
    date: dt.date = Field(description="The site-local date of the plan.")
    status: PlanStatus = Field(
        description="`rule` from the forecast; `fallback` when the forecast is missing or stale."
    )
    signoff_state: SignoffState = Field(
        description="`unsigned` until a supervisor of the employer signs; `signed`; `changed_since_signed` when a plan "
        "was signed earlier that day and the current rule plan differs from it. Never gates an alert or a stop."
    )
    signoff_label_code: Literal["plan.unsigned_fallback", "plan.changed_since_signed"] | None = Field(
        description="Non-null exactly when `signoff_state` is not `signed`: `plan.unsigned_fallback` for `unsigned`, "
        "`plan.changed_since_signed` for `changed_since_signed`. The client shows the matching label."
    )
    banner_code: Literal["plan.floor_banner"] = Field(description=BANNER_DESCRIPTION)
    segments: list[PlanSegment] = Field(
        description="The plan in time order, merged runs of equal state, zone and rule."
    )
    zone_hours: list[ZoneHour] = Field(description="The zone and level of each hour the plan was made from.")
    validator: ValidatorResult = Field(description="The independent validator's verdict on this plan.")
    ack_items: list[AckItem] = Field(
        description="The acknowledgements a sign-off needs: one per run above Low. Empty on an all-Low day."
    )
    suppressed: bool = Field(description="True when the crew has fewer than k members (ADR 0050).")
    restricted_headcount: int | None = Field(
        description="Crew members limited by acclimatisation, the 7-day heavy-work rule or age rules; null when "
        "`suppressed`."
    )
    restrictions: list[str] = Field(description="Restriction rule ids that apply to some members, without a count.")
    signed_at: AwareDatetime | None = Field(
        description="UTC time of the sign-off; null while `unsigned`; the time of the earlier sign-off when "
        "`changed_since_signed`."
    )
    signed_by_role: Literal["supervisor"] | None = Field(
        description="Role of the signer; null while unsigned. The API never exposes a person's name."
    )
    forecast_status: ForecastStatus = Field(
        description="`fresh`, `stale` or `fallback`; on the latter two the plan is protective."
    )
    ban_window: BanWindow = Field(description=BAN_WINDOW_DESCRIPTION)
    policy_version: str = Field(description="Id of the ruleset the plan was made under.")
    config_version: int = Field(
        description="Active runtime configuration id; 0 when running without a database configuration."
    )
    model_id: str | None = Field(description="Id of the corrector model behind the zones; null in fallback.")
    mode: ForecastMode | None = Field(default=None, description=MODE_DESCRIPTION)


class PlanSignOffRequest(ApiRequest):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"acknowledged_items": ["high-0600"], "deviation_reason_code": None}]}
    )

    acknowledged_items: list[Annotated[str, StringConstraints(min_length=1, max_length=32)]] = Field(
        max_length=40, description="Ids of the `ack_items` the supervisor ticked (`<zone>-<HHMM>`)."
    )
    deviation_reason_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")] | None = Field(
        default=None,
        description="Reason code when the supervisor deviates from the plan: lower-case words joined by underscores.",
    )


class PlanSignOff(ApiResponse):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "crew_id": CREW_ID,
                    "date": "2026-07-01",
                    "signoff_state": "signed",
                    "signed_at": "2026-07-01T01:10:00Z",
                    "signed_by_role": "supervisor",
                    "acknowledged_items": ["high-0600"],
                    "deviation_reason_code": None,
                }
            ]
        }
    )

    crew_id: str
    date: dt.date = Field(description="The site-local date of the signed plan.")
    signoff_state: Literal["signed"] = Field(description="Always `signed` on success.")
    signed_at: AwareDatetime = Field(description="UTC time of the sign-off.")
    signed_by_role: Literal["supervisor"] = Field(
        description="Role of the signer. The API never exposes a person's name, and a worker never signs."
    )
    acknowledged_items: list[str] = Field(description="The ack item ids recorded.")
    deviation_reason_code: str | None = Field(description="The deviation reason recorded; null when none.")


# --- try-a-plan ---------------------------------------------------------------------------------------------------


class PlanCrewInput(ApiRequest):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"workload": "heavy", "headcount": 20, "acclimatised": True, "days_per_week": 6}]
        }
    )

    workload: Workload = Field(description="The hypothetical crew's workload class.")
    headcount: int = Field(ge=1, le=200, description="Head count of the hypothetical crew.")
    acclimatised: bool = Field(
        default=True, description="One flag for the whole hypothetical crew: heat-acclimatised or not."
    )
    days_per_week: int = Field(default=6, ge=1, le=7, description="Working days per week, for the weekly-hours rule.")


class RosterSegmentInput(ApiRequest):
    model_config = ConfigDict(json_schema_extra={"examples": [{"start": "06:00", "end": "11:00", "state": "work"}]})

    start: HHMM = Field(description="Site-local start, `HH:MM`, within 04:00-22:00.")
    end: HHMM = Field(description="Site-local end, `HH:MM`, exclusive, after `start`.")
    state: Literal["work", "rest", "break"] = Field(
        description="`work`, `rest` (ADOSH rest) or `break` (Article 18 break)."
    )


class PlanValidateRequest(ApiRequest):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "site_id": SITE_ID,
                    "date": "2026-07-01",
                    "crew": {"workload": "heavy", "headcount": 20, "acclimatised": True, "days_per_week": 6},
                    "roster_text": "06:00-12:30 work\n15:00-17:00 work",
                    "segments": None,
                }
            ]
        }
    )

    site_id: EntityId = Field(description="Site whose forecast zones the plan is checked against.")
    date: dt.date = Field(description="The site-local date to check the plan on.")
    crew: PlanCrewInput = Field(description="The hypothetical crew the roster is checked for.")
    roster_text: str | None = Field(
        default=None,
        max_length=2000,
        description="The roster as text, one `HH:MM-HH:MM work|rest|break` per line (`#` starts a comment). "
        "Exactly one of `roster_text` and `segments` must be given.",
    )
    segments: list[RosterSegmentInput] | None = Field(
        default=None,
        max_length=40,
        description="The roster as segments (at most 40). Exactly one of `roster_text` and `segments` must be given; "
        "a malformed segment is answered with `roster-invalid`, `line` being its 1-based index.",
    )

    @model_validator(mode="after")
    def _exactly_one_input(self) -> "PlanValidateRequest":
        if (self.roster_text is None) == (self.segments is None):
            msg = "give exactly one of roster_text and segments"
            raise ValueError(msg)
        return self


class PlanValidateResponse(ApiResponse):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "validator": {
                        "passed": False,
                        "violations": [
                            {
                                "rule_id": "P-H3",
                                "clause": "Labour Art. 18: a break of one hour after five hours of work.",
                                "source_id": "ae-labour-art-18",
                                "ranges": [{"starts_at": "2026-07-01T02:00:00Z", "ends_at": "2026-07-01T08:30:00Z"}],
                                "detail": "6.5 hours of attendance without a one-hour break.",
                            }
                        ],
                        "checked_rules": ["P-H1", "P-H2.daily", "P-H3", "P-H7.cap60", "P-H7.run"],
                    },
                    "zone_hours": [{"starts_at": "2026-07-01T02:00:00Z", "zone": "high", "level": "orange"}],
                    "banner_code": "plan.floor_banner",
                    "forecast_status": "fresh",
                    "ban_window": BAN,
                    "policy_version": POLICY_VERSION,
                    "config_version": 1,
                    "model_id": MODEL_ID,
                }
            ]
        }
    )

    banner_code: Literal["plan.floor_banner"] = Field(description=BANNER_DESCRIPTION)
    validator: ValidatorResult = Field(description="The independent validator's verdict on the roster.")
    zone_hours: list[ZoneHour] = Field(description="The zones of the day the plan was checked against.")
    forecast_status: ForecastStatus = Field(
        description="`fresh`, `stale` or `fallback`; a fallback day is High everywhere."
    )
    ban_window: BanWindow = Field(description=BAN_WINDOW_DESCRIPTION)
    policy_version: str = Field(description="Id of the ruleset the check ran under.")
    config_version: int = Field(
        description="Active runtime configuration id; 0 when running without a database configuration."
    )
    model_id: str | None = Field(description="Id of the corrector model behind the zones; null in fallback.")


# --- push ---------------------------------------------------------------------------------------------------------


class PushSubscriptionKeys(ApiRequest):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "p256dh": P256DH_EXAMPLE,
                    "auth": AUTH_EXAMPLE,
                }
            ]
        }
    )

    p256dh: str = Field(max_length=256, description="The browser's P-256 public key, base64url, exactly as produced.")
    auth: str = Field(max_length=256, description="The browser's auth secret, base64url, exactly as produced.")

    @field_validator("p256dh", "auth")
    @classmethod
    def _base64url(cls, value: str) -> str:
        return check_key(value)  # a ValueError: answered by the 422 handler, adds no schema constraint


class PushSubscriptionDetails(ApiRequest):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "endpoint": "https://push.example/send/abc123",
                    "expirationTime": None,
                    "keys": {
                        "p256dh": P256DH_EXAMPLE,
                        "auth": AUTH_EXAMPLE,
                    },
                }
            ]
        },
    )

    endpoint: str = Field(
        max_length=2048,
        description="The browser's push endpoint. A per-device address stored for delivery only, never logged. "
        "It must be an https URL of a public host: no IP address, no internal name, no credentials.",
    )
    expiration_time: float | None = Field(
        alias="expirationTime",
        description="Epoch milliseconds when the browser says the subscription expires, or null.",
    )
    keys: PushSubscriptionKeys = Field(description="The encryption keys of the subscription.")

    @field_validator("endpoint")
    @classmethod
    def _public_https(cls, value: str) -> str:
        return check_endpoint(value)

    @field_validator("expiration_time")
    @classmethod
    def _finite_int64(cls, value: float | None) -> float | None:
        return check_expiration(value)


class PushSubscriptionCreate(ApiRequest):
    """The browser's ``PushSubscription.toJSON()`` plus the scope the worker chose. No other member exists."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "subscription": {
                        "endpoint": "https://push.example/send/abc123",
                        "expirationTime": None,
                        "keys": {
                            "p256dh": P256DH_EXAMPLE,
                            "auth": AUTH_EXAMPLE,
                        },
                    },
                    "site_id": SITE_ID,
                    "crew_id": None,
                }
            ]
        }
    )

    subscription: PushSubscriptionDetails = Field(
        description="The browser's subscription, exactly as `PushSubscription.toJSON()`."
    )
    site_id: EntityId = Field(
        description="A site id from `list_sites`. Site alerts go to every subscription of the site."
    )
    crew_id: EntityId | None = Field(
        description="A crew id of that site from `list_site_crews`, or null for site alerts only."
    )


class PushSubscriptionCreated(ApiResponse):
    model_config = ConfigDict(json_schema_extra={"examples": [{"id": "sub-7d1f3a90"}]})

    id: str = Field(
        description="Subscription id. Keep it to delete the subscription; a repeat POST of an endpoint returns it."
    )


# --- governance ---------------------------------------------------------------------------------------------------


class DataRequestCreate(ApiRequest):
    """An employer's request for individual data. It is always refused (403) and the refusal is logged (ADR 0054)."""

    model_config = ConfigDict(
        json_schema_extra={"examples": [{"subject": "worker", "data_class": "health", "worker_ref": "staff no. 4471"}]}
    )

    subject: Literal["worker"] = Field(description="Whose data is requested. Only `worker` exists.")
    data_class: Literal["health", "personal", "exposure"] = Field(description="The class of individual data requested.")
    worker_ref: Annotated[str, StringConstraints(min_length=1, max_length=100)] = Field(
        description="Free text naming the person. Write-only: validated, then discarded; never stored, logged or "
        "echoed."
    )


class TransparencyEntry(ApiResponse):
    at: AwareDatetime = Field(description="UTC time the request was refused.")
    kind: Literal["data_request.refused"] = Field(description="The only worker-visible kind of audit entry.")
    outcome: Literal["refused"] = Field(description="What happened to the request.")
    actor_role: Literal["employer"] = Field(
        description="Role that made the request. Never a name, never an employer id."
    )
    rule: str = Field(description="The rule the refusal applied, for example `ADR 0004; PDPL purpose limitation`.")
    policy_version: str = Field(description="Ruleset id in force when the request was refused.")
    config_version: int = Field(description="Active runtime configuration id at that time.")
    model_id: str | None = Field(description="Corrector model id at that time; null when none was loaded.")


class TransparencyLog(ApiResponse):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "site_id": SITE_ID,
                    "entries": [
                        {
                            "at": "2026-07-01T07:42:10Z",
                            "kind": "data_request.refused",
                            "outcome": "refused",
                            "actor_role": "employer",
                            "rule": "ADR 0004; PDPL purpose limitation",
                            "policy_version": POLICY_VERSION,
                            "config_version": 1,
                            "model_id": MODEL_ID,
                        }
                    ],
                }
            ]
        }
    )

    site_id: str
    entries: list[TransparencyEntry] = Field(
        description="Worker-visible audit entries of the site, newest first, at most 50. Says an employer request was "
        "refused at this site, never whose data it was."
    )


class CrewStopCreate(ApiRequest):
    model_config = ConfigDict(json_schema_extra={"examples": [{"reason_code": "heat"}]})

    reason_code: Literal["heat", "worker_unwell", "other"] = Field(
        description="Why the crew lead stops work. Never free text."
    )


class CrewStop(ApiResponse):
    """A recorded crew-lead stop. It takes effect on the crew's plan and level immediately."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "id": "stop-0001",
                    "crew_id": CREW_ID,
                    "started_at": "2026-07-01T06:00:00Z",
                    "cleared_at": None,
                }
            ]
        }
    )

    id: str
    crew_id: str
    started_at: AwareDatetime = Field(
        description="UTC time the stop was recorded. A stop is never delayed by sign-off or validation."
    )
    cleared_at: AwareDatetime | None = Field(description="UTC time the stop was cleared; null while it is active.")


class DemoReset(ApiResponse):
    """A reset starts a new epoch of a synthetic demo site. Nothing is deleted."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"site_id": SITE_ID, "epoch_id": 2, "previous_epoch_id": 1, "reset_at": "2026-07-01T05:00:00Z"}
            ]
        }
    )

    site_id: str
    epoch_id: int = Field(description=EPOCH_SEMANTICS)
    previous_epoch_id: int = Field(description="The epoch that was current before the reset (`epoch_id` minus 1).")
    reset_at: AwareDatetime = Field(description="UTC time of the reset.")


# --- problem extensions -------------------------------------------------------------------------------------------


class ValidationErrorItem(BaseModel):
    """One framework validation error: where, what, which kind. The input value is never echoed."""

    model_config = ConfigDict(extra="forbid")

    loc: list[str | int] = Field(
        description='Path to the offending member, for example `["body", "crew", "headcount"]`.'
    )
    msg: str = Field(description="Human-readable message.")
    type: str = Field(description="Machine-readable error kind.")


class RosterError(BaseModel):
    """One problem in the roster text or segments of ``validate_plan``."""

    model_config = ConfigDict(extra="forbid")

    line: int = Field(description="1-based line of `roster_text`, or 1-based index into `segments`.")
    message: str = Field(description="What is wrong with that line.")


VALIDATION_FAILED_EXAMPLE: dict[str, Any] = {
    "type": "about:blank",
    "title": "Unprocessable Entity",
    "status": 422,
    "detail": "Request validation failed",
    "instance": "/api/v1/crews/crew-b/timeline",
    "request_id": REQUEST_ID,
    "errors": [{"loc": ["query", "date"], "msg": "Input should be a valid date", "type": "date_parsing"}],
}
ROSTER_INVALID_EXAMPLE: dict[str, Any] = {
    "type": ROSTER_INVALID,
    "title": "Roster invalid",
    "status": 422,
    "detail": "The roster could not be read.",
    "instance": "/api/v1/plans/validate",
    "request_id": REQUEST_ID,
    "errors": [{"line": 2, "message": "end 25:00 is not a time"}],
}
REVIEW_REQUIRED_EXAMPLE: dict[str, Any] = {
    "type": REVIEW_REQUIRED,
    "title": "Review required",
    "status": 409,
    "detail": "Every Medium and High item must be acknowledged before signing.",
    "instance": "/api/v1/crews/crew-b/day-plan/sign-off",
    "request_id": REQUEST_ID,
    "missing_items": ["high-0600"],
}
SHIFT_NOT_LEGAL_EXAMPLE: dict[str, Any] = {
    "type": SHIFT_NOT_LEGAL,
    "title": "Shift not legal",
    "status": 422,
    "detail": "The published shift breaks a shift rule by itself; no plan can fix it.",
    "instance": "/api/v1/crews/crew-b/day-plan",
    "request_id": REQUEST_ID,
    "violations": [
        {
            "rule_id": "P-H2.daily",
            "clause": "Art. 17(1): maximum normal working hours are eight hours per day.",
            "source_id": "fdl-33-2021",
        }
    ],
}


class ValidationProblem(Problem):
    """The 422 problem of a request that fails validation: `errors` lists where and why (never the input value)."""

    model_config = ConfigDict(extra="allow", json_schema_extra={"examples": [VALIDATION_FAILED_EXAMPLE]})

    errors: list[ValidationErrorItem] = Field(description="Every member that failed validation.")


class RosterInvalidProblem(Problem):
    """The 422 problem of ``validate_plan`` when the roster does not parse: `errors` names the lines."""

    model_config = ConfigDict(extra="allow", json_schema_extra={"examples": [ROSTER_INVALID_EXAMPLE]})

    errors: list[RosterError] = Field(description="Every line of the roster that could not be read.")


class ReviewRequiredProblem(Problem):
    """The 409 problem of ``sign_off_day_plan``: Medium, High or Red items still need an acknowledgement."""

    model_config = ConfigDict(extra="allow", json_schema_extra={"examples": [REVIEW_REQUIRED_EXAMPLE]})

    missing_items: list[str] = Field(description="Ids of the `ack_items` that were not acknowledged.")


class ShiftViolation(BaseModel):
    """One shift rule the published shift breaks by itself."""

    model_config = ConfigDict(extra="forbid")

    rule_id: str = Field(description="Id of the violated rule, for example `P-H2.daily`.")
    clause: str = Field(description="Text of the clause the rule comes from, from the ruleset.")
    source_id: str = Field(description="Id of the legal or policy source of the clause.")


class ShiftNotLegalProblem(Problem):
    """The 422 problem of the day plan and sign-off when the crew's published shift is itself not legal (hours or
    juvenile rules): the planner cannot fix it, so no plan is served; fix the shift."""

    model_config = ConfigDict(extra="allow", json_schema_extra={"examples": [SHIFT_NOT_LEGAL_EXAMPLE]})

    violations: list[ShiftViolation] = Field(description="Every shift rule the published shift breaks.")


REQUEST_MODELS: list[type[BaseModel]] = [
    PlanSignOffRequest,
    PlanCrewInput,
    RosterSegmentInput,
    PlanValidateRequest,
    PushSubscriptionKeys,
    PushSubscriptionDetails,
    PushSubscriptionCreate,
    DataRequestCreate,
    CrewStopCreate,
]
RESPONSE_MODELS: list[type[BaseModel]] = [
    Site,
    BanWindow,
    HourForecast,
    SiteForecastToday,
    RiskPolicy,
    Crew,
    CrewHour,
    CrewTimeline,
    AckItem,
    DayPlan,
    PlanSignOff,
    PlanValidateResponse,
    PushSubscriptionCreated,
    TransparencyLog,
    CrewStop,
    DemoReset,
]
PROBLEM_MODELS: list[type[Problem]] = [
    ValidationProblem,
    RosterInvalidProblem,
    ReviewRequiredProblem,
    ShiftNotLegalProblem,
]
