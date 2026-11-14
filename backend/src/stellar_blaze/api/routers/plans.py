"""Try-a-plan: check a hypothetical roster against a day's zones. Body arrives in B3 Task 10; the contract is final."""

from fastapi import APIRouter

from stellar_blaze.api.models import PlanValidateRequest, PlanValidateResponse
from stellar_blaze.api.responses import not_implemented, problem_responses

router = APIRouter(tags=["plans"])


@router.post(
    "/plans/validate",
    summary="Check a roster against the day's zones",
    responses=problem_responses(
        "not-found", "validation-failed", "roster-invalid", "not-implemented", "dependency-unavailable"
    ),
)
async def validate_plan(payload: PlanValidateRequest) -> PlanValidateResponse:
    """Run the independent validator on a roster given as text or as segments, for a hypothetical crew.

    Nothing is stored. A roster that does not parse is `roster-invalid` (422, `errors` with 1-based line numbers).
    """
    raise not_implemented()
