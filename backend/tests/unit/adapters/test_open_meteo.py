"""``OpenMeteoPreviousRunsSource`` against a recorded response (``fixtures/open_meteo/ifs025_OMAA_2025-07-01_02.json``).

The recording is the real answer for OMAA, ECMWF IFS 0.25 degree, 2025-07-01 and 2025-07-02, with the 48 series (six
variables, lead 0 and previous days 1 to 7). Tests that need a different window or a damaged body derive it from the
recording; the expected values are read from the recording's JSON, never from the adapter.
"""

import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx2
import polars as pl
import pytest

from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import UpstreamError, build_async_client
from stellar_blaze.adapters.http.pacer import RequestPacer
from stellar_blaze.adapters.sources.open_meteo import OpenMeteoPreviousRunsSource
from stellar_blaze.config import Settings
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA
from stellar_blaze.domain.weather.stations import Station, station
from stellar_blaze.logging import configure_logging
from tests.unit.adapters.http_support import cached_files, forbidden, json_lines
from tests.unit.contract.forecast_contract import check_forecast_source

pytestmark = pytest.mark.unit

OMAA = station("OMAA")
OMDB = station("OMDB")
FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "open_meteo" / "ifs025_OMAA_2025-07-01_02.json"
START, END = date(2025, 7, 1), date(2025, 7, 2)
ALL_LEADS = list(range(8))

# (Open-Meteo variable, FORECAST_SCHEMA column, unit the recording carries, divisor to the schema's unit), in the order
# the request names them.
VARIABLES = (
    ("temperature_2m", "t_c", "°C", 1.0),
    ("dew_point_2m", "td_c", "°C", 1.0),
    ("wind_speed_10m", "wind_ms", "km/h", 3.6),
    ("shortwave_radiation", "sw_wm2", "W/m²", 1.0),
    ("direct_radiation", "direct_wm2", "W/m²", 1.0),
    ("surface_pressure", "pressure_hpa", "hPa", 1.0),
)

FLOAT_COLUMNS = [column for _, column, _, _ in VARIABLES] + ["grid_lat", "grid_lon", "grid_elev_m"]

Handler = Callable[[httpx2.Request], httpx2.Response]


def series_name(variable: str, lead: int) -> str:
    return variable if lead == 0 else f"{variable}_previous_day{lead}"


def hourly_names(leads: list[int]) -> list[str]:
    return [series_name(variable, lead) for variable, _, _, _ in VARIABLES for lead in leads]


def recorded() -> dict[str, Any]:
    payload: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return payload


def json_response(payload: object, status: int = 200) -> httpx2.Response:
    # json.dumps, not the client's json=: it writes NaN as the literal some servers send, httpx2's encoder refuses.
    return httpx2.Response(
        status, content=json.dumps(payload).encode(), headers={"content-type": "application/json; charset=utf-8"}
    )


def answer_from_fixture(request: httpx2.Request) -> httpx2.Response:
    """Answer as the API does: the requested series only, for the requested dates (the recording covers two days)."""
    params = request.url.params
    payload = recorded()
    hourly, units = payload["hourly"], payload["hourly_units"]
    names = params["hourly"].split(",")
    unknown = [name for name in names if name not in hourly]
    if unknown:
        return json_response(
            {"error": True, "reason": f"Cannot initialize ForecastVariable from invalid String value {unknown[0]}"}, 400
        )
    first, last = date.fromisoformat(params["start_date"]), date.fromisoformat(params["end_date"])
    keep = [i for i, time in enumerate(hourly["time"]) if first <= date.fromisoformat(time[:10]) <= last]
    payload["hourly"] = {name: [hourly[name][i] for i in keep] for name in ["time", *names]}
    payload["hourly_units"] = {name: units[name] for name in ["time", *names]}
    return json_response(payload)


def serve(payload: object) -> Handler:
    return lambda request: json_response(payload)


def recording(requests: list[httpx2.Request], answer: Handler) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return answer(request)

    return handler


def expected_params(*, lat: str, lon: str, model: str, start: str, end: str, leads: list[int]) -> list[tuple[str, str]]:
    """The query string of the data-availability study, in its order."""
    return [
        ("latitude", lat),
        ("longitude", lon),
        ("models", model),
        ("timezone", "UTC"),
        ("start_date", start),
        ("end_date", end),
        ("hourly", ",".join(hourly_names(leads))),
    ]


@asynccontextmanager
async def open_meteo_source(
    settings: Settings, handler: Handler, cache: RawResponseCache | None = None, pacer: RequestPacer | None = None
) -> AsyncIterator[OpenMeteoPreviousRunsSource]:
    async with build_async_client(settings, httpx2.MockTransport(handler)) as client:
        yield OpenMeteoPreviousRunsSource(client, settings.open_meteo_previous_runs_url, cache, pacer=pacer)


async def fetch(
    source: OpenMeteoPreviousRunsSource,
    *,
    at: Station = OMAA,
    model: NwpModel = NwpModel.ECMWF_IFS025,
    start: date = START,
    end: date = END,
    leads: list[int] | None = None,
) -> pl.DataFrame:
    return await source.previous_runs(
        station=at, model=model, start=start, end=end, leads_days=ALL_LEADS if leads is None else leads
    )


def detail_of(error: UpstreamError) -> str:
    """The adapter's own wording of a rejected body: the message minus the request URL, which names every series."""
    cause = error.__cause__
    assert isinstance(cause, ValueError), f"expected a ValueError cause, got {cause!r}"
    return str(cause)


Damage = Callable[[dict[str, Any]], None]
DELETE: Any = object()


def set_at(*path: str | int, to: object) -> Damage:
    """Damage the recording: put ``to`` at ``path`` (or remove the entry when ``to`` is ``DELETE``)."""

    def damage(payload: dict[str, Any]) -> None:
        node: Any = payload
        for step in path[:-1]:
            node = node[step]
        if to is DELETE:
            del node[path[-1]]
        else:
            node[path[-1]] = to

    return damage


def column_values(payload: dict[str, Any], variable: str, divisor: float, leads: list[int]) -> list[float | None]:
    """The recording's values of one variable as the frame lists them: hour by hour, the leads within each hour."""
    hourly = payload["hourly"]
    hours = len(hourly["time"])
    return [
        None if hourly[name][i] is None else hourly[name][i] / divisor
        for i in range(hours)
        for name in (series_name(variable, lead) for lead in leads)
    ]


# === the request ====================================================================================================


def test_the_recording_holds_the_48_requested_series() -> None:
    # The request names are checked against what the API really served, not only against the implementation.
    names = hourly_names(ALL_LEADS)
    assert len(names) == 48
    assert names[:2] == ["temperature_2m", "temperature_2m_previous_day1"]
    assert names[7] == "temperature_2m_previous_day7"
    assert names[8] == "dew_point_2m"
    assert names[-1] == "surface_pressure_previous_day7"
    assert set(names) == set(recorded()["hourly"]) - {"time"}
    assert set(names) == set(recorded()["hourly_units"]) - {"time"}


@pytest.mark.asyncio
async def test_request_params_exact(settings: Settings) -> None:
    requests: list[httpx2.Request] = []

    async with open_meteo_source(settings, recording(requests, answer_from_fixture)) as source:
        await fetch(source)

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "GET"
    assert str(request.url).startswith(settings.open_meteo_previous_runs_url + "?")
    assert list(request.url.params.multi_items()) == expected_params(
        lat="24.4330", lon="54.6511", model="ecmwf_ifs025", start="2025-07-01", end="2025-07-02", leads=ALL_LEADS
    )
    assert len(request.url.params["hourly"].split(",")) == 48


@pytest.mark.asyncio
async def test_request_follows_station_model_dates_and_leads(settings: Settings) -> None:
    requests: list[httpx2.Request] = []

    async with open_meteo_source(settings, recording(requests, answer_from_fixture)) as source:
        # Leads are requested once each and in ascending order, whatever order and repeats the caller used.
        frame = await fetch(source, at=OMDB, model=NwpModel.ECMWF_AIFS025, start=END, end=END, leads=[3, 1, 3])

    assert [list(request.url.params.multi_items()) for request in requests] == [
        expected_params(
            lat="25.2550",  # four decimals, trailing zero kept
            lon="55.3643",
            model="ecmwf_aifs025_single",
            start="2025-07-02",
            end="2025-07-02",
            leads=[1, 3],
        )
    ]
    assert frame.height == 24 * 2
    assert set(frame["station"]) == {"OMDB"}
    assert set(frame["model"]) == {"ecmwf_aifs025_single"}
    assert sorted(set(frame["lead_days"])) == [1, 3]
    assert frame["valid_time"].min() == datetime(2025, 7, 2, 0, tzinfo=UTC)
    assert frame["valid_time"].max() == datetime(2025, 7, 2, 23, tzinfo=UTC)


@pytest.mark.asyncio
@pytest.mark.parametrize("leads", [[8], [-1], [0, 9]], ids=["lead-8", "negative-lead", "lead-9-with-a-valid-one"])
async def test_a_lead_outside_0_to_7_is_rejected_before_any_request(settings: Settings, leads: list[int]) -> None:
    async with open_meteo_source(settings, forbidden) as source:
        with pytest.raises(ValueError, match="lead"):
            await fetch(source, leads=leads)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start", "end", "leads"),
    [
        pytest.param(END, START, ALL_LEADS, id="inverted-dates"),
        pytest.param(START, END, [], id="no-leads"),
    ],
)
async def test_an_empty_request_returns_the_empty_schema_without_a_call(
    settings: Settings, start: date, end: date, leads: list[int]
) -> None:
    async with open_meteo_source(settings, forbidden) as source:
        frame = await fetch(source, start=start, end=end, leads=leads)

    assert frame.schema == FORECAST_SCHEMA
    assert frame.height == 0


# === the parse ======================================================================================================


@pytest.mark.asyncio
async def test_parse_long_format(settings: Settings) -> None:
    payload = recorded()
    times = [datetime.fromisoformat(time).replace(tzinfo=UTC) for time in payload["hourly"]["time"]]
    assert len(times) == 48

    async with open_meteo_source(settings, answer_from_fixture) as source:
        frame = await fetch(source)
        await check_forecast_source(source, OMAA, NwpModel.ECMWF_IFS025, START, END, ALL_LEADS)

    assert frame.schema == FORECAST_SCHEMA
    assert frame.height == 48 * 8
    # One row per hour and lead, hour by hour, ascending leads within the hour.
    assert frame["valid_time"].to_list() == [time for time in times for _ in ALL_LEADS]
    assert frame["lead_days"].to_list() == ALL_LEADS * 48
    assert set(frame["station"]) == {"OMAA"}
    assert set(frame["model"]) == {"ecmwf_ifs025"}
    for variable, column, _, divisor in VARIABLES:
        assert frame[column].to_list() == column_values(payload, variable, divisor, ALL_LEADS), column
        assert frame[column].null_count() == 0
    # The grid cell is the one the API chose (24.5 N, 54.75 E, 16 m), not the station's coordinates.
    assert (set(frame["grid_lat"]), set(frame["grid_lon"]), set(frame["grid_elev_m"])) == ({24.5}, {54.75}, {16.0})


@pytest.mark.asyncio
async def test_parse_long_format_row_values(settings: Settings) -> None:
    async with open_meteo_source(settings, answer_from_fixture) as source:
        frame = await fetch(source)

    hourly = recorded()["hourly"]
    hour_5 = pl.col("valid_time") == datetime(2025, 7, 1, 5, tzinfo=UTC)
    row = frame.filter(hour_5 & (pl.col("lead_days") == 3)).row(0, named=True)
    # The same hour (index 5) of the previous-day-3 series, and wind converted from km/h.
    assert row["t_c"] == hourly["temperature_2m_previous_day3"][5]
    assert row["td_c"] == hourly["dew_point_2m_previous_day3"][5]
    assert row["wind_ms"] == hourly["wind_speed_10m_previous_day3"][5] / 3.6
    assert row["sw_wm2"] == hourly["shortwave_radiation_previous_day3"][5]
    assert row["direct_wm2"] == hourly["direct_radiation_previous_day3"][5]
    assert row["pressure_hpa"] == hourly["surface_pressure_previous_day3"][5]
    # Literals from the recording: the first hour, lead 3, is not read from the neighboring lead.
    first = frame.row(3, named=True)
    assert (first["lead_days"], first["t_c"], first["wind_ms"]) == (3, 27.2, 0.7 / 3.6)
    assert frame.row(0, named=True)["wind_ms"] == hourly["wind_speed_10m"][0] / 3.6  # lead 0 is the bare name


@pytest.mark.asyncio
async def test_a_missing_variable_is_a_null_column(settings: Settings) -> None:
    payload = recorded()
    for container in (payload["hourly"], payload["hourly_units"]):
        for name in [name for name in container if name.startswith("direct_radiation")]:
            del container[name]
    assert not any(name.startswith("direct_radiation") for name in payload["hourly"])

    async with open_meteo_source(settings, serve(payload)) as source:
        frame = await fetch(source)

    assert frame.height == 48 * 8
    assert frame["direct_wm2"].null_count() == frame.height
    assert frame.schema["direct_wm2"] == pl.Float64
    for variable, column, _, divisor in VARIABLES:
        if column != "direct_wm2":
            assert frame[column].to_list() == column_values(recorded(), variable, divisor, ALL_LEADS), column


@pytest.mark.asyncio
async def test_a_series_missing_for_one_lead_is_null_for_that_lead_only(settings: Settings) -> None:
    payload = recorded()
    del payload["hourly"]["temperature_2m_previous_day5"]
    del payload["hourly_units"]["temperature_2m_previous_day5"]

    async with open_meteo_source(settings, serve(payload)) as source:
        frame = await fetch(source)

    lead5 = frame.filter(pl.col("lead_days") == 5)
    assert lead5["t_c"].null_count() == lead5.height
    assert lead5["td_c"].null_count() == 0
    assert frame.filter(pl.col("lead_days") != 5)["t_c"].null_count() == 0


@pytest.mark.asyncio
async def test_absent_series_are_named_in_one_warning(settings: Settings, capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(settings)  # JSON on stdout, as in production
    payload = recorded()
    for name in ("temperature_2m_previous_day5", "direct_radiation"):
        del payload["hourly"][name]
        del payload["hourly_units"][name]

    async with open_meteo_source(settings, serve(payload)) as source:
        await fetch(source)

    warnings = [line for line in json_lines(capsys.readouterr().out) if line["event"] == "open_meteo.series_absent"]
    assert len(warnings) == 1
    assert warnings[0]["level"] == "warning"
    assert warnings[0]["station"] == "OMAA"
    assert warnings[0]["model"] == "ecmwf_ifs025"
    assert warnings[0]["absent"] == ["temperature_2m_previous_day5", "direct_radiation"]
    assert warnings[0]["requested"] == 48


@pytest.mark.asyncio
async def test_a_complete_response_logs_no_absent_series_warning(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging(settings)

    async with open_meteo_source(settings, serve(recorded())) as source:
        await fetch(source)

    assert [line for line in json_lines(capsys.readouterr().out) if line["event"] == "open_meteo.series_absent"] == []


@pytest.mark.asyncio
async def test_an_open_meteo_request_waits_up_to_180_seconds_like_the_research_pull(settings: Settings) -> None:
    # fetch_forecast_stations.py pulled these 139-day, 24-series windows with timeout=180; Settings.http_timeout_s
    # (60 s) was never tried on a response that heavy.
    requests: list[httpx2.Request] = []

    async with open_meteo_source(settings, recording(requests, serve(recorded()))) as source:
        await fetch(source)

    assert requests[0].extensions["timeout"] == {"connect": 180.0, "read": 180.0, "write": 180.0, "pool": 180.0}


@pytest.mark.asyncio
async def test_open_meteo_requests_are_paced_but_cache_hits_are_not(settings: Settings, tmp_path: Path) -> None:
    sleeps: list[float] = []
    now = [0.0]

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        now[0] += seconds

    pacer = RequestPacer(6.0, clock=lambda: now[0], sleep=sleep)
    requests: list[httpx2.Request] = []

    async with open_meteo_source(
        settings, recording(requests, serve(recorded())), RawResponseCache(tmp_path), pacer
    ) as source:
        await fetch(source)
        await fetch(source)  # from the cache
        await source.previous_runs(
            station=OMDB, model=NwpModel.ECMWF_IFS025, start=START, end=END, leads_days=ALL_LEADS
        )

    assert len(requests) == 2
    assert sleeps == [6.0]


@pytest.mark.asyncio
async def test_null_and_non_finite_values_become_null_never_nan(settings: Settings) -> None:
    payload = recorded()
    payload["hourly"]["temperature_2m_previous_day3"][0] = None
    payload["hourly"]["temperature_2m_previous_day3"][1] = float("nan")
    payload["hourly"]["temperature_2m_previous_day3"][2] = float("inf")
    payload["hourly"]["wind_speed_10m_previous_day3"][0] = None

    async with open_meteo_source(settings, serve(payload)) as source:
        frame = await fetch(source)

    lead3 = frame.filter(pl.col("lead_days") == 3)
    assert lead3["t_c"].head(4).to_list() == [None, None, None, 27.8]
    assert lead3["wind_ms"][0] is None
    assert lead3["wind_ms"][1] == 1.1 / 3.6
    for column in FLOAT_COLUMNS:
        assert not frame[column].is_nan().any(), column


@pytest.mark.asyncio
async def test_an_absent_elevation_is_a_null_grid_elevation(settings: Settings) -> None:
    # The research script read the elevation with `.get`; the other two grid values are required (see below).
    payload = recorded()
    del payload["elevation"]

    async with open_meteo_source(settings, serve(payload)) as source:
        frame = await fetch(source)

    assert frame["grid_elev_m"].null_count() == frame.height
    assert set(frame["grid_lat"]) == {24.5}


@pytest.mark.asyncio
async def test_a_response_without_hours_is_an_empty_frame_with_the_schema(settings: Settings) -> None:
    payload = recorded()
    payload["hourly"] = {name: [] for name in payload["hourly"]}

    async with open_meteo_source(settings, serve(payload)) as source:
        frame = await fetch(source)

    assert frame.schema == FORECAST_SCHEMA
    assert frame.height == 0


# === upstream drift fails loudly ====================================================================================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("key", "unit", "mentions"),
    [
        pytest.param("wind_speed_10m", "m/s", "m/s", id="wind-in-meters-per-second"),
        pytest.param("wind_speed_10m_previous_day7", "mph", "mph", id="wind-lead-7-in-miles-per-hour"),
        pytest.param("temperature_2m", "°F", "°F", id="temperature-in-fahrenheit"),
        pytest.param("dew_point_2m_previous_day2", "K", "K", id="dew-point-lead-2-in-kelvin"),
        pytest.param("shortwave_radiation", "MJ/m²", "MJ/m²", id="shortwave-in-megajoules"),
        pytest.param("direct_radiation_previous_day1", "kW/m²", "kW/m²", id="direct-lead-1-in-kilowatts"),
        pytest.param("surface_pressure", "kPa", "kPa", id="pressure-in-kilopascals"),
        pytest.param("wind_speed_10m_previous_day2", None, "no unit", id="a-series-without-a-unit"),
    ],
)
async def test_unit_mismatch_fails_loudly(
    settings: Settings, tmp_path: Path, key: str, unit: str | None, mentions: str
) -> None:
    payload = recorded()
    if unit is None:
        del payload["hourly_units"][key]
    else:
        payload["hourly_units"][key] = unit
    cache = RawResponseCache(tmp_path)

    async with open_meteo_source(settings, serve(payload), cache) as source:
        with pytest.raises(UpstreamError) as caught:
            await fetch(source)

    assert key in detail_of(caught.value)  # the series name, so the log says which one drifted
    assert mentions in detail_of(caught.value)
    assert caught.value.status == 200
    assert cached_files(tmp_path) == []  # a body that fails the check is never stored, so it cannot fail forever


@pytest.mark.asyncio
async def test_unit_of_a_series_that_was_not_requested_is_not_checked(settings: Settings) -> None:
    # Only leads 1 to 3 are asked for; the recording's other series may say anything.
    payload = recorded()
    payload["hourly_units"]["wind_speed_10m_previous_day7"] = "mph"

    async with open_meteo_source(settings, serve(payload)) as source:
        frame = await fetch(source, leads=[1, 2, 3])

    assert sorted(set(frame["lead_days"])) == [1, 2, 3]


@pytest.mark.asyncio
async def test_none_of_the_requested_variables_in_the_response_is_an_error(settings: Settings) -> None:
    payload = recorded()
    payload["hourly"] = {"time": payload["hourly"]["time"]}
    payload["hourly_units"] = {"time": "iso8601"}

    async with open_meteo_source(settings, serve(payload)) as source:
        with pytest.raises(UpstreamError) as caught:
            await fetch(source)

    assert "none of the 48" in detail_of(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("damage", "mentions"),
    [
        pytest.param(set_at("utc_offset_seconds", to=14400), "utc_offset_seconds", id="not-utc"),
        pytest.param(set_at("latitude", to=DELETE), "latitude", id="no-grid-latitude"),
        pytest.param(set_at("longitude", to="54.75"), "longitude", id="text-grid-longitude"),
        pytest.param(set_at("hourly_units", to=DELETE), "hourly_units", id="no-units-at-all"),
        pytest.param(set_at("hourly", to=[]), "hourly", id="hourly-is-not-an-object"),
        pytest.param(set_at("hourly", "time", to=DELETE), "hourly.time", id="no-time-axis"),
        pytest.param(set_at("hourly", "time", to=["2025-07-01 00:00"] * 48), "hourly.time", id="unparseable-times"),
        pytest.param(set_at("hourly", "time", 1, to="2025-07-01T00:00"), "duplicate", id="repeated-hour"),
        pytest.param(set_at("hourly", "wind_speed_10m", to=[1.0] * 47), "wind_speed_10m", id="short-series"),
        pytest.param(set_at("hourly", "dew_point_2m", 4, to="12.5"), "dew_point_2m", id="text-value"),
        pytest.param(set_at("hourly", "dew_point_2m", 4, to=True), "dew_point_2m", id="boolean-value"),
        pytest.param(set_at("hourly", "surface_pressure", to=7), "surface_pressure", id="series-is-not-a-list"),
    ],
)
async def test_malformed_body_raises_and_is_not_cached(
    settings: Settings, tmp_path: Path, damage: Damage, mentions: str
) -> None:
    payload = recorded()
    damage(payload)
    cache = RawResponseCache(tmp_path)

    async with open_meteo_source(settings, serve(payload), cache) as source:
        with pytest.raises(UpstreamError) as caught:
            await fetch(source)

    assert mentions in detail_of(caught.value)
    assert caught.value.status == 200
    assert cached_files(tmp_path) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "mentions"),
    [
        pytest.param(b"", "not JSON", id="empty-body"),
        pytest.param(b"<html><body>Bad gateway</body></html>", "not JSON", id="html-page"),
        pytest.param(b"\xff\xfe", "not JSON", id="not-text"),
        pytest.param(b"[1, 2, 3]", "not a JSON object", id="json-list"),
        pytest.param(b'"ok"', "not a JSON object", id="json-string"),
    ],
)
async def test_a_body_that_is_not_a_json_object_raises_and_is_not_cached(
    settings: Settings, tmp_path: Path, body: bytes, mentions: str
) -> None:
    cache = RawResponseCache(tmp_path)

    async with open_meteo_source(settings, lambda request: httpx2.Response(200, content=body), cache) as source:
        with pytest.raises(UpstreamError) as caught:
            await fetch(source)

    assert mentions in detail_of(caught.value)
    assert caught.value.status == 200
    assert cached_files(tmp_path) == []


# === errors the API reports =========================================================================================


@pytest.mark.asyncio
async def test_error_body_raises(settings: Settings) -> None:
    reason = "Cannot initialize WeatherVariable from invalid String value"
    requests: list[httpx2.Request] = []

    async with open_meteo_source(
        settings, recording(requests, lambda request: json_response({"error": True, "reason": reason}, 400))
    ) as source:
        with pytest.raises(UpstreamError) as caught:
            await fetch(source)

    assert len(requests) == 1  # a 400 is final: no retry
    assert reason in str(caught.value)
    assert caught.value.status == 400
    assert caught.value.url.startswith(settings.open_meteo_previous_runs_url)


@pytest.mark.asyncio
async def test_error_flag_in_a_success_body_raises_with_the_reason_and_is_not_cached(
    settings: Settings, tmp_path: Path
) -> None:
    reason = "Parameter 'start_date' is out of allowed range from 2022-01-01 until 2026-11-25"
    cache = RawResponseCache(tmp_path)

    async with open_meteo_source(
        settings, lambda request: json_response({"error": True, "reason": reason}), cache
    ) as source:
        with pytest.raises(UpstreamError) as caught:
            await fetch(source)

    assert reason in str(caught.value)
    assert caught.value.status == 200
    assert cached_files(tmp_path) == []


# === the cache ======================================================================================================


@pytest.mark.asyncio
async def test_second_identical_request_is_served_from_the_cache(settings: Settings, tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []
    cache = RawResponseCache(tmp_path)

    async with open_meteo_source(settings, recording(requests, answer_from_fixture), cache) as source:
        first = await fetch(source)
        second = await fetch(source)

    assert len(requests) == 1
    assert first.equals(second)
    assert first.height == 48 * 8
    assert len(cached_files(tmp_path)) == 1


@pytest.mark.asyncio
async def test_the_cache_key_separates_leads_and_dates(settings: Settings, tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []
    cache = RawResponseCache(tmp_path)

    async with open_meteo_source(settings, recording(requests, answer_from_fixture), cache) as source:
        await fetch(source)
        await fetch(source, leads=[1])
        await fetch(source, start=END)

    assert len(requests) == 3
    assert len(cached_files(tmp_path)) == 3
