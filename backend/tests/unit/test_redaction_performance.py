"""``redact`` runs over every log line's exception text, so an input chosen to be slow must not be able to stall the
process (final review I1).

Before the fix two patterns were quadratic: the credential-pair pattern read an unbounded ``[\\w-]*`` prefix from every
word boundary, and the URL pattern read an unbounded scheme from every position. Measured on the development laptop on
2026-11-12 with the old code, 8 KB of ``a-`` took 2.7 s, 8 KB of ``eyJ-`` 1.3 s and 8 KB of ``secret-`` 0.84 s; 64 KB of
``a-`` takes minutes.

Measured with the fix, one ``redact`` call over 64 KB took 35 ms at worst for every input below (``eyJ-`` repeated; the
mean is 12 ms). Since the masking moved in front of the cut (post-final fix), a text over the ceiling is masked in two
windows of 36,832 characters (the kept part and the 20 KB of context past each cut), so the work is set by the windows
and not by the input: 256 KB and 1 MB took what 64 KB took. At the ceiling itself the worst was 21 ms.
The assertion is 0.5 s, fourteen times the worst measurement, so that a loaded CI runner does not make it flaky, and it
is still orders of magnitude under what a quadratic pattern needs at this size. Each input is tried at the ceiling
(``MAX_REDACTED_CHARS``, scanned whole) and at 64 KB (masked in two windows first), so a pattern that is slow cannot
hide behind the cut.
"""

import time
from collections.abc import Callable

import pytest

from stellar_blaze.redaction import MAX_REDACTED_CHARS, redact

pytestmark = pytest.mark.unit

BOUND_S = 0.5


def repeated(unit: str) -> Callable[[int], str]:
    return lambda n: unit * (n // len(unit))


ADVERSARIAL: dict[str, Callable[[int], str]] = {
    "hyphen-runs": repeated("a-"),
    "hyphens-only": repeated("-"),
    "long-alphanumeric-run": repeated("x"),
    "alphanumeric-run-ending-in-scheme-separator": lambda n: "x" * (n - 3) + "://",
    "at-dense": repeated("@"),
    "equals-dense": repeated("="),
    "key-equals-dense": repeated("a="),
    "scheme-repeated-without-at": repeated("x://"),
    "scheme-repeated-with-one-at-at-the-end": lambda n: "x://" * (n // 4 - 1) + "a@",
    "empty-userinfo-dense": repeated("a://@"),
    "credential-word-dense": repeated("password: "),
    "credential-word-without-separator": repeated("token"),
    "credential-prefix-dense": repeated("secret-"),
    "credential-suffix-dense": repeated("a-token"),
    "unterminated-quoted-value": lambda n: 'password="' + "a\\" * (n // 2),
    "authorization-then-spaces": lambda n: "authorization:" + " " * n,
    "bearer-then-spaces": lambda n: "bearer" + " " * n,
    "cookie-then-spaces": lambda n: "cookie" + " " * n,
    "jwt-header-start-at-every-hyphen": repeated("eyJ-"),
    "jwt-header-then-long-run-without-dot": lambda n: "eyJ" + "a-" * (n // 2),
    "jwt-header-and-dot-dense": repeated("eyJaaaaaaaa."),
    "whitespace-only": repeated(" "),
    "newlines": repeated("a\n"),
}


@pytest.mark.parametrize("size", [MAX_REDACTED_CHARS, 64 * 1024], ids=["at-the-ceiling", "64-KB"])
@pytest.mark.parametrize("name", list(ADVERSARIAL))
def test_redact_is_fast_on_an_input_built_to_be_slow(name: str, size: int) -> None:
    text = ADVERSARIAL[name](size)

    start = time.perf_counter()
    redact(text)
    elapsed = time.perf_counter() - start

    assert elapsed < BOUND_S, f"redact took {elapsed:.3f} s on {size} characters of {name}"


def test_redact_of_a_megabyte_is_as_cheap_as_the_ceiling() -> None:
    # What an exception that quotes a whole response body hands over: the work is set by the ceiling, not by the input.
    text = "a-" * (1024 * 1024 // 2)

    start = time.perf_counter()
    out = redact(text)
    elapsed = time.perf_counter() - start

    assert elapsed < BOUND_S
    assert len(out) < MAX_REDACTED_CHARS
