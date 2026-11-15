"""``evaluate-2026 --part warnings|plans`` end to end on a synthetic world (review finding I8 of Feature E).

The two parts run ONCE on the real 2026 data and a second run is refused, so the glue between the pieces (the series
reader, ``load_test_pairs``, the radiation filter and 1:1 join, ``released_sampler``, the freeze addendum, the
all-or-nothing writer) must be proved beforehand. Nothing here touches a real file: the world is B2's ``GatedWorld``
(a tmp repository with a fake git) with a synthetic gold file, the series the forecast part would have written (made
with its own writers, ``series_frame`` / ``series_parquet_bytes`` / ``series_manifest``), the committed ruleset and demo
fixture, a ``theta.json`` and a freeze addendum that records the SHA-256 of the three. The sampler is the real one (the
synthetic released model of ``tests/fixtures/forecast/gated.py``); the real run uses the committed released model, which
this test cannot load (see the report for the checklist of what only the real run exercises).

The weather is designed so that every count can be made by hand. All days are Monday-Friday 22-26 June 2026 (inside
the 15 Jun-15 Sep ban season, so 09 and 10 UTC weigh 0 and 08 UTC weighs 0.5), hours 02-15 UTC, leads 1-7 (the scorer
keeps 1, 2, 3, 5 and 7). A "hot" hour is deep in the Red zone (43 C, dew point 27 C, wind 1 m/s: TWL about 60 W/m2), a
"mild" hour is deep in the Low zone (30 C, 10 C, 5 m/s: TWL above 245), so the 50 corrected samples (spread 0.3 C) all
fall in one zone and the thresholds theta cannot matter.

* truth, hot UTC hours per day (a label is the start of its hour, and the zone timeline interpolates linearly between
  hourly labels, so a hot hour next to a shift block would leak ticks into it: the hot hours are the whole afternoon
  block, labels 11-14 UTC = 15:00-18:00 GST, plus 08 UTC, which lies in the gap between the blocks): D0 (22 Jun) none;
  D1 (23), D2 (24) and D3 (25) 11, 12, 13, 14; D4 (26) 08, 11, 12, 13, 14, with ``wbgt_obs_reject`` = 3 at 12 UTC (so
  D4, the hottest day, is not a demo-day candidate).
* forecasts: lead 1 the raw IFS says mild everywhere while the corrected grids are hot where the truth is; lead 2 both
  are hot where the truth is; lead 3 both are hot at every hour; leads 4-7 both are mild everywhere.

Worked hours per day are 06, 07, 08, 11, 12, 13, 14 UTC (06-14 minus the weight-0 hours 09 and 10): 7 hours of weight
1, 1, 0.5, 1, 1, 1, 1 = 6.5. Over the 5 days: 35 worked hours per lead and 32.5 weighted hours. Truth danger hours:
D1 4, D2 4, D3 4, D4 5 (08, 11-14; weighted 4.5), so 17 worked danger hours and 4 + 4 + 4 + 4.5 = 16.5 weighted.
"""

import hashlib
import json
import re
import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime
from functools import cache
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Final, NamedTuple, cast

import numpy as np
import polars as pl
import pytest

from stellar_blaze.config import Settings
from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64
from stellar_blaze.domain.physics.solar import mean_cos_zenith_prev_hour
from stellar_blaze.domain.provenance import Provenance as WireProvenance
from stellar_blaze.domain.provenance import ProvenanceLabel as WireLabel
from stellar_blaze.domain.scoreboard import (
    DemoDay,
    PlanRow,
    PlanScoreboard,
    PolicyScoreboard,
    Provenance,
    ProvenanceLabel,
    ThetaDecision,
    ThetaGridPoint,
)
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import GOLD_PAIRS_SCHEMA
from stellar_blaze.domain.weather.stations import station
from stellar_blaze.jobs import evaluate_2026, replay_build
from stellar_blaze.ml.artifact_io import write_artifact
from stellar_blaze.ml.data import load_test_pairs
from stellar_blaze.ml.eval_inputs import crew_spec, load_fixture
from stellar_blaze.ml.exporters import PROTOCOL_PATH, render_json
from stellar_blaze.ml.forecast_tables import series_frame, series_manifest, series_parquet_bytes
from stellar_blaze.ml.protocol_gate import Part
from stellar_blaze.ml.twl_rows import raw_twl
from tests.fixtures.forecast.gated import HEAD, GatedWorld, released
from tests.unit.jobs import test_evaluate_2026_cli as base
from tests.unit.jobs.support import FakeLock, FakeRuns, use_fake_database
from tests.unit.rules.support import RULESETS_DIR

pytestmark = [pytest.mark.unit, pytest.mark.slow]

invoke = base.invoke

BACKEND: Final = Path(__file__).resolve().parents[3]
IFS: Final = NwpModel.ECMWF_IFS025.value
GFS: Final = NwpModel.GFS_SEAMLESS.value
DAYS: Final = tuple(date(2026, 6, 22 + i) for i in range(5))
"""Monday to Friday, inside the ban season; D0 .. D4."""
HOT_HOURS: Final[tuple[tuple[int, ...], ...]] = (
    (),
    (11, 12, 13, 14),
    (11, 12, 13, 14),
    (11, 12, 13, 14),
    (8, 11, 12, 13, 14),
)
LEADS: Final = (1, 2, 3, 4, 5, 6, 7)
SCORED_LEADS: Final = (1, 2, 3, 5, 7)
HOURS: Final = tuple(range(2, 16))
REJECTED: Final = (DAYS[4], 12)
"""The day and UTC hour whose ``wbgt_obs_reject`` is 3 (the hottest day, therefore not a demo-day candidate)."""
HOT: Final = (43.0, 27.0, 1.0, 34.0)
MILD: Final = (30.0, 10.0, 5.0, 24.0)
"""(t, td, wind, wbgt) of a hot and a mild hour."""
SPREAD: Final = (0.3, 0.3, 0.1, 0.3)
LEVEL_Z: Final = np.linspace(-1.645, 1.645, 19)
"""One z per grid level; the grids are symmetric around the centre, so the median is the centre."""
WORKED_PER_LEAD: Final = 35
DANGER_WEIGHTED: Final = 16.5
DANGER_COUNT: Final = 17

WARNINGS_FILES: Final = ("policy_scoreboard.json", "demo_day.json")
PLANS_FILES: Final = ("plan_scoreboard.json",)
RESULT_FILES: Final = (*WARNINGS_FILES, *PLANS_FILES)
INPUT_NAMES: Final = {
    "theta": evaluate_2026.THETA_PATH,
    "ruleset": f"ruleset {evaluate_2026.FROZEN_RULESET_ID}",
    "fixture": evaluate_2026.FIXTURE_PATH,
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# === the synthetic world ============================================================================================


@dataclass(frozen=True)
class _Cell:
    """One station-hour-lead of the synthetic gold and series: where it is and what the weather and forecasts say."""

    icao: str
    summer: int
    day: date
    hour: int
    lead: int
    truth_hot: bool
    raw_hot: bool
    grid_hot: bool


def _cells() -> list[_Cell]:
    """OMAA 2026 (the scored rows, leads 1-7), then the rows that must never be counted.

    The extras are OMDB 2026 (the same valid times as OMAA, so a station filter that failed would double the hours or
    raise on the duplicate valid time) and OMAA 2025 (a summer filter that failed would add 350 rows); both are hot at
    every hour. The real series holds OMAA 2026 only; the extras are in it here so that ``inputs_2026``'s own filters
    are tested, and in the gold, where ``load_test_pairs`` returns 2025 and the radiation filter drops OMDB.
    """
    cells: list[_Cell] = []
    for index, day in enumerate(DAYS):
        for hour in HOURS:
            truth = hour in HOT_HOURS[index]
            for lead in LEADS:
                raw = {1: False, 2: truth, 3: True}.get(lead, False)
                grid = {1: truth, 2: truth, 3: True}.get(lead, False)
                cells.append(_Cell("OMAA", 2026, day, hour, lead, truth, raw, grid))
    for icao, summer, year in (("OMDB", 2026, 2026), ("OMAA", 2025, 2025)):
        for day in DAYS:
            for hour in HOURS:
                for lead in SCORED_LEADS:
                    cells.append(_Cell(icao, summer, date(year, day.month, day.day), hour, lead, True, True, True))
    return cells


def _when(cell: _Cell) -> datetime:
    return datetime(cell.day.year, cell.day.month, cell.day.day, cell.hour, tzinfo=UTC)


@cache
def _cos_zenith(icao: str, day: date, hour: int) -> float:
    where = station(icao)
    stamp = np.array([np.datetime64(f"{day.isoformat()}T{hour:02d}", "h").astype("datetime64[us]")])
    return float(mean_cos_zenith_prev_hour(where.lat, where.lon, stamp)[0])


def _values(hot: bool) -> tuple[float, float, float, float]:
    return HOT if hot else MILD


def _gold_and_keys(cells: list[_Cell]) -> tuple[pl.DataFrame, pl.DataFrame, dict[Target, F64], dict[Target, F64]]:
    """The gold frame (IFS rows of every cell, plus GFS copies of OMAA 2026) and the series' keys, grids and truths."""
    columns: dict[str, list[Any]] = {name: [] for name in GOLD_PAIRS_SCHEMA}
    raw: dict[str, list[float]] = {name: [] for name in ("t", "td", "wind", "wbgt")}
    grids: dict[Target, list[list[float]]] = {target: [] for target in Target}
    truths: dict[Target, list[float]] = {target: [] for target in Target}
    for cell in cells:
        where = station(cell.icao)
        stamp = _when(cell)
        sw = (
            1000.0 * _cos_zenith(cell.icao, cell.day, cell.hour) * 0.82
        )  # the lead-0 reference; the forecast's own differs by lead below
        truth = _values(cell.truth_hot)
        raw_values, grid_values = _values(cell.raw_hot), _values(cell.grid_hot)
        rejected = (cell.day, cell.hour) == REJECTED and cell.icao == "OMAA" and cell.summer == 2026
        fc_sw = sw * (1.0 - 0.02 * cell.lead)
        row: dict[str, Any] = {
            "station": cell.icao,
            "cluster": where.cluster,
            "model": IFS,
            "summer": cell.summer,
            "valid_time": stamp,
            "lead_days": cell.lead,
            "hour_utc": cell.hour,
            "doy": stamp.timetuple().tm_yday,
            "is_daytime": 5 <= cell.hour <= 16,
            "station_elev_m": where.elevation_m,
            "grid_lat": where.lat,
            "grid_lon": where.lon,
            "grid_elev_m": where.elevation_m,
            "fc_t_c": raw_values[0],
            "fc_td_c": raw_values[1],
            "fc_wind_ms": raw_values[2],
            "fc_sw_wm2": fc_sw,
            "fc_direct_wm2": 0.7 * fc_sw,
            "fc_pressure_hpa": 1005.0 - cell.lead,
            "ref_sw_wm2": sw,
            "ref_direct_wm2": 0.7 * sw,
            "ref_pressure_hpa": 1005.0,
            "obs_t_c": truth[0],
            "obs_td_c": truth[1],
            "obs_wind_ms": truth[2],
            "has_joint_obs": True,
            "audit_t_c": truth[0],
            "audit_td_c": truth[1],
            "audit_wind_ms": truth[2],
            "wbgt_obs_c": truth[3] - (1.0 if cell.truth_hot else 0.0),  # 33 hot, 24 mild
            "wbgt_fc_c": raw_values[3],
            "wbgt_fc_refrad_c": raw_values[3],
            "wbgt_obs_reject": 3 if rejected else 0,
            "wbgt_fc_reject": 0,
            "wbgt_fc_refrad_reject": 0,
        }
        for name, value in row.items():
            columns[name].append(value)
        for name, value in zip(("t", "td", "wind", "wbgt"), raw_values, strict=True):
            raw[name].append(value)
        for target, centre, spread, obs in zip(Target, grid_values, SPREAD, truth, strict=True):
            grids[target].append([centre + spread * z for z in LEVEL_Z])
            truths[target].append(obs)
    ifs = pl.DataFrame(columns, schema=GOLD_PAIRS_SCHEMA)
    gfs = ifs.filter((pl.col("station") == "OMAA") & (pl.col("summer") == 2026)).with_columns(
        pl.lit(GFS).alias("model"), (pl.col("fc_sw_wm2") * 0.5).alias("fc_sw_wm2")
    )
    keys = ifs.select("station", "cluster", "valid_time", "summer", "lead_days", "hour_utc").with_columns(
        *(pl.Series(f"raw_{name}", values, dtype=pl.Float64) for name, values in raw.items())
    )
    return (
        pl.concat([ifs, gfs]),
        keys,
        {target: np.asarray(values, dtype=np.float64) for target, values in grids.items()},
        {target: np.asarray(values, dtype=np.float64) for target, values in truths.items()},
    )


def _series(
    gold: pl.DataFrame, keys: pl.DataFrame, grids: dict[Target, F64], truths: dict[Target, F64]
) -> pl.DataFrame:
    """The series the forecast part would have written, by its own ``series_frame`` (and the extras of ``_cells``)."""
    reference = gold.filter(pl.col("model") == IFS)
    parts = [
        series_frame(keys, grids, truths, station=icao, summer=summer, reference=reference)
        for icao, summer in (("OMAA", 2026), ("OMAA", 2025), ("OMDB", 2026))
    ]
    return pl.concat(parts).sort("valid_time", "lead_days")


class Frames(NamedTuple):
    gold: pl.DataFrame
    series: pl.DataFrame


@cache
def frames() -> Frames:
    """The synthetic gold and series (built once per process; the frames are never modified)."""
    gold, keys, grids, truths = _gold_and_keys(_cells())
    return Frames(gold, _series(gold, keys, grids, truths))


def _scoreboard_provenance() -> Provenance:
    return Provenance(
        protocol_path="docs/research/p.md",
        protocol_anchor="#6",
        script="stellar_blaze.ml.theta",
        function="select_theta",
        git_sha="a" * 40,
        data_sha256="b" * 64,
        model_id=None,
        label=ProvenanceLabel.REAL,
        generated_at=datetime(2026, 11, 15, tzinfo=UTC),
    )


@dataclass
class World:
    """The synthetic world around ``base.Env``: the gold, the series, the frozen inputs and the freeze addendum."""

    env: base.Env
    root: Path
    settings: Settings
    hashes: dict[str, str]  # input key (theta, ruleset, fixture) to its SHA-256
    series: pl.DataFrame

    @property
    def results(self) -> Path:
        return self.env.results

    def written(self) -> list[str]:
        """The result files of the two B3 parts that exist (the forecast part's files are not these)."""
        return [name for name in RESULT_FILES if (self.results / name).exists()]

    def freeze(self, omit: str | None = None) -> None:
        """Write the addendum recording the SHA-256 of the inputs (all but ``omit``) and re-sign the lock and the go."""
        lines = [f"{key} {digest}" for key, digest in self.hashes.items() if key != omit]
        self.env.world.write_freeze(("# Freeze addendum\n" + "\n".join(lines) + "\n").encode("utf-8"))


def make_env(mp: pytest.MonkeyPatch, root: Path) -> base.Env:
    """``base.env`` for this module: ``SB_*`` environment, the synthetic gold pinned by a fake lock, fake git and DB.

    The released model is the synthetic one trained on leads 1-7 (the default fixture model has joint-sample strata for
    leads 1-3 only, and the series has rows at leads 5 and 7, as the real model's does).
    """
    mp.chdir(root)  # a developer's backend/.env must not reach the test
    data = root / "data"
    (data / "gold").mkdir(parents=True)
    gold_path = data / "gold" / "pairs.parquet"
    frames().gold.write_parquet(gold_path)
    gold_sha256 = sha(gold_path.read_bytes())
    model = released(all_leads=True)
    mp.setenv("SB_DATABASE_URL", base.DATABASE_URL)
    mp.setenv("SB_ENV", "test")
    mp.setenv("SB_LOG_FORMAT", "json")
    mp.setenv("SB_DATA_DIR", str(data))
    mp.setenv("SB_MODELS_DIR", str(model.models_dir))
    world = GatedWorld(root, model.model.manifest.model_id, model.models_dir, gold_sha256=gold_sha256)
    mp.setattr(replay_build, "repo_root", lambda: world.repo_root)
    mp.setattr(evaluate_2026, "SubprocessGit", lambda _root: world.git)  # the call sites stay inline
    runs, lock = FakeRuns(), FakeLock()
    use_fake_database(mp, runs, lock)
    loads: list[dict[str, Any]] = []

    def spy_load(path: Path, **kwargs: Any) -> pl.DataFrame:
        loads.append({"path": path, **kwargs})
        loaded: pl.DataFrame = load_test_pairs(path, **kwargs)
        return loaded

    mp.setattr("stellar_blaze.jobs.evaluate_2026.load_test_pairs", spy_load)
    return base.Env(root, world, gold_path, gold_sha256, runs, lock, loads, [])


def build_world(
    env: base.Env, *, series: bool = True, theta_ruleset: tuple[str | None, str | None] | None = None
) -> World:
    """Lay the B3 world out under ``env`` (series with its manifest, theta, ruleset, fixture, freeze addendum).

    ``theta_ruleset`` is the (id, SHA-256) that ``theta.json`` records; the default is the frozen ruleset's own.
    """
    root = env.world.repo_root
    theta = root / evaluate_2026.THETA_PATH
    ruleset_file = f"{evaluate_2026.FROZEN_RULESET_ID}.toml"
    ruleset_id, ruleset_sha256 = theta_ruleset or (
        evaluate_2026.FROZEN_RULESET_ID,
        sha((RULESETS_DIR / ruleset_file).read_bytes()),
    )
    write_artifact(
        theta,
        ThetaDecision(
            theta_protect=0.25,
            theta_balanced=0.35,
            grid=[ThetaGridPoint(theta=0.05, pod=1.0, far=0.5, pss=0.5, n_hours=10)],
            red_hour_share=0.1,
            n_hours=10,
            ruleset_id=ruleset_id,
            ruleset_sha256=ruleset_sha256,
            rule="preregistration §6.5",
            provenance=_scoreboard_provenance(),
        ),
    )
    fixture = root / evaluate_2026.FIXTURE_PATH
    fixture.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BACKEND / "fixtures" / "demo_site.toml", fixture)
    shutil.copytree(RULESETS_DIR, root / "backend" / "rulesets")  # the catalog checks every file against lock.json
    hashes = {
        "theta": sha(theta.read_bytes()),
        "ruleset": sha((RULESETS_DIR / ruleset_file).read_bytes()),
        "fixture": sha(fixture.read_bytes()),
    }
    settings = cast(Settings, SimpleNamespace(rulesets_dir=Path("rulesets")))
    world = World(env, root, settings, hashes, frames().series)
    world.freeze()
    if series:
        write_series(world)
    return world


def write_series(world: World, *, manifest_sha256: str | None = None) -> None:
    """Write the forecast part's series and manifest as ``run_forecast`` does (its writers, its provenance)."""
    lock = world.env.world
    provenance = WireProvenance(
        protocol_path=PROTOCOL_PATH,
        protocol_anchor="#74-demo-day-day-zoom-selection-rule",
        script="stellar_blaze.ml.forecast_test",
        function="series_frame",
        git_sha=HEAD,
        data_sha256=lock.gold_sha256,
        model_id=lock.model_id,
        label=WireLabel.REAL,
        generated_at=datetime(2026, 11, 15, 9, 0, tzinfo=UTC),
    )
    data = series_parquet_bytes(world.series, provenance)
    manifest = series_manifest(
        world.series,
        file=evaluate_2026.SERIES_FILE,
        data=data,
        command="sb-jobs evaluate-2026 --part forecast",
        git_sha=HEAD,
    )
    if manifest_sha256 is not None:
        manifest["sha256"] = manifest_sha256
    world.results.mkdir(parents=True, exist_ok=True)
    (world.results / evaluate_2026.SERIES_FILE).write_bytes(data)
    (world.results / evaluate_2026.SERIES_MANIFEST_FILE).write_bytes(render_json(manifest, provenance))


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> base.Env:
    return make_env(monkeypatch, tmp_path)


@pytest.fixture
def world(env: base.Env) -> World:
    return build_world(env)


def summary_of(result: Any) -> dict[str, Any]:
    """The command's summary: the last line of stdout (the job's own log lines come first)."""
    return json.loads(result.stdout.strip().splitlines()[-1])  # type: ignore[no-any-return]


def run(part: str) -> Any:
    result = invoke("--part", part)
    assert result.exit_code == 0, result.stderr
    return result


GENERATED_AT = re.compile(rb'"generated_at"\s*:\s*"[^"]*"')


def normalized(data: bytes) -> bytes:
    """``data`` with the one field that is the clock (``provenance.generated_at``) blanked; everything else is kept."""
    blanked, count = GENERATED_AT.subn(b'"generated_at":"-"', data)
    assert count == 1
    return blanked


# === one complete run of both parts, shared by the read-only tests =================================================


@dataclass
class Ran:
    """What one complete synthetic run left behind (each part runs twice: ``first`` and, after a delete, ``second``)."""

    world: World
    summary: dict[str, dict[str, Any]]  # part -> the command's summary of the first run
    listing: dict[str, list[str]]  # part -> every file in the results directory after its first run
    loaded: dict[str, list[Part]]  # part -> the parts of the gold reads made so far, after its first run
    first: dict[str, bytes]  # result file -> bytes of the first run
    refused: dict[str, Any]  # part -> the CLI result of a second run attempt while the first results stand
    after_refusal: dict[str, bytes]  # result file -> bytes after the refused attempts
    loads_after_refusal: int
    second: dict[str, bytes]  # result file -> bytes of the run made after deleting the results


@pytest.fixture(scope="module")
def ran(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Ran]:
    """Run warnings and plans through the CLI, try both again, then delete the results and run both once more.

    The parts cost several seconds each, so the read-only tests share this one world (the tests that change the world
    use the function-scoped ``world``).
    """
    with pytest.MonkeyPatch.context() as mp:
        env = make_env(mp, tmp_path_factory.mktemp("b3-e2e"))
        world = build_world(env)
        summary: dict[str, dict[str, Any]] = {}
        listing: dict[str, list[str]] = {}
        loaded: dict[str, list[Part]] = {}
        first: dict[str, bytes] = {}
        for part, files in (("warnings", WARNINGS_FILES), ("plans", PLANS_FILES)):
            summary[part] = summary_of(run(part))
            listing[part] = sorted(path.name for path in world.results.iterdir())
            loaded[part] = [load["part"] for load in env.loads]
            first.update({name: (world.results / name).read_bytes() for name in files})
        loads = len(env.loads)
        refused = {part: invoke("--part", part) for part in ("warnings", "plans")}
        after_refusal = {name: (world.results / name).read_bytes() for name in RESULT_FILES}
        loads_after_refusal = len(env.loads) - loads
        for name in RESULT_FILES:
            (world.results / name).unlink()
        for part in ("warnings", "plans"):
            run(part)
        second = {name: (world.results / name).read_bytes() for name in RESULT_FILES}
        yield Ran(world, summary, listing, loaded, first, refused, after_refusal, loads_after_refusal, second)


def document(ran: Ran, name: str) -> dict[str, Any]:
    return json.loads(ran.first[name])  # type: ignore[no-any-return]


def row(lead: Any, policy: str) -> Any:
    return next(r for r in lead.rows if r.policy == policy)


# === the world and the scoring frame ================================================================================


def test_the_synthetic_world_is_what_the_comments_say() -> None:
    series = frames().series
    omaa = series.filter((pl.col("station") == "OMAA") & (pl.col("summer") == 2026))
    # 5 days x 14 hours x 7 leads of OMAA 2026, plus the extras that must never be scored: OMDB 2026 and OMAA 2025 at
    # the five scored leads (5 x 14 x 5 = 350 each).
    assert omaa.height == 5 * 14 * 7
    assert series.height == omaa.height + 2 * 5 * 14 * 5
    # The truth-hot hours of one lead: 0 + 4 + 4 + 4 + 5 = 17, of which 08 UTC weighs 0.5 = 16.5.
    assert sum(len(hours) for hours in HOT_HOURS) == DANGER_COUNT
    assert sum(1.0 - 0.5 * (hour == 8) for hours in HOT_HOURS for hour in hours) == DANGER_WEIGHTED


def test_the_scoring_frame_holds_only_the_2026_omaa_rows_at_the_scored_leads(world: World) -> None:
    gate = world.env.world.token(Part.WARNINGS)
    frozen = evaluate_2026.frozen_inputs(world.settings, gate, world.root)
    settings = cast(
        Settings,
        SimpleNamespace(models_dir=world.env.world.models_dir, data_dir=world.env.root / "data", rulesets_dir=None),
    )

    inputs = evaluate_2026._scoring_inputs(settings, gate, world.root, frozen)  # noqa: SLF001 (the glue under test)

    rows = inputs.rows
    # 5 days x 14 hours x 5 scored leads (leads 4 and 6 are in the series and dropped); not the 2025 or OMDB rows (350
    # more each would double or triple it), and not the GFS gold rows (a model filter that failed would break the 1:1
    # join: the load is IFS only).
    assert rows.height == 5 * 14 * 5
    assert set(rows["lead_days"].unique().to_list()) == set(SCORED_LEADS)
    assert {t.year for t in rows["valid_time"].to_list()} == {2026}
    assert not rows.select("valid_time", "lead_days").is_duplicated().any()
    assert [load["models"] for load in world.env.loads] == [frozenset({IFS})]
    assert world.env.loads[0]["part"] == Part.WARNINGS
    assert inputs.reject_available
    # The join took each row's OWN forecast radiation and pressure (they differ by lead: sw x (1 - 0.02 lead), pressure
    # 1005 - lead): the raw effective TWL of EVERY row, recomputed from the gold row picked by (valid time, lead) with a
    # join written here, is the frame's. (A hot hour's TWL sits on the 60 W/m2 floor and would not show a wrong lead,
    # a mild hour's does.)
    gold = pl.read_parquet(world.env.gold_path).filter(
        (pl.col("model") == IFS) & (pl.col("station") == "OMAA") & (pl.col("summer") == 2026)
    )
    picked = rows.select("valid_time", "lead_days").join(
        gold, on=["valid_time", "lead_days"], how="left", maintain_order="left", validate="1:1"
    )
    expected = raw_twl(picked, "fc_t_c", "fc_td_c", "fc_wind_ms", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa")
    assert np.allclose(rows["raw_twl_eff"].to_numpy(), expected - frozen.params.twl_margin_w_m2, rtol=1e-9)
    mild = rows.filter(pl.col("raw_twl_eff") > 200.0)
    assert mild.height > 0
    assert (
        mild["raw_twl_eff"].n_unique() > 10
    )  # the mild rows are not all alike: the radiation varies with hour and lead
    # Lead 1: the raw IFS is mild everywhere and the corrected grids are hot where the truth is: every one of the 50
    # joint samples of a hot hour is High or Red, none of a mild hour.
    lead1 = rows.filter(pl.col("lead_days") == 1).sort("valid_time")
    hot = lead1.filter(pl.col("n_high") > 0)
    assert hot.height == sum(len(hours) for hours in HOT_HOURS)
    assert (hot["n_high"] == hot["n_finite"]).all()
    assert (lead1["n_finite"] == 50).all()


# === the Warnings part ==============================================================================================


def test_warnings_through_the_cli_writes_exactly_its_two_files_and_validates(ran: Ran) -> None:
    assert ran.listing["warnings"] == sorted(
        [*WARNINGS_FILES, evaluate_2026.SERIES_FILE, evaluate_2026.SERIES_MANIFEST_FILE]
    )  # the two files, beside the forecast part's two
    assert ran.loaded["warnings"] == [Part.WARNINGS]  # one gold read
    assert ran.summary["warnings"]["part"] == "warnings"
    assert ran.summary["warnings"]["files"] == {name: sha(ran.first[name]) for name in WARNINGS_FILES}

    scoreboard = PolicyScoreboard.model_validate(document(ran, "policy_scoreboard.json"))
    wire = WireProvenance.model_validate(document(ran, "policy_scoreboard.json")["provenance"])  # B2's class
    lock = ran.world.env.world
    assert (wire.git_sha, wire.data_sha256, wire.model_id) == (HEAD, lock.gold_sha256, lock.model_id)
    assert scoreboard.evaluation_set == "scored_2026"
    assert scoreboard.station == "OMAA"
    assert (scoreboard.season_start, scoreboard.season_end) == (date(2026, 5, 15), date(2026, 9, 30))
    # theta is the file's, the ruleset is the frozen one with the hash of the file the addendum records
    theta = json.loads((ran.world.root / evaluate_2026.THETA_PATH).read_bytes())
    assert (scoreboard.theta_protect, scoreboard.theta_balanced) == (theta["theta_protect"], theta["theta_balanced"])
    assert (scoreboard.theta_protect, scoreboard.theta_balanced) == (0.25, 0.35)
    assert scoreboard.ruleset_id == evaluate_2026.FROZEN_RULESET_ID
    assert scoreboard.ruleset_sha256 == ran.world.hashes["ruleset"]
    assert scoreboard.n_days == 5  # D0-D4 have scored hours at lead 1
    # Rows are in lead order: 1, 2, 3, 5, 7 (leads 4 and 6 are not scored).
    assert [lead.lead_days for lead in scoreboard.leads] == list(SCORED_LEADS)
    assert [lead.headline for lead in scoreboard.leads] == [True, False, False, False, False]
    assert [lead.report_only for lead in scoreboard.leads] == [False, False, False, True, True]
    assert [r.policy for r in scoreboard.leads[0].rows] == ["P0", "P1", "P2", "P3_protect", "P3_balanced"]
    assert len(scoreboard.sensitivity) == 4
    assert [v.id for v in scoreboard.verdicts] == ["H4", "H5", "H4-lead2"]


def test_the_warnings_counts_match_the_hand_count(ran: Ran) -> None:
    leads = {
        lead.lead_days: lead for lead in PolicyScoreboard.model_validate(document(ran, "policy_scoreboard.json")).leads
    }

    for lead in leads.values():
        # Truth is the same at every lead: 17 worked danger hours, 16.5 weighted (see the module docstring).
        assert lead.truth_danger_hours.n == DANGER_COUNT
        assert lead.truth_danger_hours.value == pytest.approx(DANGER_WEIGHTED)
        for policy_row in lead.rows:
            assert policy_row.missed_danger_hours.n == WORKED_PER_LEAD  # 5 days x 7 worked hours
        # P0 warns nothing on a worked hour: it misses every danger hour and raises no false alarm.
        p0 = row(lead, "P0")
        assert p0.missed_danger_hours.value == pytest.approx(DANGER_WEIGHTED)
        assert p0.false_alarm_hours.value == 0.0
        assert p0.alerts_per_shift.value == 0.0

    def counts(lead: int, policy: str) -> tuple[float, float]:
        picked = row(leads[lead], policy)
        return round(picked.missed_danger_hours.value, 6), round(picked.false_alarm_hours.value, 6)

    # Lead 1: the raw IFS is mild everywhere (P1 and P2 miss all 16.5, no false alarm); the corrected samples are hot
    # exactly where the truth is (P3 misses 0, 0 false alarms, POD 1, FAR 0).
    assert counts(1, "P1") == counts(1, "P2") == (DANGER_WEIGHTED, 0.0)
    assert counts(1, "P3_protect") == counts(1, "P3_balanced") == (0.0, 0.0)
    assert row(leads[1], "P3_protect").pod.value == pytest.approx(1.0)
    assert row(leads[1], "P3_protect").far.value == 0.0
    # Alerts per shift: runs of consecutive warned worked hours per day over the 5 shift days: D1, D2 and D3 one run
    # (11-14), D4 two (08 | 11-14: 09 and 10 are not worked), D0 none = 5 runs, 5 / 5 = 1.0.
    assert row(leads[1], "P3_protect").alerts_per_shift.value == pytest.approx(1.0)
    # Lead 2: the raw and the corrected are both exact.
    for policy in ("P1", "P2", "P3_protect", "P3_balanced"):
        assert counts(2, policy) == (0.0, 0.0), policy
    # Lead 3: everything is warned at every hour: no miss; the false alarms are the weighted worked hours that are not
    # danger = 32.5 - 16.5 = 16.0. Warned worked runs per day: 06-08 | 11-14 (09 and 10 weigh 0) = 2, so 10 / 5 = 2.0.
    for policy in ("P1", "P2", "P3_protect", "P3_balanced"):
        assert counts(3, policy) == (0.0, 16.0), policy
        assert row(leads[3], policy).alerts_per_shift.value == pytest.approx(2.0), policy
    # Leads 5 and 7: everything is mild: every policy misses all of it.
    for ahead in (5, 7):
        for policy in ("P1", "P2", "P3_protect", "P3_balanced"):
            assert counts(ahead, policy) == (DANGER_WEIGHTED, 0.0), (ahead, policy)


def test_the_demo_day_is_the_earliest_hottest_candidate_and_not_the_rejected_day(ran: Ran) -> None:
    demo = DemoDay.model_validate(document(ran, "demo_day.json"))
    WireProvenance.model_validate(document(ran, "demo_day.json")["provenance"])

    assert demo.evaluation_set == "scored_2026"
    # D4 (26 Jun) scores 4.5 (08 UTC half weight + 11-14) but has a rejected WBGT hour: not a candidate, or it would
    # win. Candidates: D0 0, D1 4, D2 4, D3 4; a tie goes to the earliest date, D1 (23 Jun); the runner-up is D2.
    assert demo.date == DAYS[1]
    assert demo.date in DAYS
    assert demo.score == demo.high_hours == demo.high_hours_outside_ban == 4.0
    assert demo.candidates == 4
    assert demo.runner_up is not None
    assert (demo.runner_up.date, demo.runner_up.score) == (DAYS[2], 4.0)
    assert [h.starts_at.hour for h in demo.hours] == list(range(6, 15))
    hot = {11, 12, 13, 14}
    for hour in demo.hours:
        is_hot = hour.starts_at.hour in hot
        assert hour.truth_zone == ("red" if is_hot else "low")
        assert hour.truth_wbgt_c == (33.0 if is_hot else 24.0)
        assert hour.raw_zone == "low"  # lead 1: the raw IFS is mild everywhere
        assert hour.raw_wbgt_c == 24.0
        assert hour.p_high == (1.0 if is_hot else 0.0)
        assert hour.corrected_wbgt_c is not None
        assert hour.corrected_wbgt_c.p50 == pytest.approx(34.0 if is_hot else 24.0)  # the median grid level
        assert hour.ban_weight == {8: 0.5, 9: 0.0, 10: 0.0}.get(hour.starts_at.hour, 1.0)
        # P0 "warns" the ban part of an hour (08, 09, 10 UTC); P3 warns the hot hours; P1 and P2 warn nothing.
        expected = (["P0"] if hour.starts_at.hour in (8, 9, 10) else []) + (
            ["P3_protect", "P3_balanced"] if is_hot else []
        )
        assert hour.warned_by == expected
    assert demo.raw_hits == 0.0
    assert demo.p3_hits == 4.0


def test_warnings_is_deterministic_across_two_fresh_runs(ran: Ran) -> None:
    # The second run is made in the same world with the results deleted: no result in the way, a new sampler built from
    # the stored model, the same seed. Only ``provenance.generated_at`` (the clock) is blanked before comparing.
    for name in WARNINGS_FILES:
        assert normalized(ran.second[name]) == normalized(ran.first[name]), name


# === the Plans part =================================================================================================


def test_plans_through_the_cli_scores_the_synthetic_world(ran: Ran) -> None:
    assert ran.listing["plans"] == sorted(
        [*WARNINGS_FILES, *PLANS_FILES, evaluate_2026.SERIES_FILE, evaluate_2026.SERIES_MANIFEST_FILE]
    )
    assert ran.loaded["plans"] == [Part.WARNINGS, Part.PLANS]  # one gold read per part
    assert ran.summary["plans"]["files"] == {PLANS_FILES[0]: sha(ran.first[PLANS_FILES[0]])}
    plans = PlanScoreboard.model_validate(document(ran, "plan_scoreboard.json"))
    WireProvenance.model_validate(document(ran, "plan_scoreboard.json")["provenance"])

    fixture = load_fixture(BACKEND / "fixtures" / "demo_site.toml")
    assert plans.evaluation_set == "scored_2026"
    assert plans.station == "OMAA"
    assert plans.crew_id == "crew-b"
    assert plans.site_id == fixture.site.id
    assert plans.fixture_sha256 == ran.world.hashes["fixture"]
    assert plans.ruleset_sha256 == ran.world.hashes["ruleset"]
    assert plans.headcount == len(crew_spec(fixture, "crew-b").members or ()) == 20
    assert plans.roster == "L1: 06:00-11:00 + 15:00-18:00 GST"
    assert plans.crew_label == "SIMULATED crew: 20 experienced adults, heavy work"
    assert plans.n_days == 5  # every day has a value on every shift tick

    by_plan: dict[str, PlanRow] = {r.plan: r for r in plans.rows}
    assert list(by_plan) == ["naive", "ban_only", "rule_raw", "rule_corrected"]
    # The afternoon block of L1 (15:00-18:00 GST = 11:00-14:00 UTC; the labels 11-14 UTC bound it) has 3 x 12 = 36
    # five-minute ticks. The truth is Red there on D1-D4: 4 days (D4's 08 UTC lies in the gap between the blocks: not
    # worked). A plan that works the 36 ticks of a Red day breaks STOP.red on all of them: 36 x 5 = 180 minutes a day,
    # 4 x 180 = 720. Naive and ban-only work every shift minute; the raw IFS is mild so the raw rule plan works them
    # too; the corrected q10 is Red there, so that plan stops them: 0.
    for name in ("naive", "ban_only", "rule_raw"):
        assert by_plan[name].violation_minutes_per_season.value == pytest.approx(720.0), name
    assert by_plan["rule_corrected"].violation_minutes_per_season.value == pytest.approx(0.0)
    assert by_plan["rule_corrected"].violation_minutes_per_season.n == 5
    # Truth High-or-Red attendance ticks: 4 x 36 = 144. Cycled (plan zone High or Red): corrected 144 (share 1), the
    # plans that plan Low none (share 0).
    assert by_plan["rule_corrected"].high_cycled_share.value == pytest.approx(1.0)
    assert by_plan["rule_corrected"].high_cycled_share.n == 144
    for name in ("naive", "ban_only", "rule_raw"):
        assert by_plan[name].high_cycled_share.value == 0.0, name
        assert by_plan[name].missed_protection_ticks.value == pytest.approx(144.0), name  # worked Red ticks, plan Low
    assert by_plan["rule_corrected"].missed_protection_ticks.value == 0.0
    # Rest added over naive: the corrected plan stops 180 minutes a day for 4 days = 720; the others add none.
    assert by_plan["rule_corrected"].rest_minutes_added_vs_naive.value == pytest.approx(720.0)
    assert by_plan["ban_only"].rest_minutes_added_vs_naive.value == 0.0
    h6, h7 = plans.verdicts
    assert (h6.id, h7.id) == ("H6", "H7")
    assert h6.comparisons[0].difference.value == pytest.approx(-720.0)
    assert h7.comparisons[0].difference.value == pytest.approx(-144.0)
    assert plans.identical_by_construction == ["naive", "ban_only"]


def test_plans_is_deterministic_across_two_fresh_runs(ran: Ran) -> None:
    assert normalized(ran.second[PLANS_FILES[0]]) == normalized(ran.first[PLANS_FILES[0]])


# === once only ======================================================================================================


@pytest.mark.parametrize(("part", "files"), [("warnings", WARNINGS_FILES), ("plans", PLANS_FILES)])
def test_a_second_run_is_refused_and_the_first_results_are_untouched(
    ran: Ran, part: str, files: tuple[str, ...]
) -> None:
    result = ran.refused[part]

    assert result.exit_code == 2
    assert "result-exists: " in result.stderr
    assert {name: ran.after_refusal[name] for name in files} == {
        name: ran.first[name] for name in files
    }  # byte for byte
    assert ran.loads_after_refusal == 0  # refused before the gold file was read again


# === refusals: nothing is written ===================================================================================


@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_without_the_forecast_part_the_run_fails_naming_it_and_writes_nothing(env: base.Env, part: str) -> None:
    world = build_world(env, series=False)

    result = invoke("--part", part)

    assert result.exit_code == 1
    [(status, _, error)] = world.env.runs.finished
    assert status == "failed"
    assert error is not None
    assert "FileNotFoundError" in error
    assert "evaluate-2026 --part forecast first" in error
    assert world.env.loads == []  # the gold file was never opened
    assert world.written() == []
    assert not world.results.exists()  # no partial directory either


@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_a_series_without_its_manifest_is_the_same_failure(env: base.Env, part: str) -> None:
    world = build_world(env)
    (world.results / evaluate_2026.SERIES_MANIFEST_FILE).unlink()

    result = invoke("--part", part)

    assert result.exit_code == 1
    assert "evaluate-2026 --part forecast first" in (world.env.runs.finished[0][2] or "")
    assert world.written() == []
    assert world.env.loads == []


@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_a_series_whose_manifest_hash_does_not_match_is_refused(env: base.Env, part: str) -> None:
    world = build_world(env, series=False)
    write_series(world, manifest_sha256="0" * 64)

    result = invoke("--part", part)

    assert result.exit_code == 1
    error = world.env.runs.finished[0][2] or ""
    assert "has sha256" in error
    assert "0" * 64 in error  # the manifest's hash is named
    assert world.written() == []
    assert world.env.loads == []  # refused before the gold file was read


@pytest.mark.parametrize("omitted", ["theta", "ruleset", "fixture"])
@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_an_addendum_missing_one_input_hash_is_refused_before_any_data_is_read(
    env: base.Env, part: str, omitted: str
) -> None:
    world = build_world(env)
    world.freeze(omit=omitted)

    result = invoke("--part", part)

    assert result.exit_code == 2
    assert f"freeze-input-missing: the SHA-256 of {INPUT_NAMES[omitted]} is not in the freeze addendum" in result.stderr
    for key, name in INPUT_NAMES.items():
        if key != omitted:
            assert f"the SHA-256 of {name} " not in result.stderr  # only the missing one is named
    assert world.written() == []
    assert world.env.loads == []  # no gold read


@pytest.mark.parametrize(
    ("recorded", "message"),
    [
        (
            (evaluate_2026.FROZEN_RULESET_ID, "e" * 64),
            "was computed under ruleset ae-heat-2026.1 eeeeeeee..., not the ",
        ),
        (("ae-heat-2025.9", None), "records no ruleset"),
        ((None, None), "records no ruleset"),
        (("ae-heat-2025.9", "e" * 64), "was computed under ruleset ae-heat-2025.9 eeeeeeee..., not the "),
    ],
)
@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_a_theta_computed_under_another_ruleset_is_refused_before_any_data_is_read(
    env: base.Env, part: str, recorded: tuple[str | None, str | None], message: str
) -> None:
    world = build_world(
        env, theta_ruleset=recorded
    )  # the addendum records this theta's own hash: only the ruleset is off

    result = invoke("--part", part)

    assert result.exit_code == 2
    assert "freeze-input-stale: theta.json " in result.stderr
    assert message in result.stderr
    assert f"{evaluate_2026.FROZEN_RULESET_ID} {world.hashes['ruleset'][:8]}..." in result.stderr
    assert world.written() == []
    assert world.env.loads == []  # no gold read
    assert sorted(p.name for p in world.results.iterdir()) == sorted(
        [evaluate_2026.SERIES_FILE, evaluate_2026.SERIES_MANIFEST_FILE]
    )  # only the forecast part's two files: nothing was written
