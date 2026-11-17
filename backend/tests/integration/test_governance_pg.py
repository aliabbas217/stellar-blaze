"""Governance end to end on a real Postgres through the real services (``build_api_services``): a data request is
refused and audited, the transparency log shows it for the active epoch only, a demo reset starts a new epoch, and
``sb-jobs audit verify`` keeps passing (ADR 0004, 0054, 0066; Review Focus 5)."""

import logging
from pathlib import Path

import pytest

from stellar_blaze.config import Settings
from tests.integration.b3_app import (
    ACTOR_ARGS,
    DEMO_FIXTURE,
    SITE,
    app_settings,
    bearer,
    cli_environment,
    last_json,
    make_workdir,
    rows,
    running_app,
    sb_jobs,
)
from tests.privacy import contains_standalone

pytestmark = pytest.mark.integration

WORKER_REF = "staff-no-4471-AliKhan"
REQUEST = {"subject": "worker", "data_class": "health", "worker_ref": WORKER_REF}
DATA_REQUESTS = f"/api/v1/sites/{SITE}/data-requests"
LOG = f"/api/v1/sites/{SITE}/transparency-log"


@pytest.fixture(autouse=True)
def environment(monkeypatch: pytest.MonkeyPatch, settings: Settings, tmp_path: Path) -> None:
    cli_environment(monkeypatch, settings, make_workdir(tmp_path))


def test_refusal_is_logged_listed_for_the_active_epoch_only_and_the_chain_verifies_across_a_reset(
    settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    assert sb_jobs("site", "load", str(DEMO_FIXTURE), *ACTOR_ARGS).exit_code == 0

    with caplog.at_level(logging.DEBUG), running_app(app_settings(settings)) as client:
        assert client.get(LOG).json()["entries"] == []

        refused = client.post(DATA_REQUESTS, json=REQUEST, headers=bearer())
        assert refused.status_code == 403
        assert refused.json()["type"] == "urn:stellar-blaze:problem:individual-data-refused"

        listed = client.get(LOG).json()["entries"]  # public: no token
        assert [(e["kind"], e["outcome"], e["actor_role"]) for e in listed] == [
            ("data_request.refused", "refused", "employer")
        ]

        first = sb_jobs("audit", "verify")
        assert first.exit_code == 0, first.output
        report = last_json(first)
        assert report["chain"] == "intact"
        assert report["rows"] == report["head_id"] == len(rows(settings, "SELECT id FROM audit_event"))
        assert len(report["head"]) == 64  # the anchor to record outside the database

        reset = client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
        assert reset.status_code == 200
        assert reset.json()["epoch_id"] > reset.json()["previous_epoch_id"]
        assert client.get(LOG).json()["entries"] == []  # a new epoch starts with an empty log

        client.post(DATA_REQUESTS, json=REQUEST, headers=bearer())
        assert len(client.get(LOG).json()["entries"]) == 1  # ... and lists only its own refusals

    audit = rows(
        settings, "SELECT id, kind, epoch_id, site_id FROM audit_event WHERE kind <> 'input.changed' ORDER BY id"
    )
    kinds = [r["kind"] for r in audit]
    assert kinds == ["data_request.refused", "demo_reset", "data_request.refused"]
    refused_first, demo_reset, refused_second = audit
    assert demo_reset["epoch_id"] is None  # the reset belongs to no epoch (contract tests); it is never worker-visible
    assert refused_first["epoch_id"] != refused_second["epoch_id"]
    assert WORKER_REF not in str(rows(settings, "SELECT * FROM audit_event"))
    # not a bare `in`: the log holds random hex (hashes, request ids) and four digits occur inside one by chance;
    # this very line failed a CI run on "...d4471908531..." (tests/privacy.py)
    assert not contains_standalone(caplog.text, "4471")
    assert "AliKhan" not in caplog.text
    assert WORKER_REF not in caplog.text

    second = sb_jobs("audit", "verify")
    assert second.exit_code == 0, second.output
    after = last_json(second)
    assert after["rows"] == report["rows"] + 2  # since the first verify: the demo_reset row and the second refusal
    assert after["head"] != report["head"]
