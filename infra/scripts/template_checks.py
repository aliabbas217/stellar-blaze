"""Static assertions on the demo's Bicep template, used by check-template.sh and check-db-tls.sh --template.

Nothing here contacts Azure. For every scenario (a set of dummy environment variables) the script runs
``bicep build-params`` and ``bicep snapshot`` on a COPY of the template directory, so the repository is never written to,
and then evaluates the ARM expressions that the snapshot leaves open (it cannot see secure parameters, so the ones
that depend on a secret stay as ``[...]`` text) with the dummy parameter values. The checks therefore run on concrete
values: the resources Bicep would create, with the real secret placeholders in them. What the snapshot cannot see (a value
built from a secure parameter prints as ``unknown()``, which is every Container Apps secret) is evaluated from the compiled
template instead: main.bicep's module parameters, then what each module turns them into. The B checks run the same way on
bootstrap.bicep (next to main.bicep) through its snapshot.

Output: one ``PASS|FAIL <id> <subject>`` line per check on stdout (reasons indented below a FAIL), exit 1 on any FAIL.
Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
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


# bootstrap.bicepparam (B checks). The caller's own GITHUB_OWNER, OPERATOR_PRINCIPAL_ID ... are removed from every scenario.
BOOTSTRAP_BASE_ENV: dict[str, str] = {"BUDGET_CONTACT_EMAIL": "ops@example.org"}
BOOTSTRAP_OPTIONAL_ENV = (
    "LOCATION",
    "GITHUB_OWNER",
    "GITHUB_REPO",
    "OPERATOR_PRINCIPAL_ID",
    "BUDGET_MONTH",
)
OPERATOR_ID = "11111111-1111-4111-8111-111111111111"
GITHUB_OWNER = "Foo"  # mixed case on purpose: the OIDC subject is case-sensitive
GITHUB_REPO = "bar-Baz"
BUDGET_MONTH_OVERRIDE = "2026-12"
BOOTSTRAP_SCENARIOS: dict[str, dict[str, str | None]] = {
    "boot-full": {
        "GITHUB_OWNER": GITHUB_OWNER,
        "GITHUB_REPO": GITHUB_REPO,
        "OPERATOR_PRINCIPAL_ID": OPERATOR_ID,
    },
    "boot-bare": {},
    "boot-month": {"BUDGET_MONTH": BUDGET_MONTH_OVERRIDE},
}


class CheckError(Exception):
    """A scenario could not be evaluated; the checks that need it fail with this message."""


# ---- a small evaluator for the ARM template expressions that `bicep snapshot` leaves open ----------------------------

_TOKEN = re.compile(
    r"\s*(?:(?P<str>'(?:[^']|'')*')|(?P<num>-?\d+(?:\.\d+)?)|(?P<id>[A-Za-z_]\w*)|(?P<p>[()\[\],.]))"
)


class Runtime:
    """A value that only exists in Azure (for example a server's host name). Any attribute of it is again a Runtime.

    `origin` is the first argument of the reference() it came from (the resource id), so a check can tell whose principal id
    a role assignment holds.
    """

    def __init__(self, origin: str = "") -> None:
        self.origin = origin

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


def _utc_now(fmt: str = "yyyy-MM") -> str:
    if fmt != "yyyy-MM":
        msg = f"utcNow({fmt!r}): this checker only knows the format yyyy-MM"
        raise CheckError(msg)
    return datetime.now(UTC).strftime("%Y-%m")


def _union(*args: Any) -> Any:
    if args and all(isinstance(a, dict) for a in args):
        return {key: value for a in args for key, value in a.items()}
    return [item for a in args for item in a]


class Unknown:
    """What `bicep snapshot` prints as ``unknown()``: a value built from a secure parameter, which it cannot see."""

    def __str__(self) -> str:
        return "<unknown>"


_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "concat": _concat,
    "union": _union,
    "objectKeys": lambda a: list(a),
    "unknown": Unknown,
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
    "reference": lambda *a: Runtime(str(a[0])),
    "listKeys": lambda *a: Runtime(str(a[0])),
    "utcNow": _utc_now,
    "subscriptionResourceId": lambda *a: "/".join(str(x) for x in a),
    "take": lambda a, n: a[:n],
    "toLower": lambda a: str(a).lower(),
    "toUpper": lambda a: str(a).upper(),
    "resourceId": lambda *a: "/".join(str(x) for x in a),
    "uniqueString": lambda *a: hashlib.sha256(
        "/".join(map(str, a)).encode()
    ).hexdigest()[:13],
    "resourceGroup": lambda: {
        "location": "uaenorth",
        "id": "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test",
    },
}


class Scope:
    """What an ARM expression can read: parameter values, variables (lazily, as an ARM engine does) and ``copy`` indexes."""

    def __init__(
        self,
        params: dict[str, Any],
        variables: dict[str, Any] | None = None,
    ) -> None:
        self.params = params
        defs = dict(variables or {})
        self.copies: dict[str, Any] = {c["name"]: c for c in defs.pop("copy", [])}
        self.defs = defs
        self.index: dict[str, int] = {}
        self._cache: dict[str, Any] = {}

    def variable(self, name: str) -> Any:
        if name not in self._cache:
            if name in self.copies:
                spec = self.copies[name]
                items = []
                for i in range(resolve(spec["count"], self)):
                    self.index[name] = i
                    items.append(resolve(spec["input"], self))
                self.index.pop(name, None)
                self._cache[name] = items
            elif name in self.defs:
                self._cache[name] = resolve(self.defs[name], self)
            else:
                msg = f"ARM expression: no variable {name!r}"
                raise CheckError(msg)
        return self._cache[name]


def _evaluate_node(node: Any, scope: Scope) -> Any:
    kind = node[0]
    if kind == "lit":
        return node[1]
    if kind == "attr":
        base = _evaluate_node(node[1], scope)
        if isinstance(base, Runtime | Unknown):
            return base
        if isinstance(base, dict) and node[2] in base:
            return base[node[2]]
        msg = f"ARM expression: no property {node[2]!r}"
        raise CheckError(msg)
    if kind == "index":
        base = _evaluate_node(node[1], scope)
        if isinstance(base, Runtime | Unknown):
            return base
        return base[_evaluate_node(node[2], scope)]
    _, name, args = node
    if name == "parameters":
        key = _evaluate_node(args[0], scope)
        if key not in scope.params:
            msg = (
                f"ARM expression: parameter {key!r} has no value in the parameters file"
            )
            raise CheckError(msg)
        return scope.params[key]
    if name == "variables":
        return scope.variable(_evaluate_node(args[0], scope))
    if name == "copyIndex":
        return scope.index[_evaluate_node(args[0], scope)]
    if (
        name == "if"
    ):  # lazy: the branch that is not taken may contain things that cannot be evaluated
        branch = args[1] if _truthy(_evaluate_node(args[0], scope)) else args[2]
        return _evaluate_node(branch, scope)
    if name not in _FUNCTIONS:
        msg = f"ARM expression uses {name}(), which this checker cannot evaluate"
        raise CheckError(msg)
    return _FUNCTIONS[name](*[_evaluate_node(a, scope) for a in args])


def resolve(node: Any, scope: Scope) -> Any:
    """Return `node` with every ``[expression]`` string replaced by its value."""
    if isinstance(node, dict):
        return {key: resolve(value, scope) for key, value in node.items()}
    if isinstance(node, list):
        return [resolve(item, scope) for item in node]
    if (
        isinstance(node, str)
        and node.startswith("[")
        and node.endswith("]")
        and not node.startswith("[[")
    ):
        parser = _Parser(node[1:-1])
        value = _evaluate_node(parser.expr(), scope)
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
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._params: dict[str, dict[str, Any]] = {}
        self._modules: dict[str, list[Module]] = {}
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

    def _target(self, name: str) -> str:
        """`bootstrap` for a scenario of bootstrap.bicepparam, else `main`."""
        return "bootstrap" if name in BOOTSTRAP_SCENARIOS else "main"

    def params_file(self, name: str) -> Path:
        if self._target(name) == "bootstrap":
            return self.dir / "bootstrap.bicepparam"
        return self.template.with_suffix(".bicepparam")

    def _scenario_env(self, name: str) -> dict[str, str]:
        scrub = (*OPTIONAL_ENV, *BOOTSTRAP_OPTIONAL_ENV)
        env = {k: v for k, v in os.environ.items() if k not in scrub}
        boot = self._target(name) == "bootstrap"
        env.update(BOOTSTRAP_BASE_ENV if boot else BASE_ENV)
        for key, value in (BOOTSTRAP_SCENARIOS if boot else SCENARIOS)[name].items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        env["MSYS_NO_PATHCONV"] = "1"
        return env

    def scenario_params(self, name: str) -> dict[str, Any]:
        """The parameter values `bicep build-params` gives main.bicepparam under scenario `name`."""
        if name not in self._params:
            wrapper = json.loads(
                self._run(
                    ["build-params", self.params_file(name).name, "--stdout"],
                    self._scenario_env(name),
                )
            )
            self._params[name] = {
                key: entry["value"]
                for key, entry in json.loads(wrapper["parametersJson"])[
                    "parameters"
                ].items()
            }
        return self._params[name]

    def snapshot(self, name: str) -> dict[str, Any]:
        """The predicted resources of scenario `name`, with every expression evaluated."""
        if name not in self._snapshots:
            params = self.scenario_params(name)
            scope_args = (
                ["--location", "uaenorth"]
                if self._target(name) == "bootstrap"
                else ["--resource-group", "rg-test", "--location", "uaenorth"]
            )
            params_file = self.params_file(name)
            self._run(
                [
                    "snapshot",
                    params_file.name,
                    "--mode",
                    "overwrite",
                    "--subscription-id",
                    "00000000-0000-0000-0000-000000000000",
                    *scope_args,
                ],
                self._scenario_env(name),
            )
            raw = json.loads(
                (self.dir / f"{params_file.stem}.snapshot.json").read_text(
                    encoding="utf-8"
                )
            )
            # Only the resources: the snapshot's outputs use subscription(), tenant() ..., and no check reads them.
            self._snapshots[name] = {
                "predictedResources": resolve(raw["predictedResources"], Scope(params))
            }
        return self._snapshots[name]

    def modules(self, name: str) -> list[Module]:
        """The module deployments scenario `name` makes, their parameters evaluated, from the compiled template.

        `bicep snapshot` cannot see a value built from a secure parameter (it prints ``unknown()``), and the secrets of a
        container app are exactly that, so they are evaluated here: first the parameters main.bicep gives each module, then
        what the module turns its secure ``secrets`` parameter into.
        """
        if name not in self._modules:
            compiled = self.compiled()
            given_top = self.scenario_params(name)
            defaults = {
                key: spec["defaultValue"]
                for key, spec in compiled.get("parameters", {}).items()
                if key not in given_top and "defaultValue" in spec
            }
            top = Scope(
                {**given_top, **resolve(defaults, Scope(given_top))},
                compiled.get("variables"),
            )
            found: list[Module] = []
            for res in compiled["resources"]:
                if res["type"] != "Microsoft.Resources/deployments":
                    continue
                if "condition" in res and not _truthy(resolve(res["condition"], top)):
                    continue
                template = res["properties"]["template"]
                given = {
                    key: resolve(entry, top)["value"]
                    for key, entry in res["properties"]["parameters"].items()
                }
                types = {
                    key: spec["type"] for key, spec in template["parameters"].items()
                }
                found.append(
                    Module(
                        res["name"],
                        template,
                        given,
                        types,
                        _module_secrets(template, given),
                    )
                )
            self._modules[name] = found
        return self._modules[name]


class Module:
    """One module deployment of main.bicep under one scenario."""

    def __init__(
        self,
        deployment: str,
        template: dict[str, Any],
        params: dict[str, Any],
        types: dict[str, str],
        secrets: dict[str, str] | None,
    ) -> None:
        self.deployment = deployment
        self.template = template
        self.params = params  # the values main.bicep passes (defaults of the module are not added)
        self.types = types  # the declared type of every parameter of the module
        self.secrets = secrets  # container app / job modules only: secret name -> value, as the app will hold it


def _module_secrets(
    template: dict[str, Any], given: dict[str, Any]
) -> dict[str, str] | None:
    """Evaluate, for a container app or job module, the ``secrets`` list its resource gets from the ``secrets`` parameter."""
    if "secrets" not in template["parameters"]:
        return None
    params = {
        key: given.get(key, spec.get("defaultValue"))
        for key, spec in template["parameters"].items()
    }
    scope = Scope(params, template.get("variables"))
    resources = template[
        "resources"
    ]  # a list, or a dict by symbolic name (languageVersion 2.0)
    for res in resources.values() if isinstance(resources, dict) else resources:
        if res["type"] in ("Microsoft.App/containerApps", "Microsoft.App/jobs"):
            entries = resolve(res["properties"]["configuration"]["secrets"], scope)
            return {entry["name"]: entry["value"] for entry in entries}
    return None


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


def secrets_of(ws: Workspace, scenario: str, name: str) -> dict[str, str]:
    """The Container Apps secrets (name -> value) that app or job `name` holds under `scenario`; empty if it is not made."""
    for module in ws.modules(scenario):
        if module.secrets is not None and module.params.get("name") == name:
            return module.secrets
    return {}


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
                for secret in secrets_of(ws, scenario, name):
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
        if (
            secrets_of(ws, "full", "alerts").get("sb-vapid-private-key")
            != VAPID_PRIVATE
        ):
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
            known = secrets_of(ws, scenario, name)
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
        if env_of(res) or secrets_of(ws, "placeholder", name):
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
            or secrets_of(ws, "placeholder", "job-migrate")
        ):
            problems.append(
                "placeholder/job-migrate: must run the jobs image with no command, env or secret"
            )
    return problems


def check_c11(ws: Workspace) -> list[str]:
    """A module parameter that carries a secret value must be a securestring or secureObject.

    ARM redacts only those two types from `properties.parameters` of the nested deployment, which Reader on the resource
    group can read; a secure property inside a plain array or object parameter is not known to be redacted.
    """
    secure_types = ("securestring", "secureobject")
    problems = []
    carried = 0
    for scenario in ("full", "phase1", "placeholder"):
        for module in ws.modules(scenario):
            for key, value in module.params.items():
                text = json.dumps(value, default=str)
                if not any(secret in text for secret in SECRET_VALUES):
                    continue
                carried += 1
                declared = module.types.get(key, "<undeclared>")
                if declared.lower() not in secure_types:
                    problems.append(
                        f"{scenario}/{module.deployment}: parameter {key} carries a secret value but is declared {declared!r}, "
                        "not securestring or secureObject"
                    )
    if carried == 0:
        problems.append(
            "no module parameter carries a secret value: the check saw nothing"
        )
    return problems


# ---- bootstrap.bicep (B checks: the subscription-scope template the operator runs once) -------------------------------

ACR_PULL = "7f951dda-4ed3-4680-a7ca-43fe172d538d"
ACR_PUSH = "8311e382-0749-4cb8-b61a-304f252e45ec"
CONTRIBUTOR = "b24988ac-6180-42a0-ab88-20f7382dd24c"
FEDERATED_CREDENTIAL = (
    "Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials"
)


def _role_assignments(snap: dict[str, Any]) -> list[dict[str, Any]]:
    """Every role assignment as {role, principal, scope: registry|group, type}.

    The principal of an identity is the resource id it was read from (see Runtime); the operator's is its object id.
    """
    found = []
    for res in snap["predictedResources"]:
        if res["type"] != "Microsoft.Authorization/roleAssignments":
            continue
        props = res["properties"]
        principal = props["principalId"]
        found.append(
            {
                "role": str(props["roleDefinitionId"]).rsplit("/", 1)[-1],
                "principal": principal.origin
                if isinstance(principal, Runtime)
                else str(principal),
                "scope": "registry" if "/registries/" in res["id"] else "group",
                "type": props.get("principalType"),
            }
        )
    return found


def _utc_month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


def check_b1(ws: Workspace) -> list[str]:
    problems = []
    first = _utc_month()
    for scenario, override in (
        ("boot-bare", None),
        ("boot-full", None),
        ("boot-month", BUDGET_MONTH_OVERRIDE),
    ):
        budgets = _resources(ws.snapshot(scenario), "Microsoft.Consumption/budgets")
        if len(budgets) != 1:
            problems.append(f"{scenario}: expected one budget, found {len(budgets)}")
            continue
        start = next(iter(budgets.values()))["properties"]["timePeriod"]["startDate"]
        # A run that straddles midnight on the last day of a month may see either month.
        months = {override} if override else {first, _utc_month()}
        wanted = sorted(f"{m}-01T00:00:00Z" for m in months)
        if start not in wanted:
            how = "the BUDGET_MONTH override" if override else "the current UTC month"
            problems.append(
                f"{scenario}: budget startDate is {start!r}, expected {wanted} ({how})"
            )
    return problems


def check_b2(ws: Workspace) -> list[str]:
    problems = []
    found = _resources(ws.snapshot("boot-full"), FEDERATED_CREDENTIAL)
    if len(found) != 1:
        problems.append(
            f"boot-full: expected one federated credential, found {len(found)}"
        )
    for name, res in found.items():
        props = res["properties"]
        want = f"repo:{GITHUB_OWNER}/{GITHUB_REPO}:environment:demo"
        if props.get("subject") != want:
            problems.append(
                f"{name}: subject is {props.get('subject')!r}, expected exactly {want!r}"
            )
        if props.get("issuer") != "https://token.actions.githubusercontent.com":
            problems.append(f"{name}: issuer is {props.get('issuer')!r}")
        if props.get("audiences") != ["api://AzureADTokenExchange"]:
            problems.append(f"{name}: audiences are {props.get('audiences')!r}")
        if not name.startswith("id-sb-deployer/"):
            problems.append(f"{name}: not a credential of the deployer identity")
    bare = _resources(ws.snapshot("boot-bare"), FEDERATED_CREDENTIAL)
    if bare:
        problems.append(
            f"boot-bare: a federated credential is created although githubOwner is empty: {sorted(bare)}"
        )
    return problems


def check_b3(ws: Workspace) -> list[str]:
    problems = []
    wanted = [
        ("apps AcrPull on the registry", ACR_PULL, "id-sb-apps", "registry"),
        ("deployer AcrPush on the registry", ACR_PUSH, "id-sb-deployer", "registry"),
        ("deployer Contributor on the group", CONTRIBUTOR, "id-sb-deployer", "group"),
    ]
    for scenario, operator in (("boot-full", True), ("boot-bare", False)):
        remaining = _role_assignments(ws.snapshot(scenario))
        for label, role, who, scope in wanted:
            hits = [
                a
                for a in remaining
                if a["role"] == role and who in a["principal"] and a["scope"] == scope
            ]
            if len(hits) != 1:
                problems.append(f"{scenario}: expected one {label}, found {len(hits)}")
            else:
                remaining.remove(hits[0])
        if operator:
            mine = [
                a
                for a in remaining
                if a["role"] == ACR_PUSH
                and a["scope"] == "registry"
                and a["principal"] == OPERATOR_ID
            ]
            if len(mine) != 1:
                problems.append(
                    f"{scenario}: expected one AcrPush on the registry for the operator {OPERATOR_ID}, found {len(mine)}"
                )
            elif mine[0]["type"] != "User":
                problems.append(
                    f"{scenario}: the operator is a {mine[0]['type']!r}, not a User"
                )
            remaining = [a for a in remaining if a not in mine]
        if remaining:
            problems.append(f"{scenario}: unexpected role assignment(s): {remaining}")
    return problems


def check_b4(ws: Workspace) -> list[str]:
    registries = _resources(
        ws.snapshot("boot-bare"), "Microsoft.ContainerRegistry/registries"
    )
    if len(registries) != 1:
        return [f"expected one registry, found {len(registries)}"]
    props = next(iter(registries.values()))["properties"]
    problems = []
    if props.get("roleAssignmentMode") != "LegacyRegistryPermissions":
        problems.append(
            f"roleAssignmentMode is {props.get('roleAssignmentMode')!r}, not 'LegacyRegistryPermissions'"
            " (AcrPull and AcrPush are not honoured in an ABAC-mode registry)"
        )
    for key in ("adminUserEnabled", "anonymousPullEnabled"):
        if props.get(key) is not False:
            problems.append(f"{key} is {props.get(key)!r}, not false")
    arm = props.get("policies", {}).get("azureADAuthenticationAsArmPolicy", {})
    if arm.get("status") != "enabled":
        problems.append(
            "azureADAuthenticationAsArmPolicy is not enabled (a managed-identity image pull needs the ARM-audience token)"
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
    "C11": (
        "every module parameter that carries a secret value is a securestring or secureObject",
        check_c11,
    ),
    "B1": (
        "bootstrap: budget startDate is <yyyy-MM>-01T00:00:00Z, by default and with BUDGET_MONTH",
        check_b1,
    ),
    "B2": (
        "bootstrap: federated credential subject is repo:<owner>/<repo>:environment:<env>, case kept; none without an owner",
        check_b2,
    ),
    "B3": (
        "bootstrap: role assignments are exactly apps AcrPull, deployer AcrPush and Contributor, plus operator AcrPush when given",
        check_b3,
    ),
    "B4": (
        "bootstrap: registry is LegacyRegistryPermissions, no admin user, no anonymous pull",
        check_b4,
    ),
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
