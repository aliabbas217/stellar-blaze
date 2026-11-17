"""The product default seed pins the released model and theta, and the replay path really serves the corrected day.

Without the pin the corrector is absent: the demo day would be served from the uncorrected forecast. The runtime here is
built from the REAL ``config/runtime/default.toml`` and the REAL committed ``backend/models/`` (the released model),
over the replay fixture snapshot (synthetic 2025 data: nothing of the 2026 hold-out, never the gold file).
"""

import hashlib
import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from pydantic import SecretStr

from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.application.site_day import SiteDay, site_day
from stellar_blaze.composition import CorrectorProvider, build_runtime, build_sources
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig
from tests.fixtures.forecast.replay import SNAPSHOT_ID, build_fixture_snapshot
from tests.unit.application.serving_support import demo_site

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SEED = BACKEND_ROOT / "config" / "runtime" / "default.toml"
RELEASED_MODEL = "corrector-20261114-d327987-6edafa"  # the released model of the protocol lock (B2 owns it)
FROZEN_THETA = 0.30  # the pre-registered theta_protect (ADR 0048 section 3)
DEMO_DAY = date(2025, 7, 10)  # a day of the replay fixture (the 9th to the 11th of July 2025)

pytestmark = pytest.mark.unit


def settings_for(replay_dir: Path, data_dir: Path) -> Settings:
    return Settings(
        _env_file=None,
        env="test",
        database_url=SecretStr("postgresql+asyncpg://sb:sb@127.0.0.1:1/stellar_blaze"),
        rulesets_dir=BACKEND_ROOT / "rulesets",
        models_dir=BACKEND_ROOT / "models",
        runtime_config_seed=DEFAULT_SEED,
        forecast_source="replay",
        replay_dir=replay_dir,
        replay_snapshot_id=SNAPSHOT_ID,
        replay_default_date=DEMO_DAY,
        data_dir=data_dir,
    )


def test_the_default_seed_pins_the_released_model_and_the_frozen_theta() -> None:
    from stellar_blaze.composition import load_runtime_config

    config = load_runtime_config(DEFAULT_SEED)

    assert config.model_id == RELEASED_MODEL
    assert config.tunables.warning_theta == FROZEN_THETA


def test_the_pinned_model_is_the_committed_release_and_its_files_match_the_manifest() -> None:
    root = BACKEND_ROOT / "models" / RELEASED_MODEL
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["model_id"] == RELEASED_MODEL
    for entry in manifest["files"]:
        assert hashlib.sha256((root / entry["path"]).read_bytes()).hexdigest() == entry["sha256"], entry["path"]


def test_a_runtime_built_from_the_default_seed_selects_the_released_model(tmp_path: Path) -> None:
    built = build_fixture_snapshot(tmp_path / "silver")
    runtime = build_runtime(settings_for(built.directory.parent, tmp_path), today=DEMO_DAY)

    snapshot = runtime.config.peek()

    assert snapshot is not None
    assert snapshot.config.model_id == RELEASED_MODEL
    assert snapshot.model is not None
    assert snapshot.model.manifest.model_id == RELEASED_MODEL
    assert snapshot.config.tunables.warning_theta == FROZEN_THETA


def day_summary(day: SiteDay) -> list[tuple[float | None, float | None, float | None, str | None]]:
    return [(h.wbgt_q05, h.wbgt_q50, h.wbgt_q95, None if h.level is None else h.level.value) for h in day.hours]


@pytest.mark.asyncio
@pytest.mark.slow
async def test_the_replay_path_serves_a_corrected_day_that_differs_from_the_uncorrected_one(tmp_path: Path) -> None:
    """Runtime -> ``CorrectorProvider`` -> real ``LightGbmCorrector`` -> ``site_day`` on the replay fixture."""
    built = build_fixture_snapshot(tmp_path / "silver")
    settings = settings_for(built.directory.parent, tmp_path)
    runtime = build_runtime(settings, today=DEMO_DAY)
    snapshot = runtime.config.peek()
    assert snapshot is not None
    uncorrected_snapshot = snapshot.__class__(
        version_id=None, sha256="e" * 64, config=RuntimeConfig(), source="file", model=None
    )
    sources = build_sources(settings)
    try:
        common = {
            "site": demo_site(),
            "local_date": DEMO_DAY,
            "catalog": runtime.rulesets,
            "forecasts": sources.forecasts,
            "observations": sources.observations["iem"],
            "mode": "replay",
            "now": datetime(2025, 7, 10, 7, 10, tzinfo=UTC),
        }
        corrector = CorrectorProvider().for_snapshot(snapshot)
        corrected = await site_day(snapshot=snapshot, corrector=corrector, **common)  # type: ignore[arg-type]
        uncorrected = await site_day(
            snapshot=uncorrected_snapshot,
            corrector=FakeCorrector(0.0),
            **common,  # type: ignore[arg-type]
        )
    finally:
        await sources.close()

    assert corrector.model_id == RELEASED_MODEL
    assert corrected.identity.model_id == RELEASED_MODEL
    assert uncorrected.identity.model_id is None
    assert corrected.forecast_status == "fresh"
    assert any(h.wbgt_q50 is not None for h in corrected.hours), "the corrected day carries WBGT values"
    assert day_summary(corrected) != day_summary(uncorrected)
