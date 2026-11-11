import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from stellar_blaze.errors import PROBLEM_JSON, DomainProblem

FORBIDDEN = DomainProblem(
    type_="urn:stellar-blaze:problem:forbidden", title="Forbidden", status=403, reason="employer_role"
)


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    app = create_app(settings)

    @app.get("/test/forbidden")
    async def forbidden() -> None:
        raise DomainProblem(
            type_="urn:stellar-blaze:problem:forbidden", title="Forbidden", status=403, reason="employer_role"
        )

    @app.get("/test/forbidden-shared/{n}")
    async def forbidden_shared(n: int) -> None:
        raise FORBIDDEN

    @app.get("/test/int")
    async def int_param(x: int) -> dict[str, int]:
        return {"x": x}

    @app.get("/test/boom")
    async def boom() -> None:
        raise RuntimeError("secret-db-password")

    return app


@pytest.mark.unit
def test_unknown_route_returns_problem_json(app: FastAPI) -> None:
    response = TestClient(app).get("/api/v1/nope")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    body = response.json()
    assert body["type"] == "about:blank"
    assert body["title"] == "Not Found"
    assert body["status"] == 404
    assert body["instance"] == "/api/v1/nope"
    assert body["request_id"]
    assert body["request_id"] == response.headers["X-Request-ID"]


@pytest.mark.unit
def test_http_exception_keeps_its_headers(app: FastAPI) -> None:
    # Starlette's own 405 handler sets Allow; the problem handler must not drop it.
    response = TestClient(app).post("/api/v1/health/live")

    assert response.status_code == 405
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    assert "GET" in response.headers["allow"]
    assert response.json()["title"] == "Method Not Allowed"


@pytest.mark.unit
def test_domain_problem_keeps_extension_members(app: FastAPI) -> None:
    response = TestClient(app).get("/test/forbidden")

    assert response.status_code == 403
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    body = response.json()
    assert body["reason"] == "employer_role"
    assert body["type"] == "urn:stellar-blaze:problem:forbidden"
    assert body["title"] == "Forbidden"
    assert body["status"] == 403
    assert body["instance"] == "/test/forbidden"
    assert body["request_id"] == response.headers["X-Request-ID"]
    assert "detail" not in body


@pytest.mark.unit
def test_reused_domain_problem_gets_the_instance_of_each_request(app: FastAPI) -> None:
    # A DomainProblem may be a module-level constant; filling `instance` must not stick to the first request.
    client = TestClient(app)
    first = client.get("/test/forbidden-shared/1").json()
    second = client.get("/test/forbidden-shared/2").json()

    assert first["instance"] == "/test/forbidden-shared/1"
    assert second["instance"] == "/test/forbidden-shared/2"
    assert FORBIDDEN.problem.instance is None


@pytest.mark.unit
def test_validation_error_is_422_problem(app: FastAPI) -> None:
    response = TestClient(app).get("/test/int", params={"x": "abc"})

    assert response.status_code == 422
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    body = response.json()
    assert body["status"] == 422
    assert isinstance(body["errors"], list)
    assert body["errors"]
    assert body["errors"][0]["loc"] == ["query", "x"]
    assert body["instance"] == "/test/int"


@pytest.mark.unit
def test_unhandled_error_leaks_nothing(app: FastAPI) -> None:
    response = TestClient(app, raise_server_exceptions=False).get("/test/boom")

    assert response.status_code == 500
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    assert "secret" not in response.text
    assert "RuntimeError" not in response.text
    body = response.json()
    assert body["title"] == "Internal Server Error"
    assert body["status"] == 500
    assert "detail" not in body
    assert body["request_id"]
    assert response.headers["X-Request-ID"] == body["request_id"]
