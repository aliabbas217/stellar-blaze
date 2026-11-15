"""Static assertions on the demo's Bicep template, used by check-template.sh and check-db-tls.sh --template.

Nothing here contacts Azure. For every scenario (a set of dummy environment variables) the script runs
``bicep build-params`` and ``bicep snapshot`` on a COPY of the template directory, so the repository is never written to,
and then evaluates the ARM expressions that the snapshot leaves open (it cannot see secure parameters, so the ones
that depend on a secret stay as ``[...]`` text) with the dummy parameter values. The checks therefore run on concrete
values: the resources Bicep would create, with the real secret placeholders in them.

Output: one ``PASS|FAIL <id> <subject>`` line per check on stdout (reasons indented below a FAIL), exit 1 on any FAIL.
Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterator
from pathlib import Path
from secrets import token_hex
from typing import Any

PG_ROOT_CERT = "/etc/ssl/certs/ca-certificates.crt"
SECRET_PARAMS = (
    "pgAdminPassword",
    "vapidPrivateKey",
    "sbAccessTokens",
    "demoEmployerToken",
)

# Dummy values only, drawn at random on every run (never literals: a secret scanner cannot tell a dummy literal from a
# real one, and random distinct values make a leak of any one of them recognisable in the evaluated template).
PG_PASSWORD = token_hex(32)
VAPID_PRIVATE = "dummy-vapid-" + token_hex(16)
EMPLOYER_TOKEN = "dummy-employer-" + token_hex(16)
ACCESS_TOKENS = json.dumps(
    {
        token_hex(32): {
            "actor": "demo-bff",
            "role": "employer",
            "employer_id": "emp-demo",
        }
    }
)
SECRET_VALUES = (PG_PASSWORD, VAPID_PRIVATE, EMPLOYER_TOKEN, ACCESS_TOKENS)

ACR = "acrsbdummy"
API_IMAGE = f"{ACR}.azurecr.io/sb-api:abc1234"
WEB_IMAGE = f"{ACR}.azurecr.io/sb-web:abc1234"
JOBS_IMAGE = "mcr.microsoft.com/k8se/quickstart-jobs:latest"
PLACEHOLDER_IMAGE = "mcr.microsoft.com/k8se/quickstart:latest"

BASE_ENV: dict[str, str] = {
    "ACR_NAME": ACR,
    "APPS_IDENTITY_ID": (
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/"
        "Microsoft.ManagedIdentity/userAssignedIdentities/id-sb-apps"
    ),
    "POSTGRES_VERSION": "18",
    "PG_ADMIN_PASSWORD": PG_PASSWORD,
    "GIT_SHA": "abc1234",
    "DEPLOY_APPS": "true",
    "API_IMAGE": API_IMAGE,
    "API_TARGET_PORT": "8000",
    "API_LIVE_PATH": "/api/v1/health/live",
    "API_READY_PATH": "/api/v1/health/ready",
    "API_IS_PLACEHOLDER": "false",
    "WEB_IMAGE": WEB_IMAGE,
    "WEB_TARGET_PORT": "3000",
    "WEB_HEALTH_PATH": "/api/healthz",
    "WEB_IS_PLACEHOLDER": "false",
    "JOBS_IMAGE": JOBS_IMAGE,
    "VAPID_PUBLIC_KEY": "dummy-vapid-public-key",
    "VAPID_SUBJECT": "mailto:ops@example.org",
    "VAPID_PRIVATE_KEY": VAPID_PRIVATE,
    "SB_ACCESS_TOKENS": ACCESS_TOKENS,
    "DEMO_EMPLOYER_TOKEN": EMPLOYER_TOKEN,
}
# Variables the template reads with a default; a stray value in the caller's shell must not leak into a scenario.
OPTIONAL_ENV = ("SB_RULESET_ID", "SB_MODEL_ID", "TRUSTED_PROXY_HOPS")

SCENARIOS: dict[str, dict[str, str | None]] = {
    "full": {},
    "pins": {"SB_RULESET_ID": "ruleset-test", "SB_MODEL_ID": "model-test"},
    "novapid": {"VAPID_PRIVATE_KEY": None, "VAPID_SUBJECT": None},
    "phase1": {"DEPLOY_APPS": "false"},
    "placeholder": {
        "API_IMAGE": PLACEHOLDER_IMAGE,
        "API_TARGET_PORT": "80",
        "API_LIVE_PATH": "/",
        "API_READY_PATH": "/",
        "API_IS_PLACEHOLDER": "true",
        "WEB_IMAGE": PLACEHOLDER_IMAGE,
        "WEB_TARGET_PORT": "80",
        "WEB_HEALTH_PATH": "/",
        "WEB_IS_PLACEHOLDER": "true",
    },
}


class CheckError(Exception):
    """A scenario could not be evaluated; the checks that need it fail with this message."""


# ---- a small evaluator for the ARM template expressions that `bicep snapshot` leaves open ----------------------------

_TOKEN = re.compile(
    r"\s*(?:(?P<str>'(?:[^']|'')*')|(?P<num>-?\d+(?:\.\d+)?)|(?P<id>[A-Za-z_]\w*)|(?P<p>[()\[\],.]))"
)


class Runtime:
    """A value that only exists in Azure (for example a server's host name). Any attribute of it is again a Runtime."""

    def __str__(self) -> str:
        return "<runtime-value>"


def _tokens(text: str) -> list[tuple[str, str]]:
    pos, out = 0, []
    while pos < len(text):
        match = _TOKEN.match(text, pos)
        if match is None:
            if text[pos:].strip() == "":
                break
            msg = f"cannot tokenise ARM expression at {text[pos : pos + 30]!r}"
            raise CheckError(msg)
        kind = match.lastgroup or ""
        out.append((kind, match.group(kind)))
        pos = match.end()
    return out


class _Parser:
    def __init__(self, text: str) -> None:
        self.toks = _tokens(text)
        self.i = 0

    def peek(self) -> tuple[str, str]:
        return self.toks[self.i] if self.i < len(self.toks) else ("end", "")

    def take(self, want: str | None = None) -> tuple[str, str]:
        tok = self.peek()
        if want is not None and tok[1] != want:
            msg = f"ARM expression: expected {want!r}, found {tok[1]!r}"
            raise CheckError(msg)
        self.i += 1
        return tok

    def expr(self) -> Any:
        kind, value = self.take()
        node: Any
        if kind == "str":
            node = ("lit", value[1:-1].replace("''", "'"))
        elif kind == "num":
            node = ("lit", float(value) if "." in value else int(value))
        elif kind == "id":
            self.take("(")
            args: list[Any] = []
            if self.peek()[1] != ")":
                args.append(self.expr())
                while self.peek()[1] == ",":
                    self.take(",")
                    args.append(self.expr())
            self.take(")")
            node = ("call", value, args)
        else:
            msg = f"ARM expression: unexpected {value!r}"
            raise CheckError(msg)
        while self.peek()[1] in (".", "["):
            if self.take()[1] == ".":
                node = ("attr", node, self.take()[1])
            else:
                node = ("index", node, self.expr())
                self.take("]")
        return node


def _truthy(value: Any) -> bool:
    return bool(value)


def _empty(value: Any) -> bool:
    return value is None or (isinstance(value, str | list | dict) and len(value) == 0)


def _format(fmt: str, *args: Any) -> str:
    def sub(match: re.Match[str]) -> str:
        return str(args[int(match.group(1))])

    return re.sub(r"\{(\d+)\}", sub, fmt)


def _concat(*args: Any) -> Any:
    if args and all(isinstance(a, list) for a in args):
        return [item for a in args for item in a]
    return "".join(str(a) for a in args)


def _create_object(*args: Any) -> dict[str, Any]:
    return {args[i]: args[i + 1] for i in range(0, len(args), 2)}


_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "concat": _concat,
    "createArray": lambda *a: list(a),
    "createObject": _create_object,
    "not": lambda a: not _truthy(a),
    "empty": _empty,
    "format": _format,
    "string": lambda a: str(a).lower() if isinstance(a, bool) else str(a),
    "equals": lambda a, b: a == b,
    "and": lambda *a: all(_truthy(x) for x in a),
    "or": lambda *a: any(_truthy(x) for x in a),
    "coalesce": lambda *a: next((x for x in a if x is not None), None),
    "null": lambda: None,
    "true": lambda: True,
    "false": lambda: False,
    "length": len,
    "greater": lambda a, b: a > b,
    # Anything that points at a deployed resource has no value offline.
    "reference": lambda *_: Runtime(),
    "listKeys": lambda *_: Runtime(),
    "resourceId": lambda *a: "/".join(str(x) for x in a),
}


def _evaluate_node(node: Any, params: dict[str, Any]) -> Any:
    kind = node[0]
    if kind == "lit":
        return node[1]
    if kind == "attr":
        base = _evaluate_node(node[1], params)
        if isinstance(base, Runtime):
            return base
        if isinstance(base, dict) and node[2] in base:
            return base[node[2]]
        msg = f"ARM expression: no property {node[2]!r}"
        raise CheckError(msg)
    if kind == "index":
        base = _evaluate_node(node[1], params)
        if isinstance(base, Runtime):
            return base
        return base[_evaluate_node(node[2], params)]
    _, name, args = node
    if name == "parameters":
        key = _evaluate_node(args[0], params)
        if key not in params:
            msg = (
                f"ARM expression: parameter {key!r} has no value in the parameters file"
            )
            raise CheckError(msg)
        return params[key]
    if (
        name == "if"
    ):  # lazy: the branch that is not taken may contain things that cannot be evaluated
        branch = args[1] if _truthy(_evaluate_node(args[0], params)) else args[2]
        return _evaluate_node(branch, params)
    if name not in _FUNCTIONS:
        msg = f"ARM expression uses {name}(), which this checker cannot evaluate"
        raise CheckError(msg)
    return _FUNCTIONS[name](*[_evaluate_node(a, params) for a in args])


def resolve(node: Any, params: dict[str, Any]) -> Any:
    """Return `node` with every ``[expression]`` string replaced by its value."""
    if isinstance(node, dict):
        return {key: resolve(value, params) for key, value in node.items()}
    if isinstance(node, list):
        return [resolve(item, params) for item in node]
    if (
        isinstance(node, str)
        and node.startswith("[")
        and node.endswith("]")
        and not node.startswith("[[")
    ):
        parser = _Parser(node[1:-1])
        value = _evaluate_node(parser.expr(), params)
        if parser.i != len(parser.toks):
            msg = f"ARM expression has trailing input: {node[:80]}"
            raise CheckError(msg)
        return value
    return node


# ---- running bicep on a copy -------------------------------------------------------------------------------------------


class Workspace:
    """A temporary copy of the template directory, with a bicep binary; scenarios and the compiled template are memoised."""

    def __init__(self, bicep: str, template: Path) -> None:
        self.bicep = bicep
        self._tmp = tempfile.TemporaryDirectory(prefix="sb-check-template-")
        self.dir = Path(self._tmp.name) / "bicep"
        shutil.copytree(
            template.parent, self.dir, ignore=shutil.ignore_patterns("*.snapshot.json")
        )
        self.template = self.dir / template.name
        self.params_file = self.template.with_suffix(".bicepparam")
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._compiled: dict[str, Any] | None = None

    def close(self) -> None:
        self._tmp.cleanup()

    def _run(self, args: list[str], env: dict[str, str] | None = None) -> str:
        proc = subprocess.run(
            [self.bicep, *args],
            cwd=self.dir,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            detail = "\n".join(
                line for line in proc.stderr.splitlines() if "Warning" not in line
            )
            msg = f"bicep {args[0]} failed (exit {proc.returncode}): {detail[-600:]}"
            raise CheckError(msg)
        return proc.stdout

    def compiled(self) -> dict[str, Any]:
        if self._compiled is None:
            self._compiled = json.loads(
                self._run(["build", self.template.name, "--stdout"])
            )
        return self._compiled

    def snapshot(self, name: str) -> dict[str, Any]:
        """The predicted resources of scenario `name`, with every expression evaluated."""
        if name not in self._snapshots:
            env = {k: v for k, v in os.environ.items() if k not in OPTIONAL_ENV}
            env.update(BASE_ENV)
            for key, value in SCENARIOS[name].items():
                if value is None:
                    env.pop(key, None)
                else:
                    env[key] = value
            env["MSYS_NO_PATHCONV"] = "1"
            wrapper = json.loads(
                self._run(["build-params", self.params_file.name, "--stdout"], env)
            )
            params = {
                key: entry["value"]
                for key, entry in json.loads(wrapper["parametersJson"])[
                    "parameters"
                ].items()
            }
            self._run(
                [
                    "snapshot",
                    self.params_file.name,
                    "--mode",
                    "overwrite",
                    "--subscription-id",
                    "00000000-0000-0000-0000-000000000000",
                    "--resource-group",
                    "rg-test",
                    "--location",
                    "uaenorth",
                ],
                env,
            )
            raw = json.loads(
                (self.dir / f"{self.params_file.stem}.snapshot.json").read_text(
                    encoding="utf-8"
                )
            )
            self._snapshots[name] = resolve(raw, params)
        return self._snapshots[name]


# ---- views on a snapshot -----------------------------------------------------------------------------------------------


def _resources(snap: dict[str, Any], rtype: str) -> dict[str, dict[str, Any]]:
    return {r["name"]: r for r in snap["predictedResources"] if r["type"] == rtype}


def apps(snap: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return _resources(snap, "Microsoft.App/containerApps")


def jobs(snap: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return _resources(snap, "Microsoft.App/jobs")


def container(res: dict[str, Any]) -> dict[str, Any]:
    return res["properties"]["template"]["containers"][0]  # type: ignore[no-any-return]


def env_of(res: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {entry["name"]: entry for entry in container(res).get("env") or []}


def secrets_of(res: dict[str, Any]) -> dict[str, str]:
    return {
        s["name"]: s["value"]
        for s in res["properties"]["configuration"].get("secrets") or []
    }


def walk(node: Any) -> Iterator[tuple[str, Any]]:
    """Every (key, value) pair anywhere in a JSON document."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield key, value
            yield from walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk(item)


# ---- the checks (each returns a list of failure reasons; empty means pass) ---------------------------------------------

Check = Callable[[Workspace], list[str]]


def check_c1(ws: Workspace) -> list[str]:
    bad = re.compile(
        "|".join(
            [
                *SECRET_PARAMS,
                "databaseUrl",
                "sb-database-url",
                "administratorPassword",
                "listKeys",
                "listSecrets",
            ]
        ),
        re.IGNORECASE,
    )
    problems = []
    for key, value in walk(ws.compiled()):
        if key == "outputs" and isinstance(value, dict):
            for out_name, out in value.items():
                text = out_name + json.dumps(out)
                if bad.search(text):
                    problems.append(
                        f"output {out_name} references a secret or the database URL"
                    )
    return problems


def check_c2(ws: Workspace) -> list[str]:
    snap = ws.snapshot("full")
    envs = _resources(snap, "Microsoft.App/managedEnvironments")
    problems = []
    if len(envs) != 1:
        problems.append(f"expected one managed environment, found {len(envs)}")
    for name, res in envs.items():
        profiles = res["properties"].get("workloadProfiles")
        if profiles != [{"name": "Consumption", "workloadProfileType": "Consumption"}]:
            problems.append(
                f"environment {name}: workload profiles are {profiles!r}, not exactly Consumption"
            )
    forbidden = re.compile(
        r"privateendpoint|privatelink|maintenanceconfiguration", re.IGNORECASE
    )
    for key, value in walk(ws.compiled()):
        if key == "type" and isinstance(value, str) and forbidden.search(value):
            problems.append(f"template declares a resource of type {value}")
    return problems


def check_c3(ws: Workspace) -> list[str]:
    problems = []
    want_external = {
        "api": False,
        "web": True,
        "alerts": None,
    }  # None: no ingress at all
    for scenario in ("full", "placeholder"):
        found = apps(ws.snapshot(scenario))
        for name, res in found.items():
            where = f"{scenario}/{name}"
            props = res["properties"]
            scale = props["template"]["scale"]
            if scale.get("minReplicas") != 1 or scale.get("maxReplicas") != 1:
                problems.append(
                    f"{where}: replicas are {scale.get('minReplicas')}..{scale.get('maxReplicas')}, not 1..1"
                )
            if props["configuration"].get("activeRevisionsMode") != "Single":
                problems.append(f"{where}: revision mode is not Single")
            ingress = props["configuration"].get("ingress")
            if name not in want_external:
                problems.append(f"{where}: unexpected app")
            elif want_external[name] is None:
                if ingress is not None:
                    problems.append(
                        f"{where}: has an ingress, the worker must have none"
                    )
            elif ingress is None:
                problems.append(f"{where}: has no ingress")
            elif ingress.get("external") is not want_external[name]:
                problems.append(
                    f"{where}: ingress external is {ingress.get('external')!r}, expected {want_external[name]}"
                )
            if ingress is not None and ingress.get("allowInsecure") is not False:
                problems.append(
                    f"{where}: allowInsecure is {ingress.get('allowInsecure')!r}, not false"
                )
    if not apps(ws.snapshot("full")):
        problems.append("the full scenario creates no app")
    return problems


def check_c4(ws: Workspace) -> list[str]:
    problems = []
    for name in ("api", "alerts", "web"):
        res = apps(ws.snapshot("full")).get(name)
        if res is None:
            problems.append(f"full/{name}: missing")
            continue
        for var in ("SB_RULESET_ID", "SB_MODEL_ID"):
            if var in env_of(res):
                problems.append(
                    f"full/{name}: {var} is present although the parameter is unset"
                )
    pinned = apps(ws.snapshot("pins"))
    for name in ("api", "alerts"):
        env = env_of(pinned[name]) if name in pinned else {}
        for var, want in (
            ("SB_RULESET_ID", "ruleset-test"),
            ("SB_MODEL_ID", "model-test"),
        ):
            if env.get(var, {}).get("value") != want:
                problems.append(
                    f"pins/{name}: {var} is {env.get(var)!r}, expected the value {want!r}"
                )
    for scenario in ("full", "pins"):
        for name, res in {
            **apps(ws.snapshot(scenario)),
            **jobs(ws.snapshot(scenario)),
        }.items():
            for var, entry in env_of(res).items():
                if var in ("SB_RULESET_ID", "SB_MODEL_ID") and not entry.get("value"):
                    problems.append(
                        f"{scenario}/{name}: {var} is set to an empty value"
                    )
    return problems


def check_c5(ws: Workspace) -> list[str]:
    snap = ws.snapshot("full")
    job = jobs(snap).get("job-migrate")
    if job is None:
        return ["full: job-migrate is missing"]
    cont = container(job)
    command, args = cont.get("command") or [], cont.get("args") or []
    problems = []
    if command != ["/bin/sh", "-c"]:
        problems.append(f"command is {command!r}, expected ['/bin/sh', '-c']")
    script = args[0] if len(args) == 1 and isinstance(args[0], str) else ""
    if not script:
        problems.append(f"args must be one shell string, found {args!r}")
    if not re.search(
        r"(^|&& )sb-jobs db upgrade && sb-jobs site load fixtures/demo_site\.toml( |$)",
        script,
    ):
        problems.append(
            "script is not 'sb-jobs db upgrade && sb-jobs site load fixtures/demo_site.toml ...'"
        )
    if "alembic upgrade head" in " ".join([*command, *map(str, args)]):
        problems.append(
            "the job runs 'alembic upgrade head', which skips the config seed (ADR 0010)"
        )
    if cont.get("image") != API_IMAGE:
        problems.append(f"image is {cont.get('image')!r}, expected the api image")
    return problems


def check_c6(ws: Workspace) -> list[str]:
    alerts = apps(ws.snapshot("full")).get("alerts")
    if alerts is None:
        return ["full: alerts is missing"]
    cont = container(alerts)
    command, args = cont.get("command"), cont.get("args")
    problems = []
    if not command or not args:
        problems.append(
            f"command and args must both be set, found {command!r} and {args!r}"
        )
    elif [*command, *args] != ["sb-jobs", "alerts", "run"]:
        problems.append(
            f"command + args is {[*command, *args]!r}, expected sb-jobs alerts run"
        )
    return problems


def check_c7(ws: Workspace) -> list[str]:
    problems = []
    for scenario in ("full", "novapid", "placeholder"):
        found = apps(ws.snapshot(scenario))
        for name in ("api", "web"):
            if name in found:
                for var in env_of(found[name]):
                    if "VAPID_PRIVATE" in var or "VAPID_SUBJECT" in var:
                        problems.append(f"{scenario}/{name}: has {var}")
                for secret in secrets_of(found[name]):
                    if "vapid" in secret:
                        problems.append(f"{scenario}/{name}: has the secret {secret}")
    alerts = apps(ws.snapshot("full")).get("alerts")
    if alerts is None:
        problems.append("full: alerts is missing")
    else:
        env = env_of(alerts)
        if (
            env.get("SB_VAPID_PRIVATE_KEY", {}).get("secretRef")
            != "sb-vapid-private-key"
        ):
            problems.append(
                "full/alerts: SB_VAPID_PRIVATE_KEY is not a secretRef to sb-vapid-private-key"
            )
        if secrets_of(alerts).get("sb-vapid-private-key") != VAPID_PRIVATE:
            problems.append(
                "full/alerts: the secret sb-vapid-private-key does not hold the parameter value"
            )
        if env.get("SB_VAPID_SUBJECT", {}).get("value") != BASE_ENV["VAPID_SUBJECT"]:
            problems.append("full/alerts: SB_VAPID_SUBJECT is missing or wrong")
    quiet = apps(ws.snapshot("novapid")).get("alerts")
    if quiet is not None:
        both = [
            v
            for v in ("SB_VAPID_PRIVATE_KEY", "SB_VAPID_SUBJECT")
            if v in env_of(quiet)
        ]
        if both:
            problems.append(
                f"novapid/alerts: has {both} without a private key (the backend needs both or neither)"
            )
    return problems


def check_c8(ws: Workspace) -> list[str]:
    found = apps(ws.snapshot("full"))
    if "api" not in found or "alerts" not in found:
        return ["full: api or alerts is missing"]
    api_env, alerts_env = env_of(found["api"]), env_of(found["alerts"])
    problems = []
    for var in (
        "SB_FORECAST_SOURCE",
        "SB_REPLAY_SNAPSHOT_ID",
        "SB_REPLAY_DEFAULT_DATE",
        "SB_REPLAY_NOW",
    ):
        a, b = api_env.get(var, {}).get("value"), alerts_env.get(var, {}).get("value")
        if not a or a != b:
            problems.append(f"{var}: api has {a!r}, alerts has {b!r}")
    return problems


def check_c9(ws: Workspace) -> list[str]:
    problems = []
    for scenario in ("full", "placeholder", "phase1"):
        snap = ws.snapshot(scenario)
        for name, res in {**apps(snap), **jobs(snap)}.items():
            known = secrets_of(res)
            for var, entry in env_of(res).items():
                text = str(entry.get("value", ""))
                if any(secret in text for secret in SECRET_VALUES):
                    problems.append(
                        f"{scenario}/{name}: {var} carries a secret value instead of a secretRef"
                    )
                if "secretRef" in entry and entry["secretRef"] not in known:
                    problems.append(
                        f"{scenario}/{name}: {var} refers to the unknown secret {entry['secretRef']}"
                    )
    return problems


def check_c10(ws: Workspace) -> list[str]:
    problems = []
    phase1 = ws.snapshot("phase1")
    if apps(phase1):
        problems.append(f"phase1 creates apps: {sorted(apps(phase1))}")
    if "job-migrate" not in jobs(phase1):
        problems.append("phase1: job-migrate is missing")
    placeholder = ws.snapshot("placeholder")
    found = apps(placeholder)
    if sorted(found) != ["api", "web"]:
        problems.append(
            f"placeholder creates {sorted(found)}, expected api and web only"
        )
    for name, res in found.items():
        cont = container(res)
        if env_of(res) or secrets_of(res):
            problems.append(f"placeholder/{name}: has environment entries or secrets")
        paths = {p["httpGet"]["path"] for p in cont.get("probes", [])}
        if paths != {"/"}:
            problems.append(
                f"placeholder/{name}: probe paths are {sorted(paths)}, expected only /"
            )
    job = jobs(placeholder).get("job-migrate")
    if job is None:
        problems.append("placeholder: job-migrate is missing")
    else:
        cont = container(job)
        if (
            cont.get("image") != JOBS_IMAGE
            or cont.get("command")
            or cont.get("args")
            or env_of(job)
            or secrets_of(job)
        ):
            problems.append(
                "placeholder/job-migrate: must run the jobs image with no command, env or secret"
            )
    return problems


STATIC_CHECKS: dict[str, tuple[str, Check]] = {
    "C1": ("no output references a secret or the database URL", check_c1),
    "C2": (
        "environment is Consumption only; no private endpoint or maintenance window",
        check_c2,
    ),
    "C3": (
        "api, web, alerts: 1..1 replicas, Single revision, ingress as designed, allowInsecure false",
        check_c3,
    ),
    "C4": ("SB_RULESET_ID and SB_MODEL_ID only when set, never empty", check_c4),
    "C5": (
        "job-migrate runs sb-jobs db upgrade then site load, never alembic upgrade head",
        check_c5,
    ),
    "C6": ("alerts runs exactly sb-jobs alerts run", check_c6),
    "C7": ("the VAPID pair is on alerts only, both or neither", check_c7),
    "C8": ("replay settings are identical on api and alerts", check_c8),
    "C9": ("no secret value in env values; every secretRef resolves", check_c9),
    "C10": ("phase 1 creates no app; a placeholder api creates no alerts", check_c10),
}


def check_t1(ws: Workspace) -> list[str]:
    urls = re.findall(
        r"postgres(?:ql)?(?:\+\w+)?://[^\"\\]*", json.dumps(ws.compiled())
    )
    if not urls:
        return ["no database URL found in the template"]
    return [
        f"a database URL lacks ssl=verify-full (it ends ...{u[-24:]})"
        for u in urls
        if "ssl=verify-full" not in u
    ]


def check_t2(ws: Workspace) -> list[str]:
    weak = re.findall(
        r"ssl=(?:require|prefer|allow|disable|false)|sslmode=",
        json.dumps(ws.compiled()),
        re.IGNORECASE,
    )
    return (
        [f"the template contains {sorted({w.lower() for w in weak})}"] if weak else []
    )


def check_t3(ws: Workspace) -> list[str]:
    snap = ws.snapshot("full")
    targets = {**apps(snap), **jobs(snap)}
    problems = []
    for name in ("api", "alerts", "job-migrate"):
        res = targets.get(name)
        if res is None:
            problems.append(f"{name}: missing from the full scenario")
        elif env_of(res).get("PGSSLROOTCERT", {}).get("value") != PG_ROOT_CERT:
            problems.append(f"{name}: PGSSLROOTCERT is not {PG_ROOT_CERT}")
    return problems


TLS_CHECKS: dict[str, tuple[str, Check]] = {
    "T1": ("the database URL secret expression contains ssl=verify-full", check_t1),
    "T2": ("no weaker ssl mode and no sslmode= anywhere in the template", check_t2),
    "T3": ("PGSSLROOTCERT is defined for api, alerts and job-migrate", check_t3),
}


def run(
    checks: dict[str, tuple[str, Check]], ws: Workspace, only: set[str] | None
) -> int:
    failed = False
    for check_id, (subject, fn) in checks.items():
        if only is not None and check_id not in only:
            continue
        try:
            problems = fn(ws)
        except CheckError as exc:
            problems = [f"cannot evaluate: {exc}"]
        print(f"{'FAIL' if problems else 'PASS'} {check_id} {subject}")
        for reason in problems:
            print(f"  - {reason}")
        failed = failed or bool(problems)
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("static", "tls"))
    parser.add_argument("template", type=Path)
    parser.add_argument("--bicep", required=True, help="path of the bicep executable")
    parser.add_argument(
        "--only", help="comma-separated check ids to run (default: all of the mode)"
    )
    args = parser.parse_args(argv)
    checks = STATIC_CHECKS if args.mode == "static" else TLS_CHECKS
    only = set(args.only.split(",")) if args.only else None
    if only is not None and not only <= set(checks):
        print(f"unknown check id(s): {sorted(only - set(checks))}", file=sys.stderr)
        return 2
    if not args.template.is_file():
        print(f"no such template: {args.template}", file=sys.stderr)
        return 2
    ws = Workspace(args.bicep, args.template)
    try:
        return run(checks, ws, only)
    finally:
        ws.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
