"""``IemMetarSource`` against a recorded IEM response (``tests/fixtures/iem/OMAA_2025-07-01_03.csv``)."""

import csv
import io
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import httpx2
import polars as pl
import pytest

from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import UpstreamError, build_async_client
from stellar_blaze.adapters.http.pacer import RequestPacer
from stellar_blaze.adapters.sources.iem import IemMetarSource
from stellar_blaze.config import Settings
from stellar_blaze.domain.weather.schemas import OBS_RAW_SCHEMA
from stellar_blaze.domain.weather.stations import station
from tests.unit.adapters.http_support import cached_files, forbidden
from tests.unit.contract.observation_contract import check_observation_source

pytestmark = pytest.mark.unit

OMAA = station("OMAA")
FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "iem" / "OMAA_2025-07-01_03.csv"
HEADER = "station,valid,tmpf,dwpf,sknt\n"

START = datetime(2025, 7, 1, tzinfo=UTC)
END = datetime(2025, 7, 3, tzinfo=UTC)

Handler = Callable[[httpx2.Request], httpx2.Response]


def fixture_text() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def fixture_rows() -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(fixture_text())))


def row_time(row: dict[str, str]) -> datetime:
    return datetime.strptime(row["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=UTC)


def with_cell(line: str, *, index: int, value: str) -> str:
    cells = line.split(",")
    cells[index] = value
    return ",".join(cells)


def csv_response(text: str) -> httpx2.Response:
    return httpx2.Response(200, content=text.encode(), headers={"content-type": "text/plain; charset=UTF-8"})


def serve_fixture(request: httpx2.Request) -> httpx2.Response:
    return csv_response(fixture_text())


def expected_params(first: tuple[int, int, int], last: tuple[int, int, int]) -> list[tuple[str, str]]:
    """The query string of the data-availability study, in its order, for the dates (year, month, day) asked for."""
    (y1, m1, d1), (y2, m2, d2) = first, last
    return [
        ("station", "OMAA"),
        ("data", "tmpf"),
        ("data", "dwpf"),
        ("data", "sknt"),
        ("year1", str(y1)),
        ("month1", str(m1)),
        ("day1", str(d1)),
        ("year2", str(y2)),
        ("month2", str(m2)),
        ("day2", str(d2)),
        ("tz", "Etc/UTC"),
        ("format", "onlycomma"),
        ("latlon", "no"),
        ("elev", "no"),
        ("missing", "empty"),
        ("trace", "T"),
        ("direct", "no"),
        ("report_type", "3"),
        ("report_type", "4"),
    ]


@asynccontextmanager
async def iem_source(
    settings: Settings, handler: Handler, cache: RawResponseCache | None = None, pacer: RequestPacer | None = None
) -> AsyncIterator[IemMetarSource]:
    async with build_async_client(settings, httpx2.MockTransport(handler)) as client:
        yield IemMetarSource(client, settings.iem_asos_url, cache, pacer=pacer)


def recorded(requests: list[httpx2.Request], answer: Handler) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return answer(request)

    return handler


# === pacing and timeout =============================================================================================


class CountingTime:
    """A clock and sleep for ``RequestPacer`` that record the sleeps and spend no time."""

    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.mark.asyncio
async def test_iem_requests_are_paced_but_cache_hits_are_not(settings: Settings, tmp_path: Path) -> None:
    time = CountingTime()
    pacer = RequestPacer(2.0, clock=time.clock, sleep=time.sleep)
    cache = RawResponseCache(tmp_path)
    requests: list[httpx2.Request] = []

    async with iem_source(settings, recorded(requests, serve_fixture), cache, pacer) as source:
        await source.observations(station=OMAA, start=START, end=END)  # a request: first, so no wait
        await source.observations(station=OMAA, start=START, end=END)  # the same request from the cache: no pacing
        await source.observations(station=station("OMDB"), start=START, end=END)  # a second request: paced

    assert len(requests) == 2
    assert time.sleeps == [2.0]


@pytest.mark.asyncio
async def test_a_wide_window_request_waits_up_to_180_seconds_like_the_research_download(settings: Settings) -> None:
    # The research's fetch_iem.py downloaded each 140-day station window with timeout=180; Settings.http_timeout_s
    # (60 s) was never tried on a window that wide.
    requests: list[httpx2.Request] = []

    async with iem_source(settings, recorded(requests, serve_fixture)) as source:
        await source.observations(station=OMAA, start=START, end=END)

    assert requests[0].extensions["timeout"] == {"connect": 180.0, "read": 180.0, "write": 180.0, "pool": 180.0}


# === request and parse ==============================================================================================


@pytest.mark.asyncio
async def test_iem_request_params_and_parse(settings: Settings) -> None:
    requests: list[httpx2.Request] = []

    async with iem_source(settings, recorded(requests, serve_fixture)) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "GET"
    assert str(request.url).startswith(settings.iem_asos_url + "?")
    assert list(request.url.params.multi_items()) == expected_params((2025, 7, 1), (2025, 7, 3))

    rows = fixture_rows()
    assert frame.schema == OBS_RAW_SCHEMA
    assert frame.height == len(rows)
    assert frame["obs_time"].to_list() == [row_time(row) for row in rows]
    assert set(frame["station"]) == {"OMAA"}
    assert set(frame["source"]) == {"iem"}
    first = rows[0]
    tmpf, dwpf, sknt = float(first["tmpf"]), float(first["dwpf"]), float(first["sknt"])
    assert frame["t_c"][0] == (tmpf - 32) * 5 / 9
    assert frame["td_c"][0] == (dwpf - 32) * 5 / 9
    assert frame["wind_ms"][0] == sknt * 0.514444
    for i, row in enumerate(rows):  # every row, not just the first
        assert frame["t_c"][i] == pytest.approx((float(row["tmpf"]) - 32) * 5 / 9)
        assert frame["td_c"][i] == pytest.approx((float(row["dwpf"]) - 32) * 5 / 9)
        assert frame["wind_ms"][i] == pytest.approx(float(row["sknt"]) * 0.514444)


@pytest.mark.asyncio
async def test_iem_has_no_quality_codes_but_typed_nulls(settings: Settings) -> None:
    async with iem_source(settings, serve_fixture) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    for column in ("qc_t", "qc_td", "qc_wind"):
        assert frame.schema[column] == pl.String
        assert frame[column].null_count() == frame.height


@pytest.mark.asyncio
async def test_iem_satisfies_the_observation_contract(settings: Settings) -> None:
    rows = fixture_rows()
    end = datetime(2025, 7, 2, 12, tzinfo=UTC)
    assert end in {row_time(row) for row in rows}  # a report sits exactly at `end`: the window is half-open

    def by_window(request: httpx2.Request) -> httpx2.Response:
        # Answers per request from the dates it carries; never assumes how many requests the contract makes.
        params = request.url.params
        if (params["year1"], params["month1"], params["day1"]) == ("2025", "7", "1"):
            return csv_response(fixture_text())
        return csv_response(HEADER)  # no reports in this window

    async with iem_source(settings, by_window) as source:
        await check_observation_source(source, OMAA, START, end)


# === the window =====================================================================================================


@pytest.mark.asyncio
async def test_iem_window_is_half_open(settings: Settings) -> None:
    start, end = datetime(2025, 7, 1, 6, tzinfo=UTC), datetime(2025, 7, 1, 12, tzinfo=UTC)
    rows = fixture_rows()
    assert {start, end} <= {row_time(row) for row in rows}  # reports exactly at both edges

    async with iem_source(settings, serve_fixture) as source:
        frame = await source.observations(station=OMAA, start=start, end=end)

    expected = [row_time(row) for row in rows if start <= row_time(row) < end]
    assert frame["obs_time"].to_list() == expected
    assert frame["obs_time"][0] == start  # `start` kept
    assert end not in frame["obs_time"].to_list()  # `end` dropped


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start", "end", "first", "last"),
    [
        pytest.param(START, END, (2025, 7, 1), (2025, 7, 3), id="midnight-end-is-exclusive-upstream-too"),
        pytest.param(
            datetime(2025, 7, 1, 6, tzinfo=UTC),
            datetime(2025, 7, 1, 18, 30, tzinfo=UTC),
            (2025, 7, 1),
            (2025, 7, 2),
            id="end-during-the-day-requests-through-the-next-day",
        ),
        pytest.param(
            datetime(2025, 7, 30, tzinfo=UTC),
            datetime(2025, 7, 31, 12, tzinfo=UTC),
            (2025, 7, 30),
            (2025, 8, 1),
            id="next-day-crosses-the-month",
        ),
        pytest.param(
            datetime(2025, 12, 30, tzinfo=UTC),
            datetime(2025, 12, 31, 0, 0, 1, tzinfo=UTC),
            (2025, 12, 30),
            (2026, 1, 1),
            id="one-second-after-midnight-crosses-the-year",
        ),
        pytest.param(
            datetime(2025, 7, 1, 4, tzinfo=timezone(timedelta(hours=4))),
            datetime(2025, 7, 3, 4, tzinfo=timezone(timedelta(hours=4))),
            (2025, 7, 1),
            (2025, 7, 3),
            id="local-times-are-converted-to-utc",
        ),
        pytest.param(
            datetime(2025, 7, 1, 2, tzinfo=timezone(timedelta(hours=4))),
            datetime(2025, 7, 1, 6, tzinfo=timezone(timedelta(hours=4))),
            (2025, 6, 30),  # 02:00 +04:00 is 22:00 UTC the day before
            (2025, 7, 2),  # 06:00 +04:00 is 02:00 UTC, not midnight: through the next UTC day
            id="the-utc-date-differs-from-the-local-date",
        ),
    ],
)
async def test_iem_request_dates_cover_the_window(
    settings: Settings, start: datetime, end: datetime, first: tuple[int, int, int], last: tuple[int, int, int]
) -> None:
    requests: list[httpx2.Request] = []

    async with iem_source(settings, recorded(requests, lambda request: csv_response(HEADER))) as source:
        await source.observations(station=OMAA, start=start, end=end)

    assert [list(request.url.params.multi_items()) for request in requests] == [expected_params(first, last)]


@pytest.mark.asyncio
async def test_iem_end_during_the_day_is_filtered_not_truncated(settings: Settings) -> None:
    start, end = datetime(2025, 7, 1, tzinfo=UTC), datetime(2025, 7, 1, 18, 30, tzinfo=UTC)
    requests: list[httpx2.Request] = []

    async with iem_source(settings, recorded(requests, serve_fixture)) as source:
        frame = await source.observations(station=OMAA, start=start, end=end)

    assert requests[0].url.params["day2"] == "2"  # the whole of 2025-07-01 is requested
    expected = [row_time(row) for row in fixture_rows() if start <= row_time(row) < end]
    assert frame["obs_time"].to_list() == expected
    assert frame["obs_time"][-1] == datetime(2025, 7, 1, 18, tzinfo=UTC)  # the 18:00 report is there, 19:00 is not


@pytest.mark.asyncio
@pytest.mark.parametrize("end_offset", [timedelta(0), timedelta(hours=-1)], ids=["empty-window", "inverted-window"])
async def test_iem_window_without_duration_makes_no_request(settings: Settings, end_offset: timedelta) -> None:
    # IEM answers a request whose end equals its start with a whole day, so the adapter does not ask at all.
    async with iem_source(settings, forbidden) as source:
        frame = await source.observations(station=OMAA, start=START, end=START + end_offset)

    assert frame.schema == OBS_RAW_SCHEMA
    assert frame.height == 0


@pytest.mark.asyncio
async def test_iem_rejects_a_naive_window(settings: Settings) -> None:
    async with iem_source(settings, forbidden) as source:
        with pytest.raises(ValueError, match="timezone-aware"):
            await source.observations(station=OMAA, start=START.replace(tzinfo=None), end=END)


# === missing and malformed cells ====================================================================================


@pytest.mark.asyncio
async def test_iem_empty_cells_become_null(settings: Settings) -> None:
    first, second = fixture_text().splitlines()[1:3]
    body = HEADER + "\n".join(with_cell(line, index=3, value="") for line in (first, second)) + "\n"  # dwpf

    async with iem_source(settings, lambda request: csv_response(body)) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame.height == 2
    assert frame["td_c"].to_list() == [None, None]
    assert frame["t_c"].null_count() == 0
    assert frame["wind_ms"].null_count() == 0


@pytest.mark.asyncio
async def test_iem_non_numeric_cells_become_null_never_nan(settings: Settings) -> None:
    lines = [
        "OMAA,2025-07-01 00:00,M,nan,inf",
        "OMAA,2025-07-01 01:00,,-inf,abc",
        "OMAA,2025-07-01 02:00,86.00,59.00,1.00",
    ]
    body = HEADER + "".join(f"{line}\n" for line in lines)

    async with iem_source(settings, lambda request: csv_response(body)) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame["t_c"].to_list() == [None, None, 30.0]
    assert frame["td_c"].to_list() == [None, None, 15.0]
    assert frame["wind_ms"].to_list() == [None, None, 0.514444]


@pytest.mark.asyncio
async def test_iem_header_only_body_is_an_empty_frame_with_the_schema(settings: Settings) -> None:
    async with iem_source(settings, lambda request: csv_response(HEADER)) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame.schema == OBS_RAW_SCHEMA
    assert frame.height == 0


@pytest.mark.asyncio
async def test_iem_report_outside_the_window_in_the_body_gives_an_empty_frame(settings: Settings) -> None:
    body = HEADER + "OMAA,2025-07-05 00:00,86.00,59.00,1.00\n"

    async with iem_source(settings, lambda request: csv_response(body)) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame.schema == OBS_RAW_SCHEMA
    assert frame.height == 0


# === failures and the cache =========================================================================================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        pytest.param("", id="empty-body"),
        pytest.param("<html><body>Maintenance</body></html>", id="html-page"),
        pytest.param(HEADER + "OMAA,not a time,86.00,59.00,1.00\n", id="unparseable-time"),
    ],
)
async def test_iem_unusable_success_body_raises_and_is_not_cached(
    settings: Settings, tmp_path: Path, body: str
) -> None:
    cache = RawResponseCache(tmp_path)

    async with iem_source(settings, lambda request: csv_response(body), cache) as source:
        with pytest.raises(UpstreamError) as caught:
            await source.observations(station=OMAA, start=START, end=END)

    assert caught.value.status == 200
    assert caught.value.url.startswith(settings.iem_asos_url)
    assert cached_files(tmp_path) == []


@pytest.mark.asyncio
async def test_iem_http_error_raises_upstream_error(settings: Settings) -> None:
    def forbidden_station(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(403, content=b"Forbidden")

    async with iem_source(settings, forbidden_station) as source:
        with pytest.raises(UpstreamError) as caught:
            await source.observations(station=OMAA, start=START, end=END)

    assert caught.value.status == 403


@pytest.mark.asyncio
async def test_iem_second_identical_request_is_served_from_the_cache(settings: Settings, tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []
    cache = RawResponseCache(tmp_path)

    async with iem_source(settings, recorded(requests, serve_fixture), cache) as source:
        first = await source.observations(station=OMAA, start=START, end=END)
        second = await source.observations(station=OMAA, start=START, end=END)

    assert len(requests) == 1
    assert first.equals(second)
    assert first.height == len(fixture_rows())
