import { apiClient } from "@/api/client";
import { call, type Result } from "@/api/result";
import type { PushSubscriptionBody, PushSubscriptionCreated } from "@/features/push/subscribe";

/*
 * The two calls the push flow makes (docs/contracts/web-push.md section 1), through the same-origin proxy. Both are
 * POST or DELETE: the service worker has no route for a method other than GET (features/pwa/runtime-caching.ts), so
 * neither is ever cached, and the subscription's endpoint and keys never reach Cache Storage.
 */

export function postSubscription(body: PushSubscriptionBody): Promise<Result<PushSubscriptionCreated>> {
  return call(apiClient.POST("/api/v1/push/subscriptions", { body }));
}

export function deleteSubscription(serverId: string): Promise<Result<unknown>> {
  return call(apiClient.DELETE("/api/v1/push/subscriptions/{subscription_id}", { params: { path: { subscription_id: serverId } } }));
}
