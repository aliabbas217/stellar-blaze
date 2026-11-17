"""The bearer security scheme of the employer-token routes (ADR 0051 decision 5), declared once.

``employer_bearer`` is what puts ``components.securitySchemes.EmployerBearer`` and the ``security`` requirement into
``openapi/v1.json``. ``auto_error=False`` makes a missing or malformed ``Authorization`` header reach the application
instead of FastAPI's own 403, so the application answers 401 with a problem body and ``WWW-Authenticate: Bearer``.

Task 10 builds its ``EmployerDep`` (token check, own-employer check) as a dependency that itself depends on
``employer_bearer`` and swaps it in for the route-level ``Depends(employer_bearer)``: the generated document is the
same either way (``test_security_scheme_survives_a_wrapping_dependency``).
"""

from fastapi.security import HTTPBearer

employer_bearer = HTTPBearer(
    scheme_name="EmployerBearer",
    auto_error=False,
    description=(
        "Employer access token (demo time: `SB_ACCESS_TOKENS`). Workers have no account and send no token; the routes "
        "that need one answer 401 without it and 403 for a resource of another employer."
    ),
)
