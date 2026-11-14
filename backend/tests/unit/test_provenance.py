"""``domain.provenance``: the label every exported number carries to say where it came from and how to recompute it."""

from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import JsonValue, ValidationError

from stellar_blaze.domain.provenance import Provenance, ProvenanceLabel, attach_provenance

pytestmark = pytest.mark.unit

SHA = "ab" * 32
GENERATED_AT = datetime(2026, 11, 14, 9, 30, tzinfo=UTC)


def make_provenance(**overrides: Any) -> Provenance:
    fields: dict[str, Any] = {
        "protocol_path": "docs/research/2026-11-12-preregistration-2026-evaluation.md",
        "protocol_anchor": "#7-metrics",
        "script": "stellar_blaze.ml.evaluate",
        "function": "evaluate_dev",
        "git_sha": "0123456789abcdef0123456789abcdef01234567",
        "data_sha256": SHA,
        "model_id": None,
        "label": ProvenanceLabel.REAL,
        "generated_at": GENERATED_AT,
    }
    return Provenance(**(fields | overrides))


def test_provenance_rejects_extra_and_naive_datetime() -> None:
    with pytest.raises(ValidationError, match="surprise"):
        make_provenance(surprise="x")
    with pytest.raises(ValidationError, match="generated_at"):
        make_provenance(generated_at=datetime(2026, 11, 14, 9, 30))  # noqa: DTZ001 (the naive value is the test)
    with pytest.raises(ValidationError, match="data_sha256"):
        make_provenance(data_sha256="not-a-digest")


def test_label_strings_are_exactly_the_ones_the_reports_print() -> None:
    assert {label.name: label.value for label in ProvenanceLabel} == {
        "REAL": "REAL",
        "REAL_WEATHER_ASSUMED_CREW": "REAL weather + assumed crew",
        "SIMULATED": "SIMULATED",
    }


def test_provenance_is_frozen() -> None:
    provenance = make_provenance()

    with pytest.raises(ValidationError, match="frozen"):
        provenance.git_sha = "other"  # type: ignore[misc]


def test_attach_adds_the_provenance_without_touching_the_payload() -> None:
    payload: dict[str, JsonValue] = {"mae": 0.42, "rows": [1, 2, {"nested": True}]}
    before = {"mae": 0.42, "rows": [1, 2, {"nested": True}]}

    result = attach_provenance(payload, make_provenance())

    assert payload == before  # the input has no provenance key and is otherwise unchanged
    assert result is not payload
    assert result["mae"] == 0.42
    assert result["provenance"] == make_provenance().model_dump(mode="json")
    assert isinstance(result["rows"], list)
    nested = result["rows"][2]
    assert isinstance(nested, dict)
    nested["nested"] = False  # editing the result must not reach back into the payload
    assert payload == before


def test_attach_refuses_a_payload_that_already_has_provenance() -> None:
    with pytest.raises(ValueError, match="already has a 'provenance' key"):
        attach_provenance({"provenance": "mine"}, make_provenance())


def test_attach_writes_json_native_values() -> None:
    result = attach_provenance({}, make_provenance(label=ProvenanceLabel.REAL_WEATHER_ASSUMED_CREW, model_id="m-1"))

    block = result["provenance"]
    assert isinstance(block, dict)
    assert block["label"] == "REAL weather + assumed crew"  # the enum's value, not its repr
    assert block["generated_at"] == "2026-11-14T09:30:00Z"  # a string, not a datetime
    assert block["model_id"] == "m-1"


def test_provenance_round_trips_through_json() -> None:
    import json

    original = make_provenance(model_id="corrector-20261114-0123456-abcdef", label=ProvenanceLabel.SIMULATED)

    document = json.dumps(attach_provenance({"n": 3}, original))
    restored = Provenance.model_validate(json.loads(document)["provenance"])

    assert restored == original
