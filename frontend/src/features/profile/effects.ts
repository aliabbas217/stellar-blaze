import { deleteSubscription } from "@/features/push/api";
import { deleteRegistration } from "@/features/push/pending-delete";
import { unsubscribe } from "@/features/push/subscribe";
import { clearDeviceCaches, clearExpirationMetadata } from "@/features/pwa/api-cache";

/*
 * What taking a worker's data back does outside the on-device store: the places the browser and the API keep something
 * that came from the alert subscription or the service worker. The store calls them through this interface, so a test
 * can replace each with a fake and the store never imports a browser global itself.
 */

export interface ProfileEffects {
  /**
   * Drops the browser's push subscription (the registration of the service worker, then its PushManager). Rejects when
   * that failed: alerts may still arrive.
   */
  readonly unsubscribe: () => Promise<void>;
  /**
   * Asks the API to delete a push registration. Resolves true only when the API no longer has it (deleted, or unknown to
   * it); false for anything that leaves it unconfirmed. Never rejects.
   */
  readonly deleteRegistration: (serverId: string) => Promise<boolean>;
  /** Deletes the Cache Storage caches that can hold an API response or a page URL. */
  readonly clearCaches: () => Promise<unknown>;
  /** Empties Serwist's IndexedDB record of what it cached and when. */
  readonly clearCacheMetadata: () => Promise<unknown>;
}

export const browserEffects: ProfileEffects = {
  unsubscribe: async () => {
    // A browser without service workers has no push subscription.
    if (!("serviceWorker" in navigator)) return;
    // Never settles when no worker registers; the store stops waiting after REVOKE_STEP_TIMEOUT_MS.
    const registration = await navigator.serviceWorker.ready;
    // No server id here: the API's registrations are deleted one by one, with their own confirmation (deleteRegistration).
    await unsubscribe({ registration, serverId: null, remove: deleteSubscription });
  },
  deleteRegistration,
  clearCaches: () => clearDeviceCaches(),
  clearCacheMetadata: () => clearExpirationMetadata(),
};
