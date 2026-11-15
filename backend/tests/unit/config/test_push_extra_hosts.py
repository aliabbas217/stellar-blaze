"""ADR 0067 / ADR 0010: the runtime-tunable override of the push endpoint host allow-list.

``RuntimeConfig.push_extra_host_suffixes`` EXTENDS the built-in list (it can never remove a default), is validated like
every other field (at propose and at activate, so a bad entry never becomes the active config), and does not move the
hash of any config that does not use it: an empty value is not in the stored body, so a stored version keeps its hash
and the default seed's hash is the one of before the field existed.
"""

import hashlib
import tomllib
from typing import Any

import pytest
from pydantic import ValidationError

from stellar_blaze.domain.config.runtime import RuntimeConfig, body_sha256, config_body, config_sha256
from tests.unit.config.support import config, make_service
from tests.unit.rules.support import BACKEND_ROOT

pytestmark = [pytest.mark.unit]

DEFAULT_FILE = BACKEND_ROOT / "config" / "runtime" / "default.toml"
ACTOR = "ali"
REASON = "pilot uses a self-hosted push service"

VALID = [
    "ntfy.example.org",
    "push.example",
    "a.b.c.example.net",
    "xn--80ak6aa92e.example",  # punycode labels are DNS names
    "unified-push.example.com",
    "x1.example.pk",
    "co.example",  # a normal registrable domain whose first label merely looks like a registry label
]
INVALID = {
    "uppercase": "Ntfy.example.org",
    "wildcard": "*.example.org",
    "wildcard-inside": "a*.example.org",
    "leading-dot": ".example.org",
    "trailing-dot": "example.org.",
    "empty-label": "a..example.org",
    "single-label": "example",
    "tld-only": "com",
    "ipv4": "10.0.0.1",
    "ipv4-public": "93.184.216.34",
    "ipv6": "2606:4700::1111",
    "ipv6-bracketed": "[::1]",
    "scheme": "https://example.org",
    "port": "example.org:443",
    "path": "example.org/push",
    "userinfo": "user@example.org",
    "space": "example .org",
    "underscore": "a_b.example.org",
    "unicode": "bücher.example",
    "hyphen-edge": "-a.example.org",
    "numeric-tld": "example.123",
    "empty": "",
    "long-label": "a" * 64 + ".example.org",
    "too-long": ".".join(["a" * 60] * 5) + ".org",
    # Bare public suffixes (a registry suffix anyone can register under): see the refusal list in the model.
    "public-suffix-cctld-second-level": "co.uk",
    "public-suffix-com-au": "com.au",
    "public-suffix-org-pk": "org.pk",
    "public-suffix-gov-ae": "gov.ae",
    "public-suffix-github-io": "github.io",
    "public-suffix-appspot": "appspot.com",
    "public-suffix-cloudfront": "cloudfront.net",
    "public-suffix-herokuapp": "herokuapp.com",
    "public-suffix-vercel": "vercel.app",
    "public-suffix-azurewebsites": "azurewebsites.net",
    "public-suffix-workers-dev": "workers.dev",
    "public-suffix-blogspot": "blogspot.com",
}


def test_the_default_is_empty_and_the_default_file_does_not_carry_the_field() -> None:
    assert RuntimeConfig().push_extra_host_suffixes == ()
    assert "push_extra_host_suffixes" not in tomllib.loads(DEFAULT_FILE.read_text(encoding="utf-8"))


def test_an_empty_override_is_not_in_the_stored_body_so_no_existing_hash_moves() -> None:
    assert "push_extra_host_suffixes" not in config_body(RuntimeConfig())
    # The documented canonical form of a config that does not use the field (the test of the formula pins it too).
    canonical = (
        b'{"flags":{},"model_id":null,"ruleset_pin":null,"schema_version":1,"tunables":{'
        b'"alert_dispatch_interval_minutes":null,"alert_lead_hours":null,"deescalation_dwell_minutes":null,'
        b'"forecast_stale_after_hours":null,"k_exposure":null,"k_health":null,"low_zone_voluntary_rest_min":null,'
        b'"personal_band_amber":null,"personal_band_orange":null,"personal_band_red":null,"red_twl_w_m2":null,'
        b'"twl_margin_w_m2":null,"warning_theta":null}}'
    )
    assert config_sha256(RuntimeConfig()) == hashlib.sha256(canonical).hexdigest()


def test_a_set_override_is_in_the_body_and_changes_the_hash() -> None:
    used = config(push_extra_host_suffixes=["ntfy.example.org"])

    assert config_body(used)["push_extra_host_suffixes"] == ["ntfy.example.org"]
    assert config_sha256(used) != config_sha256(RuntimeConfig())
    assert config_sha256(used) == body_sha256(config_body(used))
    assert RuntimeConfig.model_validate(config_body(used)) == used  # the stored body reads back to the same config


def test_a_stored_version_without_the_field_keeps_its_hash_and_reads_as_the_default() -> None:
    stored_before = config_body(RuntimeConfig())  # what a version written before the field existed holds
    assert "push_extra_host_suffixes" not in stored_before

    assert RuntimeConfig.model_validate(stored_before).push_extra_host_suffixes == ()
    assert body_sha256(stored_before) == config_sha256(RuntimeConfig())


@pytest.mark.parametrize("entry", VALID)
def test_a_valid_entry_is_accepted(entry: str) -> None:
    assert config(push_extra_host_suffixes=[entry]).push_extra_host_suffixes == (entry,)


@pytest.mark.parametrize("entry", INVALID.values(), ids=INVALID.keys())
def test_an_invalid_entry_is_a_schema_error(entry: str) -> None:
    with pytest.raises(ValidationError) as raised:
        config(push_extra_host_suffixes=[entry])

    [error] = raised.value.errors()
    assert (
        error["loc"][0] == "push_extra_host_suffixes"
    )  # refused AS the field, not as an unknown key (extra_forbidden)
    assert error["type"] != "extra_forbidden"
    assert entry not in error["msg"] or not entry  # the message never echoes the value (pydantic adds the input itself)


def test_at_most_twenty_entries_and_no_duplicates() -> None:
    twenty = [f"h{n}.example.org" for n in range(20)]

    assert len(config(push_extra_host_suffixes=twenty).push_extra_host_suffixes) == 20
    with pytest.raises(ValidationError):
        config(push_extra_host_suffixes=[*twenty, "h20.example.org"])
    with pytest.raises(ValidationError, match="duplicate"):
        config(push_extra_host_suffixes=["a.example.org", "a.example.org"])


@pytest.mark.parametrize("bad", ["ntfy.example.org", 5, {"a": "b"}, [5], [None]], ids=repr)
def test_the_value_must_be_a_list_of_strings(bad: Any) -> None:
    with pytest.raises(ValidationError):
        config(push_extra_host_suffixes=bad)


def test_the_config_stays_immutable_with_the_field() -> None:
    c = config(push_extra_host_suffixes=["ntfy.example.org"])
    with pytest.raises(ValidationError, match="frozen"):
        c.push_extra_host_suffixes = ()  # type: ignore[misc]


@pytest.mark.asyncio
async def test_propose_and_activate_carry_the_override_into_the_active_snapshot() -> None:
    service, _, holder = make_service()
    wanted = config(push_extra_host_suffixes=["ntfy.example.org"])

    version = await service.propose(wanted, ACTOR, REASON)
    await service.activate(version.id, None, ACTOR, REASON)

    snapshot = holder.current()
    assert snapshot.config.push_extra_host_suffixes == ("ntfy.example.org",)
    assert snapshot.sha256 == config_sha256(wanted) == version.sha256


@pytest.mark.asyncio
async def test_a_stored_body_with_a_bad_entry_is_refused_at_activate_and_never_becomes_active() -> None:
    from stellar_blaze.application.runtime_config import ConfigInvalidError

    service, store, holder = make_service()
    for entry in ("co.uk", "*.example.org", "10.0.0.1"):
        bad = store.add_raw_version({**config_body(RuntimeConfig()), "push_extra_host_suffixes": [entry]})

        with pytest.raises(ConfigInvalidError) as raised:
            await service.activate(bad.id, None, ACTOR, REASON)

        assert [(v.code, v.path) for v in raised.value.violations] == [("invalid-config", "push_extra_host_suffixes.0")]
        assert entry not in str(raised.value)  # the message never echoes the value
    assert await store.latest_activation() is None
    assert holder.peek() is None


@pytest.mark.asyncio
async def test_a_stored_body_with_too_many_entries_is_refused_at_activate() -> None:
    from stellar_blaze.application.runtime_config import ConfigInvalidError

    service, store, _ = make_service()
    bad = store.add_raw_version(
        {**config_body(RuntimeConfig()), "push_extra_host_suffixes": [f"h{n}.example.org" for n in range(21)]}
    )

    with pytest.raises(ConfigInvalidError) as raised:
        await service.activate(bad.id, None, ACTOR, REASON)

    assert [v.code for v in raised.value.violations] == ["invalid-config"]
