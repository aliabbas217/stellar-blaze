"""ISO 7933 predicted heat strain (PHS): the data contract and the guards that stand between callers and the kernel.

The kernel itself (``pythermalcomfort`` 4.8.1 ``phs``, a numba routine) is not called from the domain; the adapter
``adapters.compute.phs_process`` runs it in a separate process. This module is pure: it says which inputs the kernel
may be given and which outputs may be believed. Both guards exist because of how the kernel fails (ADR 0006; stack doc
section 6.3):

* a non-finite number in ``tdb``, ``tr``, ``v``, ``rh``, ``met``, ``clo``, ``weight`` or ``height`` makes it loop
  forever (upstream issues #524 and #523, reproduced on 4.8.1 for every one of those inputs);
* a zero ``height`` returns garbage (``t_re`` 0.0 on 4.8.1) or raises ``SystemError``;
* outside its applicability window it answers NaN. The window is not only the four limits quoted for the standard but
  also the water vapor pressure: the kernel's own comment cites ISO 7933 Annex A, Table A.1, and applies
  ``0.5 <= p_a <= 4.5`` kPa (2023 edition). That vapor-pressure limit, not an unexplained defect, is why about 19
  percent of samples drawn inside the other four ranges came back NaN: 38 C at 70 percent relative humidity is
  4.64 kPa, an ordinary Gulf summer reading, and PHS has no answer for it.

Window conventions. ``validate_phs_inputs`` is narrower than or equal to the kernel's, so an input it accepts is never
returned as NaN for being out of range. The kernel's limits are inclusive; ``tdb``, ``tr - tdb``, ``v`` and ``clo`` are
exclusive here, as in ADR 0006 (``15 < tdb < 50``, ``0 < tr - tdb < 60``, ``0 < v < 3``, ``0.1 < clo < 1``). The
metabolic rate is checked in W/m2 at the kernel's own 58.15 W/m2 per met: the quoted "0.96 to 4.3 met" is a rounding of
56 to 250 W/m2, and the kernel returns NaN exactly at 0.96 and at 4.3 met (it accepts 0.9630 to 4.2992).
"""

import math
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict

Posture = Literal["sitting", "standing", "crouching"]
RejectionReason = Literal[
    "invalid_input", "out_of_scope", "timeout", "nan_output", "implausible_output", "worker_crashed"
]

TDB_RANGE_C: Final = (15.0, 50.0)
"""Dry-bulb air temperature, exclusive on both ends."""
TR_MINUS_TDB_RANGE_C: Final = (0.0, 60.0)
"""Mean radiant minus dry-bulb temperature, exclusive on both ends: no radiant load (or a cooler surround) is out."""
V_RANGE_MS: Final = (0.0, 3.0)
"""Air speed, exclusive on both ends."""
CLO_RANGE: Final = (0.1, 1.0)
"""Clothing insulation, exclusive on both ends."""
MET_RANGE_W_M2: Final = (56.0, 250.0)
"""Metabolic rate per square meter of body surface in the 2023 edition, inclusive."""
KERNEL_W_M2_PER_MET: Final = 58.15
"""The factor ``pythermalcomfort`` applies to ``met``. ``metabolic.W_PER_M2_PER_MET`` is 58.2 (ASHRAE 55); the 0.09
percent difference only matters at the window edges, which must match the kernel's, so this one is kept apart."""
VAPOR_PRESSURE_RANGE_KPA: Final = (0.5, 4.5)
"""Partial water vapor pressure of the air, inclusive; the lower limit is the 2023 edition's (2004 has 0)."""
MAX_WEIGHT_KG: Final = 1000.0
"""The kernel raises ``ValueError`` above this body mass."""
T_RE_PLAUSIBLE_C: Final = (36.0, 42.0)
"""Rectal temperatures outside this range are rejected as implausible (stack doc 6.3), inclusive."""


class PhsInputs(BaseModel):
    """One PHS evaluation: the climate, the work and the worker.

    ``weight_kg`` and ``height_m`` default to the reference subject of the PHS model, 75 kg and 1.80 m (DuBois body
    surface area 1.94 m2). These are the defaults documented for ``pythermalcomfort.models.phs`` (``weight`` 75,
    ``height`` 1.8), which implements ISO 7933; the standard's own text is paywalled and was not checked.

    Non-finite values are representable on purpose: ``validate_phs_inputs`` is what turns them into a rejection, and it
    must be able to see them.

    Attributes:
        tdb_c: Dry-bulb air temperature, C.
        tr_c: Mean radiant temperature, C.
        v_ms: Air speed relative to the body, m/s.
        rh_pct: Relative humidity, percent.
        met: Metabolic rate in met (1 met is 58.15 W/m2 of body surface for the kernel); not whole-body watts.
        clo: Clothing insulation, clo.
        posture: Body posture.
        weight_kg: Body mass, kg.
        height_m: Body height, m.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    tdb_c: float
    tr_c: float
    v_ms: float
    rh_pct: float
    met: float
    clo: float
    posture: Posture = "standing"
    weight_kg: float = 75.0
    height_m: float = 1.8


class PhsResult(BaseModel):
    """What the kernel predicts for an 8-hour shift (the kernel's default duration of 480 minutes).

    The duration limits are capped at that 480-minute shift: 480.0 means "the limit is not reached during the shift",
    not "reached after 480 minutes".

    Attributes:
        t_re_c: Predicted rectal temperature at the end of the shift, C.
        d_lim_t_re_min: Minutes until the rectal-temperature limit (38 C) is reached.
        d_lim_loss_50_min: Minutes until the water-loss limit for the average worker is reached.
        d_lim_loss_95_min: Minutes until the water-loss limit for 95 percent of workers is reached.
        sweat_loss_g: Total sweat loss over the shift, grams.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    t_re_c: float
    d_lim_t_re_min: float
    d_lim_loss_50_min: float
    d_lim_loss_95_min: float
    sweat_loss_g: float


class PhsRejected(BaseModel):
    """Why there is no PHS answer: a refusal to ask, or an answer that was not believed.

    Attributes:
        reason: ``invalid_input`` (not finite, or not a possible body or clothing value), ``out_of_scope`` (outside the
            applicability window), ``timeout`` (no answer in time; the worker was killed), ``nan_output``,
            ``implausible_output`` (rectal temperature outside 36 to 42 C), ``worker_crashed`` (the worker died, would
            not start, or failed in an unexpected way).
        detail: A sentence for logs, naming the offending fields and values.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    reason: RejectionReason
    detail: str


PhsOutcome = PhsResult | PhsRejected


def _vapor_pressure_kpa(tdb_c: float, rh_pct: float) -> float:
    """Partial water vapor pressure as the 2023 kernel computes it (Magnus form); valid only for 15 < tdb < 50."""
    return 0.6105 * math.exp(17.27 * tdb_c / (tdb_c + 237.3)) * rh_pct / 100.0


def validate_phs_inputs(i: PhsInputs) -> PhsRejected | None:
    """Return why the kernel must not be called with ``i``, or ``None`` when it may.

    Non-finite values, a non-positive ``weight_kg``, ``height_m`` or ``clo``, a ``weight_kg`` the kernel refuses, or a
    relative humidity outside 0 to 100 give ``invalid_input``. A finite input outside the applicability window (see the
    module docstring) gives ``out_of_scope``; every violated limit is named.
    """
    values = {
        "tdb_c": i.tdb_c,
        "tr_c": i.tr_c,
        "v_ms": i.v_ms,
        "rh_pct": i.rh_pct,
        "met": i.met,
        "clo": i.clo,
        "weight_kg": i.weight_kg,
        "height_m": i.height_m,
    }
    non_finite = [f"{name}={value}" for name, value in values.items() if not math.isfinite(value)]
    if non_finite:
        return PhsRejected(reason="invalid_input", detail="non-finite value: " + ", ".join(non_finite))

    invalid: list[str] = []
    for name in ("weight_kg", "height_m", "clo"):
        if not values[name] > 0.0:
            invalid.append(f"{name} must be greater than 0, got {values[name]:g}")
    if i.weight_kg > MAX_WEIGHT_KG:
        invalid.append(f"weight_kg must be at most {MAX_WEIGHT_KG:g}, got {i.weight_kg:g}")
    if not 0.0 <= i.rh_pct <= 100.0:
        invalid.append(f"rh_pct must be within 0 to 100, got {i.rh_pct:g}")
    if invalid:
        return PhsRejected(reason="invalid_input", detail="; ".join(invalid))

    scope: list[str] = []
    tdb_in_range = TDB_RANGE_C[0] < i.tdb_c < TDB_RANGE_C[1]
    if not tdb_in_range:
        scope.append(f"tdb_c {i.tdb_c:g} outside {TDB_RANGE_C[0]:g} to {TDB_RANGE_C[1]:g} C (exclusive)")
    radiant_excess = i.tr_c - i.tdb_c
    if not TR_MINUS_TDB_RANGE_C[0] < radiant_excess < TR_MINUS_TDB_RANGE_C[1]:
        scope.append(
            f"tr_c - tdb_c {radiant_excess:g} outside {TR_MINUS_TDB_RANGE_C[0]:g} to {TR_MINUS_TDB_RANGE_C[1]:g} C"
            " (exclusive)"
        )
    if not V_RANGE_MS[0] < i.v_ms < V_RANGE_MS[1]:
        scope.append(f"v_ms {i.v_ms:g} outside {V_RANGE_MS[0]:g} to {V_RANGE_MS[1]:g} m/s (exclusive)")
    if not CLO_RANGE[0] < i.clo < CLO_RANGE[1]:
        scope.append(f"clo {i.clo:g} outside {CLO_RANGE[0]:g} to {CLO_RANGE[1]:g} (exclusive)")
    met_w_m2 = i.met * KERNEL_W_M2_PER_MET
    if not MET_RANGE_W_M2[0] <= met_w_m2 <= MET_RANGE_W_M2[1]:
        scope.append(f"met {i.met:g} ({met_w_m2:.1f} W/m2) outside {MET_RANGE_W_M2[0]:g} to {MET_RANGE_W_M2[1]:g} W/m2")
    if tdb_in_range:  # the formula is only defined (no division by zero, no overflow) inside the temperature window
        p_a = _vapor_pressure_kpa(i.tdb_c, i.rh_pct)
        if not VAPOR_PRESSURE_RANGE_KPA[0] <= p_a <= VAPOR_PRESSURE_RANGE_KPA[1]:
            scope.append(
                f"vapor pressure {p_a:.2f} kPa (tdb_c {i.tdb_c:g}, rh_pct {i.rh_pct:g}) outside"
                f" {VAPOR_PRESSURE_RANGE_KPA[0]:g} to {VAPOR_PRESSURE_RANGE_KPA[1]:g} kPa"
            )
    if scope:
        return PhsRejected(reason="out_of_scope", detail="; ".join(scope))
    return None


def check_phs_output(r: PhsResult) -> PhsRejected | None:
    """Return why ``r`` must not be believed, or ``None``.

    Any NaN or infinite field gives ``nan_output``; a rectal temperature outside 36 to 42 C gives
    ``implausible_output``. A validated input should never produce either (the output guard is the second line, for
    a kernel that changes under us), so a rejection here is worth a log line at warning level or above.
    """
    non_finite = [name for name, value in r.model_dump().items() if not math.isfinite(value)]
    if non_finite:
        return PhsRejected(reason="nan_output", detail="non-finite kernel output: " + ", ".join(non_finite))
    if not T_RE_PLAUSIBLE_C[0] <= r.t_re_c <= T_RE_PLAUSIBLE_C[1]:
        return PhsRejected(
            reason="implausible_output",
            detail=f"t_re_c {r.t_re_c:g} outside {T_RE_PLAUSIBLE_C[0]:g} to {T_RE_PLAUSIBLE_C[1]:g} C",
        )
    return None
