"""The v1 wire contract (ADR 0051 and its amendments): paths, operation ids, shapes, problems, security, examples.

This is the guard on the freeze: ``backend/openapi/v1.json`` is what ``pnpm api:gen`` types, and from the freeze on only
additive changes are allowed. Every assertion here is a property of the contract, not of an implementation, so the
route bodies of later tasks cannot change it without a test saying so (except the stub test at the end, which Task 10
and Task 11 replace route by route).
"""

import datetime
import types
from typing import Annotated, Any, cast, get_args, get_origin

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import AwareDatetime, BaseModel, ValidationError

from stellar_blaze.api import models as api_models
from stellar_blaze.api.app import create_app
from stellar_blaze.api.models import (
    PROBLEM_MODELS,
    REQUEST_MODELS,
    RESPONSE_MODELS,
    AckItem,
    DayPlan,
    PlanValidateRequest,
    PlanValidateResponse,
    PushSubscriptionCreate,
    PushSubscriptionDetails,
    ReviewRequiredProblem,
    RosterInvalidProblem,
    Site,
    ValidationProblem,
)
from stellar_blaze.api.responses import PROBLEM_EXAMPLES
from stellar_blaze.api.security import employer_bearer
from stellar_blaze.config import Settings
from stellar_blaze.domain import scoreboard
from stellar_blaze.errors import NOT_IMPLEMENTED, Problem

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
PROBLEM_JSON = "application/problem+json"
API = "/api/v1"

# operationId -> (method, path, declared problem statuses, employer token)
OPERATIONS: dict[str, tuple[str, str, set[str], bool]] = {
    "list_sites": ("get", f"{API}/sites", {"501"}, False),
    "get_site_forecast_today": (
        "get",
        f"{API}/sites/{{site_id}}/forecast/today",
        {"404", "422", "501", "503"},
        False,
    ),
    "get_risk_policy": ("get", f"{API}/risk-policy", {"501", "503"}, False),
    "list_site_crews": ("get", f"{API}/sites/{{site_id}}/crews", {"404", "422", "501"}, False),
    "get_crew_timeline": ("get", f"{API}/crews/{{crew_id}}/timeline", {"404", "422", "501", "503"}, False),
    "get_crew_day_plan": (
        "get",
        f"{API}/crews/{{crew_id}}/day-plan",
        {"401", "403", "404", "422", "429", "500", "501", "503"},
        True,
    ),
    "sign_off_day_plan": (
        "post",
        f"{API}/crews/{{crew_id}}/day-plan/sign-off",
        {"401", "403", "404", "409", "422", "429", "500", "501", "503"},
        True,
    ),
    "validate_plan": ("post", f"{API}/plans/validate", {"404", "422", "501", "503"}, False),
    "create_push_subscription": ("post", f"{API}/push/subscriptions", {"404", "422", "501"}, False),
    "delete_push_subscription": ("delete", f"{API}/push/subscriptions/{{subscription_id}}", {"422", "501"}, False),
    "create_data_request": (
        "post",
        f"{API}/sites/{{site_id}}/data-requests",
        {"401", "403", "404", "422", "429", "501", "503"},
        True,
    ),
    "get_site_transparency_log": ("get", f"{API}/sites/{{site_id}}/transparency-log", {"404", "422", "501"}, False),
    "create_crew_stop": (
        "post",
        f"{API}/crews/{{crew_id}}/stops",
        {"401", "403", "404", "422", "429", "501"},
        True,
    ),
    "delete_crew_stop": (
        "delete",
        f"{API}/crews/{{crew_id}}/stops/{{stop_id}}",
        {"401", "403", "404", "422", "429", "501"},
        True,
    ),
    "reset_demo_site": (
        "post",
        f"{API}/sites/{{site_id}}/demo-reset",
        {"401", "403", "404", "409", "422", "429", "500", "501"},
        True,
    ),
}
HEALTH = {"health_live": ("get", f"{API}/health/live"), "health_ready": ("get", f"{API}/health/ready")}

SUCCESS_STATUS = {
    "list_sites": "200",
    "get_site_forecast_today": "200",
    "get_risk_policy": "200",
    "list_site_crews": "200",
    "get_crew_timeline": "200",
    "get_crew_day_plan": "200",
    "sign_off_day_plan": "201",
    "validate_plan": "200",
    "create_push_subscription": "201",
    "delete_push_subscription": "204",
    "create_data_request": None,  # always a problem (ADR 0054): no success response exists
    "get_site_transparency_log": "200",
    "create_crew_stop": "201",
    "delete_crew_stop": "204",
    "reset_demo_site": "200",
}

# Problem schemas keep `additionalProperties: true` on purpose: RFC 9457 extension members (`errors`, `missing_items`,
# `dependency`, ...) travel next to the standard members.
RFC9457_MEMBERS = {"type", "title", "status", "detail", "instance", "request_id"}
OPEN_PROBLEM_SCHEMAS = {"Problem", "ValidationProblem", "RosterInvalidProblem", "ReviewRequiredProblem"}

# (schema, property) pairs that match the member-like regex and are allowed. Nothing else may.
MEMBER_LIKE = r"(worker|member|employee|heart|symptom|acclimat|juvenile)"
MEMBER_LIKE_ALLOWED = {
    (
        "DataRequestCreate",
        "worker_ref",
    ): "write-only free text, validated then discarded, never stored or echoed (ADR 0054)",
    ("Crew", "member_count"): "an aggregate head count of the crew (ADR 0050), not a per-member value",
    ("RiskPolicy", "acclimatisation_days_required"): "a policy constant of the ruleset (ADR 0049 decision 5)",
    (
        "PlanCrewInput",
        "acclimatised",
    ): "try-a-plan: one crew-level assumption flag for the whole hypothetical crew, no member",
}


def examples_of(model: type[BaseModel]) -> list[dict[str, Any]]:
    extra = model.model_config.get("json_schema_extra")
    assert isinstance(extra, dict), model.__name__
    found = extra["examples"]
    assert isinstance(found, list), model.__name__
    return [cast(dict[str, Any], example) for example in found]


@pytest.fixture
def spec(settings: Settings) -> dict[str, Any]:
    schema: dict[str, Any] = create_app(settings).openapi()
    return schema


def operations(spec: dict[str, Any]) -> dict[str, tuple[str, str, dict[str, Any]]]:
    return {
        operation["operationId"]: (method, path, operation)
        for path, item in spec["paths"].items()
        for method, operation in item.items()
        if method in HTTP_METHODS
    }


def schemas(spec: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, Any] = spec["components"]["schemas"]
    return found


def walk(node: Any) -> Any:
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk(item)


def ref_name(schema: dict[str, Any]) -> str:
    return str(schema["$ref"]).rsplit("/", 1)[-1]


@pytest.mark.unit
def test_paths_and_operation_ids(spec: dict[str, Any]) -> None:
    found = {op_id: (method, path) for op_id, (method, path, _) in operations(spec).items()}

    expected = {op_id: (method, path) for op_id, (method, path, _, _) in OPERATIONS.items()} | HEALTH
    assert found == expected
    assert len(OPERATIONS) == 15


@pytest.mark.unit
def test_parameters_names_and_types(spec: dict[str, Any]) -> None:
    ops = operations(spec)

    def params(op_id: str) -> dict[str, tuple[str, bool]]:
        return {p["name"]: (p["in"], p["required"]) for p in ops[op_id][2].get("parameters", [])}

    assert params("list_sites") == {}
    assert params("get_risk_policy") == {}
    assert params("get_site_forecast_today") == {"site_id": ("path", True), "date": ("query", False)}
    assert params("list_site_crews") == {"site_id": ("path", True), "date": ("query", False)}
    assert params("get_crew_timeline") == {"crew_id": ("path", True), "date": ("query", False)}
    assert params("get_crew_day_plan") == {"crew_id": ("path", True), "date": ("query", False)}
    assert params("sign_off_day_plan") == {"crew_id": ("path", True), "date": ("query", False)}
    assert params("delete_push_subscription") == {"subscription_id": ("path", True)}
    assert params("create_data_request") == {"site_id": ("path", True)}
    assert params("get_site_transparency_log") == {"site_id": ("path", True)}
    assert params("create_crew_stop") == {"crew_id": ("path", True)}
    assert params("delete_crew_stop") == {"crew_id": ("path", True), "stop_id": ("path", True)}
    assert params("reset_demo_site") == {"site_id": ("path", True)}
    assert params("validate_plan") == {}
    assert params("create_push_subscription") == {}
    # `date` is a calendar date (the site's local date), never a free string.
    for op_id in ("get_site_forecast_today", "get_crew_timeline", "get_crew_day_plan", "sign_off_day_plan"):
        date_param = next(p for p in ops[op_id][2]["parameters"] if p["name"] == "date")
        variants = date_param["schema"].get("anyOf", [date_param["schema"]])
        assert {"type": "string", "format": "date"} in variants, op_id
        assert date_param["description"]
    for op_id, (_, _, operation) in ops.items():
        for p in operation.get("parameters", []):
            assert p["description"], f"{op_id}.{p['name']} has no description"


@pytest.mark.unit
def test_success_statuses_and_bodies(spec: dict[str, Any]) -> None:
    ops = operations(spec)

    for op_id, success in SUCCESS_STATUS.items():
        responses = ops[op_id][2]["responses"]
        two_hundreds = sorted(code for code in responses if code.startswith("2"))
        assert two_hundreds == ([] if success is None else [success]), op_id
    assert "content" not in ops["delete_push_subscription"][2]["responses"]["204"]
    assert "content" not in ops["delete_crew_stop"][2]["responses"]["204"]
    assert "requestBody" not in ops["reset_demo_site"][2]
    body = ops["sign_off_day_plan"][2]["requestBody"]["content"]["application/json"]["schema"]
    assert ref_name(body) == "PlanSignOffRequest"
    created = ops["sign_off_day_plan"][2]["responses"]["201"]["content"]["application/json"]["schema"]
    assert ref_name(created) == "PlanSignOff"
    refused = ops["create_data_request"][2]["responses"]["403"]["content"][PROBLEM_JSON]["schema"]
    assert ref_name(refused) == "Problem"


@pytest.mark.unit
def test_employer_routes_declare_a_bearer_security_scheme(spec: dict[str, Any]) -> None:
    scheme = spec["components"]["securitySchemes"]["EmployerBearer"]

    assert scheme["type"] == "http"
    assert scheme["scheme"] == "bearer"
    assert scheme["description"]
    for op_id, (_, _, operation) in operations(spec).items():
        employer = OPERATIONS[op_id][3] if op_id in OPERATIONS else False
        assert operation.get("security") == ([{"EmployerBearer": []}] if employer else None), op_id


@pytest.mark.unit
def test_security_scheme_survives_a_wrapping_dependency(settings: Settings) -> None:
    """Task 10 swaps the bare scheme for an `EmployerDep` that depends on it: the document must not change."""
    app = FastAPI()

    async def bare() -> None: ...

    async def employer_principal(credentials: Any = Depends(employer_bearer)) -> None:  # noqa: B008
        return None

    app.get("/bare", dependencies=[Depends(employer_bearer)])(bare)
    app.get("/wrapped", dependencies=[Depends(employer_principal)])(bare)

    paths = app.openapi()["paths"]
    assert paths["/bare"]["get"]["security"] == paths["/wrapped"]["get"]["security"] == [{"EmployerBearer": []}]
    # auto_error=False: a missing token reaches the app, which answers 401 with a problem body (not FastAPI's 403).
    assert TestClient(app).get("/bare").status_code == 200


@pytest.mark.unit
def test_every_operation_declares_its_problem_responses(spec: dict[str, Any]) -> None:
    for op_id, (_, _, statuses, employer) in OPERATIONS.items():
        operation = operations(spec)[op_id][2]
        responses = operation["responses"]
        declared = {code for code in responses if not code.startswith("2") and code != "default"}
        assert declared == statuses, op_id
        assert "default" in responses, op_id
        for code in [*declared, "default"]:
            content = responses[code]["content"]
            assert list(content) == [PROBLEM_JSON], f"{op_id} {code}"
            schema = content[PROBLEM_JSON]["schema"]
            names = [ref_name(s) for s in schema.get("oneOf", [schema])]
            assert set(names) <= OPEN_PROBLEM_SCHEMAS, f"{op_id} {code}: {names}"
            assert responses[code]["description"], f"{op_id} {code}"
        if employer:
            header = responses["429"]["headers"]["Retry-After"]
            assert header["schema"]["type"] == "integer"
            assert header["description"]


@pytest.mark.unit
def test_problem_extension_shapes_are_components(spec: dict[str, Any]) -> None:
    found = schemas(spec)

    assert found["ReviewRequiredProblem"]["properties"]["missing_items"]["items"] == {"type": "string"}
    assert "missing_items" in found["ReviewRequiredProblem"]["required"]
    roster = found["RosterInvalidProblem"]
    assert ref_name(roster["properties"]["errors"]["items"]) == "RosterError"
    assert sorted(found["RosterError"]["required"]) == ["line", "message"]
    assert sorted(found["ValidationErrorItem"]["required"]) == ["loc", "msg", "type"]
    # 422 of validate_plan: either the framework's validation problem or the roster problem.
    responses = operations(spec)["validate_plan"][2]["responses"]
    one_of = responses["422"]["content"][PROBLEM_JSON]["schema"]["oneOf"]
    assert {ref_name(s) for s in one_of} == {"ValidationProblem", "RosterInvalidProblem"}
    review = operations(spec)["sign_off_day_plan"][2]["responses"]["409"]["content"][PROBLEM_JSON]["schema"]
    assert ref_name(review) == "ReviewRequiredProblem"


@pytest.mark.unit
def test_no_member_like_properties(spec: dict[str, Any]) -> None:
    import re

    pattern = re.compile(MEMBER_LIKE, re.IGNORECASE)
    hits: set[tuple[str, str]] = set()
    for schema_name, schema in schemas(spec).items():
        for prop in schema.get("properties", {}):
            if pattern.search(prop):
                hits.add((schema_name, prop))
    for op_id, (_, _, operation) in operations(spec).items():
        for param in operation.get("parameters", []):
            assert not pattern.search(param["name"]), f"{op_id} parameter {param['name']}"

    assert hits == set(MEMBER_LIKE_ALLOWED), f"unexpected member-like property names: {hits - set(MEMBER_LIKE_ALLOWED)}"
    assert all(MEMBER_LIKE_ALLOWED.values())


@pytest.mark.unit
def test_f1_governance_names_parity(spec: dict[str, Any]) -> None:
    """F1's contract-governance.test.ts name regex, with its own single exception (`crew_name`)."""
    import re

    personal = re.compile(r"worker|member_id|name_of|employee|heart|symptom", re.IGNORECASE)
    names: list[tuple[str, str]] = []
    for node in walk(spec):
        for prop in node.get("properties", {}) if isinstance(node.get("properties"), dict) else []:
            names.append(("property", prop))
        if isinstance(node.get("name"), str) and isinstance(node.get("in"), str):
            names.append(("parameter", node["name"]))

    offenders = sorted({name for _, name in names if personal.search(name) and name != "crew_name"})
    # The one name F1's regex matches is the write-only `worker_ref` (ADR 0054): F1 must allow-list it.
    assert offenders == ["worker_ref"]


@pytest.mark.unit
def test_crew_hour_has_no_share_above_amber(spec: dict[str, Any]) -> None:
    hour = schemas(spec)["CrewHour"]

    assert sorted(hour["properties"]) == ["ban_active", "crew_level", "starts_at"]
    assert "share_above_amber" not in str(spec)


@pytest.mark.unit
def test_crew_derivation_rule_is_written_into_the_descriptions(spec: dict[str, Any]) -> None:
    found = schemas(spec)
    level = found["CrewHour"]["properties"]["crew_level"]["description"]
    suppressed = found["CrewTimeline"]["properties"]["suppressed"]["description"]

    for phrase in ("server-held", "never from personal risk reported by a device", "no member-derived information"):
        assert phrase in level, phrase
    assert "no member-derived information" in suppressed
    assert "fewer than k" in suppressed
    assert found["CrewTimeline"]["properties"]["k"]["description"]


@pytest.mark.unit
def test_artifact_components_present(spec: dict[str, Any]) -> None:
    found = schemas(spec)

    for name in ("PolicyScoreboard", "PlanScoreboard", "DemoDay", "ThetaDecision", "Provenance", "Metric", "Interval"):
        assert name in found, name
    for name in ("PolicyScoreboard", "PlanScoreboard", "DemoDay", "ThetaDecision"):
        assert "provenance" in found[name]["required"], name
    assert found["ProvenanceLabel"]["enum"] == ["REAL", "REAL weather + assumed crew", "SIMULATED"]


@pytest.mark.unit
def test_every_object_forbids_additional_properties(spec: dict[str, Any]) -> None:
    components = schemas(spec)
    open_inline = [
        node
        for name, schema in components.items()
        if name not in OPEN_PROBLEM_SCHEMAS
        for node in walk(schema)
        if node.get("type") == "object" and node.get("additionalProperties") is not False
    ]

    assert open_inline == []
    for name in OPEN_PROBLEM_SCHEMAS:
        assert components[name]["additionalProperties"] is True, name


@pytest.mark.unit
@pytest.mark.parametrize("model", REQUEST_MODELS, ids=lambda m: m.__name__)
def test_request_models_reject_unknown_members(model: type[BaseModel]) -> None:
    example = examples_of(model)[0]
    with pytest.raises(ValidationError, match="extra_forbidden"):
        model.model_validate({**example, "unexpected_member": 1})


@pytest.mark.unit
def test_plan_validate_request_takes_exactly_one_input() -> None:
    example = examples_of(PlanValidateRequest)[0]
    assert example["roster_text"]
    assert example["segments"] is None
    both = {**example, "segments": [{"start": "06:00", "end": "11:00", "state": "work"}]}
    neither = {**example, "roster_text": None}
    for bad in (both, neither):
        with pytest.raises(ValidationError, match="exactly one"):
            PlanValidateRequest.model_validate(bad)
    PlanValidateRequest.model_validate({**example, "roster_text": None, "segments": both["segments"]})
    for patch in ({"crew": {**example["crew"], "headcount": 0}}, {"crew": {**example["crew"], "headcount": 201}}):
        with pytest.raises(ValidationError):
            PlanValidateRequest.model_validate({**example, **patch})
    with pytest.raises(ValidationError):
        PlanValidateRequest.model_validate({**example, "roster_text": "x" * 2001})


@pytest.mark.unit
def test_crew_and_policy_shapes(spec: dict[str, Any]) -> None:
    found = schemas(spec)

    assert sorted(found["Crew"]["properties"]) == sorted(
        [
            "id",
            "site_id",
            "name",
            "task_label",
            "workload",
            "member_count",
            "shift",
            "signoff_state",
            "plan_status",
            "stopped",
            "active_stop_id",
            "stopped_at",
        ]
    )
    assert sorted(found["Crew"]["required"]) == sorted(found["Crew"]["properties"])
    assert sorted(found["ShiftWindow"]["properties"]) == ["end", "start"]
    assert sorted(found["RiskPolicy"]["required"]) == sorted(
        [
            "version",
            "config_version",
            "k_suppression",
            "k_health",
            "acclimatisation_days_required",
            "bands",
            "workload_classes",
            "clothing_options",
        ]
    )
    assert sorted(found["SiteForecastToday"]["required"]) == sorted(
        [
            "site_id",
            "date",
            "generated_at",
            "policy_version",
            "config_version",
            "mode",
            "forecast_status",
            "model_id",
            "lead_days",
            "ban_window",
            "hours",
        ]
    )
    assert found["AlertLevel"]["enum"] == ["green", "amber", "orange", "red"]


@pytest.mark.unit
def test_ban_window_is_data_on_every_timeline_response(spec: dict[str, Any]) -> None:
    found = schemas(spec)

    assert sorted(found["BanWindow"]["required"]) == sorted(
        ["start", "end", "season_start", "season_end", "timezone", "active_on_date", "starts_at", "ends_at"]
    )
    for name in ("SiteForecastToday", "CrewTimeline", "DayPlan", "PlanValidateResponse"):
        assert ref_name(found[name]["properties"]["ban_window"]) == "BanWindow", name
        assert "ban_window" in found[name]["required"], name


@pytest.mark.unit
def test_day_plan_shape(spec: dict[str, Any]) -> None:
    plan = schemas(spec)["DayPlan"]

    assert sorted(plan["required"]) == sorted(plan["properties"])
    assert plan["properties"]["banner_code"]["const"] == "plan.floor_banner"
    assert plan["properties"]["signoff_state"]["enum"] == ["unsigned", "signed", "changed_since_signed"]
    assert plan["properties"]["status"]["enum"] == ["rule", "fallback"]
    assert "ack_items" in plan["properties"]
    assert "review_items" not in plan["properties"]
    for field in ("signoff_label_code", "signed_at", "signed_by_role", "restricted_headcount", "model_id"):
        variants = plan["properties"][field]["anyOf"]
        assert {"type": "null"} in variants, field
    ack = schemas(spec)["AckItem"]
    assert ack["properties"]["zone"]["enum"] == ["medium", "high", "red"]
    assert "<zone>-<HHMM>" in ack["properties"]["id"]["description"]
    assert sorted(schemas(spec)["PlanSegment"]["required"]) == sorted(
        ["starts_at", "ends_at", "state", "zone", "rule_id", "clause"]
    )
    states = schemas(spec)["PlanState"]["enum"]
    assert states == ["work", "adosh_rest", "art18_break", "ban", "stopped", "off"]


def leaf_types(annotation: Any) -> set[Any]:
    """Every class an annotation is made of, looking through unions, lists and Annotated."""
    args = get_args(annotation)
    if not args:
        return {annotation}
    if get_origin(annotation) is Annotated:
        return leaf_types(args[0])
    found: set[Any] = set()
    for arg in args:
        found |= leaf_types(arg)
    return found


def models_of(module: Any) -> list[type[BaseModel]]:
    return [
        model
        for model in vars(module).values()
        if isinstance(model, type) and issubclass(model, BaseModel) and model.__module__ == module.__name__
    ]


def naive_datetime_fields(module: Any) -> list[str]:
    return [
        f"{model.__name__}.{field}"
        for model in models_of(module)
        for field, info in model.model_fields.items()
        if datetime.datetime in leaf_types(info.annotation)
    ]


def aware_datetime_fields(module: Any) -> int:
    return sum(
        AwareDatetime in leaf_types(info.annotation)
        for model in models_of(module)
        for info in model.model_fields.values()
    )


@pytest.mark.unit
def test_every_instant_is_timezone_aware() -> None:
    """A plain `datetime` field would accept a naive instant, and the JSON schema of `AwareDatetime` looks the same,
    so this inspects the annotations."""
    assert naive_datetime_fields(api_models) == []
    assert naive_datetime_fields(scoreboard) == []
    # Not vacuous: both modules hold aware instants, and the walker flags a plain datetime.
    assert aware_datetime_fields(api_models) > 15
    assert aware_datetime_fields(scoreboard) >= 2

    leaky = types.ModuleType("leaky")

    class Leaky(BaseModel):
        at: datetime.datetime | None

    Leaky.__module__ = "leaky"
    leaky.Leaky = Leaky  # type: ignore[attr-defined]
    assert naive_datetime_fields(leaky) == ["Leaky.at"]


@pytest.mark.unit
def test_every_public_field_has_a_description(spec: dict[str, Any]) -> None:
    """Every field of every component, nested models included, says what it is (an id or label says it itself)."""
    obvious_names = {"id", "name", "site_id", "crew_id", "crew_name"}
    missing = [
        f"{name}.{prop}"
        for name, schema in schemas(spec).items()
        if name not in {"Problem", "LiveResponse", "ReadyChecks", "ReadyResponse"}  # B1 health models
        for prop, definition in schema.get("properties", {}).items()
        if not definition.get("description")
        and prop not in obvious_names
        and not (name in OPEN_PROBLEM_SCHEMAS and prop in RFC9457_MEMBERS)
    ]

    assert missing == []


@pytest.mark.unit
@pytest.mark.parametrize("model", [DayPlan, PlanValidateResponse], ids=lambda m: m.__name__)
def test_every_plan_payload_carries_the_floor_banner(spec: dict[str, Any], model: type[BaseModel]) -> None:
    schema = schemas(spec)[model.__name__]

    assert schema["properties"]["banner_code"]["const"] == "plan.floor_banner"
    assert "banner_code" in schema["required"]
    assert examples_of(model)[0]["banner_code"] == "plan.floor_banner"


@pytest.mark.unit
def test_signoff_states_and_labels(spec: dict[str, Any]) -> None:
    found = schemas(spec)
    three = ["unsigned", "signed", "changed_since_signed"]

    for name in ("DayPlan", "Crew", "CrewTimeline"):
        assert found[name]["properties"]["signoff_state"]["enum"] == three, name
    assert found["PlanSignOff"]["properties"]["signoff_state"]["const"] == "signed"
    label = found["DayPlan"]["properties"]["signoff_label_code"]["anyOf"]
    assert {"type": "string", "enum": ["plan.unsigned_fallback", "plan.changed_since_signed"]} in label
    assert {"type": "null"} in label
    assert "changed_since_signed" in found["DayPlan"]["properties"]["signoff_state"]["description"]
    for name in ("DayPlan", "PlanSignOff"):
        assert "signed_by" not in found[name]["properties"], name
    assert found["PlanSignOff"]["properties"]["signed_by_role"]["const"] == "supervisor"


@pytest.mark.unit
def test_crew_status_can_clear_a_stop_after_a_reload(spec: dict[str, Any]) -> None:
    crew = schemas(spec)["Crew"]

    for field in ("active_stop_id", "stopped_at"):
        assert field in crew["required"]
        assert {"type": "null"} in crew["properties"][field]["anyOf"]
    for field in ("signoff_state", "plan_status"):
        description = crew["properties"][field]["description"]
        assert "response date" in description, field
        assert "today" not in description, field


@pytest.mark.unit
def test_f2_alignment_fields(spec: dict[str, Any]) -> None:
    found = schemas(spec)

    assert "task_label" in found["Crew"]["properties"]
    assert "task" not in found["Crew"]["properties"]
    timeline = found["CrewTimeline"]
    assert ref_name(timeline["properties"]["shift"]["items"]) == "TimeRange"
    assert {"shift", "signoff_state"} <= set(timeline["required"])
    ban = found["BanWindow"]
    for field in ("starts_at", "ends_at"):
        assert field in ban["required"]
        assert {"type": "null"} in ban["properties"][field]["anyOf"]
    assert "never a null object" in found["SiteForecastToday"]["properties"]["ban_window"]["description"]
    assert found["AckItem"]["properties"]["text_code"]["type"] == "string"
    assert "text_code" in found["AckItem"]["required"]
    assert examples_of(AckItem)[0]["text_code"] == "cycle.high.heavy.20-40"


@pytest.mark.unit
def test_scoreboards_say_which_evaluation_they_are(spec: dict[str, Any]) -> None:
    found = schemas(spec)

    for name in ("PolicyScoreboard", "PlanScoreboard", "DemoDay"):
        assert found[name]["properties"]["evaluation_set"]["enum"] == ["dev_2025", "scored_2026"], name
        assert "evaluation_set" in found[name]["required"], name
    assert "evaluation_set" not in found["ThetaDecision"]["properties"]
    hour = found["DemoDayHour"]
    quantiles = next(v for v in hour["properties"]["corrected_wbgt_c"]["anyOf"] if "$ref" in v)
    assert ref_name(quantiles) == "WbgtQuantiles"
    assert "corrected_wbgt_c" in hour["required"]
    assert "high_hours_outside_ban" in found["DemoDay"]["properties"]["score"]["description"]


@pytest.mark.unit
def test_push_subscription_accepts_only_the_browser_names() -> None:
    example = examples_of(PushSubscriptionDetails)[0]
    snake = {k: v for k, v in example.items() if k != "expirationTime"} | {"expiration_time": None}

    with pytest.raises(ValidationError):
        PushSubscriptionDetails.model_validate(snake)


@pytest.mark.unit
def test_crew_id_has_its_own_id_alias() -> None:
    crew_id = get_args(PushSubscriptionCreate.model_fields["crew_id"].annotation)[0]

    assert get_args(crew_id)[1:] == get_args(api_models.EntityId)[1:]


@pytest.mark.unit
@pytest.mark.parametrize("model", [*REQUEST_MODELS, *RESPONSE_MODELS], ids=lambda m: m.__name__)
def test_model_example_validates_and_round_trips(model: type[BaseModel]) -> None:
    examples = examples_of(model)

    assert len(examples) == 1
    parsed = model.model_validate(examples[0])
    assert parsed.model_dump(mode="json", by_alias=True) == examples[0]


@pytest.mark.unit
def test_examples_surface_in_the_document(spec: dict[str, Any]) -> None:
    found = schemas(spec)

    for model in [*REQUEST_MODELS, *RESPONSE_MODELS]:
        assert len(found[model.__name__]["examples"]) == 1, model.__name__
    for model in PROBLEM_MODELS:
        assert len(found[model.__name__]["examples"]) == 1, model.__name__


@pytest.mark.unit
def test_every_problem_type_has_a_valid_example() -> None:
    expected_types = {
        "plan-invalid",
        "roster-invalid",
        "review-required",
        "individual-data-refused",
        "forbidden-employer",
        "unauthorized",
        "rate-limited",
        "not-a-demo-site",
        "not-found",
        "not-implemented",
        "dependency-unavailable",
        "validation-failed",
        "internal-error",
    }

    assert set(PROBLEM_EXAMPLES) == expected_types
    own_models: dict[str, type[Problem]] = {
        "validation-failed": ValidationProblem,
        "roster-invalid": RosterInvalidProblem,
        "review-required": ReviewRequiredProblem,
    }
    for key, example in PROBLEM_EXAMPLES.items():
        own_models.get(key, Problem).model_validate(example)
        parsed = Problem.model_validate(example)
        assert parsed.request_id
        assert parsed.instance
        if key not in {"validation-failed", "internal-error"}:
            assert example["type"] == f"urn:stellar-blaze:problem:{key}", key
    assert PROBLEM_EXAMPLES["roster-invalid"]["errors"][0]["line"] == 2
    assert PROBLEM_EXAMPLES["review-required"]["missing_items"] == ["high-0600"]


@pytest.mark.unit
def test_ack_item_id_in_the_day_plan_example() -> None:
    example = examples_of(DayPlan)[0]
    ids = [item["id"] for item in example["ack_items"]]

    assert ids
    assert all(i.split("-")[0] in {"medium", "high", "red"} and len(i.split("-")[1]) == 4 for i in ids)
    assert "high-0600" in ids


@pytest.mark.unit
def test_problem_type_constants() -> None:
    from stellar_blaze import errors

    expected = {
        "NOT_IMPLEMENTED": "not-implemented",
        "INDIVIDUAL_DATA_REFUSED": "individual-data-refused",
        "FORBIDDEN_EMPLOYER": "forbidden-employer",
        "UNAUTHORIZED": "unauthorized",
        "PLAN_INVALID": "plan-invalid",
        "ROSTER_INVALID": "roster-invalid",
        "NOT_FOUND": "not-found",
        "REVIEW_REQUIRED": "review-required",
        "RATE_LIMITED": "rate-limited",
        "NOT_A_DEMO_SITE": "not-a-demo-site",
    }
    for name, kebab in expected.items():
        assert getattr(errors, name) == f"urn:stellar-blaze:problem:{kebab}"


@pytest.mark.unit
def test_openapi_served_by_the_app_equals_the_exported_spec(settings: Settings) -> None:
    from stellar_blaze.api.export_openapi import build_spec

    assert TestClient(create_app(settings)).get("/openapi.json").json() == build_spec()


@pytest.mark.unit
@pytest.mark.parametrize("op_id", sorted(OPERATIONS))
def test_stub_routes_answer_501_until_implemented(settings: Settings, op_id: str) -> None:
    """Task 0 stubs. Task 10 and Task 11 delete the line of each route they implement; the contract stays."""
    method, path, _, _ = OPERATIONS[op_id]
    url = path.replace("{site_id}", "site-demo-mussafah").replace("{crew_id}", "crew-b")
    url = url.replace("{subscription_id}", "sub-1").replace("{stop_id}", "stop-1")
    bodies: dict[str, Any] = {
        "validate_plan": {
            "site_id": "site-demo-mussafah",
            "date": "2026-07-01",
            "crew": {"workload": "heavy", "headcount": 20},
            "roster_text": "06:00-11:00 work",
        },
        "create_push_subscription": {
            "subscription": {
                "endpoint": "https://push.example/send/abc",
                "expirationTime": None,
                "keys": {"p256dh": "k", "auth": "a"},
            },
            "site_id": "site-demo-mussafah",
            "crew_id": None,
        },
        "sign_off_day_plan": {"acknowledged_items": [], "deviation_reason_code": None},
        "create_data_request": {"subject": "worker", "data_class": "health", "worker_ref": "ref"},
        "create_crew_stop": {"reason_code": "heat"},
    }

    response = TestClient(create_app(settings), raise_server_exceptions=False).request(
        method, url, json=bodies.get(op_id)
    )

    assert response.status_code == 501
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    assert response.json()["type"] == NOT_IMPLEMENTED


@pytest.mark.unit
def test_site_carries_epoch_and_unwell_contacts(spec: dict[str, Any]) -> None:
    site = schemas(spec)["Site"]

    assert sorted(site["required"]) == sorted(
        ["id", "name", "timezone", "synthetic", "epoch_id", "supervisor_phone", "first_aider_phone"]
    )
    for field in ("supervisor_phone", "first_aider_phone"):
        variants = site["properties"][field]["anyOf"]
        assert {"type": "null"} in variants
        pattern = next(v["pattern"] for v in variants if "pattern" in v)
        assert pattern == r"^\+[1-9][0-9]{6,14}$"
        assert "SYNTHETIC" in site["properties"][field]["description"]
    example = examples_of(Site)[0]
    assert (example["supervisor_phone"], example["first_aider_phone"]) == ("+12025550143", "+12025550144")
    assert {"type": "null"} in site["properties"]["epoch_id"]["anyOf"]
    for bad in ("12025550143", "+0123456789", "+1202", "+1202555014312345", "tel:+12025550143"):
        with pytest.raises(ValidationError):
            Site.model_validate({**example, "supervisor_phone": bad})
    Site.model_validate({**example, "supervisor_phone": None, "first_aider_phone": None, "epoch_id": None})


@pytest.mark.unit
def test_demo_reset_is_an_epoch_not_a_deletion(spec: dict[str, Any]) -> None:
    reset = schemas(spec)["DemoReset"]

    assert sorted(reset["properties"]) == ["epoch_id", "previous_epoch_id", "reset_at", "site_id"]
    assert sorted(reset["required"]) == sorted(reset["properties"])
    operation = operations(spec)["reset_demo_site"][2]
    text = operation["description"] + reset["properties"]["epoch_id"]["description"]
    for phrase in (
        "Nothing is deleted",
        "`epoch_id` increases by one",
        "alert events and push subscriptions",
        "records `demo_reset` (not visible to workers)",
        "not-a-demo-site",
    ):
        assert phrase in text, phrase


@pytest.mark.unit
def test_rate_limits_are_in_the_contract_on_every_employer_operation(spec: dict[str, Any]) -> None:
    for op_id, (_, _, _, employer) in OPERATIONS.items():
        operation = operations(spec)[op_id][2]
        if not employer:
            assert "x-rate-limit" not in operation, op_id
            continue
        expected = [{"limit": 1, "window_seconds": 60}, {"limit": 10, "window_seconds": 3600}]
        if op_id != "reset_demo_site":
            expected = [{"limit": 60, "window_seconds": 60}]
        assert operation["x-rate-limit"] == expected, op_id
        assert "Rate limit, per access token" in operation["description"], op_id
        for item in expected:
            assert f"{item['limit']} per {item['window_seconds']} s" in operation["description"], op_id


@pytest.mark.unit
def test_stop_and_sign_off_copy_never_claims_delivery(spec: dict[str, Any]) -> None:
    """ADR 0058 decision 5: no HTTP call sends an alert; the dispatch job does."""
    import re

    claim = re.compile(r"alert|notif|push|phone", re.IGNORECASE)
    stop_texts = [operations(spec)[op][2]["description"] for op in ("create_crew_stop", "delete_crew_stop")]
    texts = [
        *stop_texts,
        operations(spec)["sign_off_day_plan"][2]["description"],
        schemas(spec)["CrewStop"]["description"],
    ]
    for text in texts:
        flat = " ".join(text.split()).replace("push alerts are sent by the alert dispatch job, not by this call", "")
        assert not claim.search(flat), text
    assert "Stop recorded" in stop_texts[0]
    assert " ".join(stop_texts[0].split()).count("push alerts are sent by the alert dispatch job") == 1
