"""``redact``: what it masks, what it must leave alone, and that it is safe to apply twice and to every log line."""

import pytest

from stellar_blaze.redaction import redact, redact_tree

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
