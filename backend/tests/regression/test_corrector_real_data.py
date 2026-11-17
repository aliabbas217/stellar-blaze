"""The forecast corrector's inputs and dev evaluation on the real data: a row-count gate and a sanity floor.

The first test needs the real gold file (``$SB_DATA_DIR/gold/pairs.parquet``, ``SB_DATA_DIR`` defaulting to ``data``
relative to ``backend/``) and the second the evaluation output; each skips when its input is absent, so a run without
them reports skips and cannot be mistaken for a pass. Only the development summers 2024-2025 are ever loaded
(``load_dev_pairs``); nothing here reads 2026.

* ``test_the_dev_rows_are_complete_and_hold_no_2026``: ``load_dev_pairs`` with the SHA-256 of the gold manifest's output
  returns, for each summer in {2024, 2025}, each lead 1-7 and the IFS model, exactly 8 stations x 139 days (15 May to
  30 September) x 14 modelled hours (UTC 02-15) = 15,568 rows, and nothing for 2026 or outside those hours. The count
  is a property of the dataset spine, not of any model.
* ``test_the_corrector_beats_raw_ifs_in_the_dev_skill_table``: a SANITY FLOOR, not a claim. It reads the evaluation's
  own output (``artifacts/eval/dev/dev_skill.json``, written by ``sb-jobs evaluate-dev``) and checks that, for
  temperature at lead 1 in the working hours, the corrector's CRPS is no worse than raw IFS (B0's CRPS is its MAE). A
  corrector that cannot clear that has a bug; clearing it says nothing about 2026 or about any other lead, variable or
  block, and the quoted skill numbers come from the report, not from this assertion. It also checks that the file is
  labelled REAL and records a full commit hash. It skips when the file has not been generated.
"""

import json
import os
import re
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from stellar_blaze.domain.weather.dataset import GoldManifest
from stellar_blaze.ml.data import load_dev_pairs

_GOLD = Path(os.environ.get("SB_DATA_DIR", "data")) / "gold"
_PAIRS = _GOLD / "pairs.parquet"
_DEV_SKILL = Path(__file__).resolve().parents[3] / "artifacts" / "eval" / "dev" / "dev_skill.json"

pytestmark = [pytest.mark.regression, pytest.mark.slow]
_NEEDS_GOLD = pytest.mark.skipif(not _PAIRS.is_file(), reason=f"gold dataset not built: {_PAIRS.resolve()}")

_IFS = "ecmwf_ifs025"
_ROWS_PER_CELL = 8 * 139 * 14  # stations x days 15 May to 30 September x modelled hours; 15,568
_DEV_SUMMERS = (2024, 2025)
_LEADS = range(1, 8)
_HOURS = range(2, 16)  # UTC 02-15
_FULL_SHA1 = re.compile(r"^[0-9a-f]{40}$")


@_NEEDS_GOLD
def test_the_dev_rows_are_complete_and_hold_no_2026() -> None:
    manifest = GoldManifest.model_validate_json((_GOLD / "manifest.json").read_bytes())

    pairs = load_dev_pairs(_PAIRS, expected_sha256=manifest.output.sha256)

    assert _ROWS_PER_CELL == 15_568
    counts = {
        (summer, lead, model): n
        for summer, lead, model, n in pairs.group_by("summer", "lead_days", "model").len().iter_rows()
    }
    ifs = {key: n for key, n in counts.items() if key[2] == _IFS}
    assert ifs == {(summer, lead, _IFS): _ROWS_PER_CELL for summer in _DEV_SUMMERS for lead in _LEADS}
    assert {summer for summer, _, _ in counts} == set(_DEV_SUMMERS), "only 2024 and 2025 may be loaded"
    assert pairs.filter(pl.col("summer") == 2026).height == 0
    assert pairs.filter(pl.col("valid_time").dt.year() == 2026).height == 0
    assert pairs.filter(~pl.col("hour_utc").is_between(_HOURS.start, _HOURS.stop - 1)).height == 0
    assert pairs.filter(pl.col("lead_days") < 1).height == 0


def _read_dev_skill() -> dict[str, Any]:
    if not _DEV_SKILL.is_file():
        pytest.skip(f"dev skill not generated yet: run sb-jobs evaluate-dev ({_DEV_SKILL})")
    document: dict[str, Any] = json.loads(_DEV_SKILL.read_bytes())
    return document


def test_the_corrector_beats_raw_ifs_in_the_dev_skill_table() -> None:
    document = _read_dev_skill()
    table = document["skill"]
    columns: list[str] = table["columns"]
    rows = [dict(zip(columns, row, strict=True)) for row in table["rows"]]
    selected = [
        row for row in rows if row["target"] == "t" and row["lead_days"] == 1 and row["hour_block"] == "working"
    ]

    assert len(selected) == 1, "the skill table must hold exactly one row for t, lead 1, working hours"
    row = selected[0]
    assert row["crps_corrector"] is not None
    assert row["crps_b0"] is not None  # B0 is raw IFS; its CRPS is its MAE
    assert row["crps_corrector"] <= row["crps_b0"], (
        f"the corrector (CRPS {row['crps_corrector']:.4f}) is worse than raw IFS (MAE {row['crps_b0']:.4f}) for "
        "temperature at lead 1 in the working hours: this is a bug floor, not a tuning target"
    )
    provenance = document["provenance"]
    assert provenance["label"] == "REAL"
    assert _FULL_SHA1.fullmatch(provenance["git_sha"]), provenance["git_sha"]
