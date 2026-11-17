"""Web Push subscriptions (public routes; the proxy rate-limits them, ADR 0051). The contract is final (ADR 0058).

The browser's endpoint and keys are stored for delivery only: they never reach a log line, an audit row or an error;
nothing here logs the request body, and the only identifier that leaves is the subscription id.
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Path, Response

from stellar_blaze.api.deps import RuntimeDep, ServicesDep
from stellar_blaze.api.models import PushSubscriptionCreate, PushSubscriptionCreated
from stellar_blaze.api.rate_limits import MAX_SUBSCRIPTIONS_PER_CREW, MAX_SUBSCRIPTIONS_PER_SITE
from stellar_blaze.api.responses import problem_responses
from stellar_blaze.api.views import endpoint_host_not_allowed, not_found, site_or_404, validation_failed
from stellar_blaze.errors import DomainProblem
from stellar_blaze.ports.push import NewSubscription, PushStoreError, SubscriptionCapError
from stellar_blaze.ports.push_endpoint import EndpointHostNotAllowedError, check_endpoint_host

router = APIRouter(tags=["push"])
logger = structlog.stdlib.get_logger(__name__)


@router.post(
    "/push/subscriptions",
    summary="Register a Web Push subscription",
    status_code=201,
    responses=problem_responses("not-found", "validation-failed", "endpoint-host-not-allowed"),
)
async def create_push_subscription(
    payload: PushSubscriptionCreate, services: ServicesDep, runtime: RuntimeDep
) -> PushSubscriptionCreated:
    """Register the browser's subscription for site alerts and, optionally, one crew's alerts.

    The endpoint is the natural key: a repeat registration returns the existing id (201, same body, not counted
    against the caps). An unknown `site_id` or `crew_id`, or a crew that is not of that site, is `not-found`. The
    endpoint must be an https URL of a public host and the keys base64url (else `validation-failed`); a site holds at
    most 500 subscriptions and a crew 200 per epoch (over that: `validation-failed`, "too many subscriptions"). The body
    holds no worker identifier by design.

    The endpoint's host must belong to a push service, else 422 `endpoint-host-not-allowed` (the allow-list: Google FCM
    `fcm.googleapis.com`, Mozilla autopush `updates.push.services.mozilla.com`, Apple Web Push `*.push.apple.com` and
    Windows WNS `*.notify.windows.com`). The operator can extend the list in the runtime configuration without a
    restart; a self-hosted push service works only once it is added. The answer names neither the endpoint nor its host.

    If the subscription cannot be stored the answer is a 500 `problem+json` that carries none of the submitted data
    (the endpoint and keys are never echoed back or logged); retry later.
    """
    # The active config is read through ``peek``: with none loaded the built-in list applies (this route never turns
    # into a 503 for want of a config, as it never was one).
    snapshot = runtime.config.peek()
    try:
        check_endpoint_host(
            payload.subscription.endpoint, () if snapshot is None else snapshot.config.push_extra_host_suffixes
        )
    except EndpointHostNotAllowedError:
        logger.info("push.endpoint_host_refused", site_id=payload.site_id)  # never the endpoint or its host
        raise endpoint_host_not_allowed() from None
    site = await site_or_404(services, payload.site_id)
    if payload.crew_id is not None:
        crew = await services.sites.get_crew(payload.crew_id)
        if crew is None or crew.site_id != site.id:
            raise not_found(f"No crew {payload.crew_id} at site {site.id}.")
    epoch = await services.sites.active_epoch(site.id)
    details = payload.subscription
    try:
        # ONE atomic step in the store: a repeat endpoint answers with the existing id (not counted); a new one is
        # counted and inserted together, so concurrent POSTs cannot pass a cap by the size of the burst.
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
            site_cap=MAX_SUBSCRIPTIONS_PER_SITE,
            crew_cap=MAX_SUBSCRIPTIONS_PER_CREW,
        )
    except SubscriptionCapError as cap:
        if cap.scope == "site":
            raise validation_failed(
                "site_id", "too many subscriptions for this site", "too-many-subscriptions", where="body"
            ) from None
        raise validation_failed(
            "crew_id", "too many subscriptions for this crew", "too-many-subscriptions", where="body"
        ) from None
    except Exception as error:
        if isinstance(error, DomainProblem):
            raise
        logger.error("push.subscription_store_failed", error=type(error).__name__)
        raise PushStoreError("the subscription store failed") from None
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
