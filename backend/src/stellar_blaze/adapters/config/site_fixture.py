"""Read a site fixture (``fixtures/demo_site.toml``, ADR 0057) from a TOML file.

Members are written as groups (``count`` identical members per ``[[crews.members]]`` table, default 1) and expanded
here, so a crew of 20 is one table, not twenty. The result is a validated ``SiteFixture``.
"""

import tomllib
from pathlib import Path
from typing import Any

from stellar_blaze.ports.sites import SiteFixture


def _expand_members(crew: dict[str, Any]) -> dict[str, Any]:
    members: list[dict[str, Any]] = []
    for group in crew.get("members", []):
        group = dict(group)
        count = group.pop("count", 1)
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise ValueError(f"crew {crew.get('id')!r}: member count must be a positive integer, got {count!r}")
        members.extend(dict(group) for _ in range(count))
    return {**crew, "members": members}


def load_site_fixture(path: Path) -> SiteFixture:
    """Parse and validate the TOML file at ``path``.

    Raises:
        FileNotFoundError: ``path`` does not exist.
        tomllib.TOMLDecodeError: The file is not TOML.
        pydantic.ValidationError: The content is not a ``SiteFixture`` (unknown keys are rejected).
        ValueError: A member group has a count that is not a positive integer.
    """
    with path.open("rb") as file:
        raw = tomllib.load(file)
    raw["crews"] = [_expand_members(crew) for crew in raw.get("crews", [])]
    return SiteFixture.model_validate(raw)
