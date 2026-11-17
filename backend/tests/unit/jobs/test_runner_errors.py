"""What ``job_run.error`` may hold: the exception's type and message with credentials masked (``redact`` itself is
tested in ``tests/unit/test_redaction.py``)."""

import time

import pytest

from stellar_blaze.jobs.runner import describe_error
from stellar_blaze.redaction import redact

pytestmark = pytest.mark.unit


def test_describe_error_is_the_type_name_and_a_redacted_message() -> None:
    error = ValueError("bad dsn postgresql+asyncpg://sb:hunter2@db/x")

    description = describe_error(error)

    assert description == "ValueError: bad dsn postgresql+asyncpg://***@db/x"
    assert "hunter2" not in description


def test_describe_error_masks_a_bearer_token_in_the_message() -> None:
    description = describe_error(RuntimeError("upstream said no (Authorization: Bearer abc.def.ghi)"))

    assert description == "RuntimeError: upstream said no (Authorization: ***"
    assert "abc.def.ghi" not in description


def test_describe_error_is_not_the_repr() -> None:
    assert describe_error(RuntimeError("boom")) == "RuntimeError: boom"
    assert describe_error(KeyError("OMXX")) == "KeyError: 'OMXX'"  # str() of a KeyError, as the traceback shows it
    assert describe_error(RuntimeError()) == "RuntimeError:"


def test_describe_error_is_bounded() -> None:
    description = describe_error(RuntimeError("x" * 10_000))

    assert len(description) < 2100
    assert description.endswith("...")


def test_describe_error_cuts_after_the_masking_never_inside_a_credential() -> None:
    # Placed so that character 2000 of the unmasked text falls inside the credentials: a cut made before the masking
    # leaves "sb:hu" behind, a fragment with no "@" after it that no pattern recognizes.
    error = RuntimeError("y" * 1967 + " postgresql://sb:hunter2@db/x and more")
    unmasked = f"RuntimeError: {error}"
    assert unmasked[1995:2000] == "sb:hu"
    assert "sb:hu" in redact(unmasked[:2000])  # the negative control: cutting first leaks it

    description = describe_error(error)

    assert "sb:" not in description
    assert "hunt" not in description
    assert description.endswith("...")


def test_describe_error_of_a_message_the_size_of_a_response_body_is_cheap_and_still_masked() -> None:
    body = "a-" * (2 * 1024 * 1024) + " postgresql://sb:hunter2@db/x"
    error = RuntimeError(f"upstream answered {body} password=hunter3 " + body)

    start = time.perf_counter()
    description = describe_error(error)
    elapsed = time.perf_counter() - start

    assert elapsed < 0.5
    assert len(description) < 2100
    assert "hunter" not in description
