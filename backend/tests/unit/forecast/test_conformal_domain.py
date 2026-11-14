"""The serving half of the conformal offsets: the data model and ``apply_offsets`` (pre-registration section 3.1).

Offsets are written by hand here, so these tests need neither the training code nor a fit; the fit and the MAPIE oracle
are in ``tests/unit/ml/test_conformal.py``.
"""

import subprocess
import sys
from statistics import NormalDist
from typing import Final

import numpy as np
import polars as pl
import pytest
from numpy.typing import NDArray

from stellar_blaze.domain.forecast.conformal import ConformalOffsets, apply_offsets, stratum_key
from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64, LEVELS, PAIRS, HourBlock

pytestmark = pytest.mark.unit

N_LEVELS: Final = len(LEVELS)
BLOCKS: Final = (HourBlock.EARLY, HourBlock.PEAK, HourBlock.LATE)


def normal_grid(rows: int, sigma: float = 1.0) -> F64:
    z = np.array([NormalDist().inv_cdf(level) for level in LEVELS])
    grid: F64 = np.broadcast_to(sigma * z, (rows, N_LEVELS)).copy()
    return grid


def offsets_for(leads: tuple[int, ...], *, target: str = "t") -> ConformalOffsets:
    """Offsets whose value identifies the stratum: lead + 0.1 * block index (0.0 for ``early``) for every pair."""
    strata = {
        stratum_key(lead, block): [lead + 0.1 * BLOCKS.index(block)] * len(PAIRS) for lead in leads for block in BLOCKS
    }
    return ConformalOffsets(
        offsets={target: strata},
        n={target: dict.fromkeys(strata, 100)},
        fallback={target: []},
        negative={target: 0},
    )


def ints(*values: int) -> NDArray[np.int8]:
    return np.array(values, dtype=np.int8)


class TestApply:
    def test_median_never_moves(self) -> None:
        grid = normal_grid(6)
        out = apply_offsets(grid, ints(1, 1, 1, 2, 2, 2), [*BLOCKS, *BLOCKS], offsets_for((1, 2)), Target.T)
        np.testing.assert_array_equal(out[:, 9], grid[:, 9])
        assert np.all(out[:, 0] < grid[:, 0])
        assert np.all(out[:, 18] > grid[:, 18])
        assert np.all(np.diff(out, axis=1) >= 0.0)

    def test_each_row_gets_its_own_stratum(self) -> None:
        # the offset of stratum (lead, block) is lead + 0.1 * block index, so the widening names the stratum applied
        grid = normal_grid(6)
        lead, block = ints(1, 1, 1, 5, 5, 5), [*BLOCKS, *BLOCKS]
        offsets = offsets_for((1, 5))
        out = apply_offsets(grid, lead, block, offsets, Target.T)
        np.testing.assert_allclose(grid[:, 0] - out[:, 0], [1.0, 1.1, 1.2, 5.0, 5.1, 5.2])
        np.testing.assert_allclose(out[:, 18] - grid[:, 18], [1.0, 1.1, 1.2, 5.0, 5.1, 5.2])
        order = np.array([4, 0, 5, 2, 1, 3])  # row order must not matter
        shuffled = apply_offsets(grid[order], lead[order], [block[i] for i in order], offsets, Target.T)
        np.testing.assert_array_equal(shuffled, out[order])

    def test_blocks_may_be_strings_or_a_polars_series(self) -> None:
        grid, lead = normal_grid(3), ints(1, 1, 1)
        offsets = offsets_for((1,))
        from_enum = apply_offsets(grid, lead, list(BLOCKS), offsets, Target.T)
        from_str = apply_offsets(grid, lead, [b.value for b in BLOCKS], offsets, Target.T)
        from_series = apply_offsets(grid, lead, pl.Series([b.value for b in BLOCKS]), offsets, Target.T)
        np.testing.assert_array_equal(from_enum, from_str)
        np.testing.assert_array_equal(from_enum, from_series)

    def test_unknown_stratum_raises_key_error_naming_it(self) -> None:
        offsets = offsets_for((1,))
        with pytest.raises(KeyError, match=r"2\|peak"):
            apply_offsets(normal_grid(2), ints(1, 2), [HourBlock.PEAK] * 2, offsets, Target.T)

    def test_unknown_target_raises_key_error_naming_it(self) -> None:
        with pytest.raises(KeyError, match="wind"):
            apply_offsets(normal_grid(1), ints(1), [HourBlock.PEAK], offsets_for((1,)), Target.WIND)

    def test_negative_offset_clamps_at_the_median_and_median_is_kept(self) -> None:
        offsets = ConformalOffsets(
            offsets={"t": {"1|early": [-10.0] * len(PAIRS)}},
            n={"t": {"1|early": 50}},
            fallback={"t": []},
            negative={"t": len(PAIRS)},
        )
        grid = normal_grid(3, sigma=2.0)
        out = apply_offsets(grid, ints(1, 1, 1), [HourBlock.EARLY] * 3, offsets, Target.T)
        np.testing.assert_array_equal(out, np.broadcast_to(grid[:, [9]], out.shape))  # every quantile collapsed to it

    def test_nan_rows_stay_nan_and_others_are_untouched(self) -> None:
        grid = normal_grid(4)
        grid[1, 5] = np.nan
        grid[3, 0] = np.inf
        out = apply_offsets(grid, ints(1, 1, 1, 1), [HourBlock.PEAK] * 4, offsets_for((1,)), Target.T)
        assert np.isnan(out[[1, 3]]).all()
        assert np.isfinite(out[[0, 2]]).all()

    def test_empty_input_gives_empty_output(self) -> None:
        out = apply_offsets(np.empty((0, N_LEVELS)), ints(), [], offsets_for((1,)), Target.T)
        assert out.shape == (0, N_LEVELS)

    @pytest.mark.parametrize(
        ("lead", "block"),
        [(ints(1, 1), [HourBlock.PEAK]), (ints(1), [HourBlock.PEAK] * 2), (ints(1, 8), [HourBlock.PEAK] * 2)],
        ids=["block length", "lead length", "lead out of range"],
    )
    def test_bad_inputs_raise(self, lead: NDArray[np.int8], block: list[HourBlock]) -> None:
        with pytest.raises(ValueError, match=r"lead|block"):
            apply_offsets(normal_grid(2), lead, block, offsets_for((1,)), Target.T)

    def test_grid_with_wrong_columns_raises(self) -> None:
        with pytest.raises(ValueError, match="19"):
            apply_offsets(np.zeros((1, 18)), ints(1), [HourBlock.PEAK], offsets_for((1,)), Target.T)


class TestModel:
    def test_json_round_trip_is_identical(self) -> None:
        offsets = offsets_for((1, 2, 3)).merge(offsets_for((1, 2), target="td"))
        again = ConformalOffsets.model_validate_json(offsets.model_dump_json())
        assert again == offsets
        assert again.model_dump_json() == offsets.model_dump_json()

    def test_serialization_does_not_depend_on_dict_order(self) -> None:
        forward = offsets_for((1, 2, 3))
        strata = forward.offsets["t"]
        reverse_keys = list(reversed(strata))
        scrambled = ConformalOffsets(
            offsets={"t": {k: strata[k] for k in reverse_keys}},
            n={"t": {k: forward.n["t"][k] for k in reverse_keys}},
            fallback={"t": ["3|late", "1|early"]},
            negative={"t": 0},
        )
        reference = ConformalOffsets(
            offsets=forward.offsets, n=forward.n, fallback={"t": ["1|early", "3|late"]}, negative={"t": 0}
        )
        assert scrambled.model_dump_json() == reference.model_dump_json()
        # canonical order: by lead, then early, peak, late (not alphabetical: "1|early" < "1|late" < "1|peak")
        assert list(scrambled.offsets["t"])[:4] == ["1|early", "1|peak", "1|late", "2|early"]
        assert scrambled.fallback["t"] == ["1|early", "3|late"]

    def test_merge_order_does_not_change_the_serialization(self) -> None:
        t, td, wind = offsets_for((1, 2)), offsets_for((1, 2), target="td"), offsets_for((1, 2), target="wind")
        assert t.merge(td).merge(wind).model_dump_json() == wind.merge(t).merge(td).model_dump_json()
        assert list(t.merge(td).merge(wind).offsets) == ["t", "td", "wind"]

    def test_merge_refuses_a_duplicate_target(self) -> None:
        t = offsets_for((1,))
        assert set(t.merge(offsets_for((1,), target="td")).negative) == {"t", "td"}
        with pytest.raises(ValueError, match="already"):
            t.merge(t)

    def test_model_is_frozen_and_rejects_extra_fields(self) -> None:
        offsets = offsets_for((1,))
        with pytest.raises(ValueError, match="frozen"):
            offsets.negative = {}  # type: ignore[misc]
        with pytest.raises(ValueError, match="extra"):
            ConformalOffsets.model_validate({**offsets.model_dump(), "surprise": 1})

    @pytest.mark.parametrize(
        "patch",
        [
            {"offsets": {"t": {"1|peak": [0.1] * 8}}},
            {"offsets": {"t": {"9|peak": [0.1] * 9}}, "n": {"t": {"9|peak": 5}}},
            {"offsets": {"t": {"1|noon": [0.1] * 9}}, "n": {"t": {"1|noon": 5}}},
            {"n": {"t": {"1|late": 50}}},
            {"fallback": {"t": ["1|late"]}},
            {"negative": {"t": 3}},
            {"negative": {"td": 0}},
            {"offsets": {"t": {"1|peak": [float("nan")] * 9}}},
        ],
        ids=[
            "8 offsets",
            "lead 9",
            "block noon",
            "n names other stratum",
            "fallback unknown",
            "wrong negative count",
            "other target",
            "nan",
        ],
    )
    def test_malformed_offsets_are_rejected(self, patch: dict[str, object]) -> None:
        base = {
            "offsets": {"t": {"1|peak": [0.1] * 9}},
            "n": {"t": {"1|peak": 50}},
            "fallback": {"t": []},
            "negative": {"t": 0},
        }
        ConformalOffsets.model_validate(base)
        with pytest.raises(ValueError):  # noqa: PT011 - each case is a different validator; the ids name them
            ConformalOffsets.model_validate({**base, **patch})


def test_module_imports_without_the_training_stack() -> None:
    """The serving adapter imports this module in an image without mapie, scikit-learn or scoringrules."""
    script = (
        "import sys\n"
        "for name in ('mapie', 'sklearn', 'scoringrules'):\n"
        "    sys.modules[name] = None\n"
        "import stellar_blaze.domain.forecast.conformal as c\n"
        "assert c.ConformalOffsets is not None and c.apply_offsets is not None\n"
        "assert 'stellar_blaze.ml' not in sys.modules, 'the domain module pulled in the training package'\n"
        "print('ok')\n"
    )
    result = subprocess.run(  # noqa: S603 - a fixed inline script run with this interpreter
        [sys.executable, "-I", "-c", script], capture_output=True, text=True, check=False, timeout=60
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ok"
