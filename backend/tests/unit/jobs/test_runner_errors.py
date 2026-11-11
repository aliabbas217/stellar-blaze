"""What ``job_run.error`` may hold: the exception's type and message with credentials masked."""

import pytest

from stellar_blaze.jobs.runner import describe_error, redact

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "could not connect to postgresql+asyncpg://sb:hunter2@db.example:5432/stellar_blaze",
            "could not connect to postgresql+asyncpg://***@db.example:5432/stellar_blaze",
        ),
        ("postgresql://user@host/db", "postgresql://***@host/db"),  # a user name alone is masked too
        (
            "redis://:p%40ss@cache:6379/0 and https://a:b@c.example/x",
            "redis://***@cache:6379/0 and https://***@c.example/x",
        ),
        (
            "a password with an @ in it: postgresql://sb:p@ss@host/db",
            "a password with an @ in it: postgresql://***@host/db",
        ),
        ("host=db user=sb password=hunter2 dbname=x", "host=db user=sb password=*** dbname=x"),
        ("PASSWORD: hunter2", "PASSWORD: ***"),
        ("Authorization token=abc123 failed", "Authorization token=*** failed"),
        ("api_key=k-1 and api-key: k-2", "api_key=*** and api-key: ***"),
        (
            "GET https://example.test/data?station=OMAA returned HTTP 503",
            "GET https://example.test/data?station=OMAA returned HTTP 503",
        ),
        ("no secrets here", "no secrets here"),
    ],
)
def test_redact_masks_credentials_and_nothing_else(text: str, expected: str) -> None:
    assert redact(text) == expected


def test_describe_error_is_the_type_name_and_a_redacted_message() -> None:
    error = ValueError("bad dsn postgresql+asyncpg://sb:hunter2@db/x")

    description = describe_error(error)

    assert description == "ValueError: bad dsn postgresql+asyncpg://***@db/x"
    assert "hunter2" not in description


def test_describe_error_is_not_the_repr() -> None:
    assert describe_error(RuntimeError("boom")) == "RuntimeError: boom"
    assert describe_error(KeyError("OMXX")) == "KeyError: 'OMXX'"  # str() of a KeyError, as the traceback shows it
    assert describe_error(RuntimeError()) == "RuntimeError:"


def test_describe_error_is_bounded() -> None:
    description = describe_error(RuntimeError("x" * 10_000))

    assert len(description) < 2100
    assert description.endswith("...")
