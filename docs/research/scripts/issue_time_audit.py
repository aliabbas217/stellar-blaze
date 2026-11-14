"""Audit which IFS run feeds Open-Meteo's ``temperature_2m_previous_day1`` / ``_previous_day2`` (B2 Task 2).

Pre-registration section 0.1 says that ``previous_day1`` may come from a run published after 18:00 GST on day D-1.
This script measures it for OMAA on the valid dates 2025-07-10 .. 2025-07-12 (hours 02-15 UTC): it fetches the
Previous Runs series and the Single Runs API forecast of every 00/06/12/18 UTC init of the two preceding days, and for
every valid hour names the init(s) whose value equals the ``previous_dayN`` value (tolerance 0.05 degrees C).

Hard limits, enforced in code: at most ``MAX_DATA_CALLS`` data calls, and no request for a date in 2026 (the 2026
hold-out). TLS is httpx2's default (verification on). A 429 is backed off once, then the run stops.

Run (writes raw bodies and ``manifest.json`` to ``--out``; ``--offline`` re-analyzes the saved bodies, no network)::

    cd backend && UV_PYTHON=3.13.15 uv run --frozen python ../docs/research/scripts/issue_time_audit.py
"""

import argparse
import hashlib
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import httpx2

PREVIOUS_RUNS_URL: Final = "https://previous-runs-api.open-meteo.com/v1/forecast"
SINGLE_RUNS_URL: Final = "https://single-runs-api.open-meteo.com/v1/forecast"
LAT: Final = "24.4330"  # OMAA, as backend/src/stellar_blaze/domain/weather/stations.py (4 decimals)
LON: Final = "54.6511"
VALID_DATES: Final = (date(2025, 7, 10), date(2025, 7, 12))
VALID_HOURS_UTC: Final = range(2, 16)  # 02..15 UTC inclusive
RUN_HOURS: Final = (0, 6, 12, 18)
MAX_DATA_CALLS: Final = 30
TOLERANCE_C: Final = 0.05
PACE_S: Final = 6.0  # B1's open_meteo_request_interval_s
BACKOFF_429_S: Final = 90.0
TIMEOUT_S: Final = 90.0
CUTOFF_UTC_HOUR: Final = 14  # 18:00 GST on D-1 is 14:00 UTC on D-1
HOLDOUT_YEAR: Final = 2026

# ECMWF dissemination schedule (Set I, oper fc, steps 0 to 90 by 1), UTC, as read from
# https://confluence.ecmwf.int/display/DAC/Dissemination+schedule on 2026-11-14 (page last updated 2026-10-07):
# init hour -> (first step starts, step 90 starts), each as (hour, minute, day offset from the init day).
SET_I_STEPS_0_90: Final = {
    0: ((5, 45, 0), (6, 12, 0)),
    6: ((11, 45, 0), (12, 12, 0)),
    12: ((17, 45, 0), (18, 12, 0)),
    18: ((23, 45, 0), (0, 12, 1)),
}
# Same page, last step of the run (steps 93-144 by 3, then 150-360 by 6 on the 00z/12z runs only).
SET_I_LAST_STEP: Final = {0: (7, 34, 0), 6: (12, 27, 0), 12: (19, 34, 0), 18: (0, 27, 1)}


@dataclass(slots=True)
class Call:
    """One data call: what was asked, what came back, and the hash of the raw body."""

    index: int
    kind: str  # "previous_runs" | "single_run"
    model: str
    run: str | None
    url: str
    status: int | None
    sha256: str | None
    body_file: str | None
    error: str | None = None


@dataclass(slots=True)
class Audit:
    """The calls made so far, with the budget and hold-out guards."""

    out: Path
    calls: list[Call] = field(default_factory=list)
    stopped: str | None = None

    def __post_init__(self) -> None:
        """Resume: calls recorded by an earlier invocation count against the budget and are not repeated."""
        manifest = self.out / "manifest.json"
        if manifest.exists():
            self.calls = [Call(**c) for c in json.loads(manifest.read_text(encoding="utf-8"))["calls"]]

    def done(self, kind: str, model: str, run: datetime | None) -> Call | None:
        """The earlier call that already answered this request (200, or 400 'run is not available'), if any."""
        stamp = None if run is None else run.strftime("%Y-%m-%dT%H:%M")
        for call in self.calls:
            if (call.kind, call.model, call.run) != (kind, model, stamp):
                continue
            if call.status == 200 or (call.status == 400 and "not available" in (call.error or "")):
                return call
        return None

    def fetch(self, client: httpx2.Client, kind: str, model: str, run: datetime | None, hourly: str) -> Call:
        """Make one data call (guarded) and persist its raw body.

        Raises:
            RuntimeError: The budget is spent, a 2026 date is requested, or a 429 persisted after one back-off.
        """
        if (earlier := self.done(kind, model, run)) is not None:
            return earlier
        if len(self.calls) >= MAX_DATA_CALLS:
            raise RuntimeError(f"data-call budget of {MAX_DATA_CALLS} is spent")
        params = {"latitude": LAT, "longitude": LON, "models": model, "timezone": "UTC", "hourly": hourly}
        if run is None:  # Previous Runs: a date window
            params["start_date"] = VALID_DATES[0].isoformat()
            params["end_date"] = VALID_DATES[1].isoformat()
        else:  # Single Runs rejects start_date/end_date ("Parameter 'start_date' must not be set"): the run decides
            params["run"] = run.strftime("%Y-%m-%dT%H:%M")
        for value in (params.get("start_date", "2025"), params.get("end_date", "2025"), params.get("run", "2025")):
            if int(value[:4]) >= HOLDOUT_YEAR:
                raise RuntimeError(f"refusing a request for {value}: 2026 is the hold-out")
        url = PREVIOUS_RUNS_URL if kind == "previous_runs" else SINGLE_RUNS_URL
        index = len(self.calls) + 1
        response = self._get(client, url, params)
        full_url = str(response.url)
        body = response.content
        name = f"call{index:02d}_{kind}_{model}_{params.get('run', 'series').replace(':', '')}.json"
        (self.out / name).write_bytes(body)
        call = Call(
            index=index,
            kind=kind,
            model=model,
            run=params.get("run"),
            url=full_url,
            status=response.status_code,
            sha256=hashlib.sha256(body).hexdigest(),
            body_file=name,
            error=None if response.status_code == 200 else body[:300].decode("utf-8", errors="replace"),
        )
        self.calls.append(call)
        return call

    def _get(self, client: httpx2.Client, url: str, params: dict[str, str]) -> httpx2.Response:
        time.sleep(PACE_S)
        response = client.get(url, params=params)
        if response.status_code == 429:
            time.sleep(BACKOFF_429_S)  # one back-off, never a loop
            response = client.get(url, params=params)
            if response.status_code == 429:
                self.stopped = "429 persisted after one back-off"
                raise RuntimeError(self.stopped)
        return response

    def save_manifest(self) -> None:
        (self.out / "manifest.json").write_text(
            json.dumps({"calls": [asdict(c) for c in self.calls], "stopped": self.stopped}, indent=2), encoding="utf-8"
        )


def _series(body: bytes, name: str) -> dict[datetime, float | None]:
    data = json.loads(body)
    times = [datetime.fromisoformat(t).replace(tzinfo=UTC) for t in data["hourly"]["time"]]
    return dict(zip(times, data["hourly"][name], strict=True))


def _runs() -> list[datetime]:
    """Every 00/06/12/18 UTC init of the two days before each valid date (2025-07-08 .. 2025-07-11)."""
    first = datetime.combine(VALID_DATES[0] - timedelta(days=2), datetime.min.time(), tzinfo=UTC)
    last_day = VALID_DATES[1] - timedelta(days=1)
    runs: list[datetime] = []
    day = first
    while day.date() <= last_day:
        runs.extend(day + timedelta(hours=h) for h in RUN_HOURS)
        day += timedelta(days=1)
    return runs


def _clock(day: date, spec: tuple[int, int, int]) -> datetime:
    hour, minute, offset = spec
    return datetime.combine(day + timedelta(days=offset), datetime.min.time(), tzinfo=UTC) + timedelta(
        hours=hour, minutes=minute
    )


def last_step_published(init: datetime) -> datetime:
    """When the last step of the run reaches a Set I customer (the conservative 'run is complete' time)."""
    return _clock(init.date(), SET_I_LAST_STEP[init.hour])


def step90_published(init: datetime) -> datetime:
    """When step 90 (end of the hourly block that holds every 24-48 h value) starts transferring."""
    return _clock(init.date(), SET_I_STEPS_0_90[init.hour][1])


def analyze(
    prev: dict[str, dict[datetime, float | None]], singles: dict[datetime, dict[datetime, float | None]]
) -> dict[str, Any]:
    """For every valid hour and lead, the matching inits and whether each was published by 18:00 GST on D-1."""
    rows: list[dict[str, Any]] = []
    for day_offset in range((VALID_DATES[1] - VALID_DATES[0]).days + 1):
        day = VALID_DATES[0] + timedelta(days=day_offset)
        cutoff = datetime.combine(day - timedelta(days=1), datetime.min.time(), tzinfo=UTC) + timedelta(
            hours=CUTOFF_UTC_HOUR
        )
        for hour in VALID_HOURS_UTC:
            valid = datetime.combine(day, datetime.min.time(), tzinfo=UTC) + timedelta(hours=hour)
            for lead in (1, 2):
                value = prev[f"temperature_2m_previous_day{lead}"].get(valid)
                matches: list[dict[str, Any]] = []
                for init, series in singles.items():
                    other = series.get(valid)
                    if value is not None and other is not None and abs(other - value) <= TOLERANCE_C + 1e-9:
                        done = last_step_published(init)
                        matches.append(
                            {
                                "init": init.strftime("%Y-%m-%dT%H:%MZ"),
                                "lead_h": int((valid - init).total_seconds() // 3600),
                                "last_step_published": done.strftime("%Y-%m-%dT%H:%MZ"),
                                "by_cutoff": done <= cutoff,
                            }
                        )
                rows.append(
                    {
                        "valid": valid.strftime("%Y-%m-%dT%H:%MZ"),
                        "lead": lead,
                        "value": value,
                        "n_matches": len(matches),
                        "matches": matches,
                        "cutoff": cutoff.strftime("%Y-%m-%dT%H:%MZ"),
                    }
                )
    return {"rows": rows}


def _fetch_all(audit: Audit) -> None:
    """The adaptive plan, per model: previous-runs series, Single Runs probes, the rest if a probe reaches 2025.

    ``ecmwf_ifs025`` is the model B1 uses; ``ecmwf_ifs`` (9 km HRES) is the fallback proxy if ifs025 is unreachable.
    Up to four distinct inits are probed per model (multi-case), stopping at the first that answers.
    """
    hourly = "temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day2"
    runs = _runs()
    probes = [datetime(2025, 7, 9, 12, tzinfo=UTC), runs[0], datetime(2025, 7, 10, 0, tzinfo=UTC), runs[-1]]
    with httpx2.Client(timeout=TIMEOUT_S, headers={"User-Agent": "stellar-blaze-research/1.0"}) as client:
        for model in ("ecmwf_ifs025", "ecmwf_ifs"):
            audit.fetch(client, "previous_runs", model, None, hourly)
            reached = False
            for probe_run in probes:
                probe = audit.fetch(client, "single_run", model, probe_run, "temperature_2m")
                print(f"{model}: Single Runs run={probe_run:%Y-%m-%dT%H:%M} -> {probe.status} {probe.error or 'ok'}")
                if probe.status == 200:
                    reached = True
                    break
            if reached:
                for run in runs:
                    audit.fetch(client, "single_run", model, run, "temperature_2m")
                return


def _load(
    out: Path, prev_model: str, singles_model: str
) -> tuple[dict[str, dict[datetime, float | None]], dict[datetime, dict[datetime, float | None]]]:
    """The previous-day series of ``prev_model`` and the Single Runs series of ``singles_model`` (hash-checked)."""
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    prev: dict[str, dict[datetime, float | None]] = {}
    singles: dict[datetime, dict[datetime, float | None]] = {}
    for call in manifest["calls"]:
        if call["status"] != 200:
            continue
        body = (out / call["body_file"]).read_bytes()
        if hashlib.sha256(body).hexdigest() != call["sha256"]:
            raise RuntimeError(f"hash mismatch for {call['body_file']}")
        if call["kind"] == "previous_runs" and call["model"] == prev_model:
            for name in ("temperature_2m_previous_day1", "temperature_2m_previous_day2"):
                prev[name] = _series(body, name)
        elif call["kind"] == "single_run" and call["model"] == singles_model:
            singles[datetime.fromisoformat(call["run"]).replace(tzinfo=UTC)] = _series(body, "temperature_2m")
    return prev, singles


def summarize(rows: list[dict[str, Any]]) -> dict[str, dict[str, float | int]]:
    """Per lead: hours with a value, with at least one match, with exactly one, mean matches per hour."""
    out: dict[str, dict[str, float | int]] = {}
    for lead in (1, 2):
        sel = [r for r in rows if r["lead"] == lead and r["value"] is not None]
        out[f"lead{lead}"] = {
            "hours_with_value": len(sel),
            "hours_with_a_match": sum(r["n_matches"] >= 1 for r in sel),
            "hours_with_exactly_one_match": sum(r["n_matches"] == 1 for r in sel),
            "mean_matches_per_hour": round(sum(r["n_matches"] for r in sel) / len(sel), 2) if sel else 0.0,
        }
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="directory for raw bodies, manifest and result")
    parser.add_argument("--offline", action="store_true", help="re-analyze the saved bodies; no network")
    args = parser.parse_args()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    audit = Audit(out=out)
    if not args.offline:
        try:
            _fetch_all(audit)
        finally:
            audit.save_manifest()
        print(f"data calls made: {len(audit.calls)}")
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    results: dict[str, dict[str, Any]] = {}
    for singles_model in ("ecmwf_ifs025", "ecmwf_ifs"):
        reached = [c for c in manifest["calls"] if c["model"] == singles_model and c["kind"] == "single_run"]
        if not any(c["status"] == 200 for c in reached):
            results[singles_model] = {"single_runs_reach_2025": False, "answers": sorted({c["error"] for c in reached})}
            continue
        # The corrector reads ecmwf_ifs025, so its previous_day series is the one to explain.
        prev, singles = _load(out, "ecmwf_ifs025", singles_model)
        rows = analyze(prev, singles)["rows"]
        results[singles_model] = {
            "single_runs_reach_2025": True,
            "n_runs": len(singles),
            "previous_day_series_from": "ecmwf_ifs025",
            "summary": summarize(rows),
            "rows": rows,
        }
    (out / "analysis.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "rows"} for k, v in results.items()}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
