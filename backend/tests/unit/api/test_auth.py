"""Access-token parsing and the bearer check."""

import json

import pytest

from stellar_blaze.api.auth import parse_access_tokens, token_key
from stellar_blaze.application.services import Principal

pytestmark = pytest.mark.unit
ENTRY = {"actor": "bff", "role": "employer", "employer_id": "emp-1"}


def test_parse_access_tokens_keys_are_token_hashes() -> None:
    key = token_key("secret")
    assert parse_access_tokens(json.dumps({key: ENTRY})) == {key: Principal("bff", "employer", "emp-1")}
    assert len(key) == 64


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "[]",
        json.dumps({"abc": ENTRY}),
        json.dumps({"A" * 64: ENTRY}),
        json.dumps({"a" * 64: {**ENTRY, "role": "admin"}}),
        json.dumps({"a" * 64: {"actor": "bff"}}),
    ],
)
def test_parse_access_tokens_refuses_malformed_values(raw: str) -> None:
    with pytest.raises(ValueError, match="SB_ACCESS_TOKENS"):
        parse_access_tokens(raw)
