"""The OpenAPI contract says what the wire carries: always-present fields are required, operation ids are stable."""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from stellar_blaze.errors import DomainProblem, Problem

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def operation_ids(spec: dict[str, Any]) -> list[str]:
    return [
        operation["operationId"]
        for item in spec["paths"].values()
        for method, operation in item.items()
        if method in HTTP_METHODS
    ]


@pytest.fixture
def spec(settings: Settings) -> dict[str, Any]:
    schema: dict[str, Any] = create_app(settings).openapi()
    return schema


@pytest.mark.unit
def test_operation_ids_are_unique_and_are_the_route_function_names(spec: dict[str, Any]) -> None:
    ids = operation_ids(spec)

    assert len(ids) == len(set(ids))
    assert {"health_live", "health_ready"} <= set(ids)
    assert spec["paths"]["/api/v1/health/live"]["get"]["operationId"] == "health_live"
    assert spec["paths"]["/api/v1/health/ready"]["get"]["operationId"] == "health_ready"


@pytest.mark.unit
def test_every_route_has_an_operation_id_equal_to_its_function_name(settings: Settings) -> None:
    app: FastAPI = create_app(settings)

    @app.get("/test/things")
    async def list_things() -> list[str]:
        return []

    ids = operation_ids(app.openapi())

    assert "list_things" in ids
    assert len(ids) == len(set(ids))


@pytest.mark.unit
def test_response_models_mark_always_present_fields_required(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]

    assert schemas["LiveResponse"]["required"] == ["status"]
    assert sorted(schemas["ReadyResponse"]["required"]) == ["checks", "status"]
    assert schemas["ReadyChecks"]["required"] == ["database", "config"]
    assert schemas["ReadyChecks"]["properties"]["config"]["enum"] == ["ok", "stale"]  # "missing" is a 503, never a 200


@pytest.mark.unit
def test_problem_schema_matches_what_the_api_sends(spec: dict[str, Any]) -> None:
    problem = spec["components"]["schemas"]["Problem"]

    assert sorted(problem["required"]) == ["instance", "request_id", "status", "title", "type"]
    # `detail` is left out when there is none, never sent as null, so the schema must not promise a null.
    assert "detail" not in problem["required"]
    assert problem["properties"]["detail"]["type"] == "string"
    assert problem["additionalProperties"] is True


@pytest.mark.unit
def test_every_error_the_api_sends_validates_against_the_problem_schema(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/test/forbidden")
    async def forbidden() -> None:
        raise DomainProblem(type_="urn:stellar-blaze:problem:forbidden", title="Forbidden", status=403, detail="No.")

    @app.get("/test/int")
    async def int_param(x: int) -> dict[str, int]:
        return {"x": x}

    @app.get("/test/boom")
    async def boom() -> None:
        raise RuntimeError("secret")

    client = TestClient(app, raise_server_exceptions=False)
    bodies = [
        client.get("/api/v1/nope").json(),
        client.post("/api/v1/health/live").json(),
        client.get("/test/forbidden").json(),
        client.get("/test/int", params={"x": "abc"}).json(),
        client.get("/test/boom").json(),
    ]

    for body in bodies:
        parsed = Problem.model_validate(body)
        assert parsed.request_id
        assert parsed.instance


@pytest.mark.unit
def test_ready_503_validates_against_the_problem_schema() -> None:
    unreachable = Settings(
        env="test",
        log_format="json",
        database_url=SecretStr("postgresql+asyncpg://sb:sb@127.0.0.1:1/x"),
        _env_file=None,
    )
    with TestClient(create_app(unreachable)) as client:
        response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    assert Problem.model_validate(response.json()).status == 503


@pytest.mark.unit
def test_ready_documents_its_503_problem(spec: dict[str, Any]) -> None:
    responses = spec["paths"]["/api/v1/health/ready"]["get"]["responses"]

    assert "200" in responses
    # The wire is application/problem+json (RFC 9457); the document says so, for 503 and for every other problem.
    assert list(responses["503"]["content"]) == ["application/problem+json"]
    problem_ref = responses["503"]["content"]["application/problem+json"]["schema"]["$ref"]
    assert problem_ref == "#/components/schemas/Problem"
    assert list(responses["default"]["content"]) == ["application/problem+json"]


@pytest.mark.unit
def test_health_live_documents_its_default_problem(spec: dict[str, Any]) -> None:
    responses = spec["paths"]["/api/v1/health/live"]["get"]["responses"]

    assert list(responses["default"]["content"]) == ["application/problem+json"]
    schemas = spec["components"]["schemas"]
    for name in ("LiveResponse", "ReadyChecks", "ReadyResponse"):
        assert schemas[name]["additionalProperties"] is False, name
