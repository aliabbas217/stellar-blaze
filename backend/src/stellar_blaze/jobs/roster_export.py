"""The roster-frontier static export (``sb-jobs export roster-frontier``): ``{data, provenance}``.

The result of the roster script as the frontend imports it.

``data`` is the source file's own bytes (line ends normalized to LF, so the output does not depend on the checkout), so
no number is rounded, reordered or recomputed. The provenance names the script (the file's own ``generated_by``), the
source path and its SHA-256, and the run date. The source records no run date today, so the date is the caller's
``run_date`` or null: it is never taken from a clock or a file time (that would make the export differ on every run).

``data`` is verbatim research output: it contains keys such as ``B0_common_practice_non_compliant`` that describe the
legality of the pre-existing practice roster; do not render keys as product copy. (There is no typed shape for this
file: the frontend imports it as static JSON, so this sentence and the command's help are where the warning lives.)

One guard is asserted before anything is written: "nothing recommended at 45 min commute, floor 21:30" (the frontier
chart must not suggest a roster change where the 2024-2026 data support none): the file's bedtime floor is 21:30 and
in the 45-minute row every fold keeps the legal default and the avoided shares are all zero.

Standard library only (the API image runs ``sb-jobs --help`` without the training packages).
"""

import hashlib
import json
from datetime import date
from typing import Final

__all__ = ["GUARD", "GUARD_COMMUTE_MIN", "GUARD_FLOOR", "RosterExportError", "check_guard", "render_roster_frontier"]

GUARD_COMMUTE_MIN: Final = 45
GUARD_FLOOR: Final = "21:30"
GUARD: Final = f"nothing recommended at {GUARD_COMMUTE_MIN} min commute, floor {GUARD_FLOOR}"


class RosterExportError(ValueError):
    """The source is not the roster frontier the export expects, or its guard fails."""


def check_guard(document: object) -> None:
    """Assert the guard on the parsed source.

    Raises:
        RosterExportError: The shape is unexpected, the floor is not 21:30, or the 45-minute row recommends a change.
    """
    if not isinstance(document, dict):
        raise RosterExportError("the source is not a JSON object")
    assumptions = document.get("assumptions")
    floor = assumptions.get("bedtime_floor") if isinstance(assumptions, dict) else None
    if floor != GUARD_FLOOR:
        raise RosterExportError(f"the guard needs the bedtime floor {GUARD_FLOOR}, the source says {floor!r}")
    rows = document.get("frontier_absolute_gate")
    if not isinstance(rows, list):
        raise RosterExportError("the source has no 'frontier_absolute_gate' list")
    matching = [r for r in rows if isinstance(r, dict) and r.get("commute_min") == GUARD_COMMUTE_MIN]
    if len(matching) != 1:
        raise RosterExportError(
            f"expected one {GUARD_COMMUTE_MIN}-minute row in 'frontier_absolute_gate', found {len(matching)}"
        )
    (row,) = matching
    avoided = {key: value for key, value in row.items() if key.startswith("avoided_vs_legal_default")}
    if not avoided or row.get("folds_no_change") != row.get("folds") or any(value != 0 for value in avoided.values()):
        raise RosterExportError(f"the guard fails: {GUARD} is violated by the row {row!r}")


def render_roster_frontier(data: bytes, *, source: str, run_date: str | None = None) -> bytes:
    """The export bytes: ``{"data": <the source>, "provenance": {...}}`` plus a newline.

    Raises:
        RosterExportError: The source is not JSON, its guard fails, or ``run_date`` is not YYYY-MM-DD.
    """
    payload = data.replace(b"\r\n", b"\n").strip()
    try:
        document = json.loads(payload)
    except ValueError as exc:
        raise RosterExportError(f"the source is not JSON: {exc}") from None
    check_guard(document)
    if run_date is not None:
        try:
            date.fromisoformat(run_date)
        except ValueError:
            raise RosterExportError(f"run_date must be YYYY-MM-DD, got {run_date!r}") from None
    provenance = {
        "script": document.get("generated_by"),
        "source": source,
        "source_sha256": hashlib.sha256(payload + b"\n").hexdigest(),
        "run_date": run_date,
        "run_date_note": (
            "the source file records no run date" if run_date is None else "given by the exporter's caller"
        ),
        "label": document.get("label"),
        "guard": f"{GUARD}: asserted",
    }
    return (
        b'{"data":'
        + payload
        + b',"provenance":'
        + json.dumps(provenance, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        + b"}\n"
    )
