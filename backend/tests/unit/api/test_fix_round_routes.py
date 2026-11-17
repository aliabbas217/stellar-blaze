"""Fix round, API minors: the data-request refusal without a config, stop idempotence, limiter gaps, token parsing."""

import json
from datetime import UTC, datetime, timedelta

import pytest

from stellar_blaze.api.auth import GENERAL_BUCKET, parse_access_tokens, token_key
from stellar_blaze.api.limiter import RateLimitedError, RateLimiter
from stellar_blaze.api.rate_limits import RateLimit
from stellar_blaze.config import Settings
from tests.unit.api.support import DEMO_TOKEN, SITE, bearer, client_for, make_world

pytestmark = pytest.mark.unit
REQUEST = {"subject": "worker", "data_class": "health", "worker_ref": "staff-4471"}


def test_a_data_request_is_403_and_audited_even_when_no_config_is_loaded(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        client.app.state.runtime.config._snapshot = None  # type: ignore[attr-defined]  # noqa: SLF001
        response = client.post(f"/api/v1/sites/{SITE}/data-requests", json=REQUEST, headers=bearer())

    assert response.status_code == 403
    assert response.json()["type"] == "urn:stellar-blaze:problem:individual-data-refused"
    [row] = world.audit.records
    assert (row.kind, row.outcome, row.site_id) == ("data_request.refused", "refused", SITE)


def test_a_second_stop_while_one_is_active_returns_the_same_stop_and_writes_nothing_more(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        first = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        second = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        client.delete(f"/api/v1/crews/crew-b/stops/{first.json()['id']}", headers=bearer())
        third = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())

    assert (first.status_code, second.status_code) == (201, 201)
    assert second.json() == first.json()
    assert third.json()["id"] != first.json()["id"]  # after a resume a new stop is a new stop
    started = [r for r in world.audit.records if r.kind == "crew.stop_started"]
    assert len(started) == 2  # the repeat wrote no audit row


def test_a_refused_request_costs_nothing() -> None:
    """Mutant guard: a limiter that charged the first bucket before checking the second would fail this."""
    now = datetime(2026, 7, 1, tzinfo=UTC)
    limiter = RateLimiter(lambda: now)
    one = [RateLimit(limit=1, window_seconds=60)]
    limiter.charge("t", [("b", one)])  # bucket b is now full

    with pytest.raises(RateLimitedError):
        limiter.charge("t", [("a", one), ("b", one)])  # refused by b: a must not be charged

    limiter.charge("t", [("a", one)])  # a still has its one slot


def test_a_refused_request_costs_nothing_inside_one_bucket_with_two_windows() -> None:
    now = datetime(2026, 7, 1, tzinfo=UTC)
    limiter = RateLimiter(lambda: now)
    windows = [RateLimit(limit=1, window_seconds=60), RateLimit(limit=10, window_seconds=3600)]
    limiter.charge("t", [("reset", windows)])

    for _ in range(5):
        with pytest.raises(RateLimitedError):
            limiter.charge("t", [("reset", windows)])

    clock = [now + timedelta(seconds=61)]
    again = RateLimiter(lambda: clock[0])
    again._admitted = limiter._admitted  # noqa: SLF001  (the same state, a later clock)
    again.charge("t", [("reset", windows)])  # the hour window holds 2 stamps, not 6: five refusals charged nothing
    assert len(limiter._admitted[("reset", "t", 3600)]) == 2  # noqa: SLF001


def test_the_reset_operation_charges_the_general_bucket_too(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        assert client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer()).status_code == 200
        limiter = client.app.state.limiter  # type: ignore[attr-defined]
        admitted = limiter._admitted  # noqa: SLF001

    key = token_key(DEMO_TOKEN)
    assert len(admitted[(GENERAL_BUCKET, key, 60)]) == 1
    assert len(admitted[("reset", key, 60)]) == 1


def test_a_malformed_access_tokens_traceback_does_not_echo_the_input() -> None:
    secret = "SECRET-INPUT-VALUE"  # noqa: S105  (a made-up value the test hunts for)
    with pytest.raises(ValueError, match="SB_ACCESS_TOKENS must be JSON") as raised:
        parse_access_tokens(json.dumps({"a" * 64: {"actor": secret, "role": ["not-a-string"], "employer_id": 3}}))

    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True
    assert secret not in str(raised.value)
