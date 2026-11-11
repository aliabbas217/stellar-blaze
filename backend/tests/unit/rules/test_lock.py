"""The ruleset loader and ``lock.json``: a released ruleset is immutable, a draft never reaches production."""

import hashlib
import json
import shutil
from datetime import date
from pathlib import Path

import pytest

from stellar_blaze.adapters.config.rulesets import RulesetLoadError, RulesetLockError, load_catalog
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from tests.unit.rules.support import RULESETS_DIR, SEED_PATH

pytestmark = pytest.mark.unit

SEED_ID = "ae-heat-0.1"


def copy_rulesets(tmp_path: Path) -> Path:
    directory = tmp_path / "rulesets"
    shutil.copytree(RULESETS_DIR, directory)
    return directory


def write_lock(directory: Path, lock: object) -> None:
    (directory / "lock.json").write_text(json.dumps(lock), encoding="utf-8")


def test_the_committed_rulesets_load_without_drafts() -> None:
    catalog = load_catalog(RULESETS_DIR, allow_drafts=False)
    assert isinstance(catalog, RulesetCatalog)
    assert catalog.ids() == (SEED_ID,)
    assert catalog.for_local_date(date(2026, 11, 11)).ruleset.meta.id == SEED_ID


def test_the_lock_holds_the_sha256_of_the_stored_bytes() -> None:
    raw = SEED_PATH.read_bytes()
    assert b"\r" not in raw, "rulesets are LF files (.gitattributes eol=lf); a CR would change the hash on Windows"
    lock = json.loads((RULESETS_DIR / "lock.json").read_text(encoding="utf-8"))
    assert lock == {SEED_ID: hashlib.sha256(raw).hexdigest()}
    assert load_catalog(RULESETS_DIR, allow_drafts=False).get(SEED_ID).sha256 == lock[SEED_ID]


def test_one_edited_byte_in_a_released_ruleset_fails_the_lock(tmp_path: Path) -> None:
    directory = copy_rulesets(tmp_path)
    path = directory / f"{SEED_ID}.toml"
    edited = path.read_bytes().replace(b"low_min_w_m2 = 140.0", b"low_min_w_m2 = 141.0")
    assert edited != path.read_bytes()
    path.write_bytes(edited)
    with pytest.raises(RulesetLockError, match=SEED_ID):
        load_catalog(directory, allow_drafts=True)  # drafts allowed: the lock still binds released files


def test_a_released_ruleset_missing_from_the_lock_fails(tmp_path: Path) -> None:
    directory = copy_rulesets(tmp_path)
    write_lock(directory, {})
    with pytest.raises(RulesetLockError, match=f"{SEED_ID}.*not in"):
        load_catalog(directory, allow_drafts=True)


def test_a_lock_entry_without_its_file_fails(tmp_path: Path) -> None:
    # A released ruleset can be pinned by old decisions, so deleting the file must be loud.
    directory = copy_rulesets(tmp_path)
    lock = json.loads((directory / "lock.json").read_text(encoding="utf-8"))
    lock["ae-heat-2020.1"] = "0" * 64
    write_lock(directory, lock)
    with pytest.raises(RulesetLockError, match=r"ae-heat-2020\.1"):
        load_catalog(directory, allow_drafts=True)


def draft_directory(tmp_path: Path) -> Path:
    directory = copy_rulesets(tmp_path)
    path = directory / f"{SEED_ID}.toml"
    draft = path.read_bytes().replace(b'status = "released"', b'status = "draft"')
    assert draft != path.read_bytes()
    path.write_bytes(draft)
    write_lock(directory, {})  # a draft is not locked
    return directory


def test_a_draft_is_refused_unless_drafts_are_allowed(tmp_path: Path) -> None:
    directory = draft_directory(tmp_path)
    with pytest.raises(RulesetLockError, match=f"draft.*{SEED_ID}"):
        load_catalog(directory, allow_drafts=False)
    catalog = load_catalog(directory, allow_drafts=True)
    assert catalog.get(SEED_ID).ruleset.meta.status == "draft"


def test_a_lock_entry_for_a_draft_fails(tmp_path: Path) -> None:
    # The lock lists released rulesets only; an entry for a file that is a draft is an inconsistent repository.
    directory = draft_directory(tmp_path)
    write_lock(directory, {SEED_ID: "0" * 64})
    with pytest.raises(RulesetLockError, match=f"{SEED_ID}.*not a released"):
        load_catalog(directory, allow_drafts=True)


def test_the_file_name_must_be_the_ruleset_id(tmp_path: Path) -> None:
    directory = copy_rulesets(tmp_path)
    (directory / f"{SEED_ID}.toml").rename(directory / "ae-heat-9999.9.toml")
    with pytest.raises(RulesetLoadError, match=r"ae-heat-9999\.9\.toml.*ae-heat-0\.1"):
        load_catalog(directory, allow_drafts=True)


def test_an_invalid_ruleset_names_its_file(tmp_path: Path) -> None:
    directory = copy_rulesets(tmp_path)
    path = directory / f"{SEED_ID}.toml"
    path.write_bytes(path.read_bytes().replace(b"[twl_zones]", b"[twl_zones]\nsurprise = 1"))
    with pytest.raises(RulesetLoadError, match=rf"(?s){SEED_ID}\.toml.*surprise"):
        load_catalog(directory, allow_drafts=True)


def test_broken_toml_names_its_file(tmp_path: Path) -> None:
    directory = copy_rulesets(tmp_path)
    (directory / f"{SEED_ID}.toml").write_bytes(b"[meta\n")
    with pytest.raises(RulesetLoadError, match=f"{SEED_ID}.toml"):
        load_catalog(directory, allow_drafts=True)


@pytest.mark.parametrize("content", ["", "not json", "[]", '{"ae-heat-0.1": 5}', '{"ae-heat-0.1": "abc"}'])
def test_a_malformed_lock_fails_loudly(tmp_path: Path, content: str) -> None:
    directory = copy_rulesets(tmp_path)
    (directory / "lock.json").write_text(content, encoding="utf-8")
    with pytest.raises(RulesetLockError, match=r"lock\.json"):
        load_catalog(directory, allow_drafts=True)


def test_a_missing_lock_fails_loudly(tmp_path: Path) -> None:
    directory = copy_rulesets(tmp_path)
    (directory / "lock.json").unlink()
    with pytest.raises(RulesetLockError, match=r"lock\.json"):
        load_catalog(directory, allow_drafts=True)


def test_a_missing_directory_fails_loudly(tmp_path: Path) -> None:
    with pytest.raises(RulesetLoadError, match="SB_RULESETS_DIR"):
        load_catalog(tmp_path / "nowhere", allow_drafts=True)


def test_an_edited_ruleset_changes_the_hash_the_catalog_reports(tmp_path: Path) -> None:
    # The sha256 a decision row stores is the one of the bytes read, not a recomputation from the parsed values.
    directory = copy_rulesets(tmp_path)
    path = directory / f"{SEED_ID}.toml"
    path.write_bytes(path.read_bytes() + b"\n# a trailing comment changes the bytes and nothing else\n")
    write_lock(directory, {SEED_ID: hashlib.sha256(path.read_bytes()).hexdigest()})
    original = load_catalog(RULESETS_DIR, allow_drafts=False).get(SEED_ID)
    edited = load_catalog(directory, allow_drafts=False).get(SEED_ID)
    assert edited.ruleset == original.ruleset
    assert edited.sha256 != original.sha256
