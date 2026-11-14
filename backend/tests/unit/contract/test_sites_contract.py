"""The in-memory site store satisfies the contract suite that Postgres also runs; the fixture parses to ADR 0057."""

import hashlib
from pathlib import Path

import pytest

from stellar_blaze.adapters.config.site_fixture import load_site_fixture
from stellar_blaze.ports.sites import CrewFixture, MemberFixture
from tests.unit.contract.b3_world import FIXTURE_PATH, SITE_ID, fake_world
from tests.unit.contract.sites_contract import CHECKS

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CHECKS))
async def test_the_in_memory_store_satisfies_the_contract(name: str) -> None:
    await CHECKS[name](fake_world())


def test_the_demo_fixture_is_adr_0057_section_2() -> None:
    fixture = load_site_fixture(FIXTURE_PATH)

    assert fixture.site.id == SITE_ID
    assert fixture.site.synthetic
    assert fixture.commute_minutes == 45
    assert [(c.id, c.workload, len(c.members)) for c in fixture.crews] == [
        ("crew-a", "heavy", 12),
        ("crew-b", "heavy", 20),
        ("crew-c", "moderate", 9),
        ("crew-d", "light", 4),
    ]
    assert not any(m.juvenile for c in fixture.crews for m in c.members)
    assert sum(1 for m in fixture.crews[0].members if not m.experienced) == 2
    assert all(m.experienced for m in fixture.crews[1].members)
    assert [m.days_away for m in fixture.crews[2].members].count(10) == 1
    assert len(fixture.crews[3].members) < 5  # below k_exposure: the suppressed crew


def test_the_demo_fixture_is_plain_ascii_with_lf_line_ends() -> None:
    raw = FIXTURE_PATH.read_bytes()

    raw.decode("ascii")  # the file that is hashed has no editor-dependent bytes
    assert b"\r" not in raw  # LF only, so the SHA-256 is the same on every platform (git autocrlf)
    assert len(hashlib.sha256(raw).hexdigest()) == 64


def test_a_member_group_needs_a_positive_integer_count(tmp_path: Path) -> None:
    bad = tmp_path / "f.toml"
    bad.write_text(FIXTURE_PATH.read_text(encoding="ascii").replace("count = 4,", "count = 0,"), encoding="ascii")

    with pytest.raises(ValueError, match="positive integer"):
        load_site_fixture(bad)


def test_an_unknown_fixture_key_is_refused(tmp_path: Path) -> None:
    bad = tmp_path / "f.toml"
    bad.write_text(FIXTURE_PATH.read_text(encoding="ascii") + "\n[surprise]\nx = 1\n", encoding="ascii")

    with pytest.raises(ValueError, match="surprise"):
        load_site_fixture(bad)


def _crew_with(**changes: object) -> CrewFixture:
    base = load_site_fixture(FIXTURE_PATH).crews[1]
    return CrewFixture.model_validate({**base.model_dump(), **changes})


@pytest.mark.parametrize(
    ("shift", "message"),
    [
        ([{"start": "03:55", "end": "11:00"}], "must be sorted and must not overlap|ends after|before"),
        ([{"start": "06:00", "end": "22:05"}], "ends after 22:00"),
        ([{"start": "11:00", "end": "11:00"}], "must start before it ends"),
        ([{"start": "12:00", "end": "11:00"}], "must start before it ends"),
        ([{"start": "06:00", "end": "12:00"}, {"start": "11:00", "end": "15:00"}], "must not overlap"),
        ([{"start": "15:00", "end": "18:00"}, {"start": "06:00", "end": "11:00"}], "sorted"),
        ([], "no shift block"),
    ],
)
def test_a_shift_the_planner_would_truncate_or_refuse_is_rejected(shift: list[dict[str, str]], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        _crew_with(shift=shift)


def test_a_member_list_that_differs_from_the_declared_headcount_is_rejected() -> None:
    members = load_site_fixture(FIXTURE_PATH).crews[1].model_dump()["members"]

    with pytest.raises(ValueError, match="headcount is 20 but 19 members"):
        _crew_with(members=members[:-1])


@pytest.mark.parametrize(
    "member",
    [
        {"days_on_site": 5, "days_away": 3, "away_reason": "none"},
        {"days_on_site": 5, "days_away": 0, "away_reason": "leave"},
        {"days_on_site": 5, "days_away": -1, "away_reason": "illness"},
        {"days_on_site": -1, "days_away": 0, "away_reason": "none"},
    ],
)
def test_an_inconsistent_member_record_is_rejected(member: dict[str, object]) -> None:
    with pytest.raises(ValueError, match=r"away_reason|days_away|days_on_site"):
        MemberFixture.model_validate({"experienced": True, "juvenile": False, **member})


def test_the_edge_shifts_are_accepted() -> None:
    crew = _crew_with(shift=[{"start": "04:00", "end": "12:00"}, {"start": "12:00", "end": "22:00"}])

    assert len(crew.shift) == 2
