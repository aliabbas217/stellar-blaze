"""``redact``: what it masks, what it must leave alone, and that it is safe to apply twice and to every log line."""

import asyncio
import itertools
import re

import pytest

from stellar_blaze.ports.config_store import StoreUnavailableError
from stellar_blaze.redaction import MAX_REDACTED_CHARS, describe_exception, redact, redact_tree

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # URL credentials
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
        # key=value pairs
        ("host=db user=sb password=hunter2 dbname=x", "host=db user=sb password=*** dbname=x"),
        ("PASSWORD: hunter2", "PASSWORD: ***"),
        ("Authorization token=abc123 failed", "Authorization token=*** failed"),
        ("api_key=k-1 and api-key: k-2", "api_key=*** and api-key: ***"),
        ("db_password=hunter2;Password=hunter3;", "db_password=***;Password=***;"),
        ("x-api-key: k-1, client_secret=s-1&access_token=t-1", "x-api-key: ***, client_secret=***&access_token=***"),
        (
            "?station=OMAA&token=t-1&data=tmpf",
            "?station=OMAA&token=***&data=tmpf",
        ),  # a query string keeps its other pairs
        ('{"password": "hunter2", "user": "sb"}', '{"password": ***, "user": "sb"}'),
        ("{'secret': 'hunter2 with spaces', 'n': 1}", "{'secret': ***, 'n': 1}"),
        # headers and tokens
        ("Authorization: Bearer abc.def.ghi", "Authorization: ***"),
        ("authorization=Basic dXNlcjpwYXNz", "authorization=***"),
        ('{"Authorization": "Bearer abc.def.ghi"}', '{"Authorization": "***"}'),
        ("Proxy-Authorization: Basic dXNlcjpwYXNz", "Proxy-Authorization: ***"),
        ("sent header Bearer abc.def.ghi to the API", "sent header Bearer *** to the API"),
        (
            "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP rejected",
            "token *** rejected",
        ),
        ("Cookie: sid=abc; theme=dark\nnext line", "Cookie: ***\nnext line"),
        ("Set-Cookie: sid=abc; HttpOnly", "Set-Cookie: ***"),
        # review M2: a password with a raw "/", "?" or "#" (SQLAlchemy's URL parser accepts them), quoted values with
        # spaces or escaped quotes, quoted keys of every kind, a header in any case
        ("postgresql+asyncpg://sb:pa/ss@host/db", "postgresql+asyncpg://***@host/db"),
        ("postgresql://sb:pa?ss#x@host/db failed", "postgresql://***@host/db failed"),
        ("'postgresql://sb:pa/ss@host/db'", "'postgresql://***@host/db'"),
        ("{'password': 'x'}", "{'password': ***}"),
        ('{"password": "x"}', '{"password": ***}'),
        ("password='a b' next", "password=*** next"),
        ('password = "a b c" next', "password = *** next"),
        ("password='it\\'s secret' next", "password=*** next"),
        ("X-Auth-Token: abc123", "X-Auth-Token: ***"),
        ("Authorization: bearer abc", "Authorization: ***"),
        ("AUTHORIZATION=Bearer abc.def.ghi", "AUTHORIZATION=***"),
        # known over-masking: an "@" later in the same URL looks like the end of the credentials
        ("https://api.example/x?next=u@b.c", "https://***@b.c"),
        # left alone
        (
            "GET https://example.test/data?station=OMAA returned HTTP 503",
            "GET https://example.test/data?station=OMAA returned HTTP 503",
        ),
        ("max_tokens=100 and tokenizer=bpe", "max_tokens=100 and tokenizer=bpe"),
        ("the bearer of this message; basic usage", "the bearer of this message; basic usage"),
        ("no secrets here", "no secrets here"),
        ("", ""),
    ],
)
def test_redact_masks_credentials_and_nothing_else(text: str, expected: str) -> None:
    assert redact(text) == expected


def test_redact_is_idempotent() -> None:
    text = "postgresql://sb:hunter2@db/x password=hunter2 Authorization: Bearer abc.def.ghi"

    once = redact(text)

    assert redact(once) == once
    assert "hunter2" not in once
    assert "abc.def.ghi" not in once


def test_redact_masks_a_credential_inside_a_rendered_traceback() -> None:
    traceback_text = (
        "Traceback (most recent call last):\n"
        '  File "app.py", line 3, in connect\n'
        '    raise RuntimeError(f"cannot reach postgresql+asyncpg://sb:hunter2@db/x ({header})")\n'
        "RuntimeError: cannot reach postgresql+asyncpg://sb:hunter2@db/x (Authorization: Bearer abc.def.ghi)\n"
    )

    redacted = redact(traceback_text)

    assert "hunter2" not in redacted
    assert "abc.def.ghi" not in redacted
    assert redacted.count("***") == 3  # the URL in the source line, then the URL and the header in the message
    assert 'File "app.py", line 3, in connect' in redacted  # the structure of the traceback is untouched


def test_redact_tree_reaches_every_string_and_keeps_the_structure() -> None:
    value = {
        "exc_value": "postgresql://sb:hunter2@db/x",
        "frames": [{"filename": "a.py", "lineno": 3}, ("password=hunter2", None)],
        "n": 7,
        "flag": True,
    }

    assert redact_tree(value) == {
        "exc_value": "postgresql://***@db/x",
        "frames": [{"filename": "a.py", "lineno": 3}, ("password=***", None)],
        "n": 7,
        "flag": True,
    }
    assert value["exc_value"] == "postgresql://sb:hunter2@db/x"  # the input is not changed


# --- final review I1: bounded work, and what an oversized text keeps -----------------------------------------------


def test_redact_masks_a_url_credential_whose_scheme_runs_past_the_32_character_bound() -> None:
    # The scheme the URL rule looks for is at most 32 characters (a bound, so that a long run of letters is not read
    # again from every position of it). Its credentials are masked all the same; the letters before the last 32 of them
    # are left as they were.
    text = f"{'x' * 40}://sb:hunter2@db/x"

    assert redact(text) == f"{'x' * 40}://***@db/x"


def test_redact_masks_a_url_whose_password_is_far_longer_than_any_real_one() -> None:
    text = f"postgresql://sb:{'p' * 5000}@db/x"

    assert redact(text) == "postgresql://***@db/x"


@pytest.mark.parametrize(("header_chars", "payload_chars"), [(1024, 40), (40, 16384)])
def test_redact_masks_a_json_web_token_up_to_the_segment_bounds(header_chars: int, payload_chars: int) -> None:
    token = f"eyJ{'a' * (header_chars - 3)}.eyJ{'b' * (payload_chars - 3)}.sig_nature-1"

    assert redact(f"got {token} back") == "got *** back"


def test_redact_a_text_at_the_ceiling_is_scanned_whole() -> None:
    filler = "word " * ((MAX_REDACTED_CHARS - 40) // 5)
    text = f"{filler}password=hunter2 tail".ljust(MAX_REDACTED_CHARS)
    assert len(text) == MAX_REDACTED_CHARS

    out = redact(text)

    assert "elided" not in out
    assert "password=***" in out
    assert "hunter2" not in out


def test_redact_keeps_the_head_and_the_tail_of_a_text_over_the_ceiling_and_masks_both() -> None:
    middle = "mid " * 20_000 + "password=hunter-middle " + "mid " * 20_000
    text = f"start password=hunter-head {middle} postgresql://sb:hunter-tail@db/x end"

    out = redact(text)

    assert len(out) < MAX_REDACTED_CHARS
    assert out.startswith("start password=*** ")
    assert out.endswith(" postgresql://***@db/x end")
    marker = re.search(r"\[\.\.\. (\d+) chars elided \.\.\.\]", out)
    assert marker is not None
    assert 0 < int(marker.group(1)) < len(text)
    assert "hunter" not in out  # the masked head and tail, and the middle that is gone


def test_redact_cuts_an_oversized_text_at_whitespace_so_that_no_credential_is_split() -> None:
    # The same URL, repeated, with the start shifted one character at a time: whichever character of the user name or
    # password the nominal cut falls on, the output holds no fragment of either, because the cut moves to a space.
    for shift in range(30):
        word = "postgresql://sb:hunter2@db/x "
        text = "y" * shift + " " + word * (3 * MAX_REDACTED_CHARS // len(word))

        out = redact(text)

        assert "elided" in out
        for fragment in ("sb:", "hunt", "unter", "ter2", "er2@"):
            assert fragment not in out, f"shift {shift}: {fragment!r} survived in {out[:60]!r}...{out[-60:]!r}"


def test_redact_of_an_oversized_text_without_any_whitespace_still_cuts_it() -> None:
    out = redact("x" * (3 * MAX_REDACTED_CHARS))

    assert len(out) < MAX_REDACTED_CHARS
    assert "chars elided" in out


# --- describe_exception --------------------------------------------------------------------------------------------


def test_describe_exception_is_the_type_and_the_message() -> None:
    assert describe_exception(RuntimeError("boom")) == "RuntimeError: boom"
    assert describe_exception(KeyError("OMXX")) == "KeyError: 'OMXX'"
    assert describe_exception(RuntimeError()) == "RuntimeError:"


def test_describe_exception_names_the_cause_and_masks_credentials_in_both() -> None:
    failure = StoreUnavailableError("the activation log could not be read, password=hunter1 was refused")
    failure.__cause__ = ConnectionRefusedError("cannot connect to postgresql+asyncpg://sb:hunter2@db:5432/x")

    description = describe_exception(failure)

    assert description == (
        "StoreUnavailableError: the activation log could not be read, password=*** was refused <- "
        "ConnectionRefusedError: cannot connect to postgresql+asyncpg://***@db:5432/x"
    )


def test_describe_exception_does_not_repeat_a_cause_that_the_message_already_quotes() -> None:
    driver = OSError("connection refused")
    failure = StoreUnavailableError(f"OSError: {driver}")
    failure.__cause__ = driver

    assert describe_exception(failure) == "StoreUnavailableError: OSError: connection refused"


def test_describe_exception_follows_the_declared_cause_and_not_the_implicit_context() -> None:
    declared = RuntimeError("second")
    declared.__cause__ = ValueError("first")  # `raise RuntimeError("second") from ValueError("first")`
    incidental = RuntimeError("second")
    incidental.__context__ = ValueError("first")  # a `raise` inside an `except` block, with no `from`

    assert describe_exception(declared) == "RuntimeError: second <- ValueError: first"
    assert describe_exception(incidental) == "RuntimeError: second"

    # What `asyncio.timeout` raises: its context is the CancelledError that it turned into a timeout.
    timeout = TimeoutError()
    timeout.__context__ = asyncio.CancelledError()
    assert describe_exception(timeout) == "TimeoutError:"


def test_describe_exception_stops_at_a_cycle_and_at_five_exceptions() -> None:
    a, b = RuntimeError("a"), RuntimeError("b")
    a.__cause__, b.__cause__ = b, a
    assert describe_exception(a) == "RuntimeError: a <- RuntimeError: b"

    chain = [ValueError(str(i)) for i in range(8)]
    for outer, inner in itertools.pairwise(chain):
        outer.__cause__ = inner
    assert describe_exception(chain[0]) == " <- ".join(f"ValueError: {i}" for i in range(5))


def test_describe_exception_is_bounded_and_the_bound_is_applied_after_the_masking() -> None:
    long = RuntimeError("x" * 10_000)
    assert len(describe_exception(long)) == 503
    assert describe_exception(long).endswith("...")

    # A cut at 40 characters would land inside the user name and password of the URL; the masking happens first.
    straddling = RuntimeError("see postgresql+asyncpg://sb:hunter2@db:5432/x for details")
    description = describe_exception(straddling, max_chars=40)
    assert "hunter" not in description
    assert "sb:" not in description
