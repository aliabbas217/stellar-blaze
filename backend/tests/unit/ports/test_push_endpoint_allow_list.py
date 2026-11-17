"""The push-endpoint HOST allow-list (ADR 0067): the pure matching rule of ``ports.push_endpoint``.

One accepted endpoint per default entry, then the boundary cases the rule exists for: a suffix entry matches only on DNS
label boundaries (never the bare suffix, never a look-alike), an exact entry never matches a subdomain, case and a
trailing dot are normalized once, punycode and non-ASCII spellings never match an ASCII entry, and the operator override
extends the list and can never remove a default. The tests carry no network and no config: the function is pure.
"""

import pytest

from stellar_blaze.ports.push_endpoint import (
    DEFAULT_EXACT_HOSTS,
    DEFAULT_SUBDOMAIN_SUFFIXES,
    EndpointHostNotAllowedError,
    check_endpoint,
    check_endpoint_host,
    check_send_endpoint,
    host_is_allowed,
)

pytestmark = [pytest.mark.unit]

# Named by code point, not typed: a formatter or an editor must never turn them into their look-alike.
KELVIN = chr(0x212A)  # KELVIN SIGN: str.lower() maps it to an ASCII "k"
FULLWIDTH_F = chr(0xFF46)  # FULLWIDTH LATIN SMALL LETTER F
IDEOGRAPHIC_STOP = chr(0x3002)  # IDEOGRAPHIC FULL STOP: not a DNS dot here

ACCEPTED = [
    "https://fcm.googleapis.com/fcm/send/dXNlci1zdWI6QVBBOTFiR",
    "https://fcm.googleapis.com/wp/ABC-def_123",
    "https://updates.push.services.mozilla.com/wpush/v1/gAAAAABk",
    "https://web.push.apple.com/QGYo0xPxhJ5mP0ZZWmAZ",
    "https://api.push.apple.com/3/device/abc",
    "https://a.b.push.apple.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAAJ",
    "https://db5p.notify.windows.com/w/x",
    "https://FCM.Googleapis.COM/fcm/send/abc",  # the host is case-insensitive
    "https://fcm.googleapis.com./fcm/send/abc",  # one trailing dot (a rooted name) is the same host
    "https://fcm.googleapis.com:443/fcm/send/abc",  # the https port, the only one the syntactic check lets in
]
REFUSED = [
    "https://push.apple.com/x",  # the bare suffix: a suffix entry needs at least one more label
    "https://notify.windows.com/x",
    "https://evilpush.apple.com/x",  # a look-alike: no label boundary
    "https://xpush.apple.com/x",
    "https://evilnotify.windows.com/x",
    "https://push.apple.com.evil.example/x",  # the suffix is not at the END
    "https://notify.windows.com.evil.example/x",
    "https://x.fcm.googleapis.com/x",  # a subdomain of an EXACT entry
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil-fcm.googleapis.com/x",
    "https://googleapis.com/x",
    "https://storage.googleapis.com/x",
    "https://updates.push.services.mozilla.com.evil.example/x",
    "https://x.updates.push.services.mozilla.com/x",
    "https://push.services.mozilla.com/x",  # the Firefox client's websocket host, not a sender target
    "https://updates-autopush.stage.mozaws.net/x",  # Mozilla stage
    "https://updates-autopush.dev.mozaws.net/x",  # Mozilla dev
    "https://jmt17.google.com/x",  # Chromium staging for non-Stable channels
    "https://android.googleapis.com/gcm/send/abc",  # the legacy GCM endpoint, shut down in 2019
    "https://fcm.googleapis.com../x",  # ONE trailing dot only
    "https://push.example/send/abc",
    "https://example.com/x",
]


@pytest.mark.parametrize("endpoint", ACCEPTED)
def test_every_default_entry_accepts_a_real_looking_endpoint(endpoint: str) -> None:
    assert check_endpoint_host(endpoint) == endpoint
    assert check_send_endpoint(endpoint) == endpoint


@pytest.mark.parametrize("endpoint", REFUSED)
def test_look_alikes_bare_suffixes_subdomains_of_exact_entries_and_staging_hosts_are_refused(endpoint: str) -> None:
    with pytest.raises(EndpointHostNotAllowedError):
        check_endpoint_host(endpoint)
    with pytest.raises(EndpointHostNotAllowedError):
        check_send_endpoint(endpoint)


def test_the_default_list_is_exactly_the_four_documented_services() -> None:
    assert sorted(DEFAULT_EXACT_HOSTS) == ["fcm.googleapis.com", "updates.push.services.mozilla.com"]
    assert sorted(DEFAULT_SUBDOMAIN_SUFFIXES) == ["notify.windows.com", "push.apple.com"]


@pytest.mark.parametrize(
    "host",
    [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "a.push.apple.com",
        "x.y.notify.windows.com",
        "FCM.GOOGLEAPIS.COM",
        "fcm.googleapis.com.",
    ],
)
def test_host_is_allowed_accepts_the_default_hosts(host: str) -> None:
    assert host_is_allowed(host)


@pytest.mark.parametrize(
    "host",
    [
        "",
        ".",
        ".push.apple.com",  # an empty label in front of the suffix
        "a..push.apple.com",
        "push.apple.com",
        "xn--push-apple.com",
        "xn--fcm-googleapis.com",
        "fcm.googleapis.com..",
        "fcm.googleapis.com\x00.evil.example",
        f"{FULLWIDTH_F}cm.googleapis.com",  # a fullwidth letter: not ASCII, never equal to an ASCII entry
        f"fcm.googleapis.com{IDEOGRAPHIC_STOP}evil.example",  # an ideographic full stop is not a DNS dot here
        "10.0.0.1",
        "localhost",
    ],
)
def test_host_is_allowed_refuses_malformed_punycode_and_non_ascii_hosts(host: str) -> None:
    assert not host_is_allowed(host)


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com@evil.example/x",  # userinfo trick: the host is evil.example
        "https://evil.example\\@fcm.googleapis.com/x",  # backslash trick: parsers disagree about the host
        "https://evil.example#@fcm.googleapis.com/x",
        "https://evil.example?@fcm.googleapis.com/x",
        "https://fcm.googleapis.com:443@evil.example/x",
        "https://user:pw@fcm.googleapis.com/x",
        "https://evil.example/@fcm.googleapis.com/x",
        "https://evil.example/https://fcm.googleapis.com/x",
        "https://evil.example/x?u=https://fcm.googleapis.com/",
    ],
)
def test_userinfo_backslash_fragment_and_embedded_url_tricks_never_reach_an_allowed_host(endpoint: str) -> None:
    with pytest.raises(EndpointHostNotAllowedError):
        check_endpoint_host(endpoint)
    with pytest.raises(ValueError, match=r"not an acceptable|allow-list"):
        check_send_endpoint(endpoint)


def test_a_kelvin_sign_cannot_smuggle_a_non_ascii_host_past_the_lowercasing_of_the_url_parser() -> None:
    # str.lower() turns U+212A (KELVIN SIGN) into an ASCII "k": the parser's hostname would then equal the extra entry
    # while the real host (what an HTTP client resolves) is a different, punycode name.
    endpoint = f"https://{KELVIN}ey.example.org/x"
    assert not host_is_allowed(f"{KELVIN}ey.example.org", ("key.example.org",))
    with pytest.raises(EndpointHostNotAllowedError):
        check_endpoint_host(endpoint, ("key.example.org",))


def test_the_refusal_never_contains_the_endpoint_or_the_host() -> None:
    endpoint = "https://LEAK-CANARY.evil.example/send/LEAK-CANARY-TOKEN?n=LEAK-CANARY"
    with pytest.raises(EndpointHostNotAllowedError) as raised:
        check_endpoint_host(endpoint)

    assert "LEAK-CANARY" not in str(raised.value) + repr(raised.value)
    assert "evil" not in str(raised.value)
    assert str(raised.value) == "endpoint host is not on the allow-list"


def test_the_not_allowed_error_is_a_value_error_so_the_channel_and_the_validators_treat_it_alike() -> None:
    assert issubclass(EndpointHostNotAllowedError, ValueError)


def test_check_send_endpoint_is_the_syntactic_check_then_the_allow_list() -> None:
    with pytest.raises(ValueError, match="https URL") as syntactic:
        check_send_endpoint("http://fcm.googleapis.com/x")
    assert not isinstance(syntactic.value, EndpointHostNotAllowedError)  # the syntactic refusal comes first
    with pytest.raises(ValueError, match="https port") as port:
        check_send_endpoint("https://fcm.googleapis.com:8443/x")
    assert not isinstance(port.value, EndpointHostNotAllowedError)
    assert (
        check_endpoint("https://push.example/x") == "https://push.example/x"
    )  # the syntactic check alone is unchanged


# --- the operator override: it EXTENDS the list ----------------------------------------------------------------


def test_an_extra_suffix_allows_the_domain_itself_and_its_subdomains_on_label_boundaries() -> None:
    extra = ("ntfy.example.org",)

    assert host_is_allowed("ntfy.example.org", extra)
    assert host_is_allowed("a.ntfy.example.org", extra)
    assert host_is_allowed("A.B.NTFY.example.org.", extra)
    assert not host_is_allowed("evilntfy.example.org", extra)
    assert not host_is_allowed("example.org", extra)
    assert not host_is_allowed("ntfy.example.org.evil.example", extra)
    assert not host_is_allowed("ntfy.example.org.", ())  # without the override it is refused


def test_an_extra_suffix_never_removes_a_default_and_the_defaults_keep_their_own_rules() -> None:
    extra = ("push.example",)

    for endpoint in ACCEPTED:
        assert check_endpoint_host(endpoint, extra) == endpoint
    with pytest.raises(EndpointHostNotAllowedError):
        check_endpoint_host("https://push.apple.com/x", extra)  # an extra entry does not loosen a default rule
    with pytest.raises(EndpointHostNotAllowedError):
        check_endpoint_host("https://x.fcm.googleapis.com/x", extra)


def test_an_added_host_is_accepted_by_the_whole_send_time_check_and_an_absent_one_is_refused() -> None:
    endpoint = "https://push.example/send/abc"

    assert check_send_endpoint(endpoint, ("push.example",)) == endpoint
    with pytest.raises(EndpointHostNotAllowedError):
        check_send_endpoint(endpoint, ())
    with pytest.raises(EndpointHostNotAllowedError):
        check_send_endpoint(endpoint, ("other.example",))
    with pytest.raises(ValueError, match="https URL"):  # the override never loosens the syntactic checks
        check_send_endpoint("http://push.example/send/abc", ("push.example",))
    with pytest.raises(ValueError, match="DNS name"):
        check_send_endpoint("https://127.0.0.1/x", ("127.0.0.1",))
