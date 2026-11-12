"""``redact`` of a text over ``MAX_REDACTED_CHARS``: a credential that straddles a cut is masked like any other.

Until the post-final fix, ``redact`` cut the raw text into its head and its tail and masked each part on its own. A cut
that fell on a credential's key word (``Bearer``, ``password:``, ``"password": "v"``, ``Authorization: Basic``,
``Cookie:``) left a tail that began at the bare value, which no pattern recognizes; a cut inside a quoted value of
several words, or inside a URL before its ``@``, left a head with an unterminated credential. Each of those leaked at
7 to 32 offsets of the cut. The fix masks first (a window that reaches past the cut) and cuts the masked text.

The sweeps here put each credential shape the module masks at every alignment with the head cut and, at the same time
(the two ends of ``redact`` do not depend on each other), with the tail cut, in a text of 96 KB, and require that no
part of the canary reaches the output. The sweeps are only worth anything if they can fail, so the second half runs the
same sweeps against the algorithm this fix replaced (cut, then mask), and requires each shape to leak under it. The cut
positions are not copied from the module: they are read back from what ``redact`` does to a numbered filler text, so a
change to how much it keeps moves the sweeps with it.

The fake credentials are called canaries because ruff's S105 reads a variable called "secret" as a hardcoded password.
"""

import base64
import functools
import re
from collections.abc import Callable
from dataclasses import dataclass

import pytest

from stellar_blaze.redaction import MAX_REDACTED_CHARS, redact

pytestmark = pytest.mark.unit

TOTAL = 3 * MAX_REDACTED_CHARS
HEAD_CANARIES = ("Zq7Kp2Xw9Lm4Vt6Rb3Hn8", "Yd5Gc1Fs0Jh8Wn4Ta2Ue6")
TAIL_CANARIES = ("Vb4Nm8Qw2Er6Ty0Ui5Op1", "Ls3Kd7Jf9Hg1Gx5Zc2Mv8")
GRAM = 8  # a fragment of this many characters of a canary in the output is a leak

_ELISION = re.compile(r" \[\.\.\. \d+ chars elided \.\.\.\] ")

Redactor = Callable[[str], str]


@dataclass(frozen=True)
class Rendered:
    """A credential as it is written in a log, and the strings of it that must never reach the output."""

    text: str
    canaries: tuple[str, ...]


def _basic(first: str, _second: str) -> Rendered:
    encoded = base64.b64encode(f"svc:{first}".encode()).decode()
    return Rendered(f"Authorization: Basic {encoded}", (encoded,))


def _jwt(first: str, second: str) -> Rendered:
    return Rendered(f"eyJhbGciOiJIUzI1NiJ9.eyJ{first}.{second}", (f"eyJ{first}", second))


# Each shape is written with two canaries (the second is used by the shapes that hold two words), one set for the head
# cut and another for the tail cut, so that a leak is attributed to the side that it is on.
SHAPES: dict[str, Callable[[str, str], Rendered]] = {
    "url-password": lambda a, _b: Rendered(f"postgresql+asyncpg://sb:{a}@db.example:5432/stellar_blaze", (a,)),
    "password-equals": lambda a, _b: Rendered(f"password={a}", (a,)),
    "password-colon": lambda a, _b: Rendered(f"password: {a}", (a,)),
    "json-pair": lambda a, _b: Rendered(f'{{"password": "{a}"}}', (a,)),
    "quoted-two-words": lambda a, b: Rendered(f'password="{a} {b}"', (a, b)),
    "authorization-bearer": lambda a, _b: Rendered(f"Authorization: Bearer {a}", (a,)),
    "authorization-basic": _basic,
    "bare-bearer": lambda a, _b: Rendered(f"Bearer {a}", (a,)),
    "cookie": lambda a, _b: Rendered(f"Cookie: sid={a}; theme=dark\n", (a,)),
    "jwt": _jwt,
}


def _numbered_filler(length: int) -> str:
    """``0000000 0000001 0000002 ...``: every offset can be read off the text, and the text holds nothing to mask."""
    return "".join(f"{number:07d} " for number in range(length // 8 + 1))[:length]


FILLER = _numbered_filler(TOTAL)


@functools.cache
def _cuts() -> tuple[int, int]:
    """Where ``redact`` cuts a text of ``TOTAL`` characters: the head is ``text[:head_end]``, the tail is the rest."""
    out = redact(FILLER)
    elision = _ELISION.search(out)
    assert elision is not None
    head, tail = out[: elision.start()], out[elision.end() :]
    assert FILLER.startswith(head), "the head of a plain text is its first characters"
    assert FILLER.endswith(tail), "the tail of a plain text is its last characters"
    return len(head), TOTAL - len(tail)


@dataclass
class Sweep:
    """What a sweep found, per side of the cut: the offsets at which a canary leaked, and how often a mask showed."""

    leaked: dict[str, list[int]]
    masks_shown: dict[str, int]


def _grams(canaries: tuple[str, ...]) -> list[str]:
    return [canary[i : i + GRAM] for canary in canaries for i in range(len(canary) - GRAM + 1)]


def _sweep(redactor: Redactor, name: str, *, stop_at_first_leak: bool = False) -> Sweep:
    """Put the shape at every alignment with each cut, and say what reached the output.

    The shape starts from far enough before the cut that it ends before it, to 64 characters after it: it is tried
    whole before the cut, with the cut at each of its characters, and whole after the cut. One text holds a copy at the
    head cut and a copy at the tail cut, each with its own canaries. The text keeps its length (the copies replace
    filler), so the cuts do not move from one offset to the next.
    """
    head_end, tail_start = _cuts()
    head_shape, tail_shape = SHAPES[name](*HEAD_CANARIES), SHAPES[name](*TAIL_CANARIES)
    head_copy, tail_copy = f" {head_shape.text} ", f" {tail_shape.text} "
    assert len(head_copy) == len(tail_copy)
    grams = {"head": _grams(head_shape.canaries), "tail": _grams(tail_shape.canaries)}
    sweep = Sweep(leaked={"head": [], "tail": []}, masks_shown={"head": 0, "tail": 0})
    for offset in range(-(len(head_copy) + 8), 65):
        at_head, at_tail = head_end + offset, tail_start + offset
        text = (
            FILLER[:at_head]
            + head_copy
            + FILLER[at_head + len(head_copy) : at_tail]
            + tail_copy
            + FILLER[at_tail + len(tail_copy) :]
        )
        assert len(text) == TOTAL
        out = redactor(text)
        elision = _ELISION.search(out)
        assert elision is not None, "a text over the ceiling is cut"
        shown = {"head": out[: elision.start()], "tail": out[elision.end() :]}
        for side, part in shown.items():
            if any(gram in part for gram in grams[side]):
                sweep.leaked[side].append(offset)
            if "***" in part:
                sweep.masks_shown[side] += 1
        if stop_at_first_leak and any(sweep.leaked.values()):
            break
    return sweep


@pytest.mark.parametrize("name", list(SHAPES))
def test_a_credential_straddling_a_cut_is_masked_whichever_character_the_cut_falls_on(name: str) -> None:
    sweep = _sweep(redact, name)

    for side in ("head", "tail"):
        assert not sweep.leaked[side], (
            f"{name}: a canary reached the output at offsets {sweep.leaked[side]} of the {side} cut"
        )
        assert sweep.masks_shown[side] > 0, f"{name}: the {side} sweep never shows a mask, so it proves nothing"


# --- the sweeps can fail ---------------------------------------------------------------------------------------------


def _cut_then_mask(head_end: int, tail_start: int, *, snap: bool) -> Redactor:
    """The algorithm that this fix replaced: cut the raw text, then mask each part on its own.

    With ``snap`` the cuts move to a whitespace within 256 characters, as the shipped code did; without it they stay
    where they are. A credential that is one whitespace-free word is protected by the snap alone, so only the second
    form leaks every shape.
    """

    def redactor(text: str) -> str:
        head, tail = text[:head_end], text[tail_start:]
        if snap:
            for index in range(len(head) - 1, len(head) - 257, -1):
                if head[index].isspace():
                    head = head[:index]
                    break
            for index, char in enumerate(tail[:256]):
                if char.isspace():
                    tail = tail[index + 1 :]
                    break
        return f"{redact(head)} [... 0 chars elided ...] {redact(tail)}"

    return redactor


@pytest.mark.parametrize("name", list(SHAPES))
def test_the_sweep_fails_for_a_raw_cut_before_the_masking(name: str) -> None:
    head_end, tail_start = _cuts()

    sweep = _sweep(_cut_then_mask(head_end, tail_start, snap=False), name, stop_at_first_leak=True)

    assert any(sweep.leaked.values())


@pytest.mark.parametrize(
    "name",
    [
        "password-colon",
        "json-pair",
        "quoted-two-words",
        "authorization-bearer",
        "authorization-basic",
        "bare-bearer",
        "cookie",
    ],
)
def test_the_sweep_fails_for_the_shipped_cut_before_the_masking_where_a_credential_holds_whitespace(name: str) -> None:
    # What the final review reproduced: moving the cut to a whitespace does not help when the whitespace is between the
    # key and the value.
    head_end, tail_start = _cuts()

    sweep = _sweep(_cut_then_mask(head_end, tail_start, snap=True), name, stop_at_first_leak=True)

    assert any(sweep.leaked.values())


# --- what is cut is the masked text, and never more of it than is safe ------------------------------------------------


def test_a_text_that_the_masking_shrinks_to_a_fraction_shows_no_fragment_of_a_credential() -> None:
    # Every JWT in this text is masked to "***", so the masked windows are far shorter than the characters to be kept,
    # and a cut by length would reach the end of the window, where the last JWT is unfinished and so not recognized.
    token = f"eyJ{'a' * 100}.eyJ{'b' * 100}.{'c' * 40} "
    text = token * (3 * MAX_REDACTED_CHARS // len(token))

    out = redact(text)

    assert "chars elided" in out
    assert "eyJ" not in out
    assert "aaaa" not in out
    assert len(out) < MAX_REDACTED_CHARS


def test_a_text_that_the_masking_empties_still_says_that_it_was_cut() -> None:
    out = redact(f"Cookie: sid={HEAD_CANARIES[0]}\n" * 8_000)

    assert "chars elided" in out
    assert HEAD_CANARIES[0] not in out
