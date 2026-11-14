"""Web Push subscriptions (public routes; the proxy rate-limits them, ADR 0051). The contract is final (ADR 0058).

The browser's endpoint and keys are stored for delivery only: they never reach a log line, an audit row or an error;
nothing here logs the request body, and the only identifier that leaves is the subscription id.
"""

from typing import Annotated

from fastapi import APIRouter, Path, Response

from stellar_blaze.api.deps import ServicesDep
from stellar_blaze.api.models import PushSubscriptionCreate, PushSubscriptionCreated
from stellar_blaze.api.responses import problem_responses
from stellar_blaze.api.views import not_found, site_or_404
from stellar_blaze.ports.push import NewSubscription

router = APIRouter(tags=["push"])


@router.post(
    "/push/subscriptions",
    summary="Register a Web Push subscription",
    status_code=201,
    responses=problem_responses("not-found", "validation-failed"),
)
async def create_push_subscription(payload: PushSubscriptionCreate, services: ServicesDep) -> PushSubscriptionCreated:
    """Register the browser's subscription for site alerts and, optionally, one crew's alerts.

    The endpoint is the natural key: a repeat registration returns the existing id (201, same body). An unknown
    `site_id` or `crew_id`, or a crew that is not of that site, is `not-found`. The body holds no worker identifier by
    design.
    """
    site = await site_or_404(services, payload.site_id)
    if payload.crew_id is not None:
        crew = await services.sites.get_crew(payload.crew_id)
        if crew is None or crew.site_id != site.id:
            raise not_found(f"No crew {payload.crew_id} at site {site.id}.")
    epoch = await services.sites.active_epoch(site.id)
    details = payload.subscription
    stored = await services.subs.upsert_by_endpoint(
        NewSubscription(
            endpoint=details.endpoint,
            p256dh=details.keys.p256dh,
            auth=details.keys.auth,
            expiration_time=None if details.expiration_time is None else int(details.expiration_time),
            site_id=site.id,
            crew_id=payload.crew_id,
        ),
        epoch,
    )
    return PushSubscriptionCreated(id=stored)


@router.delete(
    "/push/subscriptions/{subscription_id}",
    summary="Remove a Web Push subscription",
    status_code=204,
    responses=problem_responses("validation-failed"),
)
async def delete_push_subscription(
    subscription_id: Annotated[
        str, Path(min_length=1, max_length=100, description="Id returned by `create_push_subscription`.")
    ],
    services: ServicesDep,
) -> Response:
    """Remove a subscription. Idempotent: deleting one that is already gone is also 204."""
    await services.subs.delete(subscription_id)
    return Response(status_code=204)
