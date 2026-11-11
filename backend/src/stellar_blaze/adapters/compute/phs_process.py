"""Run the ISO 7933 PHS kernel in a worker process that can be killed.

``pythermalcomfort.models.phs`` is a numba routine that never returns when any input is NaN or infinite (upstream
#524), and a numba kernel cannot be interrupted from a thread. So the kernel runs in a separate long-lived process
(``spawn``, never ``fork``: numba's thread pool is not fork-safe); the parent sends the keyword arguments over a pipe,
waits for the answer with ``poll(timeout)``, and on silence kills the worker and answers ``timeout``. The next call
starts a fresh worker. ``validate_phs_inputs`` runs first, so a hang needs a kernel bug rather than a missing hour;
the timeout is the second line, and ``check_phs_output`` the third (ADR 0006).

``pythermalcomfort`` has no ``py.typed``; this module is its only importer and returns domain types, so nothing typed
loosely leaks out (the mypy override in ``pyproject.toml`` covers the import).

Timing. A new worker imports the library and runs one warm-up call before it reports ready, under its own
``startup_timeout_s``; ``timeout_s`` therefore bounds computation only. Without that split, a cold start (imports plus
a 2 to 4 s numba compile when the cache is empty) would eat the budget and every restart after a timeout would time
out again. ``NUMBA_CACHE_DIR`` and ``NUMBA_CPU_NAME=generic`` (set in the image, ``backend/Dockerfile``) make that
compile a cache load.

Calls block, and a runner serves one call at a time (a lock serializes threads). Async callers use
``asyncio.to_thread``. The timeout is meant to come from ``Settings.phs_timeout_s``; no B1 code builds a runner
outside the tests, and nothing consumes that setting yet.
"""

import contextlib
import math
import multiprocessing
import signal
import threading
import warnings
from collections.abc import Mapping
from multiprocessing.process import BaseProcess
from types import TracebackType
from typing import Any, Final, Protocol, Self

from stellar_blaze.domain.physics.phs import (
    PhsInputs,
    PhsOutcome,
    PhsRejected,
    PhsResult,
    check_phs_output,
    validate_phs_inputs,
)

KernelKwargs = Mapping[str, float | str]
"""Keyword arguments of ``pythermalcomfort.models.phs`` (its own names: ``tdb``, ``tr``, ``v``, ``weight``, ...)."""

_MODEL: Final = "7933-2023"
_GRACEFUL_STOP_S: Final = 2.0
_REAP_TIMEOUT_S: Final = 5.0
# Exceptions by which the kernel refuses an input (a bad posture string, a body mass over 1000 kg); anything else is a
# kernel failure the caller cannot fix.
_INPUT_ERRORS: Final = frozenset({"ValueError", "TypeError"})
_WARM_INPUTS: Final = PhsInputs(tdb_c=40.0, tr_c=45.0, v_ms=0.3, rh_pct=33.0, met=2.5, clo=0.5)


class _Channel(Protocol):
    """What both ``Connection`` (POSIX) and ``PipeConnection`` (Windows), the two types ``Pipe`` returns, provide."""

    def send(self, obj: Any, /) -> None: ...
    def recv(self) -> Any: ...
    def poll(self, timeout: float | None = 0.0, /) -> bool: ...
    def close(self) -> None: ...


def kernel_kwargs(inputs: PhsInputs) -> dict[str, float | str]:
    """Map ``inputs`` to the names ``pythermalcomfort`` 4.8.1 ``phs`` documents.

    ``tdb``, ``tr``, ``v``, ``rh``, ``met``, ``clo`` and ``posture`` are parameters of the signature; ``weight`` (kg)
    and ``height`` (m) are not, they travel in ``**kwargs`` and are listed under "Other Parameters" in its docstring.
    """
    return {
        "tdb": inputs.tdb_c,
        "tr": inputs.tr_c,
        "v": inputs.v_ms,
        "rh": inputs.rh_pct,
        "met": inputs.met,
        "clo": inputs.clo,
        "posture": inputs.posture,
        "weight": inputs.weight_kg,
        "height": inputs.height_m,
    }


def _run_kernel(kwargs: KernelKwargs) -> PhsResult:
    """The typed facade: one scalar call of the ISO 7933:2023 model, unrounded (rounding is a display concern).

    The import is here, not at module level, so that importing this module (the API process does) costs nothing; only
    the worker and ``warm`` pay for numba.
    """
    from pythermalcomfort.models import phs

    outcome = phs(**kwargs, model=_MODEL, round_output=False)
    return PhsResult(
        t_re_c=float(outcome.t_re),
        d_lim_t_re_min=float(outcome.d_lim_t_re),
        d_lim_loss_50_min=float(outcome.d_lim_loss_50),
        d_lim_loss_95_min=float(outcome.d_lim_loss_95),
        sweat_loss_g=float(outcome.sweat_loss_g),
    )


def warm() -> None:
    """Run one valid call in this process, which compiles the numba kernels or loads them from ``NUMBA_CACHE_DIR``.

    The image build calls it as the app user so that the cache the app reads exists (``backend/Dockerfile``). It raises
    when the call gives no usable result, so a library bump that breaks PHS fails the build, not the first request.
    """
    rejected = validate_phs_inputs(_WARM_INPUTS)
    if rejected is None:
        result = _run_kernel(kernel_kwargs(_WARM_INPUTS))
        rejected = check_phs_output(result)
    if rejected is not None:
        raise RuntimeError(f"PHS warm-up call gave no usable result: {rejected.reason}: {rejected.detail}")


def _worker_main(conn: _Channel) -> None:
    """Worker loop: warm up, report ready, then answer one request at a time until told to stop or the parent is gone.

    Messages to the parent: ``("ready",)``, ``("ok", fields)`` and ``("error", exception name, message)``. A request is
    a keyword-argument dict, or ``None`` to stop.
    """
    # Ctrl-C in a terminal reaches every process in the group; the parent decides when the worker ends.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    # The library warns whenever it turns an out-of-window input into NaN; the NaN is reported as `nan_output`.
    warnings.filterwarnings("ignore", message=r".*outside the applicability limits.*", category=UserWarning)
    try:
        try:
            warm()
        except Exception as exc:
            conn.send(("error", type(exc).__name__, str(exc)))
            return
        conn.send(("ready",))
        while True:
            request = conn.recv()
            if request is None:
                return
            try:
                result = _run_kernel(request)
            except Exception as exc:
                conn.send(("error", type(exc).__name__, str(exc)))
            else:
                conn.send(("ok", result.model_dump()))
    except (EOFError, OSError):
        return  # the parent closed its end or died


class PhsRunner:
    """One long-lived PHS worker process behind a timeout. Usable as a context manager; ``close`` ends the worker.

    Args:
        timeout_s: Seconds the worker may take to answer one request; on expiry it is killed and the call returns
            ``PhsRejected(reason="timeout")``.
        startup_timeout_s: Seconds a new worker may take to import the library and warm up before it is given up on.

    Raises:
        ValueError: If either timeout is not finite and greater than 0.
    """

    def __init__(self, timeout_s: float, *, startup_timeout_s: float = 60.0) -> None:
        for name, value in (("timeout_s", timeout_s), ("startup_timeout_s", startup_timeout_s)):
            if not (math.isfinite(value) and value > 0.0):
                raise ValueError(f"{name} must be finite and greater than 0, got {value!r}")
        self._timeout_s = timeout_s
        self._startup_timeout_s = startup_timeout_s
        self._context = multiprocessing.get_context("spawn")
        self._lock = threading.Lock()
        self._process: BaseProcess | None = None
        self._conn: _Channel | None = None
        self._closed = False

    @property
    def worker_pid(self) -> int | None:
        """Process id of the current worker, ``None`` while there is none (not started yet, killed, or closed)."""
        process = self._process
        return None if process is None else process.pid

    def run(self, inputs: PhsInputs) -> PhsOutcome:
        """Validate ``inputs``, run the kernel in the worker and guard the output.

        Invalid or out-of-window inputs return their ``PhsRejected`` without reaching the worker (which is not even
        started for them).

        Raises:
            RuntimeError: If the runner is closed.
        """
        rejected = validate_phs_inputs(inputs)
        if rejected is not None:
            return rejected
        return self.execute_unvalidated(kernel_kwargs(inputs))

    def execute_unvalidated(self, kwargs: KernelKwargs) -> PhsOutcome:
        """Send raw kernel keyword arguments to the worker, **bypassing input validation**.

        It exists for ``run``, which validates first, and for the test that proves the timeout against the real upstream
        hang. Production code calls ``run``. The output guard still applies: a ``PhsResult`` is returned only when
        ``check_phs_output`` accepts it.

        Raises:
            RuntimeError: If the runner is closed.
        """
        with self._lock:
            if self._closed:
                raise RuntimeError("PhsRunner is closed")
            outcome = self._exchange(dict(kwargs))
        if isinstance(outcome, PhsResult):
            rejected = check_phs_output(outcome)
            if rejected is not None:
                return rejected
        return outcome

    def close(self) -> None:
        """Stop the worker (politely, then by force). Idempotent; a closed runner refuses further calls."""
        with self._lock:
            self._closed = True
            if self._conn is not None and self._process is not None and self._process.is_alive():
                with contextlib.suppress(OSError):
                    self._conn.send(None)
                self._process.join(_GRACEFUL_STOP_S)
            self._discard_worker()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, traceback: TracebackType | None
    ) -> None:
        self.close()

    def _exchange(self, request: dict[str, float | str]) -> PhsOutcome:
        if self._process is not None and not self._process.is_alive():
            return self._worker_lost("the worker had already exited")
        if self._process is None:
            failed = self._start_worker()
            if failed is not None:
                return failed
        conn = self._conn
        if conn is None:  # unreachable: _start_worker either set it or returned a rejection
            raise AssertionError("PHS worker connection missing after start")
        try:
            conn.send(request)
            if not conn.poll(self._timeout_s):
                self._discard_worker()
                return PhsRejected(
                    reason="timeout", detail=f"no answer within {self._timeout_s:g} s; the worker was killed"
                )
            message: Any = conn.recv()
        except (EOFError, OSError):
            return self._worker_lost("the worker connection broke")
        return self._interpret(message)

    def _interpret(self, message: Any) -> PhsOutcome:
        match message:
            case ("ok", dict() as fields):
                return PhsResult.model_validate(fields)
            case ("error", str() as kind, str() as text) if kind in _INPUT_ERRORS:
                return PhsRejected(reason="invalid_input", detail=f"the kernel refused the input: {kind}: {text}")
            case ("error", str() as kind, str() as text):
                # State after an unexpected failure is unknown; a fresh worker is cheap next to a wrong answer.
                exit_code = self._discard_worker()
                return PhsRejected(
                    reason="worker_crashed",
                    detail=f"the kernel failed unexpectedly: {kind}: {text} (worker replaced, exit code {exit_code})",
                )
            case _:
                exit_code = self._discard_worker()
                return PhsRejected(
                    reason="worker_crashed",
                    detail=f"unexpected message from the worker: {message!r} (exit code {exit_code})",
                )

    def _start_worker(self) -> PhsRejected | None:
        """Start a worker and wait until it has warmed up; a rejection says why that did not work."""
        parent_conn, child_conn = self._context.Pipe(duplex=True)
        process = self._context.Process(target=_worker_main, args=(child_conn,), name="phs-worker", daemon=True)
        try:
            process.start()
        except OSError as exc:
            parent_conn.close()
            child_conn.close()
            return PhsRejected(reason="worker_crashed", detail=f"the worker could not be started: {exc}")
        # The parent must not keep the worker's end open, or the worker's death would never show up as end-of-file.
        child_conn.close()
        self._process, self._conn = process, parent_conn
        try:
            if not parent_conn.poll(self._startup_timeout_s):
                self._discard_worker()
                return PhsRejected(
                    reason="timeout", detail=f"the worker was not ready within {self._startup_timeout_s:g} s"
                )
            message: Any = parent_conn.recv()
        except (EOFError, OSError):
            return self._worker_lost("the worker died while starting")
        if message == ("ready",):
            return None
        exit_code = self._discard_worker()
        return PhsRejected(
            reason="worker_crashed", detail=f"the worker failed to start: {message!r} (exit code {exit_code})"
        )

    def _worker_lost(self, what: str) -> PhsRejected:
        exit_code = self._discard_worker()
        return PhsRejected(reason="worker_crashed", detail=f"{what} (exit code {exit_code})")

    def _discard_worker(self) -> int | None:
        """Kill and reap the worker and forget it; the next call starts a fresh one. Returns its exit code if known."""
        process, conn = self._process, self._conn
        self._process = self._conn = None
        if conn is not None:
            with contextlib.suppress(OSError):
                conn.close()
        if process is None:
            return None
        if process.is_alive():
            process.kill()
        process.join(_REAP_TIMEOUT_S)
        exit_code = process.exitcode
        with contextlib.suppress(ValueError):  # still running after the join: it cannot be closed, leave it to the OS
            process.close()
        return exit_code
