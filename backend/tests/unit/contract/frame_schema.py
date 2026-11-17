"""The schema check that the weather contract suites share.

Import it as ``from tests.unit.contract.frame_schema import assert_frame_has_schema``.
"""

from collections.abc import Mapping

import polars as pl

from stellar_blaze.domain.weather.schemas import SchemaMismatchError, conform


def assert_frame_has_schema(frame: pl.DataFrame, schema: Mapping[str, pl.DataType], where: str) -> None:
    """Assert that ``frame`` has exactly the schema's columns, in its order, with its dtypes.

    ``conform`` rejects missing columns and wrong dtypes and names every one of them, but it drops extra columns. A
    port returns the schema itself, and a different column order breaks a vertical ``pl.concat`` of frames from two
    sources, so extra and reordered columns fail here.

    Args:
        frame: What the source returned.
        schema: ``OBS_RAW_SCHEMA`` or ``FORECAST_SCHEMA``.
        where: Names the source and the call; every failure message starts with it.
    """
    try:
        conform(frame, schema)
    except SchemaMismatchError as exc:
        raise AssertionError(f"{where}: {exc}") from exc
    assert frame.columns == list(schema), (
        f"{where}: columns {frame.columns} must be exactly {list(schema)}, in this order"
    )
