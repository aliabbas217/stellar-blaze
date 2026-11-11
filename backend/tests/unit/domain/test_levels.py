import pytest

from stellar_blaze.domain.risk.levels import AlertLevel

pytestmark = pytest.mark.unit


def test_alert_levels_are_the_four_lowercase_wire_codes_in_ascending_severity() -> None:
    # The F1 push payload and API `Level` are "green" | "amber" | "orange" | "red"; declaration order is severity order.
    assert [level.value for level in AlertLevel] == ["green", "amber", "orange", "red"]


def test_alert_level_round_trips_through_its_wire_code() -> None:
    assert AlertLevel("red") is AlertLevel.RED
    assert str(AlertLevel.AMBER) == "amber"  # StrEnum: formats as the code, so it serializes as the code


def test_unknown_alert_level_is_rejected() -> None:
    with pytest.raises(ValueError, match="purple"):
        AlertLevel("purple")
