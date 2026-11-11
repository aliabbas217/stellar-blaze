"""Masking credentials in text that is about to be stored or shown: ``job_run.error`` and every log line.

``redact`` is deliberately a pattern mask, not a promise: it removes what looks like a credential (URL userinfo, a
``password=...`` pair, an ``Authorization`` header, a bearer token, a JSON Web Token, a cookie) and leaves every other
character alone. It is the last line of defense after the code that raises and logs has avoided putting secrets in
messages; it is also cheap enough to run over every log line's exception text (``logging.configure_logging`` does).
"""

import re
from typing import Any, Final

_MASK: Final = "***"

# scheme://user:password@host. The credentials run, greedily, up to the last "@" of the whitespace-delimited word: a
# password may hold "@", "/", "?" or "#" (SQLAlchemy's URL parser accepts a raw "/"), and a rule that stopped at the
# first one would leave the rest of the password in the text. The price is over-masking: an "@" later in the same URL
# (``?next=u@b.c``) is taken for the end of the credentials and the host and path before it go too.
_URL_CREDENTIALS = re.compile(r"(?P<scheme>[A-Za-z][A-Za-z0-9+.\-]*://)\S*@")

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
# alone.
_SECRET_PAIR = re.compile(
    r"""(?ix)
    \b(?P<key>[\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential))
    (?P<sep>["']?\s*[=:]\s*)
    (?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&"']+)
    """
)

# Cookie and Set-Cookie headers carry session identifiers: the rest of the line goes.
_COOKIE = re.compile(r"(?i)\b(?P<key>set-cookie|cookie)\b(?P<sep>\s*[=:]\s*)[^\r\n]+")

# A JSON Web Token: three base64url segments, the first two starting like a JSON header and payload ("eyJ" is "{\"").
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*")


def redact(text: str) -> str:
    """``text`` with credentials masked as ``***``; everything else is unchanged.

    Masked: URL credentials (``postgresql+asyncpg://user:pass@host`` becomes ``postgresql+asyncpg://***@host``),
    ``Authorization`` headers, bearer tokens, JSON Web Tokens, cookies, and ``password=...``, ``token: ...`` and
    ``"api_key": "..."`` pairs.
    """
    masked = _URL_CREDENTIALS.sub(rf"\g<scheme>{_MASK}@", text)
    masked = _AUTHORIZATION.sub(rf"\g<key>\g<sep>{_MASK}", masked)
    masked = _BEARER.sub(f"Bearer {_MASK}", masked)
    masked = _JWT.sub(_MASK, masked)
    masked = _COOKIE.sub(rf"\g<key>\g<sep>{_MASK}", masked)
    return _SECRET_PAIR.sub(rf"\g<key>\g<sep>{_MASK}", masked)


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
