"""Load the rulesets that ship in the image and check them against ``lock.json`` (ADR 0009 section 1)."""

import hashlib
import json
import re
import tomllib
from pathlib import Path

from pydantic import ValidationError

from stellar_blaze.domain.rules.catalog import LoadedRuleset, RulesetCatalog
from stellar_blaze.domain.rules.ruleset import Ruleset

_SHA256 = re.compile(r"[0-9a-f]{64}")


class RulesetLoadError(Exception):
    """A ruleset file cannot be loaded: unreadable, not TOML, not valid, or named differently from its id."""


class RulesetLockError(RulesetLoadError):
    """A ruleset breaks the immutability rules: a changed or unlisted released file, or a draft where none may run."""


def _read_lock(path: Path) -> dict[str, str]:
    """``lock.json``: ``{ruleset id: SHA-256 of the file bytes}`` for every released ruleset."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise RulesetLockError(f"{path} not found: it lists the SHA-256 of every released ruleset") from None
    try:
        lock = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RulesetLockError(f"{path.name} is not valid JSON: {exc}") from exc
    if not isinstance(lock, dict) or not all(
        isinstance(k, str) and isinstance(v, str) and _SHA256.fullmatch(v) for k, v in lock.items()
    ):
        raise RulesetLockError(f"{path.name} must be an object mapping a ruleset id to a lowercase SHA-256 hex string")
    return lock


def load_catalog(directory: Path, *, allow_drafts: bool) -> RulesetCatalog:
    """Read every ``*.toml`` in ``directory`` into a ``RulesetCatalog``.

    Each file is read once, as bytes: the SHA-256 is of those bytes and the parse is of the same bytes. A released
    ruleset must be listed in ``lock.json`` with exactly that hash; a draft is refused unless ``allow_drafts``. A lock
    entry for a ruleset that is not a released file on disk fails too, because decisions may be pinned to it.

    Raises:
        RulesetLoadError: The directory is missing, a file is not valid TOML or does not validate, or its name is not
            ``<id>.toml``.
        RulesetLockError: ``lock.json`` is missing or malformed, a released ruleset is unlisted or changed, a lock entry
            has no released file, or a draft is present and ``allow_drafts`` is false.
        RulesetCatalogError: The rulesets contradict each other (duplicates, overlap, unknown ``supersedes``).
    """
    if not directory.is_dir():
        raise RulesetLoadError(f"rulesets directory not found: {directory} (SB_RULESETS_DIR)")
    lock = _read_lock(directory / "lock.json")

    loaded: list[LoadedRuleset] = []
    released: set[str] = set()
    for path in sorted(directory.glob("*.toml")):
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        try:
            ruleset = Ruleset.model_validate(tomllib.loads(raw.decode("utf-8")))
        except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
            raise RulesetLoadError(f"{path.name} is not valid TOML: {exc}") from exc
        except ValidationError as exc:
            raise RulesetLoadError(f"{path.name} is not a valid ruleset:\n{exc}") from exc
        ruleset_id = ruleset.meta.id
        if path.name != f"{ruleset_id}.toml":
            raise RulesetLoadError(f"{path.name} declares id {ruleset_id!r}: a ruleset file is named <id>.toml")

        if ruleset.meta.status == "draft":
            if not allow_drafts:
                raise RulesetLockError(f"draft ruleset {ruleset_id} ({path.name}) is not allowed here (SB_ENV=prod)")
        else:
            released.add(ruleset_id)
            if ruleset_id not in lock:
                raise RulesetLockError(f"released ruleset {ruleset_id} is not in lock.json")
            if lock[ruleset_id] != digest:
                raise RulesetLockError(
                    f"released ruleset {ruleset_id} was edited: lock.json has {lock[ruleset_id]}, the file hashes to "
                    f"{digest}. Released rulesets are immutable; add a new file that supersedes it"
                )
        loaded.append(LoadedRuleset(ruleset=ruleset, sha256=digest))

    stale = sorted(set(lock) - released)
    if stale:
        raise RulesetLockError(f"lock.json lists {stale}, which is not a released ruleset on disk in {directory}")
    return RulesetCatalog(loaded)
