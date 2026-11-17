"""The gold dataset on the real data, against the research it must reproduce (the B1 exit gate, Task 11).

The dataset is the one ``sb-jobs build-dataset`` wrote to ``$SB_DATA_DIR/gold/pairs.parquet`` (``SB_DATA_DIR``
defaults to ``data``, relative to ``backend/``). Every number here is recomputed from that file with
``summarize_pairs``; ``manifest.json`` is not read, because a manifest that vouches for its own dataset proves
nothing.

The expected values are the research's, written down here and read from its CSV, never derived from the code under
test: ``docs/research/2026-11-11-data-availability.md`` section 5.1 for the pair counts and
``docs/research/scripts/results/baseline_errors_pooled.csv`` for the raw errors. A failing assertion means the dataset
differs from the research; it is not a reason to change an expected value or a tolerance.

Exact equality of the pair counts and of ``n`` is the strength of this gate and also its one legitimate failure: IEM and
Open-Meteo revise their archives, so a rebuild after an upstream revision can differ from the research with no code
change. Before suspecting the code, compare the ``inputs`` SHA-256s in ``gold/manifest.json`` with those of the build
that passed: different hashes are input drift, equal hashes are code drift.
"""

import csv
import os
from pathlib import Path
from typing import NamedTuple

import polars as pl
import pytest

from stellar_blaze.application.dataset import summarize_pairs
from stellar_blaze.domain.physics.wbgt import WbgtReject
from stellar_blaze.domain.weather.dataset import RESEARCH_CSV_KEYS, DatasetSummary

_PAIRS = Path(os.environ.get("SB_DATA_DIR", "data")) / "gold" / "pairs.parquet"
_RESEARCH_CSV = Path(__file__).parents[3] / "docs/research/scripts/results/baseline_errors_pooled.csv"

# A skipif mark and not ``pytest.skip(allow_module_level=True)``: the latter reports one skipped module, this one
# reports each of the three tests, so a run on a machine without the dataset cannot be mistaken for a pass.
pytestmark = [
    pytest.mark.regression,
    pytest.mark.slow,
    pytest.mark.skipif(not _PAIRS.is_file(), reason=f"gold dataset not built: {_PAIRS.resolve()}"),
]

# Data doc (data-availability) 5.1: matched pairs per summer, summed over the stations; the same at every lead and for
# every model that covers the summer.
_JOINT = {2024: 26608, 2025: 26413, 2026: 26633}
_JOINT_DAYTIME = {2024: 9974, 2025: 9949, 2026: 9999}
_SUMMERS_BY_MODEL = {
    "ecmwf_ifs025": (2024, 2025, 2026),
    "gfs_seamless": (2024, 2025, 2026),
    "ecmwf_aifs025_single": (2025, 2026),  # AIFS covers two summers (data doc 5.1)
}
_LEADS = range(8)

# Identical inputs reproduce the research to about 1e-15 (the offline parity check of Task 10, which served the
# research's own downloads through the real adapters), and ``n`` must be identical. A difference above this (in the MAE,
# bias or RMSE) is a different dataset, not rounding: do not loosen it.
_TOLERANCE = 1e-6

# Thermofeel returned no NaN on 100,000 coherent inputs (``docs/research/2026-11-11-backend-ml-stack.md`` section 6.6),
# so a row whose six inputs are all present should come back OK with a finite WBGT. The limit allows a few rows (0.1%)
# that do not, say a forecast that is physically incoherent, and no more. Among such rows only OK is accepted: any other
# code counts against the limit, NONFINITE_INPUT included (``build_pairs`` gives it to an input that is present but
# outside -60 to 70 degrees, a pressure <= 0 or a negative wind), as does a missing code or an OK row without a finite
# WBGT, so a WBGT axis that is dead cannot pass.
_MAX_UNACCEPTED_SHARE = 0.001

# Each WBGT column, its reject column and the six inputs of its solver call (``build_pairs`` documents the same sets).
_WBGT_VARIANTS = (
    (
        "wbgt_obs_c",
        "wbgt_obs_reject",
        ("obs_t_c", "obs_td_c", "obs_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"),
    ),
    (
        "wbgt_fc_c",
        "wbgt_fc_reject",
        ("fc_t_c", "fc_td_c", "fc_wind_ms", "fc_pressure_hpa", "fc_sw_wm2", "fc_direct_wm2"),
    ),
    (
        "wbgt_fc_refrad_c",
        "wbgt_fc_refrad_reject",
        ("fc_t_c", "fc_td_c", "fc_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"),
    ),
)

_REPORTED = 10  # how many offending rows or mismatches a failure message lists

type _ErrorKey = tuple[str, int, int, str]  # model, summer, lead_days, var


class _ResearchError(NamedTuple):
    n: int
    bias: float
    mae: float
    rmse: float


@pytest.fixture(scope="module")
def pairs() -> pl.DataFrame:
    return pl.read_parquet(_PAIRS)


@pytest.fixture(scope="module")
def summary(pairs: pl.DataFrame) -> DatasetSummary:
    return summarize_pairs(pairs)


def _research_errors() -> dict[_ErrorKey, _ResearchError]:
    """The research CSV keyed like ``RawError``: its ``year`` is our ``summer`` and its ``lead_d`` our ``lead_days``."""
    errors: dict[_ErrorKey, _ResearchError] = {}
    with _RESEARCH_CSV.open(newline="", encoding="utf-8") as handle:
        for raw in csv.DictReader(handle):
            row = {RESEARCH_CSV_KEYS.get(column, column): value for column, value in raw.items()}
            key = (row["model"], int(row["summer"]), int(row["lead_days"]), row["var"])
            n = float(row["n"])  # the CSV writes the count as a float ("26419.0")
            if not n.is_integer():
                raise ValueError(f"{key}: n is {row['n']!r}, not a whole number")
            if key in errors:
                raise ValueError(f"{key} occurs twice in {_RESEARCH_CSV.name}")
            errors[key] = _ResearchError(
                n=int(n), bias=float(row["bias"]), mae=float(row["mae"]), rmse=float(row["rmse"])
            )
    return errors


def _differs(ours: float, research: float) -> bool:
    """True if the two differ by more than the tolerance; a NaN on either side differs (``nan > x`` is False)."""
    return not abs(ours - research) <= _TOLERANCE


def test_pair_counts_match_research(summary: DatasetSummary) -> None:
    expected = {
        (model, summer, lead): (_JOINT[summer], _JOINT_DAYTIME[summer])
        for model, summers in _SUMMERS_BY_MODEL.items()
        for summer in summers
        for lead in _LEADS
    }
    actual = {(c.model, c.summer, c.lead_days): (c.joint, c.joint_daytime) for c in summary.pair_counts}

    problems = [
        f"{key}: expected (joint, joint_daytime) = {expected.get(key)}, dataset has {actual.get(key)}"
        for key in sorted(expected.keys() | actual.keys())
        if expected.get(key) != actual.get(key)
    ]
    assert not problems, f"{len(problems)} of {len(expected)} groups differ from data doc 5.1:\n" + "\n".join(
        problems[:_REPORTED]
    )


def test_raw_errors_match_research(summary: DatasetSummary) -> None:
    research = _research_errors()
    assert research, f"{_RESEARCH_CSV} has no rows"
    ours = {(e.model, e.summer, e.lead_days, e.var): e for e in summary.raw_errors}

    problems: list[str] = []
    for key, expected in research.items():
        found = ours.get(key)
        if found is None:
            problems.append(f"{key}: in the research CSV, not in the dataset")
            continue
        if found.n != expected.n:
            problems.append(f"{key}: n is {found.n}, the research has {expected.n}")
        if _differs(found.mae, expected.mae):
            problems.append(f"{key}: mae is {found.mae!r}, the research has {expected.mae!r}")
        if _differs(found.bias, expected.bias):
            problems.append(f"{key}: bias is {found.bias!r}, the research has {expected.bias!r}")
        if _differs(found.rmse, expected.rmse):
            problems.append(f"{key}: rmse is {found.rmse!r}, the research has {expected.rmse!r}")
    problems.extend(f"{key}: in the dataset, not in the research CSV" for key in sorted(ours.keys() - research.keys()))

    assert not problems, f"{len(problems)} differences from {_RESEARCH_CSV.name}:\n" + "\n".join(problems[:_REPORTED])


def test_wbgt_rejects_are_explained(pairs: pl.DataFrame) -> None:
    ok = int(WbgtReject.OK)
    names = {int(reason): reason.name for reason in WbgtReject}
    problems: list[str] = []
    for value_column, reject_column, inputs in _WBGT_VARIANTS:
        complete = pairs.filter(pl.all_horizontal(pl.col(name).is_not_null() for name in inputs))
        if not complete.height:
            problems.append(f"{value_column}: no row has all of its inputs, so no share can be computed")
            continue
        accepted = (pl.col(reject_column) == ok).fill_null(False) & pl.col(value_column).is_finite().fill_null(False)
        offending = complete.filter(~accepted)
        share = offending.height / complete.height
        if share >= _MAX_UNACCEPTED_SHARE:
            first = offending.head(_REPORTED).select(
                "station", "model", "valid_time", "lead_days", *inputs, value_column, reject_column
            )
            codes = {
                names.get(code, code): count for code, count in offending[reject_column].value_counts().iter_rows()
            }
            problems.append(
                f"{value_column}: {offending.height} of {complete.height} rows with all inputs present ({share:.4%}) "
                f"are not OK with a finite value, limit {_MAX_UNACCEPTED_SHARE:.1%}; their reject codes: {codes}; "
                f"the first {first.height}:\n{first.write_csv()}"
            )
    assert not problems, "\n".join(problems)
