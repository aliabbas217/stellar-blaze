"""The privacy-guard helper finds a real leak and ignores digits that sit inside a random hex string."""

import pytest

from tests.privacy import contains_standalone

pytestmark = pytest.mark.unit

# the log line a CI run failed on (2026-11-17): the digits are the middle of a hex id, not the worker's reference
HEX_ID_WITH_THE_DIGITS = "{'subject_sha256': '3e8c150c25963d4471908531d32530f5d6'}"


@pytest.mark.parametrize(
    "text",
    [
        "staff-no-4471-AliKhan",
        '{"worker_ref": "4471"}',
        "4471",
        "ref=4471;",
        "worker 4471 asked",
        "x4471y",  # letters that are not hex digits do not hide it
        "a 4471 b" + HEX_ID_WITH_THE_DIGITS,  # a real leak next to a hash is still a leak
    ],
)
def test_a_real_leak_is_found(text: str) -> None:
    assert contains_standalone(text, "4471")


@pytest.mark.parametrize(
    "text",
    [
        HEX_ID_WITH_THE_DIGITS,
        "d4471",
        "4471a",
        "b44719",
        "request_id: 6bdf8823be6c4cd8838f141731f5251d",
        "",
    ],
)
def test_digits_inside_a_hex_run_are_not_a_leak(text: str) -> None:
    assert not contains_standalone(text, "4471")


def test_the_fragment_is_matched_literally() -> None:
    assert contains_standalone("price (4.4)", "(4.4)")
    assert not contains_standalone("price 4x4", "4.4")
