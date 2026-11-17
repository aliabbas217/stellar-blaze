"""The active runtime config as an immutable snapshot, the service that changes it, and the poller that follows it
(ADR 0010 section 3).

A request or a job run reads one snapshot and keeps it until it finishes, so two versions of the config never mix inside
one decision. The holder replaces a single reference; a reader that already holds a snapshot is not affected by a swap.

``ConfigService`` is what changes the config: ``propose`` stores a validated version, ``activate`` and ``rollback``
append to the activation log, ``seed`` puts the git default in on first deploy. The CLI uses it today and B3's admin API
will use it unchanged. Every replica re-validates every version it loads (``load_version``), so a row inserted by hand
through SQL is refused where it would be applied. ``ConfigPoller`` follows the activation log: one cheap read per
interval, a swap when the version changed, and on any failure the last good snapshot keeps serving.
"""

import asyncio
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

import structlog
from pydantic import ValidationError

from stellar_blaze.domain.config.models import LoadedModel, ModelRegistry
from stellar_blaze.domain.config.runtime import (
    ConfigViolation,
    RuntimeConfig,
    body_sha256,
    validate_runtime_config,
)
from stellar_blaze.domain.rules.catalog import LoadedRuleset, RulesetCatalog
from stellar_blaze.ports.audit import AuditEvent, AuditLog
from stellar_blaze.ports.config_store import (
    ActivationKind,
    ActivationRecord,
    RuntimeConfigStore,
    StaleActivationError,
    StoreUnavailableError,
    VersionRecord,
)
from stellar_blaze.redaction import describe_exception

logger = structlog.stdlib.get_logger(__name__)

REASON_MIN_CHARS = 10
REASON_MAX_CHARS = 500
_MAX_LOGGED_ERROR_CHARS = 500

type ConfigStatus = Literal["ok", "stale", "missing"]
type StaleReason = Literal["database-unavailable", "rejected-activation", "poll-error"]


class ConfigUnavailableError(RuntimeError):
    """There is no active config yet (or no longer): nothing may be decided until one is loaded."""


@dataclass(frozen=True)
class ConfigSnapshot:
    """One validated runtime config and where it came from.

    Attributes:
        version_id: The ``config_version`` row, or ``None`` for a snapshot read from a file or the environment.
        sha256: ``config_sha256`` of ``config`` for a file or env snapshot; for a ``db`` snapshot the stored hash of the
            version's body (it does not move when the ``RuntimeConfig`` schema grows).
        config: The validated runtime config.
        source: ``"file"`` (the git seed), ``"env"`` (the seed with ``SB_RULESET_ID`` / ``SB_MODEL_ID`` pins applied,
            for back-tests and database-less development runs) or ``"db"`` (an activated config version).
        model: The loaded model ``config.model_id`` names, or ``None`` for the uncorrected forecast.
    """

    version_id: int | None
    sha256: str
    config: RuntimeConfig
    source: Literal["file", "env", "db"]
    model: LoadedModel | None


class SnapshotHolder:
    """Holds the current snapshot. Readers call ``current`` once and keep what they got."""

    def __init__(self, initial: ConfigSnapshot | None = None) -> None:
        self._snapshot = initial

    def current(self) -> ConfigSnapshot:
        """The active snapshot.

        Raises:
            ConfigUnavailableError: No snapshot has been loaded.
        """
        snapshot = self._snapshot
        if snapshot is None:
            msg = "no runtime config is loaded"
            raise ConfigUnavailableError(msg)
        return snapshot

    def peek(self) -> ConfigSnapshot | None:
        """The active snapshot, or ``None`` when none is loaded (``current`` raises instead)."""
        return self._snapshot

    def swap(self, snapshot: ConfigSnapshot) -> None:
        """Make ``snapshot`` the active one: one reference assignment, so a reader sees the old or the new one."""
        self._snapshot = snapshot


def ruleset_for(snapshot: ConfigSnapshot, catalog: RulesetCatalog, d: date) -> LoadedRuleset:
    """The ruleset to decide on the local date ``d`` under ``snapshot``: its pin if it has one, else the one by date.

    Raises:
        KeyError: The pin names no loaded ruleset.
        PinOutOfRangeError: The pin does not cover ``d``.
        NoRulesetError: There is no pin and no ruleset covers ``d``.
    """
    return catalog.resolve(d, snapshot.config.ruleset_pin)


class ConfigInvalidError(Exception):
    """A config or a stored version cannot become the active config; ``violations`` says why, each with its code."""

    def __init__(self, violations: Sequence[ConfigViolation]) -> None:
        self.violations = tuple(violations)
        super().__init__("; ".join(f"{v.code} at {v.path}: {v.message}" for v in self.violations))


class NothingToRollBackError(Exception):
    """``rollback`` needs an activation before the latest one, and there is none."""


class AuditFieldsError(ValueError):
    """The actor is blank, or the reason is not 10 to 500 characters (every write carries both; ADR 0010 section 4)."""


def audit_fields(actor: str, reason: str) -> tuple[str, str]:
    """``(actor, reason)`` without surrounding whitespace.

    Raises:
        AuditFieldsError: The actor is blank, or the reason is shorter than 10 or longer than 500 characters.
    """
    actor, reason = actor.strip(), reason.strip()
    if not actor:
        msg = "actor is required"
        raise AuditFieldsError(msg)
    if not REASON_MIN_CHARS <= len(reason) <= REASON_MAX_CHARS:
        msg = f"reason must be {REASON_MIN_CHARS} to {REASON_MAX_CHARS} characters, got {len(reason)}"
        raise AuditFieldsError(msg)
    return actor, reason


@dataclass(frozen=True)
class SeedResult:
    """What ``ConfigService.seed`` did: the version that holds the git default, and the activation it appended (``None``
    when an activation already existed, so nothing was activated)."""

    version: VersionRecord
    activation: ActivationRecord | None


class ConfigService:
    """Validate, propose, activate, roll back and load runtime configs against a store (ADR 0010 section 3).

    Every config that becomes active, whoever wrote its row, has passed ``validate_runtime_config`` against the rulesets
    and models of this process, on this process's date (``clock``, the Asia/Dubai date in production).
    """

    def __init__(
        self,
        store: RuntimeConfigStore,
        catalog: RulesetCatalog,
        models: ModelRegistry,
        holder: SnapshotHolder,
        clock: Callable[[], date],
        *,
        prod: bool,
        audit: AuditLog | None = None,
    ) -> None:
        """Wire the service. ``prod`` selects the strict pin rules (``validate_runtime_config``). ``audit`` receives a
        ``config.rejected`` row for every config the service refuses (ADR 0052 section 2); a successful write is
        audited by the store in its own transaction."""
        self._audit = audit
        self._store = store
        self._catalog = catalog
        self._models = models
        self._holder = holder
        self._clock = clock
        self._prod = prod

    @property
    def prod(self) -> bool:
        return self._prod

    def today(self) -> date:
        """The date this service validates on (the Asia/Dubai date in production); the poller watches it change."""
        return self._clock()

    def validate(self, config: RuntimeConfig) -> list[ConfigViolation]:
        """Every reason ``config`` cannot be the active config; empty when it can.

        Raises:
            NoRulesetError: There is no pin and no ruleset covers today (a gap in the catalog).
        """
        return validate_runtime_config(
            config, catalog=self._catalog, models=self._models, today=self._clock(), prod=self._prod
        )

    # --- reads --------------------------------------------------------------------------------------------------

    async def latest_activation(self) -> ActivationRecord | None:
        """The latest activation, or ``None`` while nothing was ever activated."""
        return await self._store.latest_activation()

    async def get_version(self, version_id: int) -> VersionRecord:
        """The stored version (``VersionNotFoundError`` if there is none)."""
        return await self._store.get_version(version_id)

    async def history(self, limit: int) -> Sequence[ActivationRecord]:
        """The latest ``limit`` activations, newest first."""
        return await self._store.history(limit)

    # --- writes -------------------------------------------------------------------------------------------------

    async def propose(self, config: RuntimeConfig, actor: str, reason: str) -> VersionRecord:
        """Store ``config`` as a version (idempotent on its hash) without activating it.

        Raises:
            AuditFieldsError: ``actor`` or ``reason`` is unusable.
            ConfigInvalidError: ``config`` violates its ruleset, the model registry or the prod pin rules.
        """
        actor, reason = audit_fields(actor, reason)
        violations = self.validate(config)
        if violations:
            await self._rejected(actor, violations)
            raise ConfigInvalidError(violations)
        return await self._store.create_version(config, actor=actor, reason=reason)

    async def activate(
        self, version_id: int, expected_previous: int | None, actor: str, reason: str
    ) -> ActivationRecord:
        """Make a stored version the active one: re-validate it, preload its model, append the activation, and only
        then swap this process's snapshot. ``expected_previous`` is the latest activation the caller saw (``None``:
        none yet, which records the first activation as the ``seed``).

        Raises:
            AuditFieldsError: ``actor`` or ``reason`` is unusable.
            VersionNotFoundError: There is no such version.
            ConfigInvalidError: The stored version no longer validates (or never did, if it was inserted by hand).
            StaleActivationError: ``expected_previous`` is not the latest activation; nothing was written.
        """
        actor, reason = audit_fields(actor, reason)
        kind: ActivationKind = "seed" if expected_previous is None else "activate"
        return await self._activate(
            version_id, expected_previous=expected_previous, kind=kind, actor=actor, reason=reason
        )

    async def rollback(self, actor: str, reason: str, *, expected_previous: int | None = None) -> ActivationRecord:
        """Activate the version of the activation before the latest one, as a ``rollback``. A second rollback undoes
        the first: "the previous activation" is then the one the first rollback replaced.

        ``expected_previous`` is the latest activation the caller saw (as for ``activate``); ``None`` means whatever is
        latest when this reads it. Two rollbacks, or one request sent twice, that both name the activation they saw
        cannot both succeed: the second is stale, instead of silently undoing the first. **A caller that acts for a
        person on a view it showed them (B3's HTTP route) must require it**; the default is for a command line whose
        operator reads the history first.

        Raises:
            AuditFieldsError: ``actor`` or ``reason`` is unusable.
            NothingToRollBackError: There are fewer than two activations, or the previous activation holds the version
                that is already active (a rollback would change nothing).
            StaleActivationError: ``expected_previous`` is not the latest activation (or another activation landed while
                this one was being made); nothing was written.
            ConfigInvalidError: That version no longer validates (a rollback goes through the same checks).
        """
        actor, reason = audit_fields(actor, reason)
        recent = await self._store.history(2)
        if len(recent) < 2:
            msg = "there is no activation before the current one to roll back to"
            raise NothingToRollBackError(msg)
        latest, previous = recent
        if expected_previous is not None and expected_previous != latest.id:
            raise StaleActivationError(expected_previous)
        if previous.config_version_id == latest.config_version_id:
            msg = "the activation before the current one holds the same version, so rolling back would change nothing"
            raise NothingToRollBackError(msg)
        return await self._activate(
            previous.config_version_id, expected_previous=latest.id, kind="rollback", actor=actor, reason=reason
        )

    async def seed(self, config: RuntimeConfig, *, actor: str, reason: str) -> SeedResult:
        """Store the git default and, only if nothing was ever activated, activate it as the ``seed``. Idempotent, and
        safe to run from several replicas at once: the one that loses the race to the first activation succeeds too.

        Raises:
            AuditFieldsError: ``actor`` or ``reason`` is unusable.
            ConfigInvalidError: ``config`` violates its ruleset or the model registry; nothing was written.
        """
        actor, reason = audit_fields(actor, reason)
        violations = self.validate(config)
        if violations:
            await self._rejected(actor, violations)
            raise ConfigInvalidError(violations)
        version = await self._store.create_version(config, actor=actor, reason=reason)
        if await self._store.latest_activation() is not None:
            return SeedResult(version, None)
        resolved = self._resolve(version)
        if isinstance(resolved, list):  # the stored row is not what was validated: only a hand-edited row gets here
            await self._rejected(actor, resolved, version)
            raise ConfigInvalidError(resolved)
        try:
            activation = await self._store.activate(
                version.id, expected_previous=None, kind="seed", actor=actor, reason=reason
            )
        except StaleActivationError:
            return SeedResult(version, None)
        self._holder.swap(resolved)
        return SeedResult(version, activation)

    async def _activate(
        self, version_id: int, *, expected_previous: int | None, kind: ActivationKind, actor: str, reason: str
    ) -> ActivationRecord:
        version = await self._store.get_version(version_id)
        resolved = self._resolve(version)
        if isinstance(resolved, list):
            await self._rejected(actor, resolved, version)
            raise ConfigInvalidError(resolved)
        record = await self._store.activate(
            version_id, expected_previous=expected_previous, kind=kind, actor=actor, reason=reason
        )
        self._holder.swap(resolved)
        return record

    async def _rejected(
        self, actor: str, violations: Sequence[ConfigViolation], version: VersionRecord | None = None
    ) -> None:
        """Append ``config.rejected`` (violation codes and paths only) when an audit log is wired.

        Best effort: the caller is about to raise ``ConfigInvalidError`` and that violation message is what the operator
        needs. An audit log that cannot be written (the database is down) must never replace it with its own error, so a
        failure is logged with its class name and swallowed here.
        """
        audit = self._audit
        if audit is None:
            return
        try:
            await audit.append(
                AuditEvent(
                    kind="config.rejected",
                    actor=actor,
                    actor_role="operator",
                    outcome="rejected",
                    detail={
                        "codes": [v.code for v in violations],
                        "paths": [v.path for v in violations],
                        "version_id": None if version is None else version.id,
                    },
                    config_version_id=None if version is None else version.id,
                    config_sha256=None if version is None else version.sha256,
                )
            )
        except Exception as error:
            logger.error("config.rejected_audit_failed", error=type(error).__name__)

    # --- loading ------------------------------------------------------------------------------------------------

    async def load_version(self, version_id: int) -> ConfigSnapshot | None:
        """The snapshot of a stored version, validated here and now; ``None`` (after logging ``config_rejected`` with
        the violation codes) when it cannot be applied, so the caller keeps its last good snapshot.

        Raises:
            VersionNotFoundError: There is no such version.
        """
        version = await self._store.get_version(version_id)
        resolved = self._resolve(version)
        if isinstance(resolved, list):
            logger.error(
                "config_rejected",
                version_id=version.id,
                sha256=version.sha256,
                codes=[v.code for v in resolved],
                violations=[f"{v.code} at {v.path}: {v.message}" for v in resolved],
            )
            return None
        return resolved

    async def load_active(self) -> ConfigSnapshot | None:
        """The snapshot of the latest activation (``load_version``), or ``None`` when nothing is active or the active
        version is refused. Reads only; the caller swaps the holder."""
        latest = await self._store.latest_activation()
        if latest is None:
            return None
        return await self.load_version(latest.config_version_id)

    def _resolve(self, version: VersionRecord) -> ConfigSnapshot | list[ConfigViolation]:
        """The snapshot a stored version makes, or why it cannot be one.

        The hash on the snapshot is the stored one, after checking it is the hash of the stored body: a decision
        records it, and it must name the version, not whatever the current schema would dump for it.
        """
        stored_body_sha256 = body_sha256(version.body)
        if stored_body_sha256 != version.sha256:
            return [
                ConfigViolation(
                    "hash-mismatch",
                    "sha256",
                    f"the stored hash {version.sha256} is not the hash of the stored body ({stored_body_sha256})",
                )
            ]
        try:
            config = RuntimeConfig.model_validate(version.body)
        except ValidationError as exc:
            return [
                ConfigViolation("invalid-config", ".".join(str(part) for part in error["loc"]) or "body", error["msg"])
                for error in exc.errors(include_input=False, include_url=False, include_context=False)
            ]
        violations = self.validate(config)
        if violations:
            return violations
        return ConfigSnapshot(
            version_id=version.id,
            sha256=version.sha256,
            config=config,
            source="db",
            model=self._models.get(config.model_id) if config.model_id is not None else None,
        )


class ConfigPoller:
    """Follows the activation log so a running process applies a config activated elsewhere, with no restart.

    Every ``interval_s`` it reads the latest activation (one single-row read); only when that activation's version
    is not the one the holder serves does it load, re-validate and swap. A failure of any kind (the database, a version
    that does not validate) leaves the last good snapshot serving and makes ``status`` ``"stale"``; ``"missing"`` means
    there is no snapshot at all. A change of ``status`` **or of the reason** is logged once (``config.status_changed``),
    at ``error`` for ``stale`` and ``missing``, so a replica that cannot follow does not repeat itself every interval.
    The reason says what failed: ``database-unavailable`` (the store could not answer), ``rejected-activation`` (the
    version does not validate) or ``poll-error`` (anything else, which is a bug and not an outage); ``error`` is the
    exception, with the cause it was raised from and credentials masked (``describe_exception``). The reason matters
    while the status stays ``missing`` (a process that started with its database down has no snapshot, so its status
    does not change when the first poll fails): the line for that poll is the first to say why.

    A snapshot is validated when it loads, and a ruleset's ``effective_to`` passing can make a valid pin invalid with
    no new activation (ADR 0044 section 3). So on the first poll after the date changes (``ConfigService.today``, the
    Asia/Dubai date) the poller validates the held snapshot again: if it no longer validates, the snapshot keeps
    serving, the status is ``stale`` with reason ``rejected-activation``, and ``config_rejected`` is logged once for
    that date. An activation it refused is read again on the first poll after the date it was refused on, since the
    pin that failed yesterday may cover today. A new valid activation replaces a snapshot that failed re-validation
    and clears the status.

    A snapshot built from ``SB_RULESET_ID`` / ``SB_MODEL_ID`` (``source="env"``, never in prod) is never replaced:
    those pins are for back-tests and runs without a database (ADR 0010 section 4.6), so the poller does not read the
    database and says so once (``config.db_activations_ignored``).
    """

    def __init__(self, service: ConfigService, holder: SnapshotHolder, interval_s: float) -> None:
        if not (math.isfinite(interval_s) and interval_s > 0):
            msg = f"interval_s must be a positive number of seconds, got {interval_s}"
            raise ValueError(msg)
        self._service = service
        self._holder = holder
        self._interval_s = interval_s
        self._task: asyncio.Task[None] | None = None
        self._stale_reason: StaleReason | None = None
        self._error: str | None = None
        self._rejected_activation: int | None = None
        self._rejected_on: date | None = None
        self._validated_on: date = service.today()  # the held snapshot was validated at start-up, on this date
        self._refused_snapshot: ConfigSnapshot | None = None  # the held snapshot, if it failed re-validation today
        self._logged: tuple[ConfigStatus, StaleReason | None] | None = None
        self._warned_about_env_pins = False

    @property
    def interval_s(self) -> float:
        return self._interval_s

    @property
    def running(self) -> bool:
        return self._task is not None

    @property
    def status(self) -> ConfigStatus:
        """``missing``: no snapshot yet. ``stale``: serving the last good snapshot, but the latest could not be read or
        was refused. ``ok`` otherwise."""
        if self._holder.peek() is None:
            return "missing"
        return "stale" if self._stale_reason is not None else "ok"

    def start(self) -> None:
        """Start polling in the running event loop; the first poll comes one interval from now.

        Raises:
            RuntimeError: Already started.
        """
        if self._task is not None:
            msg = "the config poller is already started"
            raise RuntimeError(msg)
        self._task = asyncio.get_running_loop().create_task(self._run(), name="config-poller")
        self._warn_if_env_pinned()
        self._log_status()

    async def stop(self) -> None:
        """Stop polling and wait for the task to end, cancelling a poll that is in flight. Harmless when not started."""
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                raise  # this coroutine was cancelled too, not only the poll it was stopping

    async def poll_once(self) -> None:
        """One pass: read, compare, and swap if the active version changed. Never raises (except for cancellation)."""
        try:
            await self._poll()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # the supervisor of a background loop: any failure is a stale poll, not a dead poller
            unavailable = isinstance(exc, StoreUnavailableError | OSError | TimeoutError)
            self._stale_reason = "database-unavailable" if unavailable else "poll-error"
            self._error = describe_exception(exc, max_chars=_MAX_LOGGED_ERROR_CHARS)
        self._log_status()

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self._interval_s)
            await self.poll_once()

    async def _poll(self) -> None:
        if self._warn_if_env_pinned():
            self._settled()
            return
        today = self._service.today()
        current = self._holder.peek()
        if today != self._validated_on:
            if current is not None:
                self._revalidate(current)
            self._validated_on = today  # not reached when validation raises, so the next poll tries again
        latest = await self._service.latest_activation()
        if latest is None or (current is not None and current.version_id == latest.config_version_id):
            self._settled_unless_refused(current)  # reachable, and nothing newer than what is served
            return
        if self._rejected_activation == latest.id and self._rejected_on == today:
            self._stale_reason, self._error = "rejected-activation", None  # already refused today: do not re-read it
            return
        snapshot = await self._service.load_version(latest.config_version_id)
        if snapshot is None:
            self._rejected_activation, self._rejected_on = latest.id, today
            self._stale_reason, self._error = "rejected-activation", None
            return
        if self._holder.peek() is not current:
            return  # an activation made through this process swapped meanwhile; the next pass compares again
        self._holder.swap(snapshot)
        self._rejected_activation, self._rejected_on = None, None
        self._refused_snapshot = None
        logger.info(
            "config.loaded",
            config_version=snapshot.version_id,
            config_sha256=snapshot.sha256,
            activation_id=latest.id,
            previous_version=None if current is None else current.version_id,
        )
        self._settled()

    def _revalidate(self, snapshot: ConfigSnapshot) -> None:
        """Validate the held ``snapshot`` on today's date; remember (and log once) that it no longer validates.

        Raises:
            NoRulesetError: There is no pin and no ruleset covers today: a gap in the catalog, which ``poll_once`` turns
                into a ``poll-error`` stale poll.
        """
        violations = self._service.validate(snapshot.config)
        if not violations:
            self._refused_snapshot = None
            return
        self._refused_snapshot = snapshot
        logger.error(
            "config_rejected",
            version_id=snapshot.version_id,
            sha256=snapshot.sha256,
            codes=[v.code for v in violations],
            violations=[f"{v.code} at {v.path}: {v.message}" for v in violations],
        )

    def _settled_unless_refused(self, current: ConfigSnapshot | None) -> None:
        """``ok``, unless ``current`` is the snapshot that failed today's re-validation (it serves, but ``stale``)."""
        if current is not None and current is self._refused_snapshot:
            self._stale_reason, self._error = "rejected-activation", None
        else:
            self._settled()

    def _warn_if_env_pinned(self) -> bool:
        """Whether the snapshot is an ``env`` one, which the database must not replace; logs that once."""
        snapshot = self._holder.peek()
        if snapshot is None or snapshot.source != "env":
            return False
        if not self._warned_about_env_pins:
            self._warned_about_env_pins = True
            logger.warning(
                "config.db_activations_ignored",
                reason="SB_RULESET_ID or SB_MODEL_ID is set, so activations in the database are not applied",
                config_sha256=snapshot.sha256,
            )
        return True

    def _settled(self) -> None:
        self._stale_reason, self._error = None, None

    def _log_status(self) -> None:
        """Log the status and the reason once per change of either (the first call logs the starting state)."""
        current = (self.status, self._stale_reason)
        if current == self._logged:
            return
        previous, self._logged = self._logged, current
        status, reason = current
        log = logger.info if status == "ok" else logger.error
        log(
            "config.status_changed",
            status=status,
            previous=None if previous is None else previous[0],
            reason=reason,
            previous_reason=None if previous is None else previous[1],
            error=self._error,
        )
