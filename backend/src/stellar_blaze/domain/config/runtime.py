"""The runtime configuration: operating values that may change without a release (ADR 0010).

``RuntimeConfig`` holds the ruleset pin, the active model id, the tunables and the flags that are safe to flip live.
Legal floors are absent from it by construction (``extra="forbid"``), so a payload that tries to set one fails schema
validation. Each tunable is bounded by the range its ruleset declares, and in production a ruleset pin must not be less
protective than the ruleset in force today: not on a floor, and not on the range end or the default of a tunable.
"""

import dataclasses
import hashlib
import ipaddress
import itertools
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Final, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, JsonValue, field_validator

from stellar_blaze.domain.config.models import ModelRegistry
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.domain.rules.floors import floor_violations
from stellar_blaze.domain.rules.ruleset import Ruleset

# The first six are what `validate_runtime_config` finds in a config that parsed. The last two are about a stored
# version that cannot become a config at all: its body is not a `RuntimeConfig` (an unknown key, which includes any
# attempt to set a legal floor; a wrong type; a schema version this release does not know), or its stored hash is not
# the hash of its body. `ConfigService` reports them for a row that was not written through the service.
type ViolationCode = Literal[
    "unknown-tunable",
    "out-of-range",
    "floor-violation",
    "unknown-model",
    "unknown-ruleset",
    "pin-out-of-range",
    "invalid-config",
    "hash-mismatch",
]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class Tunables(_Model):
    """Operating values; ``None`` means the ruleset default. Each is bounded by its ruleset's ``[tunables]`` range.

    ``twl_margin_w_m2`` is B1 (ADR 0047 moves its default to 7). The rest are B3: the Red edge and the warning
    probability (ADR 0046, 0048), the personal bands (ADR 0049), the suppression thresholds (ADR 0050), the alert
    timing, the dispatch cadence and the stale-forecast age (ADR 0058), and the optional voluntary rest in the Low
    zone (ADR 0011).
    """

    twl_margin_w_m2: float | None = None
    warning_theta: float | None = None
    red_twl_w_m2: float | None = None
    personal_band_amber: float | None = None
    personal_band_orange: float | None = None
    personal_band_red: float | None = None
    deescalation_dwell_minutes: int | None = None
    alert_lead_hours: int | None = None
    alert_dispatch_interval_minutes: int | None = None
    forecast_stale_after_hours: int | None = None
    k_health: int | None = None
    k_exposure: int | None = None
    low_zone_voluntary_rest_min: int | None = None


class RuntimeFlags(_Model):
    """Flags that are safe to flip live. None in B1: each flag is added together with the code it gates."""


MAX_PUSH_EXTRA_HOST_SUFFIXES: Final = 20

_DNS_LABEL: Final = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?")
_DNS_TLD: Final = re.compile(r"[a-z]{2,63}|xn--[a-z0-9-]{1,59}")
# The push host override must not name a suffix that anyone can register under: that would let any stranger put a
# push endpoint on the list. This is NOT the Public Suffix List (about 10,000 rows), only a small explicit refusal list
# of the cases a pilot is most likely to mistype or be talked into: the second-level registry labels of the country
# domains (`co.uk`, `com.au`, `org.pk`: a registry label then a two-letter country code, which is the shape of most
# ICANN rows of that kind) and the best known free-subdomain hosts. Every name below is a row of the PRIVATE section
# of the Public Suffix List of 2026-11-14 (https://publicsuffix.org/list/public_suffix_list.dat), except
# `amazonaws.com`, which is not a row but is one domain shared by every customer of one cloud: the same exposure.
_REGISTRY_LABELS: Final = frozenset(
    {"com", "net", "org", "edu", "gov", "mil", "int", "co", "ac", "or", "ne", "go", "gob", "gouv", "nom", "info", "biz"}
    | {"name", "sch", "web", "asso", "med", "id", "art", "coop", "pro", "tm", "me", "tv"}
)
_SHARED_HOSTING_DOMAINS: Final = frozenset(
    {
        "github.io", "gitlab.io", "appspot.com", "googleapis.com", "cloudfunctions.net", "web.app", "firebaseapp.com",
        "herokuapp.com", "cloudfront.net", "azurewebsites.net", "azureedge.net", "amazonaws.com", "s3.amazonaws.com",
        "vercel.app", "now.sh", "netlify.app", "pages.dev", "workers.dev", "fly.dev", "onrender.com", "surge.sh",
        "blogspot.com", "myshopify.com", "ngrok.io", "ngrok-free.app", "trycloudflare.com", "duckdns.org", "no-ip.org",
        "ddns.net", "dyndns.org",
    }
)  # fmt: skip


def check_push_host_suffix(value: str) -> str:
    """One entry of ``RuntimeConfig.push_extra_host_suffixes``: a lowercase ASCII DNS name of at least two labels.

    Refused: an uppercase or non-ASCII character, a wildcard (the entry already matches its subdomains), an IP
    literal, a URL, port or path, a single label, a name that is not DNS-shaped (labels of 1 to 63 characters, 253 in
    all, a TLD of letters or punycode), and a bare public suffix (``_REGISTRY_LABELS`` and
    ``_SHARED_HOSTING_DOMAINS``: a small explicit list, not the full Public Suffix List). The message never contains
    the value.

    Raises:
        ValueError: The entry is refused.
    """
    if not value.isascii() or value != value.lower():
        msg = "must be lowercase ASCII"
        raise ValueError(msg)
    try:
        ipaddress.ip_address(value.strip("[]"))
    except ValueError:
        pass
    else:
        msg = "must be a DNS name, not an IP address"
        raise ValueError(msg)
    if "*" in value:
        msg = "must not contain a wildcard: an entry already matches its subdomains"
        raise ValueError(msg)
    labels = value.split(".")
    if (
        len(value) > 253
        or len(labels) < 2
        or not all(_DNS_LABEL.fullmatch(label) for label in labels)
        or not _DNS_TLD.fullmatch(labels[-1])
    ):
        msg = "must be a DNS name of at least two labels (no scheme, port, path or trailing dot)"
        raise ValueError(msg)
    if value in _SHARED_HOSTING_DOMAINS or (len(labels) == 2 and labels[0] in _REGISTRY_LABELS and len(labels[1]) == 2):
        msg = "must not be a public suffix that anyone can register under"
        raise ValueError(msg)
    return value


class RuntimeConfig(_Model):
    """What can change at runtime, without a restart.

    ``push_extra_host_suffixes`` (ADR 0067, ADR 0010) EXTENDS the built-in allow-list of Web Push endpoint hosts
    (``ports.push_endpoint``: Google FCM, Mozilla autopush, Apple Web Push, Windows WNS); it can never remove one.
    Each entry names a domain; it matches that host and its subdomains on DNS label boundaries (``ntfy.example.org``
    allows ``ntfy.example.org`` and ``eu.ntfy.example.org``, not ``evilntfy.example.org``). At most 20 entries, each a
    lowercase ASCII DNS name of at least two labels, no wildcard, no IP literal, not a bare public suffix
    (``check_push_host_suffix``). It is not a ruleset tunable: the rulesets are frozen and hashed, and a host is not a
    number in a range. An EMPTY value is left out of the stored body, so it changes the hash of no config that does
    not use it.
    """

    schema_version: Literal[1] = 1
    ruleset_pin: str | None = None  # None resolves the ruleset by date
    model_id: str | None = None  # None serves the uncorrected forecast
    tunables: Tunables = Field(default_factory=Tunables)
    flags: RuntimeFlags = Field(default_factory=RuntimeFlags)
    push_extra_host_suffixes: tuple[Annotated[str, AfterValidator(check_push_host_suffix)], ...] = Field(
        default=(), max_length=MAX_PUSH_EXTRA_HOST_SUFFIXES, exclude_if=lambda value: not value
    )

    @field_validator("push_extra_host_suffixes")
    @classmethod
    def _no_duplicate_hosts(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value):
            msg = "must not hold duplicate entries"
            raise ValueError(msg)
        return value


def body_sha256(body: Mapping[str, JsonValue]) -> str:
    """SHA-256 of the canonical JSON of ``body`` (sorted keys, compact separators, ASCII).

    This is the hash of a stored ``config_version.body``: it is computed from the bytes that were stored, never from a
    model dumped again on read, so adding a field to ``Tunables`` or ``RuntimeFlags`` later cannot change the hash of a
    version that already exists (the dump of a newer model would add a ``null`` key). Key order and whitespace do not
    matter, which is also what lets Postgres ``jsonb`` re-order and re-space the body without changing its hash.
    """
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def config_body(c: RuntimeConfig) -> dict[str, JsonValue]:
    """The JSON body that is stored for ``c`` (``config_version.body``)."""
    body: dict[str, JsonValue] = c.model_dump(mode="json")
    return body


def config_sha256(c: RuntimeConfig) -> str:
    """SHA-256 of the canonical JSON of ``c``: ``body_sha256(config_body(c))``.

    The same configuration always has the same hash, whatever order its keys were written in. The hash is stored with
    every config version and every decision that used it, so the formula is part of the persisted contract. For a
    config built in memory (the file seed) this is the hash; for a stored version, use the stored one
    (``body_sha256`` of the stored body), which does not move when the schema grows.
    """
    return body_sha256(config_body(c))


@dataclass(frozen=True)
class ConfigViolation:
    """A reason a runtime config cannot be used: a machine-readable code, the dotted path of the field, a message."""

    code: ViolationCode
    path: str
    message: str


@dataclass(frozen=True)
class EffectiveParams:
    """The tunables after defaults are applied: one field per ``Tunables`` field, none ``None``.

    Counts, minutes and hours are ``int``; probabilities and W/m2 are ``float``.
    """

    twl_margin_w_m2: float
    warning_theta: float
    red_twl_w_m2: float
    personal_band_amber: float
    personal_band_orange: float
    personal_band_red: float
    deescalation_dwell_minutes: int
    alert_lead_hours: int
    alert_dispatch_interval_minutes: int
    forecast_stale_after_hours: int
    k_health: int
    k_exposure: int
    low_zone_voluntary_rest_min: int


# The tunables whose effective value is an integer (counts, minutes, hours): read off ``EffectiveParams``, not repeated.
_INTEGER_TUNABLES = frozenset(f.name for f in dataclasses.fields(EffectiveParams) if f.type is int)

# The personal bands in severity order: each must be strictly above the one before it (ADR 0049 decision 1).
_PERSONAL_BANDS = ("personal_band_amber", "personal_band_orange", "personal_band_red")


def resolve_effective(c: RuntimeConfig, ruleset: Ruleset) -> EffectiveParams | list[ConfigViolation]:
    """Apply ``c.tunables`` to ``ruleset``: a set tunable must be declared and in range; an unset one is the default.

    Also refused: an integer tunable whose ruleset default is not a whole number, and personal bands that are not
    strictly increasing (amber < orange < red; the ranges of ADR 0049 touch at 0.30 and 0.70, so a tie is possible).
    """
    violations: list[ConfigViolation] = []
    values: dict[str, float] = {}
    for name in Tunables.model_fields:
        path = f"tunables.{name}"
        value: float | None = getattr(c.tunables, name)
        spec = ruleset.tunables.get(name)
        if spec is None:
            what = "is not declared by" if value is not None else "has no default in"
            violations.append(ConfigViolation("unknown-tunable", path, f"{name} {what} ruleset {ruleset.meta.id}"))
        elif value is None:
            if name in _INTEGER_TUNABLES and not float(spec.default).is_integer():
                violations.append(
                    ConfigViolation(
                        "out-of-range",
                        path,
                        f"{name} default {spec.default} of ruleset {ruleset.meta.id} is not a whole number",
                    )
                )
            else:
                values[name] = spec.default
        elif not spec.min <= value <= spec.max:
            violations.append(
                ConfigViolation(
                    "out-of-range",
                    path,
                    f"{name}={value} is outside [{spec.min}, {spec.max}] of ruleset {ruleset.meta.id}",
                )
            )
        else:
            values[name] = value
    if all(name in values for name in _PERSONAL_BANDS):
        for lower, upper in itertools.pairwise(_PERSONAL_BANDS):
            if not values[lower] < values[upper]:
                violations.append(
                    ConfigViolation(
                        "out-of-range",
                        f"tunables.{upper}",
                        f"{upper}={values[upper]} must be above {lower}={values[lower]}: the personal bands must "
                        "be strictly increasing",
                    )
                )
    if violations:
        return violations
    return EffectiveParams(
        twl_margin_w_m2=values["twl_margin_w_m2"],
        warning_theta=values["warning_theta"],
        red_twl_w_m2=values["red_twl_w_m2"],
        personal_band_amber=values["personal_band_amber"],
        personal_band_orange=values["personal_band_orange"],
        personal_band_red=values["personal_band_red"],
        deescalation_dwell_minutes=int(values["deescalation_dwell_minutes"]),
        alert_lead_hours=int(values["alert_lead_hours"]),
        alert_dispatch_interval_minutes=int(values["alert_dispatch_interval_minutes"]),
        forecast_stale_after_hours=int(values["forecast_stale_after_hours"]),
        k_health=int(values["k_health"]),
        k_exposure=int(values["k_exposure"]),
        low_zone_voluntary_rest_min=int(values["low_zone_voluntary_rest_min"]),
    )


def _check_pin(
    pin: str, *, catalog: RulesetCatalog, today: date, prod: bool
) -> tuple[Ruleset | None, list[ConfigViolation]]:
    """The pinned ruleset (``None`` if it cannot be used at all) and the violations the pin causes."""
    try:
        pinned = catalog.get(pin)
    except KeyError as exc:
        return None, [ConfigViolation("unknown-ruleset", "ruleset_pin", exc.args[0])]
    if not prod:
        return pinned.ruleset, []
    if pinned.ruleset.meta.status != "released":
        return pinned.ruleset, [
            ConfigViolation("unknown-ruleset", "ruleset_pin", f"{pin} is a draft; prod accepts released rulesets only")
        ]
    if not pinned.ruleset.covers(today):
        return pinned.ruleset, [ConfigViolation("pin-out-of-range", "ruleset_pin", f"{pin} does not cover {today}")]
    in_force = catalog.for_local_date(today).ruleset
    violations = [
        ConfigViolation(
            "floor-violation",
            f"ruleset_pin.{v.path}",
            f"{pin} has {v.candidate}, less protective than {v.reference} in {in_force.meta.id}",
        )
        for v in floor_violations(pinned.ruleset, in_force)
    ]
    violations.extend(_tunable_violations(pinned.ruleset, in_force))
    return pinned.ruleset, violations


def _tunable_violations(pinned: Ruleset, in_force: Ruleset) -> list[ConfigViolation]:
    """Where ``pinned`` would let a tunable be less protective than ``in_force`` does (ADR 0044).

    For every tunable ``in_force`` declares, the end of the range that is less protective, and the effective default
    (what ``resolve_effective`` gives a config that sets nothing), must be at least as protective in ``pinned``, as
    ``safer`` says: ``higher`` compares ``min`` and the default upwards, ``lower`` compares ``max`` and the default
    downwards, ``none`` is not compared. A tunable ``in_force`` declares and ``pinned`` does not is a violation at
    ``ruleset_pin.tunables.<name>``. One violation per failing tunable per check, at ``.min``, ``.max`` or ``.default``.
    """
    violations: list[ConfigViolation] = []
    effective = resolve_effective(RuntimeConfig(), pinned)
    for name, force in in_force.tunables.items():
        path = f"ruleset_pin.tunables.{name}"
        pin_spec = pinned.tunables.get(name)
        if pin_spec is None:
            violations.append(
                ConfigViolation(
                    "floor-violation",
                    path,
                    f"{pinned.meta.id} does not declare tunable {name}, which {in_force.meta.id} does",
                )
            )
            continue
        if force.safer == "none":
            continue
        pin_default = (
            getattr(effective, name, pin_spec.default) if isinstance(effective, EffectiveParams) else pin_spec.default
        )
        higher = force.safer == "higher"
        checks = (
            ("min", pin_spec.min, force.min) if higher else ("max", pin_spec.max, force.max),
            ("default", pin_default, force.default),
        )
        for field, pin_value, force_value in checks:
            if (pin_value < force_value) if higher else (pin_value > force_value):
                violations.append(
                    ConfigViolation(
                        "floor-violation",
                        f"{path}.{field}",
                        f"{pinned.meta.id} has {name} {field} {pin_value}, less protective than {force_value} in "
                        f"{in_force.meta.id} (safer is {force.safer})",
                    )
                )
    return violations


def validate_runtime_config(
    c: RuntimeConfig, *, catalog: RulesetCatalog, models: ModelRegistry, today: date, prod: bool
) -> list[ConfigViolation]:
    """Every reason ``c`` cannot be the active config; an empty list means it can.

    The pin must name a loaded ruleset. In prod it must also be released, cover ``today`` (the Asia/Dubai local date)
    and have no floor, tunable range end or tunable default less protective than the ruleset in force today (ADR 0010
    section 4.3, ADR 0044); in dev a pin may be for another date. A pin can only be used if the ruleset declares every
    tunable of ``Tunables``: a superseded ruleset that predates a tunable (``ae-heat-0.1`` and the B3 ones) can still
    be loaded and found by id (audit replay through ``RulesetCatalog.resolve`` never calls ``resolve_effective``), but
    pinning it fails with one ``unknown-tunable`` ("has no default in ruleset") violation per missing tunable. The
    model must be in the registry, and the tunables must resolve against the pinned ruleset, or against the one in
    force today when there is no pin. A floor violation's path is ``ruleset_pin.<floor path>``; a tunable's is
    ``ruleset_pin.tunables.<name>`` plus ``.min``, ``.max`` or ``.default``.

    Raises:
        NoRulesetError: There is no pin and no ruleset is in force today. That is a gap in the catalog, not a config
            error, and it fails startup loudly.
    """
    violations: list[ConfigViolation] = []
    if c.ruleset_pin is None:
        ruleset: Ruleset | None = catalog.for_local_date(today).ruleset
    else:
        ruleset, pin_violations = _check_pin(c.ruleset_pin, catalog=catalog, today=today, prod=prod)
        violations.extend(pin_violations)

    if c.model_id is not None and c.model_id not in models.ids():
        known = ", ".join(models.ids()) or "(none)"
        violations.append(ConfigViolation("unknown-model", "model_id", f"unknown model {c.model_id!r}; known: {known}"))

    if ruleset is not None:
        resolved = resolve_effective(c, ruleset)
        if isinstance(resolved, list):
            violations.extend(resolved)
    return violations
