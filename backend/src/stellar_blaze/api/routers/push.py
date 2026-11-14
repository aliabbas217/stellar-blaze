"""Web Push subscriptions (public routes). Bodies arrive in B3 Task 11; the contract is final (ADR 0058)."""

from typing import Annotated

from fastapi import APIRouter, Path

from stellar_blaze.api.models import PushSubscriptionCreate, PushSubscriptionCreated
from stellar_blaze.api.responses import not_implemented, problem_responses

router = APIRouter(tags=["push"])


@router.post(
    "/push/subscriptions",
    summary="Register a Web Push subscription",
    status_code=201,
    responses=problem_responses("not-found", "validation-failed", "not-implemented"),
)
async def create_push_subscription(payload: PushSubscriptionCreate) -> PushSubscriptionCreated:
    """Register the browser's subscription for site alerts and, optionally, one crew's alerts.

    The endpoint is the natural key: a repeat registration returns the existing id (201, same body). An unknown
    `site_id` or `crew_id` is `not-found`. The body holds no worker identifier by design.
    """
    raise not_implemented()


@router.delete(
    "/push/subscriptions/{subscription_id}",
    summary="Remove a Web Push subscription",
    status_code=204,
    responses=problem_responses("validation-failed", "not-implemented"),
)
async def delete_push_subscription(
    subscription_id: Annotated[
        str, Path(min_length=1, max_length=100, description="Id returned by `create_push_subscription`.")
    ],
) -> None:
    """Remove a subscription. Idempotent: deleting one that is already gone is also 204."""
    raise not_implemented()
