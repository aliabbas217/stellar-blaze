"""Masking credentials in text that is about to be stored or shown: ``job_run.error`` and every log line.

``redact`` is deliberately a pattern mask, not a promise: it removes what looks like a credential (URL userinfo, a
``password=...`` pair, an ``Authorization`` header, a bearer token, a JSON Web Token, a cookie) and leaves every other
character alone. It is the last line of defense after the code that raises and logs has avoided putting secrets in
messages; it is also cheap enough to run over every log line's exception text (``logging.configure_logging`` does).

"Cheap" is a property this module enforces, because the text it sees is not under our control (an exception can quote a
whole response body): every pattern is either linear in the length of the text or bounded per position, and ``redact``
never scans more than twice ``_KEPT_CHARS + _CONTEXT_CHARS`` characters (about 74 KB) whatever the length of its
input: a text over ``MAX_REDACTED_CHARS`` keeps its head and its tail (see ``redact``).
``tests/unit/test_redaction_performance.py`` holds the adversarial inputs and the measured times.
"""

import re
from typing import Any, Final

_MASK: Final = "***"

MAX_REDACTED_CHARS: Final = 32_768
"""The longest text ``redact`` returns whole. A longer one is cut to its head and its tail around an elision marker, so
that what a log line or a database row holds has a ceiling whatever the caller passes (a traceback is 1 to 10 KB; 32 KB
is a deep chain)."""

# Each kept part is a little under half of the ceiling, so that the two parts and the marker stay under it.
_KEPT_CHARS: Final = (MAX_REDACTED_CHARS - 64) // 2
# How far past a cut the text is read before it is masked, so that a credential that straddles the cut is seen whole.
# Masking after the cut is what leaked: a part that began at "Bearer", at "password:" or at a bare value has lost the
# words that make the rest a credential. The longest span a pattern here recognizes and bounds is a JSON Web Token
# (1,024 + 16,384 characters in its first two segments, then the signature, which is a few hundred); an Authorization
# or Cookie header line is under 8 KB where a server accepts it. 20 KB covers all of them. A URL password, a quoted
# value or a cookie line has no bound in the patterns, so one that runs more than this far past a cut is not seen whole
# there; ``redact`` says so.
_CONTEXT_CHARS: Final = 20_480
# A cut is moved to the nearest whitespace within this many characters of the masked text, so that it does not leave
# half a word. This is for the reader: what keeps a credential out of the output is that the text is masked first.
_CUT_SLACK_CHARS: Final = 256

# scheme://user:password@host. The credentials run, greedily, up to the last "@" of the whitespace-delimited word: a
# password may hold "@", "/", "?" or "#" (SQLAlchemy's URL parser accepts a raw "/"), and a rule that stopped at the
# first one would leave the rest of the password in the text. The price is over-masking: an "@" later in the same URL
# (``?next=u@b.c``) is taken for the end of the credentials and the host and path before it go too.
#
# It is code and not one pattern (``scheme://\S*@``) because that pattern is quadratic on a long word that holds a
# scheme but no "@": every "x://" in ``x://x://x://...`` scans to the end of the word and backs off again. Here the
# last "@" of a word is found once, and only the text before it is searched for the scheme (at most 32 characters
# long: RFC 3986 allows more, no driver or protocol name comes near it).
_URL_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]{0,31}://")
_WORD = re.compile(r"\S+")

# An Authorization header or JSON member, with or without a scheme word: "Authorization: Bearer abc",
# "authorization=abc", '"Authorization": "Basic abc"'. The whole value goes, the scheme word included.
_AUTHORIZATION = re.compile(
    r"""(?ix)
    \b(?P<key>(?:proxy-)?authorization)\b
    (?P<sep>["']?\s*[=:]\s*["']?)
    (?:(?:bearer|basic|digest|negotiate|token)\s+)?
    [^\s,;"']+
    """
)

# A bearer token on its own ("Bearer abc.def.ghi"), as quoted from a header value or a library's message. Six
# characters or more, so that the English word in "the bearer of this message" is not mistaken for one.
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]{6,}")

# key=value, key: value and "key": "value" pairs whose key names a credential: password, db_password, client_secret,
# access_token, x-api-key, private_key, credential. The value is a quoted string (spaces and escaped quotes inside it
# belong to it) or runs to the next space, comma, semicolon or ampersand (so a query string or a connection string keeps
# its other pairs). A key that merely contains one of the words (max_tokens, tokenizer) is not a credential and is left
# alone: the separator has to follow the word.
#
# The pattern starts at the word itself, with no ``[\w-]*`` in front of it for a prefix such as "db_" or "x-": the
# prefix is not part of what is replaced (only the value is), and a pattern that has to read a prefix of unbounded
# length at every position is quadratic on a long run of word characters and hyphens (``a-a-a-...``).
_SECRET_PAIR = re.compile(
    r"""(?ix)
    (?P<key>password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)
    (?P<sep>["']?\s*[=:]\s*)
    (?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&"']+)
    """
)

# Cookie and Set-Cookie headers carry session identifiers: the rest of the line goes.
_COOKIE = re.compile(r"(?i)\b(?P<key>set-cookie|cookie)\b(?P<sep>\s*[=:]\s*)[^\r\n]+")

# A JSON Web Token: three base64url segments, the first two starting like a JSON header and payload ("eyJ" is "{\"").
# The first two segments are bounded (a header is about 40 to 400 characters and a payload one to a few thousand; HTTP
# servers refuse a header line past 8 KB; a JWT whose header is over 1,024 characters or whose payload is over 16,384
# is not recognized as one here) and possessive: ``eyJ-eyJ-eyJ-...`` offers a start at every hyphen, and an unbounded
# segment would be read to the end of the run from each of them. The header bound is the one that sets the cost of
# that input; the payload is only read after a header and ``.eyJ`` have matched.
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{6,1024}+\.eyJ[A-Za-z0-9_-]{6,16384}+\.[A-Za-z0-9_-]*")


def _mask_url_credentials(text: str) -> str:
    """``scheme://user:password@host`` with the part between ``://`` and the last ``@`` of the word masked."""
    if "://" not in text or "@" not in text:  # almost every line: skip the word scan
        return text

    def mask_word(match: re.Match[str]) -> str:
        word = match.group()
        at = word.rfind("@")
        if at < 0:
            return word
        scheme = _URL_SCHEME.search(word, 0, at)
        if scheme is None:
            return word
        return f"{word[: scheme.end()]}{_MASK}@{word[at + 1 :]}"

    return _WORD.sub(mask_word, text)


def _mask(text: str) -> str:
    masked = _mask_url_credentials(text)
    masked = _AUTHORIZATION.sub(rf"\g<key>\g<sep>{_MASK}", masked)
    masked = _BEARER.sub(f"Bearer {_MASK}", masked)
    masked = _JWT.sub(_MASK, masked)
    masked = _COOKIE.sub(rf"\g<key>\g<sep>{_MASK}", masked)
    return _SECRET_PAIR.sub(rf"\g<key>\g<sep>{_MASK}", masked)


def _end_at_whitespace(masked: str, end: int) -> str:
    """``masked[:end]``, ended at the nearest whitespace within ``_CUT_SLACK_CHARS`` before ``end`` if there is one."""
    end = max(end, 0)
    for index in range(end - 1, max(end - _CUT_SLACK_CHARS, 0) - 1, -1):
        if masked[index].isspace():
            return masked[:index]
    return masked[:end]


def _start_at_whitespace(masked: str, start: int) -> str:
    """``masked[start:]``, started after the nearest whitespace within ``_CUT_SLACK_CHARS`` after ``start``, if any."""
    for index in range(start, min(start + _CUT_SLACK_CHARS, len(masked))):
        if masked[index].isspace():
            return masked[index + 1 :]
    return masked[start:]


def _masked_head_and_tail(text: str) -> tuple[str, str]:
    """The masked first and last ``_KEPT_CHARS`` characters or so of ``text``, masked before they are cut.

    Each end is read with ``_CONTEXT_CHARS`` more characters, past the cut, masked as a whole, and then trimmed; the raw
    text is never cut. A credential that straddles the nominal cut is therefore masked as it is anywhere else, and the
    trim only removes characters from text that is already masked.

    The trim also keeps ``_CONTEXT_CHARS`` of masked text between what is shown and the outer edge of each window. A
    window is cut out of the text, so a credential that crosses its outer edge is cut as well and may not be recognized
    (a URL whose ``@`` is past the edge, a quoted value whose closing quote is). What is left of it is in the last
    ``_CONTEXT_CHARS`` characters of the masked head, or the first of the masked tail, and none of that is shown. The
    offsets are taken in the masked text, so what masking took out of a window is not given back: a text that is mostly
    credentials shows less, and one that is nothing but credentials shows nothing. (A cut by the length of the kept
    part alone would show up to the very edge of a window that masking had shortened, unfinished credential and all.)
    """
    reach = _KEPT_CHARS + _CONTEXT_CHARS
    head, tail = _mask(text[:reach]), _mask(text[-reach:])
    return (
        _end_at_whitespace(head, min(_KEPT_CHARS, len(head) - _CONTEXT_CHARS)),
        _start_at_whitespace(tail, max(len(tail) - _KEPT_CHARS, _CONTEXT_CHARS)),
    )


def redact(text: str) -> str:
    """``text`` with credentials masked as ``***``; everything else is unchanged.

    Masked: URL credentials (``postgresql+asyncpg://user:pass@host`` becomes ``postgresql+asyncpg://***@host``),
    ``Authorization`` headers, bearer tokens, JSON Web Tokens, cookies, and ``password=...``, ``token: ...`` and
    ``"api_key": "..."`` pairs.

    A text longer than ``MAX_REDACTED_CHARS`` keeps its first and its last 16,000 characters or so around
    ``[... N chars elided ...]``. What is in the elided middle is gone, secret or not, so nothing in it can reach a log
    or a database. The masking comes before the cut, never after: each end is masked together with ``_CONTEXT_CHARS``
    (20,480) characters past the cut, and the cut is made in the masked text. A credential with whitespace in it
    (``Authorization: Bearer <token>``, ``password: <value>``, a JSON pair, a quoted value of several words, a cookie
    line) is masked whichever of its characters the cut falls on, because the words that identify it are in the text
    that is masked; cutting the raw text first left the part after the cut starting at a bare value.

    What this does not cover is a credential that no pattern bounds and that runs more than ``_CONTEXT_CHARS``
    characters past a cut: a URL password, a quoted value or a cookie line of over 20 KB. (A JSON Web Token is covered:
    its pattern accepts at most 17 KB before the signature.)

    ``N`` is the length of ``text`` minus the lengths of the two masked parts that are shown, so it differs from the
    number of characters left out by what the masking added or removed in those parts.
    """
    if len(text) <= MAX_REDACTED_CHARS:
        return _mask(text)
    head, tail = _masked_head_and_tail(text)
    elided = len(text) - len(head) - len(tail)
    return f"{head} [... {elided} chars elided ...] {tail}"


def describe_exception(exc: BaseException, *, max_chars: int = 500) -> str:
    """``"<ExceptionType>: <message>"`` of ``exc``, then of each exception it was raised from, redacted and bounded.

    For a log line that has to say what failed without a traceback. Each declared cause (``raise ... from cause``)
    follows as `` <- <ExceptionType>: <message>``, up to four of them. A cause is not repeated when the exception it
    explains already quotes its message (the Postgres config store puts the driver's error text into its own
    ``StoreUnavailableError``). The implicit ``__context__`` is not followed: it records what was being handled when
    the exception was raised, not that it caused it, and is often noise (``asyncio.timeout`` raises its ``TimeoutError``
    with a ``CancelledError`` as context); the traceback in the ``exception`` field of an ``exc_info`` log line has it.

    Not ``repr(exc)``, and not the traceback: an exception that fails while connecting can quote the DSN, and
    ``redact`` masks what it recognizes (it is a pattern mask, see the module docstring). Over ``max_chars`` the text
    ends in ``...``.
    """
    parts: list[str] = []
    seen: set[int] = set()
    parent_message = ""
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(seen) < 5:
        seen.add(id(current))
        message = str(current)
        if not parts or not message or message not in parent_message:
            parts.append(f"{type(current).__name__}: {message}".strip())
        parent_message = message
        current = current.__cause__
    text = redact(" <- ".join(parts))
    return text if len(text) <= max_chars else text[:max_chars] + "..."


def redact_tree(value: Any) -> Any:
    """``value`` with ``redact`` applied to every string in it: strings, and the lists, tuples and dicts holding them.

    Dict keys are kept. Anything that is not a string or one of those containers is returned as it is.
    """
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, list):
        return [redact_tree(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_tree(item) for item in value)
    if isinstance(value, dict):
        return {key: redact_tree(item) for key, item in value.items()}
    return value
