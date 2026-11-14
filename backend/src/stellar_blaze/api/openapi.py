"""The OpenAPI document of the app: FastAPI's own, plus the components no route's field references.

Two groups of schemas are not reachable from a route model and would be missing from the generated client:
- the problem extension shapes (``ValidationProblem``, ``RosterInvalidProblem``, ``ReviewRequiredProblem``), which
  a route declares by ``$ref`` in its problem responses;
- the evaluation artefacts (``PolicyScoreboard``, ``PlanScoreboard``, ``DemoDay``, ``ThetaDecision``), static files
  that F2 imports at build time (ADR 0051 decision 3), typed by the same ``pnpm api:gen``.

The merge lives in ``app.openapi`` rather than in ``export_openapi`` so that the served ``/openapi.json``, the exported
spec and the committed snapshot are one document.
"""

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from stellar_blaze.api.models import PROBLEM_MODELS
from stellar_blaze.api.rate_limits import EXTENSION, sentence
from stellar_blaze.domain.scoreboard import DemoDay, PlanScoreboard, PolicyScoreboard, ThetaDecision

ARTIFACT_MODELS: list[type[BaseModel]] = [PolicyScoreboard, PlanScoreboard, DemoDay, ThetaDecision]
REF_TEMPLATE = "#/components/schemas/{model}"


def extra_component_schemas() -> dict[str, Any]:
    """Schemas (top-level models and everything they reference) to add to ``components.schemas``."""
    models = [*PROBLEM_MODELS, *ARTIFACT_MODELS]
    _, definitions = models_json_schema([(model, "serialization") for model in models], ref_template=REF_TEMPLATE)
    found: dict[str, Any] = definitions["$defs"]
    return found


def install_openapi(app: FastAPI) -> None:
    """Make ``app.openapi()`` return FastAPI's document with :func:`extra_component_schemas` merged in (idempotent)."""
    default_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        spec = default_openapi()
        schemas: dict[str, Any] = spec.setdefault("components", {}).setdefault("schemas", {})
        for name, schema in extra_component_schemas().items():
            schemas.setdefault(name, schema)
        for item in spec["paths"].values():
            for operation in item.values():
                limits = operation.get(EXTENSION)
                if limits and "Rate limit, per access token" not in operation.get("description", ""):
                    text = operation.get("description", "")
                    operation["description"] = "\n\n".join(part for part in (text, sentence(limits)) if part)
        return spec

    app.openapi = openapi  # type: ignore[method-assign]
