"""``day_plan``: crew stops, the planner, the independent validator, the 422/500 split, audit, persistence."""

import dataclasses
import itertools
from collections.abc import Callable
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.adapters.fakes.plans import InMemoryCrewStopStore, InMemoryDayPlanStore
from stellar_blaze.adapters.fakes.sites import InMemorySiteStore
from stellar_blaze.application import day_plan as day_plan_module
from stellar_blaze.application.day_plan import (
    DayPlanResult,
    PlannerBugError,
    ShiftNotLegalError,
    day_plan,
    plan_segments,
)
from stellar_blaze.application.runtime_config import ConfigSnapshot
from stellar_blaze.application.site_day import SiteDay
from stellar_blaze.domain.planner.rule_planner import plan_crew
from stellar_blaze.domain.plans.model import CrewPlan, CrewSpec, ShiftBlock, TickState
from stellar_blaze.domain.plans.rules import planner_rules
from stellar_blaze.domain.risk.levels import AlertLevel, Zone
from stellar_blaze.domain.validator.validator import MissingClauseError
from stellar_blaze.ports.audit import AuditRecord
from tests.unit.application.serving_support import (
    AMBER,
    DAY,
    GREEN_DAY,
    SHA,
    ExplodingForecasts,
    catalog,
    day_of,
    forecasts_of,
    make_site_day,
    newest_run,
    snapshot,
)
from tests.unit.contract.b3_world import SITE_ID, demo_fixture
from tests.unit.risk.support import default_params

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

K = 5


class Clock:
    """A settable clock for the in-memory stop store."""

    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@dataclasses.dataclass
class World:
    sites: InMemorySiteStore
    audit: InMemoryAuditLog
    stops: InMemoryCrewStopStore
    plans: InMemoryDayPlanStore
    clock: Clock
    epoch: int

    async def crew(self, crew_id: str) -> CrewSpec:
        return await self.sites.crew_spec(crew_id)

    async def run(
        self,
        site_day_: SiteDay,
        crew: CrewSpec,
        *,
        config: ConfigSnapshot | None = None,
        k: int = K,
    ) -> DayPlanResult:
        return await day_plan(
            site_day=site_day_,
            crew=crew,
            catalog=catalog(),
            snapshot=config or snapshot(version_id=3),
            sites=self.sites,
            stops=self.stops,
            plans=self.plans,
            audit=self.audit,
            k_exposure=k,
        )

    async def audit_rows(self) -> list[AuditRecord]:
        return list(
            await self.audit.site_entries(SITE_ID, ["plan.validator_rejected", "plan.planner_failed"], 50, self.epoch)
        )


async def world() -> World:
    audit = InMemoryAuditLog()
    clock = Clock(datetime(2026, 7, 1, 3, tzinfo=UTC))
    sites = InMemorySiteStore(audit)
    await sites.upsert_fixture(demo_fixture(), "test")
    return World(
        sites, audit, InMemoryCrewStopStore(clock), InMemoryDayPlanStore(), clock, await sites.active_epoch(SITE_ID)
    )


async def amber_day() -> SiteDay:
    return await make_site_day(forecasts_of(day_of(AMBER)))


def counts(result: DayPlanResult) -> dict[TickState, int]:
    plan = result.plan
    return {state: plan.states.count(state) for state in TickState}


async def test_plan_is_validated_persisted_with_identity_and_epoch() -> None:
    w = await world()
    day = await amber_day()

    result = await w.run(day, await w.crew("crew-b"))

    assert result.validation.passed
    assert result.validation.checked_rules
    assert result.plan.status == "rule"
    assert counts(result)[TickState.WORK] > 0
    assert (result.suppressed, result.restricted_headcount) == (False, result.plan.restricted_headcount)
    stored = await w.plans.latest("crew-b", DAY, w.epoch)
    assert stored is not None
    assert result.record == stored
    assert (stored.ruleset_id, stored.ruleset_sha256) == (day.identity.ruleset_id, day.identity.ruleset_sha256)
    assert (stored.model_id, stored.config_version_id, stored.config_sha256) == (None, 3, SHA)
    assert (stored.epoch_id, stored.status, stored.violations) == (w.epoch, "rule", 0)
    assert await w.audit_rows() == []


async def test_two_identical_calls_store_one_row_and_return_the_same_record() -> None:
    w = await world()
    day = await amber_day()
    crew = await w.crew("crew-b")

    first = await w.run(day, crew)
    second = await w.run(day, crew)

    assert len(w.plans.records) == 1  # a public GET per request must not append a row per request
    assert first.record is not None
    assert second.record == first.record  # the same id and created_at: the sign-off plan_hash stays stable


async def test_a_changed_zone_timeline_stores_a_second_row() -> None:
    w = await world()
    crew = await w.crew("crew-b")
    first = await w.run(await amber_day(), crew)

    changed = await w.run(await make_site_day(forecasts_of(day_of(GREEN_DAY))), crew)
    again = await w.run(await make_site_day(forecasts_of(day_of(GREEN_DAY))), crew)

    assert first.record is not None
    assert changed.record is not None
    assert changed.record.id != first.record.id
    assert changed.record.plan != first.record.plan
    assert again.record == changed.record
    assert len(w.plans.records) == 2
    assert (await w.plans.latest("crew-b", DAY, w.epoch)) == changed.record


async def test_no_persist_without_db_snapshot() -> None:
    w = await world()

    result = await w.run(await amber_day(), await w.crew("crew-b"), config=snapshot(version_id=None))

    assert result.record is None
    assert w.plans.records == []
    assert result.validation.passed


async def test_suppressed_crew_hides_restricted_headcount() -> None:
    w = await world()
    day = await amber_day()
    crew_d = await w.crew("crew-d")
    crew_c = await w.crew("crew-c")

    small = await w.run(day, crew_d)
    shown = await w.run(day, crew_c)
    hidden = await w.run(day, crew_c, k=10)  # crew-c has a returning member, so its restricted count is not zero

    assert crew_d.headcount == 4
    assert small.suppressed
    assert small.restricted_headcount is None
    assert shown.plan.restricted_headcount > 0
    assert (shown.suppressed, shown.restricted_headcount) == (False, shown.plan.restricted_headcount)
    assert (hidden.suppressed, hidden.restricted_headcount) == (True, None)
    # The stored row says nothing a response would withhold.
    assert (await w.plans.latest("crew-c", DAY, w.epoch)).plan["restricted_headcount"] is None  # type: ignore[union-attr]
    assert (await w.plans.latest("crew-d", DAY, w.epoch)).plan["restricted_headcount"] is None  # type: ignore[union-attr]


def illegal_shift(crew: CrewSpec) -> CrewSpec:
    # 06:00-18:00 less the 150 min ban less the planner's own 1 h Art. 18 break = 8.5 h of attendance a day. On a
    # 6-day week that breaks P-H2.daily (8 h normal) and P-H2.weekly (6 x 8.5 = 51 h > 48 h); on 5 days it is legal.
    return dataclasses.replace(crew, shift=(ShiftBlock(time(6, 0), time(18, 0)),), days_per_week=6)


async def test_illegal_published_shift_raises_shift_not_legal_not_planner_bug(caplog: pytest.LogCaptureFixture) -> None:
    w = await world()
    crew = illegal_shift(await w.crew("crew-b"))

    with pytest.raises(ShiftNotLegalError) as raised:
        await w.run(await amber_day(), crew)

    ids = {v.rule_id for v in raised.value.result.violations}
    assert ids == {"P-H2.daily", "P-H2.weekly"}
    assert {v.origin for v in raised.value.result.violations} == {"shift"}
    assert await w.audit_rows() == []  # no audit row for a shift that is simply not legal
    assert w.plans.records == []
    # The same crew on a 5-day week is legal (8.5 h a day, 42.5 h a week): the 422 is about the shift, not the planner.
    legal = await w.run(await amber_day(), dataclasses.replace(crew, days_per_week=5))
    assert legal.validation.passed


def work_in_the_ban(plan: CrewPlan) -> CrewPlan:
    states = list(plan.states)
    tick = 108  # 13:00 local, inside the 12:30-15:00 ban; the L1 shift is off then
    assert states[tick] is TickState.OFF
    states[tick] = TickState.WORK
    return dataclasses.replace(plan, states=tuple(states), tick_rules=())


async def test_validator_rejection_is_a_500_and_audited(monkeypatch: pytest.MonkeyPatch) -> None:
    w = await world()
    real = plan_crew

    def broken(*args: Any, **kwargs: Any) -> CrewPlan:
        return work_in_the_ban(real(*args, **kwargs))

    monkeypatch.setattr(day_plan_module, "plan_crew", broken)

    crew = await w.crew("crew-d")  # suppressed: the row must still carry no member data
    with pytest.raises(PlannerBugError) as raised:
        await w.run(await amber_day(), crew)

    assert raised.value.result is not None
    assert "P-H1" in {v.rule_id for v in raised.value.result.plan_violations}
    (row,) = await w.audit_rows()
    assert row.kind == "plan.validator_rejected"
    assert (row.epoch_id, row.site_id, row.employer_id) == (w.epoch, SITE_ID, crew.employer_id)
    assert (row.ruleset_id, row.ruleset_sha256, row.config_version_id) == (
        "ae-heat-2026.1",
        catalog().for_local_date(DAY).sha256,
        3,
    )
    detail: dict[str, Any] = dict(row.detail)
    assert set(detail) == {"crew_id", "local_date", "violations", "rules"}
    assert all(set(rule) == {"rule_id", "count"} for rule in detail["rules"])
    assert "P-H1" in {rule["rule_id"] for rule in detail["rules"]}
    assert w.plans.records == []
    assert await w.audit.verify() is None


@pytest.mark.parametrize(
    ("patch", "name"),
    [
        ("plan_crew", "ValueError"),
        ("validate_plan", "ValueError"),
        ("validate_plan", "MissingClauseError"),
    ],
)
async def test_planner_or_validator_exceptions_are_planner_bugs(
    monkeypatch: pytest.MonkeyPatch, patch: str, name: str
) -> None:
    w = await world()
    error: Callable[[], Exception] = (
        (lambda: MissingClauseError("P-H1")) if name == "MissingClauseError" else (lambda: ValueError("12 members"))
    )

    def boom(*args: Any, **kwargs: Any) -> Any:
        raise error()

    monkeypatch.setattr(day_plan_module, patch, boom)

    with pytest.raises(PlannerBugError) as raised:
        await w.run(await amber_day(), await w.crew("crew-b"))

    assert raised.value.result is None
    (row,) = await w.audit_rows()
    assert row.kind == "plan.planner_failed"
    assert dict(row.detail) == {"crew_id": "crew-b", "local_date": "2026-07-01", "error": name}  # the class name only
    assert w.plans.records == []


async def test_the_real_planner_refuses_a_headcount_mismatch_as_a_planner_bug() -> None:
    w = await world()
    crew = dataclasses.replace(await w.crew("crew-b"), headcount=3)  # 20 members listed

    with pytest.raises(PlannerBugError):
        await w.run(await amber_day(), crew)

    (row,) = await w.audit_rows()
    assert (row.kind, dict(row.detail)["error"]) == ("plan.planner_failed", "ValueError")


def red_ticks(result: DayPlanResult) -> list[int]:
    return [i for i, zone in enumerate(result.zones.zones) if zone is Zone.RED]


async def test_an_active_stop_turns_the_covered_ticks_red_and_the_planner_stops_them() -> None:
    w = await world()
    day = await make_site_day(forecasts_of(day_of(GREEN_DAY)))
    await w.stops.start("crew-b", "lead_stop", "crew-lead", w.epoch)  # now = 03:00Z = 07:00 local = tick 36

    result = await w.run(day, await w.crew("crew-b"))

    assert red_ticks(result) == list(range(36, 216))
    assert result.validation.passed
    assert "STOP.red" in result.validation.checked_rules
    work_ticks = [i for i, s in enumerate(result.plan.states) if s is TickState.WORK]
    assert all(i < 36 for i in work_ticks)  # nothing works once the crew is stopped
    assert TickState.STOPPED in result.plan.states[36:]
    hours = {hour.starts_at.hour: hour for hour in result.hours}
    assert (hours[2].level, hours[2].zone) == (AlertLevel.GREEN, Zone.LOW)  # 06:00-07:00 is before the stop
    assert all(hours[h].level is AlertLevel.RED and hours[h].zone is Zone.RED for h in range(3, 16))
    assert [hour.level for hour in day.hours] == [AlertLevel.GREEN] * 14  # the site's own levels are untouched


async def test_a_cleared_stop_ends_at_that_instant() -> None:
    w = await world()
    day = await make_site_day(forecasts_of(day_of(GREEN_DAY)))
    stop = await w.stops.start("crew-b", "lead_stop", "crew-lead", w.epoch)
    w.clock.now = datetime(2026, 7, 1, 4, tzinfo=UTC)
    await w.stops.clear(stop.id, "crew-lead")

    result = await w.run(day, await w.crew("crew-b"))

    assert red_ticks(result) == list(range(36, 48))  # 03:00Z to 04:00Z, exclusive
    hours = {hour.starts_at.hour: hour.level for hour in result.hours}
    assert (hours[3], hours[4]) == (AlertLevel.RED, AlertLevel.GREEN)


async def test_stops_of_another_epoch_or_crew_do_not_turn_ticks_red() -> None:
    w = await world()
    day = await make_site_day(forecasts_of(day_of(GREEN_DAY)))
    await w.stops.start("crew-b", "lead_stop", "crew-lead", w.epoch)  # epoch 1
    await w.stops.start("crew-a", "lead_stop", "crew-lead", w.epoch)  # another crew
    await w.sites.start_epoch(SITE_ID, "demo-admin")  # the demo reset: epoch 2 is active now
    assert await w.sites.active_epoch(SITE_ID) == w.epoch + 1

    result = await w.run(day, await w.crew("crew-b"))

    assert red_ticks(result) == []
    stored = await w.plans.latest("crew-b", DAY, w.epoch + 1)
    assert stored is not None
    assert stored.epoch_id == w.epoch + 1


async def test_a_stop_needs_no_forecast() -> None:
    w = await world()
    now = datetime(2026, 7, 1, 1, tzinfo=UTC)
    day = await make_site_day(ExplodingForecasts(), mode="live", now=now)
    await w.stops.start("crew-b", "lead_stop", "crew-lead", w.epoch)

    result = await w.run(day, await w.crew("crew-b"))

    assert result.validation.passed
    assert result.plan.status == "fallback"
    assert result.forecast_status == "fallback"
    assert red_ticks(result) == list(range(36, 216))
    assert result.record is not None
    assert result.record.status == "fallback"
    hours = {hour.starts_at.hour: hour for hour in result.hours}
    assert (hours[2].level, hours[2].zone) == (None, None)  # no forecast: no level before the stop
    assert hours[5].level is AlertLevel.RED


async def test_a_stale_forecast_gives_the_protective_plan_and_says_so() -> None:
    w = await world()
    source = forecasts_of(day_of(GREEN_DAY))
    fresh_day = await make_site_day(source, mode="live", now=newest_run() + timedelta(hours=1))
    stale_day = await make_site_day(source, mode="live", now=newest_run() + timedelta(hours=31))

    fresh = await w.run(fresh_day, await w.crew("crew-b"))
    stale = await w.run(stale_day, await w.crew("crew-b"))

    assert (fresh.forecast_status, stale.forecast_status) == ("fresh", "stale")
    assert fresh.plan.status == "rule"
    assert TickState.ADOSH_REST not in fresh.plan.states
    assert stale.plan.status == "fallback"
    assert stale.record is not None
    assert stale.record.status == "fallback"
    assert TickState.ADOSH_REST in stale.plan.states  # protective: the same cycles as a High day
    assert set(stale.zones.zones) == {Zone.HIGH}
    assert [hour.level for hour in stale.hours] == [AlertLevel.GREEN] * 14  # the stale forecast is shown as it is


async def test_plan_segments_merge_runs_and_cite_a_clause_for_each() -> None:
    w = await world()
    crew = dataclasses.replace(await w.crew("crew-b"), shift=(ShiftBlock(time(6, 0), time(18, 0)),), days_per_week=5)
    result = await w.run(await amber_day(), crew)
    clauses = catalog().for_local_date(DAY).ruleset.clauses.entries  # type: ignore[union-attr]

    segments = plan_segments(result.plan, result.zones, clauses)

    assert segments[0].starts_at == result.plan.start_utc
    assert segments[-1].ends_at == result.plan.start_utc + timedelta(minutes=5 * 216)
    assert all(a.ends_at == b.starts_at for a, b in itertools.pairwise(segments))
    assert all((a.state, a.zone, a.rule_id) != (b.state, b.zone, b.rule_id) for a, b in itertools.pairwise(segments))
    assert all(s.rule_id in clauses and s.clause == clauses[s.rule_id].clause for s in segments)
    ban = [s for s in segments if s.state is TickState.BAN]
    assert [(s.starts_at.hour, s.starts_at.minute, s.ends_at.hour, s.rule_id, s.zone) for s in ban] == [
        (8, 30, 11, "P-H1", None)
    ]
    assert all(s.zone is None for s in segments if s.state is TickState.OFF)
    assert sum(1 for s in segments if s.state is TickState.WORK) >= 2


async def test_a_shift_the_planner_cannot_break_up_and_the_hours_rules_refuse_is_422_not_500() -> None:
    w = await world()
    # 07:10-20:30 less the 150 min ban is 10 h 50 min (130 ticks) of attendance in one run: no 12-tick window leaves a
    # legal remainder, so the planner raises ValueError. Hand-check: 10.83 h > 10 h (8 h normal + 2 h overtime on a
    # 5-day week), so the raw shift itself breaks P-H2.daily (and 5 x 10.83 = 54.2 h breaks P-H2.weekly).
    crew = dataclasses.replace(await w.crew("crew-b"), shift=(ShiftBlock(time(7, 10), time(20, 30)),), days_per_week=5)
    with pytest.raises(ValueError, match=r"no feasible Art\. 18 break"):
        plan_crew(
            crew,
            (await amber_day()).zones,
            planner_rules(catalog().for_local_date(DAY).ruleset, default_params()),
            local_date=DAY,
            tz=ZoneInfo("Asia/Dubai"),
        )

    with pytest.raises(ShiftNotLegalError) as raised:
        await w.run(await amber_day(), crew)

    assert "P-H2.daily" in {v.rule_id for v in raised.value.result.violations}
    assert {v.origin for v in raised.value.result.violations} == {"shift"}
    assert await w.audit_rows() == []
    assert w.plans.records == []
