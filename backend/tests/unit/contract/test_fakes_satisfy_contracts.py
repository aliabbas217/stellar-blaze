"""The in-memory fakes satisfy the contract suites that the real adapters also run, and the suites fail on sources
that break the port (a contract that cannot fail would make every green run vacuous)."""

import re
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta, timezone

import polars as pl
import pytest
from pydantic import ValidationError

from stellar_blaze.adapters.fakes.notifications import FailingChannel, RecordingChannel
from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource, InMemoryObservationSource
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_RAW_SCHEMA, SchemaMismatchError
from stellar_blaze.domain.weather.stations import Station, station
from stellar_blaze.ports.notifications import Audience, DeliveryResult, DeliveryStatus, OutboundMessage
from tests.unit.contract.forecast_contract import check_forecast_source
from tests.unit.contract.notification_contract import check_notification_channel
from tests.unit.contract.observation_contract import check_observation_source

pytestmark = pytest.mark.unit

OMAA = station("OMAA")
OMDB = station("OMDB")

# --- observation fixtures -------------------------------------------------------------------------------------------

START = datetime(2026, 7, 1, 0, tzinfo=UTC)
END = datetime(2026, 7, 1, 6, tzinfo=UTC)
# One report just before the window, four inside it (the first exactly at `start`), one exactly at `end` and one after.
OBS_TIMES = [
    START - timedelta(minutes=1),
    START,
    START + timedelta(hours=1),
    START + timedelta(hours=2, minutes=30),
    END - timedelta(minutes=1),
    END,
    END + timedelta(hours=1),
]
OBS_IN_WINDOW = OBS_TIMES[1:5]


def obs_frame(times: Sequence[datetime], icao: str = "OMAA") -> pl.DataFrame:
    """One report per time; ``t_c`` is 30.0, 31.0, ... so row order is visible."""
    n = len(times)
    return pl.DataFrame(
        {
            "station": [icao] * n,
            "obs_time": list(times),
            "t_c": [30.0 + i for i in range(n)],
            "td_c": [10.0] * n,
            "wind_ms": [3.0] * n,
            "qc_t": [None] * n,
            "qc_td": [None] * n,
            "qc_wind": [None] * n,
            "source": ["fake"] * n,
        },
        schema=OBS_RAW_SCHEMA,
    )


# --- forecast fixtures ----------------------------------------------------------------------------------------------

FC_START = date(2026, 7, 1)
FC_END = date(2026, 7, 2)
LEADS = (0, 1, 2)


def hourly(first: datetime, count: int) -> list[datetime]:
    return [first + timedelta(hours=i) for i in range(count)]


# The two days of the request, and a wider stored range: two hours before it and one hour after it.
FC_IN_RANGE = hourly(datetime(2026, 7, 1, 0, tzinfo=UTC), 48)
FC_STORED = hourly(datetime(2026, 6, 30, 22, tzinfo=UTC), 51)


def forecast_frame(
    valid_times: Sequence[datetime],
    leads: Sequence[int],
    *,
    icao: str = "OMAA",
    model: NwpModel = NwpModel.ECMWF_IFS025,
) -> pl.DataFrame:
    """One row per valid time and lead."""
    rows = [(valid_time, lead) for valid_time in valid_times for lead in leads]
    n = len(rows)
    return pl.DataFrame(
        {
            "station": [icao] * n,
            "model": [model.value] * n,
            "valid_time": [valid_time for valid_time, _ in rows],
            "lead_days": [lead for _, lead in rows],
            "t_c": [35.0] * n,
            "td_c": [12.0] * n,
            "wind_ms": [4.0] * n,
            "sw_wm2": [800.0] * n,
            "direct_wm2": [600.0] * n,
            "pressure_hpa": [1000.0] * n,
            "grid_lat": [24.5] * n,
            "grid_lon": [54.75] * n,
            "grid_elev_m": [20.0] * n,
        },
        schema=FORECAST_SCHEMA,
    )


# --- notification fixtures ------------------------------------------------------------------------------------------

VALID_FROM = datetime(2026, 7, 1, 6, tzinfo=UTC)


def site_message() -> OutboundMessage:
    return OutboundMessage(
        site_id="site-1",
        audience=Audience.SITE,
        crew_id=None,
        level=AlertLevel.AMBER,
        valid_from=VALID_FROM,
        template_id="heat.amber.v1",
    )


def crew_message() -> OutboundMessage:
    return OutboundMessage(
        site_id="site-1",
        audience=Audience.CREW,
        crew_id="crew-a",
        level=AlertLevel.ORANGE,
        valid_from=VALID_FROM,
        template_id="heat.orange.v1",
    )


WIRE_PAYLOAD = {
    "site_id": "site-1",
    "audience": "site",
    "crew_id": None,
    "level": "amber",
    "valid_from": "2026-07-01T06:00:00Z",
    "template_id": "heat.amber.v1",
}


# === the fakes satisfy the contracts ================================================================================


@pytest.mark.asyncio
async def test_in_memory_observation_source_satisfies_the_contract() -> None:
    source = InMemoryObservationSource({"OMAA": obs_frame(OBS_TIMES)})

    await check_observation_source(source, OMAA, START, END)


@pytest.mark.asyncio
async def test_in_memory_forecast_source_satisfies_the_contract() -> None:
    source = InMemoryForecastSource({("OMAA", NwpModel.ECMWF_IFS025): forecast_frame(FC_STORED, (0, 1, 2, 3))})

    await check_forecast_source(source, OMAA, NwpModel.ECMWF_IFS025, FC_START, FC_END, LEADS)


@pytest.mark.asyncio
async def test_recording_channel_satisfies_the_contract_and_records_in_order() -> None:
    channel = RecordingChannel()
    site, crew = site_message(), crew_message()

    await check_notification_channel(channel, site, DeliveryStatus.DELIVERED)
    await check_notification_channel(channel, crew, DeliveryStatus.DELIVERED)

    assert channel.sent == [site, crew]


@pytest.mark.asyncio
async def test_failing_channel_satisfies_the_contract_without_raising() -> None:
    await check_notification_channel(FailingChannel(), site_message(), DeliveryStatus.FAILED)


# === fake behavior beyond the contract ==============================================================================


@pytest.mark.asyncio
async def test_observation_fake_window_is_half_open() -> None:
    source = InMemoryObservationSource({"OMAA": obs_frame(OBS_TIMES)})

    frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame["obs_time"].to_list() == OBS_IN_WINDOW  # `start` kept, `end` and the minute before `start` dropped


@pytest.mark.asyncio
async def test_observation_fake_accepts_a_non_utc_aware_window() -> None:
    source = InMemoryObservationSource({"OMAA": obs_frame(OBS_TIMES)})
    gst = timezone(timedelta(hours=4))

    frame = await source.observations(station=OMAA, start=START.astimezone(gst), end=END.astimezone(gst))

    assert frame["obs_time"].to_list() == OBS_IN_WINDOW


@pytest.mark.asyncio
async def test_observation_fake_rejects_a_naive_window() -> None:
    source = InMemoryObservationSource({"OMAA": obs_frame(OBS_TIMES)})

    with pytest.raises(ValueError, match="timezone-aware"):
        await source.observations(station=OMAA, start=START.replace(tzinfo=None), end=END)


@pytest.mark.asyncio
async def test_observation_fake_keeps_stored_order_and_duplicate_times() -> None:
    times = [START + timedelta(hours=2), START + timedelta(hours=1), START + timedelta(hours=1)]
    source = InMemoryObservationSource({"OMAA": obs_frame(times)})

    frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame["t_c"].to_list() == [30.0, 31.0, 32.0]


@pytest.mark.asyncio
async def test_observation_fake_returns_an_empty_frame_for_an_unseeded_station() -> None:
    source = InMemoryObservationSource({"OMAA": obs_frame(OBS_TIMES)})

    frame = await source.observations(station=OMDB, start=START, end=END)

    assert frame.height == 0
    assert frame.schema == OBS_RAW_SCHEMA


def test_observation_fake_name_defaults_to_fake_and_can_be_set() -> None:
    assert InMemoryObservationSource({}).name == "fake"
    assert InMemoryObservationSource({}, name="iem-replay").name == "iem-replay"


def test_observation_fake_rejects_a_frame_with_the_wrong_schema() -> None:
    wrong = obs_frame(OBS_IN_WINDOW).with_columns(pl.col("t_c").cast(pl.Int64))

    with pytest.raises(SchemaMismatchError, match=r"'OMAA'.*wrong dtypes"):
        InMemoryObservationSource({"OMAA": wrong})


def test_observation_fake_rejects_rows_of_another_station() -> None:
    with pytest.raises(ValueError, match=r"'OMAA'.*'station'.*OMDB"):
        InMemoryObservationSource({"OMAA": obs_frame(OBS_IN_WINDOW, icao="OMDB")})


@pytest.mark.asyncio
async def test_forecast_fake_keeps_the_inclusive_utc_dates_and_the_requested_leads() -> None:
    source = InMemoryForecastSource({("OMAA", NwpModel.ECMWF_IFS025): forecast_frame(FC_STORED, (0, 1, 2, 3))})

    frame = await source.previous_runs(
        station=OMAA, model=NwpModel.ECMWF_IFS025, start=FC_START, end=FC_END, leads_days=LEADS
    )

    assert frame.height == 48 * len(LEADS)
    assert frame["valid_time"].min() == datetime(2026, 7, 1, 0, tzinfo=UTC)  # 2026-06-30 22:00 and 23:00 dropped
    assert frame["valid_time"].max() == datetime(2026, 7, 2, 23, tzinfo=UTC)  # 23:00 of `end` kept, 2026-07-03 dropped
    assert set(frame["lead_days"].to_list()) == set(LEADS)  # lead 3 dropped


@pytest.mark.asyncio
async def test_forecast_fake_honors_a_narrower_lead_request_and_an_empty_one() -> None:
    source = InMemoryForecastSource({("OMAA", NwpModel.ECMWF_IFS025): forecast_frame(FC_STORED, (0, 1, 2, 3))})

    only_lead_1 = await source.previous_runs(
        station=OMAA, model=NwpModel.ECMWF_IFS025, start=FC_START, end=FC_START, leads_days=[1]
    )
    no_leads = await source.previous_runs(
        station=OMAA, model=NwpModel.ECMWF_IFS025, start=FC_START, end=FC_START, leads_days=[]
    )

    assert set(only_lead_1["lead_days"].to_list()) == {1}
    assert only_lead_1.height == 24
    assert no_leads.height == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("leads", [[8], [-1], [0, 1, 9]])
async def test_forecast_fake_refuses_a_lead_outside_0_to_7_like_the_real_adapter(leads: list[int]) -> None:
    source = InMemoryForecastSource({("OMAA", NwpModel.ECMWF_IFS025): forecast_frame(FC_STORED, (0, 1, 2, 3))})

    with pytest.raises(ValueError, match=r"leads_days must be within 0\.\.7"):
        await source.previous_runs(
            station=OMAA, model=NwpModel.ECMWF_IFS025, start=FC_START, end=FC_END, leads_days=leads
        )


@pytest.mark.asyncio
async def test_forecast_fake_returns_an_empty_frame_for_an_unseeded_station_or_model() -> None:
    source = InMemoryForecastSource({("OMAA", NwpModel.ECMWF_IFS025): forecast_frame(FC_STORED, LEADS)})

    other_model = await source.previous_runs(
        station=OMAA, model=NwpModel.GFS_SEAMLESS, start=FC_START, end=FC_END, leads_days=LEADS
    )
    other_station = await source.previous_runs(
        station=OMDB, model=NwpModel.ECMWF_IFS025, start=FC_START, end=FC_END, leads_days=LEADS
    )

    assert other_model.height == 0
    assert other_model.schema == FORECAST_SCHEMA
    assert other_station.height == 0
    assert other_station.schema == FORECAST_SCHEMA


def test_forecast_fake_rejects_a_frame_with_the_wrong_schema() -> None:
    wrong = forecast_frame(FC_IN_RANGE, LEADS).with_columns(pl.col("lead_days").cast(pl.Int64))

    with pytest.raises(SchemaMismatchError, match=r"'OMAA'.*wrong dtypes"):
        InMemoryForecastSource({("OMAA", NwpModel.ECMWF_IFS025): wrong})


def test_forecast_fake_rejects_rows_of_another_station_or_model() -> None:
    with pytest.raises(ValueError, match=r"'station'.*OMDB"):
        InMemoryForecastSource({("OMAA", NwpModel.ECMWF_IFS025): forecast_frame(FC_IN_RANGE, LEADS, icao="OMDB")})
    with pytest.raises(ValueError, match=r"'model'.*gfs_seamless"):
        InMemoryForecastSource(
            {("OMAA", NwpModel.ECMWF_IFS025): forecast_frame(FC_IN_RANGE, LEADS, model=NwpModel.GFS_SEAMLESS)}
        )


@pytest.mark.asyncio
async def test_recording_channel_reports_delivered_with_its_own_name() -> None:
    channel = RecordingChannel()

    result = await channel.send(site_message())

    assert result.channel == channel.name == "recording"
    assert result.status is DeliveryStatus.DELIVERED
    assert result.detail is None


@pytest.mark.asyncio
async def test_failing_channel_reports_failed_with_its_detail() -> None:
    default = await FailingChannel().send(site_message())
    custom = await FailingChannel(detail="push service returned 410").send(site_message())

    assert (default.channel, default.status, default.detail) == ("failing", DeliveryStatus.FAILED, "injected failure")
    assert custom.detail == "push service returned 410"


# === the outbound message and result types ==========================================================================


def test_outbound_message_forbids_extra_fields() -> None:
    with pytest.raises(ValidationError, match="worker_id"):
        OutboundMessage(  # type: ignore[call-arg]
            site_id="site-1",
            audience=Audience.SITE,
            crew_id=None,
            level=AlertLevel.AMBER,
            valid_from=VALID_FROM,
            template_id="heat.amber.v1",
            worker_id="w1",
        )


def test_outbound_message_forbids_extra_fields_in_a_parsed_payload() -> None:
    with pytest.raises(ValidationError, match="worker_id"):
        OutboundMessage.model_validate({**WIRE_PAYLOAD, "worker_id": "w1"})


def test_outbound_message_carries_exactly_the_adr_0002_fields() -> None:
    # Adding a field widens what may leave the system (ADR 0002: no worker id, no free text), so it must be deliberate.
    assert set(OutboundMessage.model_fields) == {"site_id", "audience", "crew_id", "level", "valid_from", "template_id"}


def test_crew_audience_requires_crew_id() -> None:
    with pytest.raises(ValidationError, match="crew_id is required"):
        OutboundMessage(
            site_id="site-1",
            audience=Audience.CREW,
            crew_id=None,
            level=AlertLevel.ORANGE,
            valid_from=VALID_FROM,
            template_id="heat.orange.v1",
        )


def test_site_audience_rejects_a_crew_id() -> None:
    with pytest.raises(ValidationError, match="crew_id must be None"):
        OutboundMessage(
            site_id="site-1",
            audience=Audience.SITE,
            crew_id="crew-a",
            level=AlertLevel.AMBER,
            valid_from=VALID_FROM,
            template_id="heat.amber.v1",
        )


def test_outbound_message_requires_a_timezone_aware_valid_from() -> None:
    with pytest.raises(ValidationError, match="valid_from"):
        OutboundMessage.model_validate({**WIRE_PAYLOAD, "valid_from": "2026-07-01T06:00:00"})


def test_outbound_message_parses_its_wire_payload() -> None:
    message = OutboundMessage.model_validate(WIRE_PAYLOAD)

    assert message == site_message()
    assert message.level is AlertLevel.AMBER
    assert message.audience is Audience.SITE


def test_outbound_message_and_delivery_result_are_frozen() -> None:
    message = site_message()
    result = DeliveryResult(channel="recording", status=DeliveryStatus.DELIVERED)

    with pytest.raises(ValidationError, match="frozen"):
        message.level = AlertLevel.RED  # type: ignore[misc]
    with pytest.raises(ValidationError, match="frozen"):
        result.status = DeliveryStatus.FAILED  # type: ignore[misc]


def test_delivery_result_optional_fields_default_to_none() -> None:
    result = DeliveryResult(channel="recording", status=DeliveryStatus.SKIPPED)

    assert result.provider_message_id is None
    assert result.detail is None
    assert [status.value for status in DeliveryStatus] == ["delivered", "failed", "skipped"]


# === the contract suites fail on sources that break the port =======================================================


class StubObservationSource:
    """Returns ``frame`` for any non-empty window and ``empty`` (a frame, or an exception to raise) for an empty one.

    Named like the frames of ``obs_frame`` (``source`` column ``"fake"``), so only the defect a test injects fails.
    """

    name = "fake"

    def __init__(self, frame: pl.DataFrame, *, empty: pl.DataFrame | Exception | None = None) -> None:
        self.frame = frame
        self.empty = pl.DataFrame(schema=OBS_RAW_SCHEMA) if empty is None else empty

    async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame:
        if start < end:
            return self.frame
        if isinstance(self.empty, Exception):
            raise self.empty
        return self.empty


class StubForecastSource:
    """Returns ``frame`` whatever is asked."""

    def __init__(self, frame: pl.DataFrame) -> None:
        self.frame = frame

    async def previous_runs(
        self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        return self.frame


class StubChannel:
    """Answers every message with ``outcome`` (a result, or an exception to raise)."""

    name = "stub"

    def __init__(self, outcome: DeliveryResult | Exception) -> None:
        self.outcome = outcome

    async def send(self, message: OutboundMessage) -> DeliveryResult:
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


GOOD_OBS = obs_frame(OBS_IN_WINDOW)
BAD_OBSERVATION_FRAMES = {
    "wrong-dtype": (GOOD_OBS.with_columns(pl.col("t_c").cast(pl.Int64)), "wrong dtypes"),
    "extra-column": (GOOD_OBS.with_columns(pl.lit(1).alias("extra")), "must be exactly"),
    "reordered-columns": (GOOD_OBS.select(reversed(GOOD_OBS.columns)), "must be exactly"),
    "other-station": (obs_frame(OBS_IN_WINDOW, icao="OMDB"), "not for station OMAA"),
    "before-start": (obs_frame([START - timedelta(seconds=1), *OBS_IN_WINDOW]), "outside [start, end)"),
    "at-end": (obs_frame([*OBS_IN_WINDOW, END]), "outside [start, end)"),
    "null-obs-time": (GOOD_OBS.with_columns(pl.col("obs_time").shift(1)), "null obs_time"),
    "source-is-not-the-source-name": (GOOD_OBS.with_columns(pl.lit("iem").alias("source")), "source other than 'fake'"),
    "null-source": (GOOD_OBS.with_columns(pl.lit(None, dtype=pl.String).alias("source")), "source other than 'fake'"),
    "no-rows": (GOOD_OBS.clear(), "no rows"),
}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("frame", "fragment"),
    [pytest.param(frame, fragment, id=name) for name, (frame, fragment) in BAD_OBSERVATION_FRAMES.items()],
)
async def test_observation_contract_rejects_a_bad_window_result(frame: pl.DataFrame, fragment: str) -> None:
    with pytest.raises(AssertionError, match=re.escape(fragment)):
        await check_observation_source(StubObservationSource(frame), OMAA, START, END)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("empty", "fragment"),
    [
        pytest.param(GOOD_OBS, "empty window", id="returns-rows"),
        pytest.param(pl.DataFrame(), "missing columns", id="wrong-schema"),
        pytest.param(RuntimeError("no reports"), "raised RuntimeError: no reports", id="raises"),
    ],
)
async def test_observation_contract_rejects_a_bad_empty_window_result(
    empty: pl.DataFrame | Exception, fragment: str
) -> None:
    with pytest.raises(AssertionError, match=re.escape(fragment)):
        await check_observation_source(StubObservationSource(GOOD_OBS, empty=empty), OMAA, START, END)


GOOD_FC = forecast_frame(FC_IN_RANGE, LEADS)
BAD_FORECAST_FRAMES = {
    "wrong-dtype": (GOOD_FC.with_columns(pl.col("lead_days").cast(pl.Int64)), "wrong dtypes"),
    "extra-column": (GOOD_FC.with_columns(pl.lit(1).alias("extra")), "must be exactly"),
    "other-station": (forecast_frame(FC_IN_RANGE, LEADS, icao="OMDB"), "not for station OMAA"),
    "other-model": (forecast_frame(FC_IN_RANGE, LEADS, model=NwpModel.GFS_SEAMLESS), "not for model ecmwf_ifs025"),
    "missing-lead": (GOOD_FC.filter(pl.col("lead_days") != 2), "lead_days [0, 1] differ from the requested [0, 1, 2]"),
    "extra-lead": (forecast_frame(FC_IN_RANGE, (*LEADS, 3)), "lead_days [0, 1, 2, 3] differ from the requested"),
    "after-end": (forecast_frame([*FC_IN_RANGE, datetime(2026, 7, 3, 0, tzinfo=UTC)], LEADS), "outside 2026-07-01"),
    "before-start": (
        forecast_frame([datetime(2026, 6, 30, 23, tzinfo=UTC), *FC_IN_RANGE], LEADS),
        "outside 2026-07-01",
    ),
    "duplicate-row": (pl.concat([GOOD_FC, GOOD_FC.head(1)]), "one row per requested lead"),
    "missing-valid-time-lead-pair": (GOOD_FC.slice(1), "one row per requested lead"),
    "null-valid-time": (GOOD_FC.with_columns(pl.col("valid_time").shift(1)), "null valid_time"),
    "no-rows": (GOOD_FC.clear(), "no rows"),
}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("frame", "fragment"),
    [pytest.param(frame, fragment, id=name) for name, (frame, fragment) in BAD_FORECAST_FRAMES.items()],
)
async def test_forecast_contract_rejects_a_bad_result(frame: pl.DataFrame, fragment: str) -> None:
    with pytest.raises(AssertionError, match=re.escape(fragment)):
        await check_forecast_source(StubForecastSource(frame), OMAA, NwpModel.ECMWF_IFS025, FC_START, FC_END, LEADS)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("outcome", "expect", "fragment"),
    [
        pytest.param(ConnectionError("down"), DeliveryStatus.FAILED, "send raised ConnectionError: down", id="raises"),
        pytest.param(
            DeliveryResult(channel="stub", status=DeliveryStatus.DELIVERED),
            DeliveryStatus.FAILED,
            "status 'delivered', expected 'failed'",
            id="wrong-status",
        ),
        pytest.param(
            DeliveryResult(channel="other", status=DeliveryStatus.DELIVERED),
            DeliveryStatus.DELIVERED,
            "result.channel 'other' is not the channel's name 'stub'",
            id="wrong-channel-name",
        ),
        pytest.param(
            DeliveryResult(channel="stub", status=DeliveryStatus.FAILED),
            DeliveryStatus.FAILED,
            "FAILED result carries no detail",
            id="failed-without-detail",
        ),
        pytest.param(
            DeliveryResult(channel="stub", status=DeliveryStatus.FAILED, detail="  "),
            DeliveryStatus.FAILED,
            "FAILED result carries a blank detail",
            id="failed-with-blank-detail",
        ),
    ],
)
async def test_notification_contract_rejects_a_bad_result(
    outcome: DeliveryResult | Exception, expect: DeliveryStatus, fragment: str
) -> None:
    with pytest.raises(AssertionError, match=re.escape(fragment)):
        await check_notification_channel(StubChannel(outcome), site_message(), expect)
