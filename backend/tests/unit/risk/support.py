"""Builders shared by the risk and plans unit tests: the released ruleset and its default effective parameters."""

import tomllib
from functools import cache

from stellar_blaze.domain.config.runtime import EffectiveParams, RuntimeConfig, resolve_effective
from stellar_blaze.domain.rules.ruleset import Ruleset
from tests.unit.rules.support import RULESETS_DIR


@cache
def released_ruleset() -> Ruleset:
    """``ae-heat-2026.1`` read from the committed file."""
    raw = tomllib.loads((RULESETS_DIR / "ae-heat-2026.1.toml").read_text(encoding="utf-8"))
    return Ruleset.model_validate(raw)


def default_params() -> EffectiveParams:
    """The tunables of ``released_ruleset()`` with nothing overridden."""
    resolved = resolve_effective(RuntimeConfig(), released_ruleset())
    assert isinstance(resolved, EffectiveParams), resolved
    return resolved
