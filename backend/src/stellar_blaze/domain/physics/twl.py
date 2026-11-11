"""Thermal Work Limit (TWL): the maximum sustainable metabolic rate in W/m2, ported from an MIT-licensed reference.

TWL is the metabolic rate that a euhydrated, acclimatized worker can sustain in a given thermal environment without the
deep body temperature passing 38.2 degrees Celsius or the sweat rate passing its limit (Brake and Bates 2002, *Applied
Occupational and Environmental Hygiene* 17(3):176-186, doi:10.1080/104732202753438261). Abu Dhabi's ADOSH code keys its
controls to TWL zones (ADR 0006). This module is "aligned with ADOSH TWL zones", never "ADOSH-compliant".

Provenance. The solver is a line-by-line port of ``solve_twl_single`` and ``three_zone_evaporation``
(``R/solve_twl.R``), the wind-height correction and the withdrawal limits of ``generate_twl`` (``R/generate_twl.R``),
and the constants of ``R/constants.R`` and ``R/psychrometrics.R`` of the R package ``vorpalvorpal/meteoHazard`` 0.4.0 at
commit ``5633d5719225d15d84f2608189e2b3d654dba73d``, which is MIT-licensed (see ``backend/THIRD_PARTY_NOTICES.md``). The
equation citations in the comments (ASHRAE Fundamentals Ch. 8, EESAM equation numbers, Brake and Bates Appendix 1) are
the reference's own; the primary papers were not available to us, so the port is verified against published values
rather than against the equations (ADR 0006 revisit trigger: obtain Brake and Bates 2002 Appendix 1).

Inputs and units. Temperatures are in degrees Celsius, pressures in kPa, wind in m/s and the result in W/m2. The wind is
the wind at body height (about 1 m): convert a 10 m forecast wind with ``body_level_wind_ms``. The mean radiant
temperature comes from the caller (B3 derives it from radiation). The vapor pressure comes from the dew point
(``psychrometrics.vapor_pressure_kpa_from_dewpoint``); the wet bulb and the globe temperature are not inputs, as in the
reference, whose solver accepts them and ignores them. Callers screen raw data for plausibility first (see
``psychrometrics``). A non-finite input gives NaN ("unavailable"); a finite but impossible one (negative wind, pressure
not above zero, a dew point whose vapor pressure is not below the air pressure) raises ``ValueError``.

Measured bias against the published values, which is safety-relevant. The 11 climatic-chamber sessions of Miller and
Bates (2007, *Ann Occup Hyg* 51(6):553-561) Table 2 (0.12 clo, vapor permeability 0.45, 101.3 kPa, MRT equal to the dry
bulb, wet bulb converted with the WMO psychrometer equation) give, on 2026-11-11 with this module
(``tests/unit/physics/test_twl.py``, computed minus published, W/m2; the last column is the independent scratch port of
the fixture, computed minus scratch):

    session  published    port  port - published  scratch  port - scratch
          1        154  160.18            +6.18    160.2           -0.02
          2        156  162.85            +6.85    162.9           -0.05
          3        160  165.62            +5.62    165.6           +0.02
          4        160  166.28            +6.28    166.3           -0.02
          5        198  201.88            +3.88    201.9           -0.02
          6        159  165.96            +6.96    166.0           -0.04
          7        172  178.74            +6.74    178.7           +0.04
          8        168  174.64            +6.64    174.6           +0.04
          9        164  170.45            +6.45    170.5           -0.05
         10        162  168.90            +6.90    168.9           -0.00
         11        156  162.10            +6.10    162.1           +0.00
       mean                               +6.24                    -0.01
      range                          +3.88..+6.96             -0.05..+0.04

A higher TWL is less protective, and the ADOSH zone edges are 25 W/m2 apart, so readings within about 7 W/m2 above 115
or 140 may sit in the wrong zone; B3 decides how to handle that band (ADR 0006). The port was not fitted to these data:
the 0.45 permeability is the reference default.

Table 2 reaches only the fully wet skin branch of the evaporation model. The 62 rows of Brake and Bates (2002) Table 1
and the two worked examples, as transcribed in the reference's own regression test (not checked by us against the
paper), reach the partial-dripping branch and the sweat-rate limit. The port reproduces all 64 within the reference's
tolerances (5 W/m2; 14 W/m2 for four extreme low-humidity rows; 8 W/m2 for one worked example). Residuals there run
from -13.0 to +4.6 W/m2 with mean -0.4. Unlike the chamber sessions, on the driest rows of set 3 (wet bulb 24 C) the
port reads 1 to 13 W/m2 below the published values, which is the more protective direction.

The TWL returned is clamped to [60, 380] W/m2, the reference's floor and ceiling (the reference says the ceiling is the
top of the published Brake and Bates regime chart). The reference also caps TWL at 115 W/m2 in two hot cases; that is
kept apart in ``apply_withdrawal_limits`` because its primary source is not verified.
"""

import math
from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import ArrayLike

from stellar_blaze.domain.physics.psychrometrics import (
    saturation_vapor_pressure_kpa,
    vapor_pressure_kpa_from_dewpoint,
)
from stellar_blaze.domain.physics.types import F64

TWL_FLOOR_W_M2: Final = 60.0
"""Lower clamp of the returned TWL (reference ``TWL_CONSTANTS$TWL_FLOOR``); also the result for a degenerate bracket."""

TWL_CEILING_W_M2: Final = 380.0
"""Upper clamp of the returned TWL (reference ``TWL_CONSTANTS$TWL_CEILING``)."""

# Wind at body level is limited to the range recommended by Brake and Bates (generate_twl.R, "constrained to 0.2--4.0").
_BODY_WIND_MIN_MS: Final = 0.2
_BODY_WIND_MAX_MS: Final = 4.0

# Bisection on skin temperature (solve_twl.R): at most 200 steps, stop when the heat balance is below 0.01 W/m2.
_MAX_ITERATIONS: Final = 200
_BALANCE_TOLERANCE_W_M2: Final = 0.01

# Three-zone evaporation model (solve_twl.R three_zone_evaporation; Brake and Bates 2002 Appendix 1, Figure 3).
_ZONE_A_UPPER: Final = 0.46  # x below this: no dripping, all sweat evaporates
_ZONE_C_LOWER: Final = 1.7  # x above this: fully wet skin, E = Emax


@dataclass(frozen=True, slots=True)
class TwlParams:
    """Model parameters of the TWL heat balance; the defaults are the reference's at the pinned commit.

    These are the model, not policy: published vectors pin them, so they live in code and not in the ruleset
    (ADR 0009 section 1).

    Attributes:
        clothing_clo: Intrinsic clothing thermal insulation in clo (``Icl``).
        vapor_permeability: Clothing vapor permeation efficiency, in (0, 1] (``icl``).
        max_core_temp_c: Limiting deep body core temperature in degrees Celsius.
        max_sweat_rate_kg_m2_h: Limiting sweat rate in kg/(m2 h).
        lewis_relation_k_per_kpa: Lewis relation in K/kPa (``LR``).
        latent_heat_kj_kg: Latent heat of evaporation of sweat at skin temperature in kJ/kg (ASHRAE Eq. 14 at 30 C).
    """

    clothing_clo: float = 0.6
    vapor_permeability: float = 0.45
    max_core_temp_c: float = 38.2
    max_sweat_rate_kg_m2_h: float = 0.67
    lewis_relation_k_per_kpa: float = 16.5
    latent_heat_kj_kg: float = 2430.0

    def __post_init__(self) -> None:
        if not (math.isfinite(self.clothing_clo) and self.clothing_clo >= 0.0):
            raise ValueError(f"clothing_clo must be finite and not negative, got {self.clothing_clo!r}")
        if not (math.isfinite(self.vapor_permeability) and 0.0 < self.vapor_permeability <= 1.0):
            raise ValueError(f"vapor_permeability must be in (0, 1], got {self.vapor_permeability!r}")
        if not math.isfinite(self.max_core_temp_c):
            raise ValueError(f"max_core_temp_c must be finite, got {self.max_core_temp_c!r}")
        for name in ("max_sweat_rate_kg_m2_h", "lewis_relation_k_per_kpa", "latent_heat_kj_kg"):
            value: float = getattr(self, name)
            if not (math.isfinite(value) and value > 0.0):
                raise ValueError(f"{name} must be finite and greater than 0, got {value!r}")


@dataclass(frozen=True, slots=True)
class WithdrawalLimits:
    """The reference's two "withdrawal limits" on TWL: a cap that applies in very hot conditions.

    The values are the reference's. Under ADR 0009 the ruleset's ``[twl_withdrawal]`` section carries the operative
    values and the ``enabled`` switch, and B3 builds this dataclass from it.

    Attributes:
        dry_bulb_c: Dry-bulb temperature above which TWL is capped, in degrees Celsius.
        natural_wet_bulb_c: Natural wet-bulb temperature above which TWL is capped, in degrees Celsius.
        cap_w_m2: The cap, in W/m2.
    """

    dry_bulb_c: float = 44.0
    natural_wet_bulb_c: float = 32.0
    cap_w_m2: float = 115.0


# A frozen dataclass is safe as a default argument value; one shared instance also keeps ruff B008 quiet.
_DEFAULT_PARAMS: Final = TwlParams()
_DEFAULT_LIMITS: Final = WithdrawalLimits()


def _three_zone_evaporation_w_m2(sweat_supply_w_m2: float, max_evaporation_w_m2: float) -> float:
    """Actual evaporation rate ``E`` from the sweat supply and the evaporative capacity (``three_zone_evaporation``).

    With ``x = sweat supply / Emax`` (Brake and Bates 2002, Appendix 1, Figure 3):

    * Zone A, ``x < 0.46``: no dripping, ``E = sweat supply``.
    * Zone B, ``0.46 <= x <= 1.7``: partial dripping, ``E = supply * exp(-0.4127 * (x - 0.46) ** 1.168)``.
    * Zone C, ``x > 1.7``: fully wet skin, ``E = Emax``.

    The reference notes that the published Zone B formula reads ``1.8x - 0.46`` and that ``x - 0.46`` is the continuous
    form (it matches the zones at ``x = 0.46`` and ``x = 1.7``: ``exp(-0.4127 * 1.24 ** 1.168) * 1.7 = 1.0001``); the
    port uses ``x - 0.46``.
    """
    if max_evaporation_w_m2 <= 0.0:
        return 0.0
    x = sweat_supply_w_m2 / max_evaporation_w_m2
    if x < _ZONE_A_UPPER:
        evaporation = sweat_supply_w_m2
    elif x <= _ZONE_C_LOWER:
        evaporation = sweat_supply_w_m2 * math.exp(-0.4127 * (x - _ZONE_A_UPPER) ** 1.168)
    else:
        evaporation = max_evaporation_w_m2
    return max(0.0, evaporation)


def _solve_twl_w_m2(
    *, t_c: float, td_c: float, wind_ms: float, pressure_kpa: float, mrt_c: float, pa_kpa: float, params: TwlParams
) -> float:
    """``solve_twl_single``: bisection on the mean skin temperature, then the metabolic rate at the balance point.

    The skin temperature at which the heat flow from the core to the skin ``H`` equals the heat lost from the skin
    to the environment ``C + R + E`` is unique if the balance is monotone on ``[dew point + 1, core - 0.5]`` (the
    reference's "bracketing assumption"). At that steady state the metabolic rate ``M = H + B`` (``B`` = respiratory
    loss) is the TWL. Returns the unclamped value, or the floor when the bracket is degenerate. When the root is not
    bracketed (extreme heat and humidity) the result is the best-residual iterate, as in the reference; its diagnostic
    warning is not ported because no numerics depend on it.
    """
    t_core = params.max_core_temp_c
    lewis = params.lewis_relation_k_per_kpa

    # Clothing parameters [ASHRAE Fundamentals Ch. 8].
    r_cl = 0.155 * params.clothing_clo  # thermal resistance, (m2 K)/W [ASHRAE Eq. 41]
    f_cl = 1.0 + 0.31 * params.clothing_clo  # clothing area factor [ASHRAE Eq. 47]
    r_e_cl = r_cl / (lewis * params.vapor_permeability)  # evaporative resistance [ASHRAE Table II]

    # Convective heat transfer coefficient [EESAM Eq. 13]: hc = 0.608 * P ** 0.6 * V ** 0.6, in W/(m2 K).
    hc = 0.608 * pressure_kpa**0.6 * wind_ms**0.6

    # Evaporative heat transfer coefficient [EESAM Eq. 17]: he = 1587 * hc * P / (P - pa) ** 2, in W/(m2 kPa). The
    # reference uses this exact form: the Lewis-relation approximation LR * hc holds only when pa << P.
    he = 1587.0 * hc * pressure_kpa / (pressure_kpa - pa_kpa) ** 2

    def components(t_skin: float) -> tuple[float, float, float, float]:
        """The balance ``H - (C + R + E)`` and its parts ``H``, ``C + R`` and ``E`` at one skin temperature."""
        # Radiant heat transfer coefficient, which depends on the iterated skin temperature [EESAM Eq. 9]:
        # hr = 4.61 * (1 + (trad + t_skin) / 546) ** 3, in W/(m2 K); h = hr + hc [ASHRAE Eq. 9].
        hr = 4.61 * (1.0 + (mrt_c + t_skin) / 546.0) ** 3
        h = hr + hc

        # Operative temperature [ASHRAE Eq. 8].
        t_operative = (hr * mrt_c + hc * t_c) / h

        # Clothing correction factors. Fcle: sensible heat [ASHRAE Table II, Sensible Heat Flow, last equation];
        # Fpcl: evaporative heat [ASHRAE Table II, Evaporative Heat Flow, last equation].
        f_cle = f_cl / (1.0 + f_cl * h * r_cl)
        f_pcl = 1.0 / (1.0 + f_cl * he * r_e_cl)

        # Sensible heat loss from the skin, C + R [ASHRAE Table III, third equation].
        sensible = f_cle * h * (t_skin - t_operative)

        # Maximum evaporative capacity from fully wet skin (w = 1), with ps the saturation vapor pressure at the skin
        # temperature [ASHRAE Table III, Evaporative, third equation]: Emax = Fpcl * fcl * he * (ps - pa).
        ps = float(saturation_vapor_pressure_kpa(t_skin))
        e_max = max(0.0, f_pcl * f_cl * he * (ps - pa_kpa))

        # Thermoregulatory signal [Cabanac]: tz = 0.1 * t_skin + 0.9 * t_core.
        tz = 0.1 * t_skin + 0.9 * t_core

        # Physiological conductance from Wyndham's data [Figure 1 fit]: Kcs = 84 + 72 * tanh(1.3 * (tz - 37.9)).
        k_cs = 84.0 + 72.0 * math.tanh(1.3 * (tz - 37.9))

        # Heat flow from the core to the skin [EESAM Eq. 23]: H = Kcs * (t_core - t_skin).
        heat_from_core = max(0.0, k_cs * (t_core - t_skin))

        # Sweat rate from Wyndham's data [Figure 2 fit]: Sr = 0.42 + 0.44 * tanh(1.16 * (tz - 37.4)), kg/(m2 h),
        # limited to the maximum sweat rate; lambda * Sr / 3.6 converts kJ/kg * kg/(m2 h) to W/m2.
        sweat_rate = max(0.0, min(params.max_sweat_rate_kg_m2_h, 0.42 + 0.44 * math.tanh(1.16 * (tz - 37.4))))
        sweat_supply = params.latent_heat_kj_kg * sweat_rate / 3.6

        evaporation = _three_zone_evaporation_w_m2(sweat_supply, e_max)

        # balance > 0: the core supplies more heat than the skin loses, so the skin temperature should rise.
        return heat_from_core - (sensible + evaporation), heat_from_core, sensible, evaporation

    # Starting bracket: dew point + 1 C to core - 0.5 C. If the dew point is so high that the bracket is degenerate
    # (humidity near the skin temperature) the reference returns the floor.
    t_skin_min = td_c + 1.0
    t_skin_max = t_core - 0.5
    if t_skin_min >= t_skin_max:
        return TWL_FLOOR_W_M2

    t_skin = 0.5 * (t_skin_min + t_skin_max)
    best_t_skin = t_skin
    best_balance = math.inf
    for _ in range(_MAX_ITERATIONS):
        balance = components(t_skin)[0]
        if abs(balance) < best_balance:
            best_balance = abs(balance)
            best_t_skin = t_skin
        if abs(balance) < _BALANCE_TOLERANCE_W_M2:
            break

        # Bisection update: keep the bracket tight.
        if balance > 0.0:
            t_skin_min = t_skin
        else:
            t_skin_max = t_skin
        t_skin = 0.5 * (t_skin_min + t_skin_max)

        # Safety clamp of the bracket, as in the reference.
        t_skin_min = max(t_skin_min, td_c + 1.0)
        t_skin_max = min(t_skin_max, t_core - 0.1)
        if t_skin_min >= t_skin_max:
            break

    # The metabolic rate at the best skin temperature. The reference uses the mean of H and (C + R + E) as the heat
    # throughput, to avoid a systematic bias from imperfect convergence.
    _, heat_from_core, sensible, evaporation = components(best_t_skin)
    heat_throughput = 0.5 * (heat_from_core + sensible + evaporation)

    # Respiratory loss B = 0.0014 * M * (34 - ta) + 0.0173 * M * (5.87 - pa) [ASHRAE Eq. 26], so that
    # M * (1 - resp_coeff) = H and M = H / (1 - resp_coeff); the coefficient is clamped to [0, 0.5].
    resp_coeff = 0.0014 * (34.0 - t_c) + 0.0173 * (5.87 - pa_kpa)
    resp_coeff = max(0.0, min(0.5, resp_coeff))
    return max(TWL_FLOOR_W_M2, heat_throughput / (1.0 - resp_coeff))


def twl_w_m2(
    *,
    t_c: float,
    td_c: float,
    wind_body_ms: float,
    pressure_kpa: float,
    mrt_c: float,
    params: TwlParams = _DEFAULT_PARAMS,
) -> float:
    """Thermal Work Limit in W/m2 for one set of conditions, clamped to [60, 380]. NaN if any input is not finite.

    A scalar port of ``solve_twl_single`` with ``three_zone_evaporation`` (see the module docstring); the vapor
    pressure is the saturation vapor pressure at the dew point.

    Args:
        t_c: Dry-bulb air temperature in degrees Celsius.
        td_c: Dew-point temperature in degrees Celsius.
        wind_body_ms: Wind speed at body height in m/s (see ``body_level_wind_ms``).
        pressure_kpa: Air pressure in kPa.
        mrt_c: Mean radiant temperature in degrees Celsius.
        params: Model parameters; the defaults are the reference's.

    Raises:
        ValueError: If ``wind_body_ms`` is negative, ``pressure_kpa`` is not above zero, or the vapor pressure at
            the dew point is not below ``pressure_kpa``.
    """
    if not all(math.isfinite(v) for v in (t_c, td_c, wind_body_ms, pressure_kpa, mrt_c)):
        return math.nan
    if wind_body_ms < 0.0:
        raise ValueError(f"wind_body_ms must not be negative, got {wind_body_ms!r}")
    if pressure_kpa <= 0.0:
        raise ValueError(f"pressure_kpa must be greater than 0, got {pressure_kpa!r}")
    pa_kpa = float(vapor_pressure_kpa_from_dewpoint(td_c))
    if pa_kpa >= pressure_kpa:
        raise ValueError(
            f"the vapor pressure at the dew point ({pa_kpa:.3f} kPa) must be below the air pressure "
            f"({pressure_kpa} kPa)"
        )
    twl = _solve_twl_w_m2(
        t_c=t_c, td_c=td_c, wind_ms=wind_body_ms, pressure_kpa=pressure_kpa, mrt_c=mrt_c, pa_kpa=pa_kpa, params=params
    )
    if not math.isfinite(twl):
        return math.nan
    return min(twl, TWL_CEILING_W_M2)


def twl_w_m2_array(
    *,
    t_c: ArrayLike,
    td_c: ArrayLike,
    wind_body_ms: ArrayLike,
    pressure_kpa: ArrayLike,
    mrt_c: ArrayLike,
    params: TwlParams = _DEFAULT_PARAMS,
) -> F64:
    """``twl_w_m2`` over arrays: the arguments broadcast against each other and the result has the broadcast shape.

    It loops over the scalar solver, which is a bisection per element. A scalar input everywhere gives a
    zero-dimensional array, as in ``psychrometrics``. NaN in an element gives NaN in that element; an impossible value
    raises ``ValueError`` as in ``twl_w_m2``.
    """
    t, td, wind, pressure, mrt = np.broadcast_arrays(
        *(np.asarray(a, dtype=np.float64) for a in (t_c, td_c, wind_body_ms, pressure_kpa, mrt_c))
    )
    values = [
        twl_w_m2(
            t_c=float(t_i),
            td_c=float(td_i),
            wind_body_ms=float(wind_i),
            pressure_kpa=float(pressure_i),
            mrt_c=float(mrt_i),
            params=params,
        )
        for t_i, td_i, wind_i, pressure_i, mrt_i in zip(
            t.ravel(), td.ravel(), wind.ravel(), pressure.ravel(), mrt.ravel(), strict=True
        )
    ]
    return np.asarray(values, dtype=np.float64).reshape(t.shape)


def body_level_wind_ms(wind_ms: ArrayLike, height_m: float = 10.0, z0_m: float = 0.01) -> F64:
    """Wind at body height (1 m) from wind measured at ``height_m``, by the log profile, limited to [0.2, 4.0] m/s.

    ``v_1m = v * ln(1 / z0) / ln(height / z0)`` with the roughness length ``z0`` of open terrain (0.01 m): the factor is
    about 0.667 for a 10 m forecast wind and about 0.869 for a 2 m mast (``generate_twl.R``). The result is then clipped
    to 0.2-4.0 m/s, the range recommended by Brake and Bates. Passing a 10 m wind to ``twl_w_m2`` unconverted overstates
    wind cooling and so TWL. NaN in gives NaN out.

    Args:
        wind_ms: Wind speed in m/s measured at ``height_m`` (a scalar or an array).
        height_m: Measurement height in m; must be above ``z0_m``.
        z0_m: Aerodynamic roughness length in m; must be above 0.

    Raises:
        ValueError: If ``z0_m`` is not above 0, ``height_m`` is not above ``z0_m``, or any wind speed is negative.
    """
    if not (math.isfinite(z0_m) and z0_m > 0.0):
        raise ValueError(f"z0_m must be finite and greater than 0, got {z0_m!r}")
    if not (math.isfinite(height_m) and height_m > z0_m):
        raise ValueError(f"height_m must be finite and greater than z0_m ({z0_m}), got {height_m!r}")
    wind = np.asarray(wind_ms, dtype=np.float64)
    if np.any(wind < 0.0):
        raise ValueError(f"wind_ms must not be negative, first offending value: {wind[wind < 0.0].flat[0]!r}")
    factor = math.log(1.0 / z0_m) / math.log(height_m / z0_m)
    return np.asarray(np.clip(wind * factor, _BODY_WIND_MIN_MS, _BODY_WIND_MAX_MS), dtype=np.float64)


def apply_withdrawal_limits(
    twl: ArrayLike,
    *,
    t_c: ArrayLike,
    natural_wet_bulb_c: ArrayLike | None,
    limits: WithdrawalLimits = _DEFAULT_LIMITS,
) -> F64:
    """Cap TWL at ``limits.cap_w_m2`` when the dry bulb or the natural wet bulb exceeds its limit.

    Ported from meteoHazard; primary source not verified; B3 decides whether to apply (ADR 0006). With the reference's
    values TWL is capped at 115 W/m2 when the dry bulb is above 44 C or the natural wet bulb is above 32 C. Both
    comparisons are strict, as in ``generate_twl.R``. The cap only lowers a TWL, never raises it. A missing
    (``None`` or NaN) wet bulb applies no wet-bulb cap, and a NaN TWL stays NaN. The arguments broadcast against each
    other.

    Args:
        twl: TWL in W/m2 (a scalar or an array).
        t_c: Dry-bulb temperature in degrees Celsius.
        natural_wet_bulb_c: Natural wet-bulb temperature in degrees Celsius, or ``None`` if there is none.
        limits: The limits and the cap; the defaults are the reference's.
    """
    twl_arr = np.asarray(twl, dtype=np.float64)
    capped = np.asarray(t_c, dtype=np.float64) > limits.dry_bulb_c
    if natural_wet_bulb_c is not None:
        capped = capped | (np.asarray(natural_wet_bulb_c, dtype=np.float64) > limits.natural_wet_bulb_c)
    return np.asarray(np.where(capped, np.minimum(twl_arr, limits.cap_w_m2), twl_arr), dtype=np.float64)
