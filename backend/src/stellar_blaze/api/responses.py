"""Problem responses as the v1 contract declares them, one registry for every route.

FastAPI documents an error response from a model, under ``application/json``. The API really answers
``application/problem+json`` (RFC 9457), and an undeclared error shape is an untyped one in the generated client, so
each route declares the problems it can answer through :func:`problem_responses`: media type, schema, a named example
per problem type, and the ``Retry-After`` header of a 429. The examples are validated against the models in
``tests/unit/api/test_openapi_v1_contract.py`` so they cannot rot.
"""

from typing import Any, NamedTuple

from fastapi.responses import JSONResponse

from stellar_blaze.api.models import (
    REQUEST_ID,
    REVIEW_REQUIRED_EXAMPLE,
    ROSTER_INVALID_EXAMPLE,
    SHIFT_NOT_LEGAL_EXAMPLE,
    VALIDATION_FAILED_EXAMPLE,
)
from stellar_blaze.errors import (
    DEPENDENCY_UNAVAILABLE,
    FORBIDDEN_EMPLOYER,
    INDIVIDUAL_DATA_REFUSED,
    NOT_A_DEMO_SITE,
    NOT_FOUND,
    NOT_IMPLEMENTED,
    PLAN_INVALID,
    PROBLEM_JSON,
    RATE_LIMITED,
    SHIFT_NOT_LEGAL,
    UNAUTHORIZED,
    DomainProblem,
)


class ProblemJSONResponse(JSONResponse):
    """Route ``response_class`` for a route whose only answer is a problem: its primary response is documented as
    ``application/problem+json`` too (``create_data_request``, always 403)."""

    media_type = PROBLEM_JSON


class ProblemSpec(NamedTuple):
    status: int
    schema: str
    summary: str
    description: str


# key = the problem type's last URN segment, except `validation-failed` (the framework's 422, type `about:blank`).
SPECS: dict[str, ProblemSpec] = {
    "unauthorized": ProblemSpec(
        401, "Problem", "Unauthorized", "No bearer token, or a token this service does not know."
    ),
    "forbidden-employer": ProblemSpec(
        403, "Problem", "Forbidden", "The token belongs to another employer than the one that owns the resource."
    ),
    "individual-data-refused": ProblemSpec(
        403,
        "Problem",
        "Individual data refused",
        "Individual health, personal or exposure data is not held by this service and is never released to an employer "
        "(ADR 0004). Every request is refused and the refusal is logged.",
    ),
    "not-found": ProblemSpec(404, "Problem", "Not found", "No such site, crew or other id."),
    "validation-failed": ProblemSpec(
        422, "ValidationProblem", "Validation failed", "A path, query or body member is missing or malformed."
    ),
    "roster-invalid": ProblemSpec(
        422,
        "RosterInvalidProblem",
        "Roster invalid",
        "The roster text or segments could not be read; `errors` names the lines.",
    ),
    "shift-not-legal": ProblemSpec(
        422,
        "ShiftNotLegalProblem",
        "Shift not legal",
        "The crew's published shift breaks a shift rule by itself (hours, juvenile rules); `violations` lists them.",
    ),
    "review-required": ProblemSpec(
        409,
        "ReviewRequiredProblem",
        "Review required",
        "Medium, High or Red items of the plan were not acknowledged; `missing_items` lists them.",
    ),
    "not-a-demo-site": ProblemSpec(
        409, "Problem", "Not a demo site", "Only a synthetic site (`Site.synthetic`) can be reset."
    ),
    "rate-limited": ProblemSpec(
        429, "Problem", "Rate limited", "Too many requests; wait `Retry-After` seconds before trying again."
    ),
    "plan-invalid": ProblemSpec(
        500,
        "Problem",
        "Plan invalid",
        "The independent validator rejected the planner's own plan. A bug, never served as a plan; the incident is "
        "audited.",
    ),
    "internal-error": ProblemSpec(
        500,
        "Problem",
        "Internal server error",
        "An unexpected failure; nothing internal is revealed. Quote `request_id`.",
    ),
    "not-implemented": ProblemSpec(
        501, "Problem", "Not implemented", "The route exists in the contract but is not built yet."
    ),
    "dependency-unavailable": ProblemSpec(
        503,
        "Problem",
        "Dependency unavailable",
        "A required dependency (the database or the active configuration) is down.",
    ),
}

TYPES = {
    "unauthorized": UNAUTHORIZED,
    "forbidden-employer": FORBIDDEN_EMPLOYER,
    "individual-data-refused": INDIVIDUAL_DATA_REFUSED,
    "not-found": NOT_FOUND,
    "not-a-demo-site": NOT_A_DEMO_SITE,
    "rate-limited": RATE_LIMITED,
    "shift-not-legal": SHIFT_NOT_LEGAL,
    "plan-invalid": PLAN_INVALID,
    "not-implemented": NOT_IMPLEMENTED,
    "dependency-unavailable": DEPENDENCY_UNAVAILABLE,
}


def _example(key: str, instance: str, title: str, detail: str, **extra: Any) -> dict[str, Any]:
    spec = SPECS[key]
    return {
        "type": TYPES[key],
        "title": title,
        "status": spec.status,
        "detail": detail,
        "instance": instance,
        "request_id": REQUEST_ID,
        **extra,
    }


PROBLEM_EXAMPLES: dict[str, dict[str, Any]] = {
    "unauthorized": _example(
        "unauthorized", "/api/v1/crews/crew-b/day-plan", "Unauthorized", "A bearer token is required."
    ),
    "forbidden-employer": _example(
        "forbidden-employer",
        "/api/v1/crews/crew-b/day-plan",
        "Forbidden",
        "This crew belongs to another employer.",
    ),
    "individual-data-refused": _example(
        "individual-data-refused",
        "/api/v1/sites/site-demo-mussafah/data-requests",
        "Individual data refused",
        "Individual health data is not held by this service and is never released to an employer (ADR 0004).",
    ),
    "not-found": _example("not-found", "/api/v1/crews/crew-z/timeline", "Not found", "No crew crew-z."),
    "validation-failed": VALIDATION_FAILED_EXAMPLE,
    "roster-invalid": ROSTER_INVALID_EXAMPLE,
    "review-required": REVIEW_REQUIRED_EXAMPLE,
    "shift-not-legal": SHIFT_NOT_LEGAL_EXAMPLE,
    "not-a-demo-site": _example(
        "not-a-demo-site",
        "/api/v1/sites/site-prod-1/demo-reset",
        "Not a demo site",
        "Site site-prod-1 is not synthetic.",
    ),
    "rate-limited": _example("rate-limited", "/api/v1/crews/crew-b/stops", "Rate limited", "Too many requests."),
    "plan-invalid": _example(
        "plan-invalid",
        "/api/v1/crews/crew-b/day-plan",
        "Plan invalid",
        "The plan did not pass the independent validator.",
    ),
    "internal-error": {
        "type": "about:blank",
        "title": "Internal Server Error",
        "status": 500,
        "instance": "/api/v1/sites/site-demo-mussafah/demo-reset",
        "request_id": REQUEST_ID,
    },
    "not-implemented": _example("not-implemented", "/api/v1/sites", "Not implemented", "This route is not built yet."),
    "dependency-unavailable": _example(
        "dependency-unavailable",
        "/api/v1/risk-policy",
        "Dependency unavailable",
        "The active configuration is not loaded.",
        dependency="config",
    ),
}

RETRY_AFTER = {
    "description": "Seconds to wait before the request may be repeated.",
    "schema": {"type": "integer", "minimum": 1},
}


def _ref(name: str) -> dict[str, str]:
    return {"$ref": f"#/components/schemas/{name}"}


def problem_responses(*keys: str) -> dict[int | str, dict[str, Any]]:
    """The ``responses=`` entries for the problems a route can answer, plus the shared ``default``.

    Two keys with one status (the 422 of ``validate_plan``) become one response whose schema is a ``oneOf``.
    """
    by_status: dict[int, list[str]] = {}
    for key in keys:
        by_status.setdefault(SPECS[key].status, []).append(key)
    responses: dict[int | str, dict[str, Any]] = {}
    for status, group in sorted(by_status.items()):
        schemas = [_ref(SPECS[key].schema) for key in group]
        media: dict[str, Any] = {
            "schema": schemas[0] if len(schemas) == 1 else {"oneOf": schemas},
            "examples": {key: {"summary": SPECS[key].summary, "value": PROBLEM_EXAMPLES[key]} for key in group},
        }
        responses[status] = {
            "description": " ".join(f"{SPECS[key].summary}: {SPECS[key].description}" for key in group),
            "content": {PROBLEM_JSON: media},
        }
        if status == 429:
            responses[status]["headers"] = {"Retry-After": RETRY_AFTER}
    responses["default"] = {
        "description": "Any other problem (RFC 9457).",
        "content": {PROBLEM_JSON: {"schema": _ref("Problem")}},
    }
    return responses


def not_implemented() -> DomainProblem:
    """What every stub route raises until its task builds the body: ``raise not_implemented()``."""
    return DomainProblem(
        type_=NOT_IMPLEMENTED, title="Not implemented", status=501, detail="This route is not built yet."
    )
