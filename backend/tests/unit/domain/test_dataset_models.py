"""The summary and manifest records: immutable, strict about unknown fields, and keyed like the research CSV."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from stellar_blaze.domain.weather.dataset import (
    RESEARCH_CSV_KEYS,
    DatasetSummary,
    GoldManifest,
    ManifestFile,
    ObservationQc,
    PairCount,
    RawError,
)

pytestmark = pytest.mark.unit

SHA = "a" * 64


def manifest() -> GoldManifest:
    return GoldManifest(
        created_at=datetime(2026, 11, 12, 9, 30, tzinfo=UTC),
        code_version="abc1234",
        inputs=[ManifestFile(path="silver/forecasts/ecmwf_ifs025/2025/OMAA.parquet", sha256=SHA, rows=26688)],
        output=ManifestFile(path="gold/pairs.parquet", sha256=SHA, rows=3),
        summary=DatasetSummary(
            pair_counts=[PairCount(model="ecmwf_ifs025", summer=2025, lead_days=1, joint=2, joint_daytime=1)],
            raw_errors=[
                RawError(model="ecmwf_ifs025", summer=2025, lead_days=1, var="t", n=3, bias=0.1, mae=1.0, rmse=1.2)
            ],
            wbgt_rejects={"wbgt_obs_c": {"OK": 3}},
            observation_qc=[
                ObservationQc(
                    source="iem",
                    station="OMAA",
                    summer=2025,
                    n_raw=5,
                    n_implausible={"t_c": 0},
                    n_qc_flagged={"t_c": 0},
                )
            ],
        ),
    )


def test_a_manifest_survives_a_json_round_trip() -> None:
    original = manifest()

    assert GoldManifest.model_validate_json(original.model_dump_json()) == original


def test_the_records_are_frozen_and_refuse_unknown_fields() -> None:
    record = PairCount(model="m", summer=2025, lead_days=1, joint=1, joint_daytime=0)

    with pytest.raises(ValidationError, match="frozen"):
        record.joint = 2  # type: ignore[misc]
    with pytest.raises(ValidationError, match="joint_night"):
        PairCount.model_validate(
            {"model": "m", "summer": 2025, "lead_days": 1, "joint": 1, "joint_daytime": 0, "joint_night": 1}
        )


def test_a_manifest_needs_a_timezone_aware_time_and_a_sha256_digest() -> None:
    with pytest.raises(ValidationError, match="created_at"):
        GoldManifest.model_validate(
            {**manifest().model_dump(), "created_at": "2026-11-12T09:30:00"}
        )  # no offset: not UTC-aware
    with pytest.raises(ValidationError, match="sha256"):
        ManifestFile(path="x", sha256="not-a-digest", rows=1)


def test_counts_cannot_be_negative_and_an_error_row_needs_pairs() -> None:
    with pytest.raises(ValidationError, match="joint"):
        PairCount(model="m", summer=2025, lead_days=1, joint=-1, joint_daytime=0)
    with pytest.raises(ValidationError, match="n"):
        RawError(model="m", summer=2025, lead_days=1, var="t", n=0, bias=0.0, mae=0.0, rmse=0.0)


def test_the_research_csv_keys_map_to_the_summary_field_names() -> None:
    # The CSV (docs/research/scripts/results/baseline_errors_pooled.csv) is keyed model, year, lead_d, var; the summary
    # rows are keyed model, summer, lead_days, var. The test that compares them renames through this mapping.
    assert dict(RESEARCH_CSV_KEYS) == {"year": "summer", "lead_d": "lead_days"}
    assert set(RESEARCH_CSV_KEYS.values()) <= set(RawError.model_fields)
    assert set(RESEARCH_CSV_KEYS.values()) <= set(PairCount.model_fields)
