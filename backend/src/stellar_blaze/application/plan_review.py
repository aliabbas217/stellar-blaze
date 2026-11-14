"""What a supervisor reviews and signs: acknowledgement items, the plan hash and the sign-off state (ADR 0011 7.1).

* **Ack items**: runs of consecutive plan segments whose state is ``work`` or ``adosh_rest`` at one zone above Low
  (adjacent: ``ends_at == next starts_at``). Id ``<zone>-<HHMM>`` with the SITE-LOCAL start of the run (``high-0600``).
  ``text_code`` is the ruleset's action code of the run: ``cycle.<zone>.<column>.<work>-<rest>`` when Table 1 prescribes
  a cycle for the crew's workload in that zone (moderate work reads the heavy column when the ruleset says so), else the
  first non-cycle action code of the zone's level (Medium light work: ``no-lone-work``; Red: ``stop-work``).
* **Plan hash**: SHA-256 of the canonical JSON ``{"crew_id", "local_date", "segments": [[starts_at, ends_at, state,
  zone, rule_id], ...]}`` (sorted keys, compact separators, instants as UTC ``Z`` seconds, zone ``null`` for off and
  ban). It reads nothing but the plan: no clock, no forecast status, no clause text.
* **Sign-off state**: ``unsigned`` with no sign-off row; ``signed`` when the latest row's hash equals the current
  plan's; ``changed_since_signed`` when a row exists and the hash differs.
"""

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final, Literal
from zoneinfo import ZoneInfo

from stellar_blaze.application.day_plan import PlanSegmentData
from stellar_blaze.domain.plans.model import TickState, Workload
from stellar_blaze.domain.plans.rules import PlannerRules
from stellar_blaze.domain.risk.levels import Zone, level_for_zone
from stellar_blaze.domain.rules.ruleset import AlertCatalog
from stellar_blaze.ports.plans import PlanSignoffRecord

__all__ = ["AckItemData", "SignoffState", "ack_items", "plan_hash", "signoff_state"]

type SignoffState = Literal["unsigned", "signed", "changed_since_signed"]

_ACK_STATES: Final = frozenset({TickState.WORK, TickState.ADOSH_REST})


@dataclass(frozen=True)
class AckItemData:
    id: str
    zone: Zone
    starts_at: datetime
    ends_at: datetime
    text_code: str


def _text_code(zone: Zone, workload: Workload, rules: PlannerRules, alerts: AlertCatalog) -> str:
    level = level_for_zone(zone).value
    codes = alerts.action_codes_by_level[level]
    cycle = rules.cycle(zone, workload)
    if cycle is not None:
        heavy = workload == "heavy" or (workload == "moderate" and rules.cycles.moderate_uses_heavy)
        code = f"cycle.{zone.name.lower()}.{'heavy' if heavy else 'light'}.{cycle[0]}-{cycle[1]}"
        if code in codes:
            return code
    return next((c for c in codes if not c.startswith("cycle.")), codes[0])


def ack_items(
    segments: Sequence[PlanSegmentData], *, workload: Workload, rules: PlannerRules, alerts: AlertCatalog, tz: ZoneInfo
) -> tuple[AckItemData, ...]:
    """The acknowledgement items of a plan, in time order; empty for a plan with no work above Low."""
    runs: list[list[PlanSegmentData]] = []
    for segment in segments:
        if segment.state not in _ACK_STATES or segment.zone is None or segment.zone is Zone.LOW:
            continue
        last = runs[-1] if runs else None
        if last is not None and last[-1].ends_at == segment.starts_at and last[-1].zone == segment.zone:
            last.append(segment)
        else:
            runs.append([segment])
    items: list[AckItemData] = []
    for run in runs:
        zone = run[0].zone
        if zone is None:  # unreachable: runs only hold segments with a zone; narrows the type
            continue
        start = run[0].starts_at
        items.append(
            AckItemData(
                id=f"{zone.name.lower()}-{start.astimezone(tz):%H%M}",
                zone=zone,
                starts_at=start,
                ends_at=run[-1].ends_at,
                text_code=_text_code(zone, workload, rules, alerts),
            )
        )
    return tuple(items)


def _instant(at: datetime) -> str:
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def plan_hash(crew_id: str, local_date: date, segments: Sequence[PlanSegmentData]) -> str:
    """The SHA-256 hex digest that identifies a plan for sign-off (see the module docstring for the serialization)."""
    payload = {
        "crew_id": crew_id,
        "local_date": local_date.isoformat(),
        "segments": [
            [
                _instant(s.starts_at),
                _instant(s.ends_at),
                s.state.value,
                s.zone.name.lower() if s.zone is not None else None,
                s.rule_id,
            ]
            for s in segments
        ],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def signoff_state(latest: PlanSignoffRecord | None, current_hash: str | None) -> SignoffState:
    """The sign-off state; ``current_hash=None`` (the plan could not be computed) with a row reads as changed."""
    if latest is None:
        return "unsigned"
    return "signed" if latest.plan_hash == current_hash else "changed_since_signed"
