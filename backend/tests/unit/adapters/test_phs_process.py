import json
import math
import multiprocessing
import os
import re
import signal
import threading
import time
from collections.abc import Iterator
from typing import Any

import numpy as np
import pytest

from stellar_blaze.adapters.compute.phs_process import PhsRunner, kernel_kwargs, warm
from stellar_blaze.config import Settings
from stellar_blaze.domain.physics.phs import PhsInputs, PhsRejected, PhsResult, Posture, validate_phs_inputs
from stellar_blaze.logging import configure_logging

pytestmark = pytest.mark.unit

POSTURES: tuple[Posture, ...] = ("sitting", "standing", "crouching")
REFERENCE = PhsInputs(tdb_c=40.0, tr_c=45.0, v_ms=0.3, rh_pct=33.0, met=2.5, clo=0.5)
# A hot, heavy case on which the rectal-temperature limit is reached inside the shift (limit 41 min, not the 480 cap).
HARSH = PhsInputs(tdb_c=45.0, tr_c=60.0, v_ms=0.5, rh_pct=30.0, met=3.5, clo=0.7)
# Inputs the validator accepts that the kernel answers with a rectal temperature above 42 C (4.8.1: 46.34 C with the
# limit reached after 18 min, and 43.70 C after 29 min): strain beyond the model's range, the most severe band.
BEYOND_RANGE = [
    (PhsInputs(tdb_c=49.5, tr_c=79.5, v_ms=0.02, rh_pct=5.0, met=4.29, clo=0.11), 18.0),
    (PhsInputs(tdb_c=45.0, tr_c=80.0, v_ms=0.5, rh_pct=25.0, met=3.5, clo=0.7), 29.0),
]


@pytest.fixture(scope="module")
def runner() -> Iterator[PhsRunner]:
    """One warmed worker shared by the tests that only need answers; tests that kill a worker build their own."""
    with PhsRunner(timeout_s=60.0) as shared:
        yield shared


def _alive_worker_pids() -> set[int | None]:
    return {child.pid for child in multiprocessing.active_children()}


def _log_events(out: str, event: str) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = [json.loads(line) for line in out.splitlines() if line.strip()]
    return [line for line in lines if line["event"] == event]


def test_kernel_kwargs_use_the_documented_keyword_names() -> None:
    # pythermalcomfort 4.8.1 `phs` takes tdb, tr, v, rh, met, clo, posture; `weight` (kg) and `height` (m) travel in
    # **kwargs, documented under "Other Parameters" (Step 1 of the task).
    assert kernel_kwargs(REFERENCE) == {
        "tdb": 40.0,
        "tr": 45.0,
        "v": 0.3,
        "rh": 33.0,
        "met": 2.5,
        "clo": 0.5,
        "posture": "standing",
        "weight": 75.0,
        "height": 1.8,
    }


@pytest.mark.parametrize("timeout_s", [0.0, -1.0, math.nan, math.inf])
def test_timeout_must_be_positive_and_finite(timeout_s: float) -> None:
    with pytest.raises(ValueError, match="timeout_s"):
        PhsRunner(timeout_s=timeout_s)


def test_run_never_sends_invalid_inputs_and_does_not_even_start_a_worker() -> None:
    with PhsRunner(timeout_s=5.0) as idle:
        nan_case = idle.run(PhsInputs(tdb_c=math.nan, tr_c=45.0, v_ms=0.3, rh_pct=33.0, met=2.5, clo=0.5))
        window_case = idle.run(PhsInputs(tdb_c=52.0, tr_c=57.0, v_ms=0.3, rh_pct=20.0, met=2.5, clo=0.5))
        assert isinstance(nan_case, PhsRejected)
        assert nan_case.reason == "invalid_input"
        assert isinstance(window_case, PhsRejected)
        assert window_case.reason == "out_of_scope"
        assert idle.worker_pid is None


def test_a_closed_runner_refuses_work_and_close_is_idempotent() -> None:
    closed = PhsRunner(timeout_s=5.0)
    closed.close()
    closed.close()
    with pytest.raises(RuntimeError, match="closed"):
        closed.run(REFERENCE)


@pytest.mark.slow
@pytest.mark.parametrize(
    ("inputs", "expected"),
    [
        # pythermalcomfort 4.8.1 output (ISO 7933:2023, 480 min, acclimatized, round_output=False); a bump that
        # changes it needs review. Recorded from the library itself, so it guards regressions, not correctness.
        # (t_re_c, d_lim_t_re_min, d_lim_loss_50_min, d_lim_loss_95_min, sweat_loss_g)
        (REFERENCE, (37.50262058757168, 480.0, 283.0, 283.0, 6495.169081411674)),
        (HARSH, (41.35358201876139, 41.0, 163.0, 163.0, 11552.623640394939)),
    ],
)
def test_valid_call_returns_result(runner: PhsRunner, inputs: PhsInputs, expected: tuple[float, ...]) -> None:
    result = runner.run(inputs)
    assert isinstance(result, PhsResult), result
    assert 36.0 <= result.t_re_c <= 42.0
    actual = (
        result.t_re_c,
        result.d_lim_t_re_min,
        result.d_lim_loss_50_min,
        result.d_lim_loss_95_min,
        result.sweat_loss_g,
    )
    assert actual == pytest.approx(expected, rel=1e-6)


@pytest.mark.slow
@pytest.mark.parametrize(("inputs", "limit_minutes"), BEYOND_RANGE)
def test_a_validated_hot_input_exceeds_the_model_range_instead_of_going_missing(
    runner: PhsRunner, inputs: PhsInputs, limit_minutes: float
) -> None:
    # The most dangerous valid cases: the input is inside the applicability window, the model's rectal temperature is
    # above 42 C and the 38 C limit is minutes away. A caller must be able to tell this from missing data.
    assert validate_phs_inputs(inputs) is None
    outcome = runner.run(inputs)
    assert isinstance(outcome, PhsRejected), outcome
    assert outcome.reason == "exceeds_model_range"
    assert "never as missing data" in outcome.detail
    limit = re.search(r"limit reached after ([0-9.]+) min", outcome.detail)
    assert limit is not None, outcome.detail
    assert float(limit.group(1)) == pytest.approx(limit_minutes)
    assert float(limit.group(1)) < 60.0


@pytest.mark.slow
def test_more_heat_load_means_more_sweat_and_an_earlier_water_limit(runner: PhsRunner) -> None:
    # Physical properties, independent of the recorded golden values. Rectal temperature is deliberately NOT asserted
    # to rise with the radiant field: while sweating keeps up (compensable load) 4.8.1 gives 37.508 C at tr 41 and
    # 37.460 C at tr 60 (tdb 40, standing, 2.5 met), a slight fall; it only climbs once the sweat rate saturates
    # (40.5 C at tr 80).
    by_radiant = [runner.run(REFERENCE.model_copy(update={"tr_c": tr})) for tr in (41.0, 45.0, 55.0, 60.0)]
    by_work = [runner.run(REFERENCE.model_copy(update={"met": met})) for met in (1.5, 2.5, 3.5)]
    uncompensable = runner.run(REFERENCE.model_copy(update={"tr_c": 80.0}))
    results = [*by_radiant, *by_work, uncompensable]
    assert all(isinstance(outcome, PhsResult) for outcome in results), results
    radiant = [o for o in by_radiant if isinstance(o, PhsResult)]
    work = [o for o in by_work if isinstance(o, PhsResult)]
    for series in (radiant, work):
        sweat = [o.sweat_loss_g for o in series]
        water_limit = [o.d_lim_loss_50_min for o in series]
        assert sweat == sorted(sweat)
        assert len(set(sweat)) == len(sweat)
        assert water_limit == sorted(water_limit, reverse=True)
    assert isinstance(uncompensable, PhsResult)
    assert uncompensable.t_re_c > radiant[1].t_re_c + 1.0
    assert uncompensable.d_lim_t_re_min < 480.0  # the rectal limit is reached inside the shift only here


@pytest.mark.slow
def test_a_kernel_nan_is_caught_on_the_output_side(runner: PhsRunner) -> None:
    # 38 C at 70 % RH (4.64 kPa) is outside the vapor-pressure window, so the real kernel answers NaN. The unvalidated
    # path still runs the output guard.
    humid = PhsInputs(tdb_c=38.0, tr_c=41.0, v_ms=0.3, rh_pct=70.0, met=2.5, clo=0.5)
    assert validate_phs_inputs(humid) is not None
    outcome = runner.execute_unvalidated(kernel_kwargs(humid))
    assert isinstance(outcome, PhsRejected)
    assert outcome.reason == "nan_output"


@pytest.mark.slow
def test_an_input_the_validator_accepts_never_comes_back_nan(runner: PhsRunner) -> None:
    # The validator must describe the kernel's own applicability window, or `nan_output` stops meaning "something is
    # wrong" and starts meaning "an ordinary day": about 19 percent of the nominal ranges used to return NaN. The only
    # rejection a validated input may meet is `exceeds_model_range` (a real, very hot prediction).
    rng = np.random.default_rng(7933)
    accepted = 0
    nan_outputs: list[PhsRejected] = []
    unexpected: list[PhsRejected] = []
    for _ in range(400):
        tdb = float(rng.uniform(15.01, 49.99))
        case = PhsInputs(
            tdb_c=tdb,
            tr_c=tdb + float(rng.uniform(0.01, 59.99)),
            v_ms=float(rng.uniform(0.01, 2.99)),
            rh_pct=float(rng.uniform(0.0, 100.0)),
            met=float(rng.uniform(0.9631, 4.2991)),
            clo=float(rng.uniform(0.101, 0.999)),
            posture=POSTURES[int(rng.integers(3))],
        )
        if validate_phs_inputs(case) is not None:
            continue
        accepted += 1
        outcome = runner.run(case)
        if isinstance(outcome, PhsRejected):
            if outcome.reason == "nan_output":
                nan_outputs.append(outcome)
            if outcome.reason != "exceeds_model_range":
                unexpected.append(outcome)
    assert accepted >= 100, f"only {accepted} of 400 draws passed validation; the property is not being tested"
    assert not nan_outputs, f"{len(nan_outputs)} of {accepted} accepted inputs returned NaN: {nan_outputs[:3]}"
    assert not unexpected, f"{len(unexpected)} of {accepted} accepted inputs were rejected: {unexpected[:3]}"


@pytest.mark.slow
def test_a_kernel_exception_is_an_input_rejection_and_keeps_the_worker(runner: PhsRunner) -> None:
    assert isinstance(runner.run(REFERENCE), PhsResult)
    pid = runner.worker_pid
    outcome = runner.execute_unvalidated({**kernel_kwargs(REFERENCE), "posture": "lying"})
    assert isinstance(outcome, PhsRejected)
    assert outcome.reason == "invalid_input"
    assert "posture" in outcome.detail.lower()
    assert runner.worker_pid == pid
    assert isinstance(runner.run(REFERENCE), PhsResult)


@pytest.mark.slow
def test_real_nan_hang_is_cut_by_timeout(
    request: pytest.FixtureRequest, settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    # The upstream hang (pythermalcomfort #524) is real on 4.8.1: a NaN dry-bulb temperature never returns. No fake:
    # the worker below really spins until the parent kills it.
    configure_logging(settings)  # JSON on stdout, as in production
    with PhsRunner(timeout_s=10.0) as hang_runner:
        baseline = hang_runner.run(REFERENCE)
        assert isinstance(baseline, PhsResult), baseline
        hung_pid = hang_runner.worker_pid
        assert hung_pid is not None

        started = time.monotonic()
        outcome = hang_runner.execute_unvalidated({**kernel_kwargs(REFERENCE), "tdb": float("nan")})
        elapsed = time.monotonic() - started
        request.node.user_properties.append(("phs_hang_cut_after_s", f"{elapsed:.2f}"))

        assert isinstance(outcome, PhsRejected), outcome
        assert outcome.reason == "timeout"
        assert 9.0 <= elapsed < 30.0, f"cut after {elapsed:.1f} s"
        assert hung_pid not in _alive_worker_pids(), "the hung worker is still running"
        assert hang_runner.worker_pid is None
        killed = _log_events(capsys.readouterr().out, "phs.worker_killed_timeout")
        assert len(killed) == 1, killed
        assert killed[0]["level"] == "warning"
        assert killed[0]["pid"] == hung_pid
        assert killed[0]["timeout_s"] == 10.0

        recovered = hang_runner.run(REFERENCE)
        assert isinstance(recovered, PhsResult), recovered
        assert recovered.t_re_c == pytest.approx(baseline.t_re_c, rel=1e-9)
        assert hang_runner.worker_pid not in (None, hung_pid)


@pytest.mark.slow
def test_a_dead_worker_is_reported_and_replaced(settings: Settings, capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(settings)
    with PhsRunner(timeout_s=30.0) as crash_runner:
        assert isinstance(crash_runner.run(REFERENCE), PhsResult)
        dead_pid = crash_runner.worker_pid
        assert dead_pid is not None

        os.kill(dead_pid, signal.SIGTERM)  # an OOM-kill or a segfault looks the same to the parent

        outcome = crash_runner.run(REFERENCE)
        assert isinstance(outcome, PhsRejected), outcome
        assert outcome.reason == "worker_crashed"
        assert crash_runner.worker_pid is None
        crashed = _log_events(capsys.readouterr().out, "phs.worker_crashed")
        assert len(crashed) == 1, crashed
        assert crashed[0]["level"] == "warning"
        assert crashed[0]["pid"] == dead_pid

        recovered = crash_runner.run(REFERENCE)
        assert isinstance(recovered, PhsResult), recovered
        assert crash_runner.worker_pid not in (None, dead_pid)


@pytest.mark.slow
def test_an_exception_while_a_request_is_in_flight_drops_the_worker_and_propagates(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    # Stands in for an interrupt between send and recv (the code path is the same for any exception that is not an
    # OSError): a worker that may owe the caller a reply must not serve the next call, which would read that stale reply
    # as its own answer. An unpicklable argument makes `send` itself fail, so no real interrupt is simulated here.
    configure_logging(settings)
    unpicklable: Any = {**kernel_kwargs(REFERENCE), "tdb": threading.Lock()}
    with PhsRunner(timeout_s=30.0) as interrupted:
        baseline = interrupted.run(REFERENCE)
        assert isinstance(baseline, PhsResult), baseline
        first_pid = interrupted.worker_pid
        capsys.readouterr()

        with pytest.raises(TypeError, match="pickle"):
            interrupted.execute_unvalidated(unpicklable)

        assert interrupted.worker_pid is None
        discarded = _log_events(capsys.readouterr().out, "phs.worker_discarded_interrupted")
        assert len(discarded) == 1, discarded
        assert discarded[0]["pid"] == first_pid
        assert discarded[0]["error"] == "TypeError"

        recovered = interrupted.run(REFERENCE)
        assert isinstance(recovered, PhsResult), recovered
        assert recovered.t_re_c == pytest.approx(baseline.t_re_c, rel=1e-9)
        assert interrupted.worker_pid not in (None, first_pid)


@pytest.mark.slow
def test_warm_runs_one_valid_call_in_process() -> None:
    # Called at image build to fill NUMBA_CACHE_DIR; it must raise when the call does not give a usable result.
    warm()
