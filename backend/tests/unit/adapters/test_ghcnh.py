"""``GhcnhParquetSource`` against a recorded GHCNh by-year file (``tests/fixtures/ghcnh``, 58 rows of 2025-07-01/02)."""

import io
import json
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx2
import polars as pl
import pytest

from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import UpstreamError, build_async_client
from stellar_blaze.adapters.sources.ghcnh import GhcnhParquetSource
from stellar_blaze.config import Settings
from stellar_blaze.domain.weather.schemas import OBS_RAW_SCHEMA
from stellar_blaze.domain.weather.stations import station
from stellar_blaze.logging import configure_logging
from tests.unit.adapters.http_support import cached_files, forbidden
from tests.unit.contract.observation_contract import check_observation_source

pytestmark = pytest.mark.unit

OMAA = station("OMAA")
OMRK = station("OMRK")  # its GHCNh id (AEU041184-1) is not its ICAO: the station column must carry the ICAO
FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "ghcnh" / "GHCNh_AEI0000OMAA_2025_0701-0703.parquet"

START = datetime(2025, 7, 1, tzinfo=UTC)
END = datetime(2025, 7, 3, tzinfo=UTC)

Handler = Callable[[httpx2.Request], httpx2.Response]


def year_url(settings: Settings, ghcnh_id: str, year: int) -> str:
    return f"{settings.ghcnh_base_url}/{year}/parquet/GHCNh_{ghcnh_id}_{year}.parquet"


def parquet_bytes(frame: pl.DataFrame) -> bytes:
    buffer = io.BytesIO()
    frame.write_parquet(buffer)
    return buffer.getvalue()


def ghcnh_frame(
    dates: list[str],
    *,
    temperature: list[float | None] | None = None,
    temperature_qc: list[str | None] | None = None,
) -> pl.DataFrame:
    """The columns the adapter reads, in the shape of a real file (``DATE`` is a String), for synthetic cases."""
    n = len(dates)
    return pl.DataFrame(
        {
            "STATION": ["AEI0000OMAA"] * n,
            "DATE": dates,
            "temperature": temperature if temperature is not None else [30.0 + i for i in range(n)],
            "temperature_Quality_Code": temperature_qc if temperature_qc is not None else ["1"] * n,
            "dew_point_temperature": [10.0] * n,
            "dew_point_temperature_Quality_Code": ["1"] * n,
            "wind_speed": [3.0] * n,
            "wind_speed_Quality_Code": ["1"] * n,
        },
        schema_overrides={
            "temperature": pl.Float64,
            "temperature_Quality_Code": pl.String,
            "dew_point_temperature": pl.Float64,
            "wind_speed": pl.Float64,
        },
    )


def serving(files: Mapping[str, bytes], requests: list[httpx2.Request] | None = None) -> Handler:
    """Answers the by-year URLs it was given with their bytes and every other URL with 404, like NCEI."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        if requests is not None:
            requests.append(request)
        body = files.get(str(request.url))
        if body is None:
            return httpx2.Response(404, content=b"Not Found")
        return httpx2.Response(200, content=body)

    return handler


@asynccontextmanager
async def ghcnh_source(
    settings: Settings, handler: Handler, cache: RawResponseCache | None = None, base_url: str | None = None
) -> AsyncIterator[GhcnhParquetSource]:
    async with build_async_client(settings, httpx2.MockTransport(handler)) as client:
        yield GhcnhParquetSource(client, base_url or settings.ghcnh_base_url, cache)


@pytest.fixture
def fixture_files(settings: Settings) -> dict[str, bytes]:
    return {year_url(settings, OMAA.ghcnh_id, 2025): FIXTURE.read_bytes()}


def json_lines(out: str) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = [json.loads(line) for line in out.splitlines() if line.strip()]
    return parsed


# === parse ==========================================================================================================


@pytest.mark.asyncio
async def test_ghcnh_maps_columns_and_keeps_qc_codes(settings: Settings, fixture_files: dict[str, bytes]) -> None:
    requests: list[httpx2.Request] = []

    async with ghcnh_source(settings, serving(fixture_files, requests)) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert [str(r.url) for r in requests] == [year_url(settings, "AEI0000OMAA", 2025)]  # one GET, no query string
    raw = pl.read_parquet(FIXTURE)
    assert frame.schema == OBS_RAW_SCHEMA
    assert frame.height == raw.height == 58
    assert frame["obs_time"].to_list() == [datetime.fromisoformat(date).replace(tzinfo=UTC) for date in raw["DATE"]]
    assert frame["t_c"].to_list() == raw["temperature"].to_list()
    assert frame["td_c"].to_list() == raw["dew_point_temperature"].to_list()
    assert frame["wind_ms"].to_list() == raw["wind_speed"].to_list()
    assert frame["qc_t"].to_list() == raw["temperature_Quality_Code"].to_list()
    assert frame["qc_td"].to_list() == raw["dew_point_temperature_Quality_Code"].to_list()
    assert frame["qc_wind"].to_list() == raw["wind_speed_Quality_Code"].to_list()
    assert frame.schema["qc_td"] == pl.String
    assert frame["qc_t"].null_count() < frame.height  # at least one row has a quality code
    assert set(frame["station"]) == {"OMAA"}  # the ICAO, not AEI0000OMAA
    assert set(frame["source"]) == {"ghcnh"}


@pytest.mark.asyncio
async def test_ghcnh_does_not_filter_on_quality_codes(settings: Settings, fixture_files: dict[str, bytes]) -> None:
    async with ghcnh_source(settings, serving(fixture_files)) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    suspect = frame.filter(pl.col("qc_td") == "2")
    assert suspect.height >= 1  # the dew point at 2025-07-01 12:00 and 14:00 is flagged suspect in the file
    assert suspect["td_c"].null_count() == 0  # and still carried: binning applies the policy, not the source


@pytest.mark.asyncio
async def test_ghcnh_satisfies_the_observation_contract(settings: Settings, fixture_files: dict[str, bytes]) -> None:
    end = datetime(2025, 7, 2, 12, tzinfo=UTC)
    assert "2025-07-02T12:00:00" in pl.read_parquet(FIXTURE)["DATE"].to_list()  # a report sits exactly at `end`

    async with ghcnh_source(settings, serving(fixture_files)) as source:
        await check_observation_source(source, OMAA, START, end)


@pytest.mark.asyncio
async def test_ghcnh_blank_quality_codes_and_nan_values_become_null(settings: Settings) -> None:
    dates = ["2025-07-01T00:00:00", "2025-07-01T01:00:00", "2025-07-01T02:00:00", "2025-07-01T03:00:00"]
    frame = ghcnh_frame(
        dates,
        temperature=[30.0, float("nan"), None, 33.0],
        temperature_qc=["", "  ", None, " 1 "],
    )
    files = {year_url(settings, OMAA.ghcnh_id, 2025): parquet_bytes(frame)}

    async with ghcnh_source(settings, serving(files)) as source:
        result = await source.observations(station=OMAA, start=START, end=END)

    assert result["qc_t"].to_list() == [None, None, None, "1"]  # blank is null; a padded code is trimmed
    assert result["t_c"].to_list() == [30.0, None, None, 33.0]  # NaN is null, never NaN


# === the window =====================================================================================================


@pytest.mark.asyncio
async def test_ghcnh_window_is_half_open(settings: Settings, fixture_files: dict[str, bytes]) -> None:
    start, end = datetime(2025, 7, 1, 6, tzinfo=UTC), datetime(2025, 7, 1, 12, tzinfo=UTC)
    raw = pl.read_parquet(FIXTURE)
    assert {"2025-07-01T06:00:00", "2025-07-01T12:00:00"} <= set(raw["DATE"])  # reports exactly at both edges

    async with ghcnh_source(settings, serving(fixture_files)) as source:
        frame = await source.observations(station=OMAA, start=start, end=end)

    expected = [
        moment for date in raw["DATE"] if start <= (moment := datetime.fromisoformat(date).replace(tzinfo=UTC)) < end
    ]
    assert frame["obs_time"].to_list() == expected
    assert frame["obs_time"][0] == start
    assert end not in frame["obs_time"].to_list()


@pytest.mark.asyncio
@pytest.mark.parametrize("end_offset", [timedelta(0), timedelta(hours=-1)], ids=["empty-window", "inverted-window"])
async def test_ghcnh_window_without_duration_makes_no_request(settings: Settings, end_offset: timedelta) -> None:
    async with ghcnh_source(settings, forbidden) as source:
        frame = await source.observations(station=OMAA, start=START, end=START + end_offset)

    assert frame.schema == OBS_RAW_SCHEMA
    assert frame.height == 0


@pytest.mark.asyncio
async def test_ghcnh_rejects_a_naive_window(settings: Settings) -> None:
    async with ghcnh_source(settings, forbidden) as source:
        with pytest.raises(ValueError, match="timezone-aware"):
            await source.observations(station=OMAA, start=START.replace(tzinfo=None), end=END)


@pytest.mark.asyncio
async def test_ghcnh_downloads_each_year_the_window_touches_once(settings: Settings) -> None:
    files = {
        year_url(settings, OMRK.ghcnh_id, 2024): parquet_bytes(
            ghcnh_frame(["2024-12-30T23:00:00", "2024-12-31T00:00:00", "2024-12-31T23:00:00"])
        ),
        year_url(settings, OMRK.ghcnh_id, 2025): parquet_bytes(
            ghcnh_frame(["2025-01-01T00:00:00", "2025-01-01T23:00:00", "2025-01-02T00:00:00"])
        ),
    }
    requests: list[httpx2.Request] = []

    async with ghcnh_source(settings, serving(files, requests)) as source:
        frame = await source.observations(
            station=OMRK, start=datetime(2024, 12, 31, tzinfo=UTC), end=datetime(2025, 1, 2, tzinfo=UTC)
        )

    assert sorted(str(r.url) for r in requests) == sorted(files)  # the id in the URL is AEU041184-1
    assert "AEU041184-1" in str(requests[0].url)
    assert frame["obs_time"].to_list() == [
        datetime(2024, 12, 31, 0, tzinfo=UTC),
        datetime(2024, 12, 31, 23, tzinfo=UTC),
        datetime(2025, 1, 1, 0, tzinfo=UTC),
        datetime(2025, 1, 1, 23, tzinfo=UTC),
    ]
    assert set(frame["station"]) == {"OMRK"}
    assert frame.schema == OBS_RAW_SCHEMA


@pytest.mark.asyncio
async def test_ghcnh_window_ending_at_new_year_does_not_download_the_next_year(settings: Settings) -> None:
    files = {year_url(settings, OMAA.ghcnh_id, 2025): parquet_bytes(ghcnh_frame(["2025-12-31T23:00:00"]))}
    requests: list[httpx2.Request] = []

    async with ghcnh_source(settings, serving(files, requests)) as source:
        frame = await source.observations(
            station=OMAA, start=datetime(2025, 12, 31, tzinfo=UTC), end=datetime(2026, 1, 1, tzinfo=UTC)
        )

    assert [str(r.url) for r in requests] == list(files)
    assert frame.height == 1


@pytest.mark.asyncio
async def test_ghcnh_local_window_is_converted_to_utc_years(settings: Settings) -> None:
    # 2025-01-01 02:00 at UTC+4 is 2024-12-31 22:00 UTC, so the 2024 file is needed.
    files = {year_url(settings, OMAA.ghcnh_id, 2024): parquet_bytes(ghcnh_frame(["2024-12-31T22:00:00"]))}
    requests: list[httpx2.Request] = []
    local = timezone(timedelta(hours=4))

    async with ghcnh_source(settings, serving(files, requests)) as source:
        frame = await source.observations(
            station=OMAA, start=datetime(2025, 1, 1, 2, tzinfo=local), end=datetime(2025, 1, 1, 4, tzinfo=local)
        )

    assert [str(r.url) for r in requests] == list(files)
    assert frame["obs_time"].to_list() == [datetime(2024, 12, 31, 22, tzinfo=UTC)]


# === missing years and failures =====================================================================================


@pytest.mark.asyncio
async def test_ghcnh_missing_year_is_empty(settings: Settings, capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(settings)  # JSON on stdout, as in production

    async with ghcnh_source(settings, serving({})) as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame.schema == OBS_RAW_SCHEMA
    assert frame.height == 0
    warnings = [line for line in json_lines(capsys.readouterr().out) if line["event"] == "ghcnh.year_missing"]
    assert len(warnings) == 1
    assert warnings[0]["level"] == "warning"
    assert warnings[0]["station"] == "OMAA"
    assert warnings[0]["year"] == 2025
    assert warnings[0]["url"] == year_url(settings, "AEI0000OMAA", 2025)


@pytest.mark.asyncio
async def test_ghcnh_year_without_a_file_is_skipped_and_the_other_year_is_kept(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging(settings)
    files = {year_url(settings, OMAA.ghcnh_id, 2025): parquet_bytes(ghcnh_frame(["2025-01-01T00:00:00"]))}

    async with ghcnh_source(settings, serving(files)) as source:
        frame = await source.observations(
            station=OMAA, start=datetime(2024, 12, 31, tzinfo=UTC), end=datetime(2025, 1, 2, tzinfo=UTC)
        )

    assert frame["obs_time"].to_list() == [datetime(2025, 1, 1, tzinfo=UTC)]
    missing = [line for line in json_lines(capsys.readouterr().out) if line["event"] == "ghcnh.year_missing"]
    assert [line["year"] for line in missing] == [2024]


@pytest.mark.asyncio
async def test_ghcnh_other_http_errors_are_not_mistaken_for_a_missing_year(settings: Settings) -> None:
    def forbidden_file(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(403, content=b"Forbidden")

    async with ghcnh_source(settings, forbidden_file) as source:
        with pytest.raises(UpstreamError) as caught:
            await source.observations(station=OMAA, start=START, end=END)

    assert caught.value.status == 403


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        pytest.param(b"", id="empty-body"),
        pytest.param(b"<html><body>Maintenance</body></html>", id="html-page"),
        pytest.param(parquet_bytes(ghcnh_frame(["2025-07-01T00:00:00"]).drop("temperature")), id="missing-column"),
        pytest.param(
            parquet_bytes(
                ghcnh_frame(["2025-07-01T00:00:00"]).with_columns(
                    pl.col("DATE").str.to_datetime("%Y-%m-%dT%H:%M:%S", time_zone="UTC")
                )
            ),
            id="date-is-not-a-string",
        ),
        pytest.param(parquet_bytes(ghcnh_frame(["01/07/2025 00:00"])), id="unparseable-date"),
    ],
)
async def test_ghcnh_unusable_success_body_raises_and_is_not_cached(
    settings: Settings, tmp_path: Path, body: bytes
) -> None:
    files = {year_url(settings, OMAA.ghcnh_id, 2025): body}
    cache = RawResponseCache(tmp_path)

    async with ghcnh_source(settings, serving(files), cache) as source:
        with pytest.raises(UpstreamError) as caught:
            await source.observations(station=OMAA, start=START, end=END)

    assert caught.value.status == 200
    assert caught.value.url == year_url(settings, "AEI0000OMAA", 2025)
    assert cached_files(tmp_path) == []


@pytest.mark.asyncio
async def test_ghcnh_second_identical_request_is_served_from_the_cache(
    settings: Settings, fixture_files: dict[str, bytes], tmp_path: Path
) -> None:
    requests: list[httpx2.Request] = []
    cache = RawResponseCache(tmp_path)

    async with ghcnh_source(settings, serving(fixture_files, requests), cache) as source:
        first = await source.observations(station=OMAA, start=START, end=END)
        second = await source.observations(station=OMAA, start=START, end=END)

    assert len(requests) == 1
    assert first.equals(second)


@pytest.mark.asyncio
async def test_ghcnh_base_url_may_end_with_a_slash(settings: Settings, fixture_files: dict[str, bytes]) -> None:
    async with ghcnh_source(settings, serving(fixture_files), base_url=settings.ghcnh_base_url + "/") as source:
        frame = await source.observations(station=OMAA, start=START, end=END)

    assert frame.height == 58
