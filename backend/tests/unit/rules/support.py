"""Builders for rulesets in tests: start from the committed seed and change what the test is about."""

import hashlib
import json
import tomllib
from datetime import date
from pathlib import Path
from typing import Any

from stellar_blaze.domain.rules.catalog import LoadedRuleset
from stellar_blaze.domain.rules.ruleset import Ruleset

BACKEND_ROOT = Path(__file__).resolve().parents[3]
RULESETS_DIR = BACKEND_ROOT / "rulesets"
SEED_PATH = RULESETS_DIR / "ae-heat-0.1.toml"


def seed_dict() -> dict[str, Any]:
    """A fresh copy of the committed seed ruleset as the dictionary ``tomllib`` produces."""
    return tomllib.loads(SEED_PATH.read_text(encoding="utf-8"))


def b3_tunables() -> dict[str, Any]:
    """The tunables ``ae-heat-2026.1`` adds to the seed's, under the seed's source ``adr-0006``.

    ``Tunables`` has one field per tunable and ``resolve_effective`` needs a default for each, so a test ruleset built
    from the seed (which predates B3) declares them too; the config tests are about validation, not about these values.
    """
    released = tomllib.loads((RULESETS_DIR / "ae-heat-2026.1.toml").read_text(encoding="utf-8"))["tunables"]
    return {
        name: {**spec, "source": "adr-0006"} for name, spec in released.items() if name not in seed_dict()["tunables"]
    }


def ruleset_dict(
    ruleset_id: str = "ae-heat-0.1",
    *,
    effective_from: date = date(2024, 1, 1),
    effective_to: date | None = None,
    supersedes: tuple[str, ...] = (),
    status: str = "released",
) -> dict[str, Any]:
    """The seed's values under a different identity and effective range, with the B3 tunables declared as well."""
    raw = seed_dict()
    raw["tunables"].update(b3_tunables())
    meta: dict[str, Any] = {
        "id": ruleset_id,
        "effective_from": effective_from,
        "status": status,
        "jurisdiction": "ae",
    }
    if effective_to is not None:
        meta["effective_to"] = effective_to
    if supersedes:
        meta["supersedes"] = list(supersedes)
    raw["meta"] = meta
    return raw


def make_ruleset(ruleset_id: str = "ae-heat-0.1", **kwargs: Any) -> Ruleset:
    return Ruleset.model_validate(ruleset_dict(ruleset_id, **kwargs))


def loaded(ruleset: Ruleset) -> LoadedRuleset:
    """A loaded ruleset with a stable, content-derived hash (the tests never read it from a file)."""
    digest = hashlib.sha256(json.dumps(ruleset.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    return LoadedRuleset(ruleset=ruleset, sha256=digest)


def set_path(raw: dict[str, Any], path: tuple[str | int, ...], value: Any) -> None:
    """Set ``raw[path[0]][path[1]]... = value``."""
    node: Any = raw
    for step in path[:-1]:
        node = node[step]
    node[path[-1]] = value
