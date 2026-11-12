import { deleteSubscription } from "@/features/push/api";
import { unsubscribe } from "@/features/push/subscribe";
import { clearApiCaches, deleteExpirationMetadata } from "@/features/pwa/api-cache";

/*
 * What taking a worker's data back does outside the on-device store: the three places the browser keeps something that
 * came from the API or the alert subscription. The store calls them through this interface, so a test can replace each
 * with a fake and the store never imports a browser global itself.
 */

export interface ProfileEffects {
  /**
   * Turns alerts off: drops the browser's push subscription and deletes the API's registration (`serverId`, null when none
   * is stored). Rejects when either step failed.
   */
  readonly unsubscribe: (serverId: string | null) => Promise<void>;
  /** Deletes the Cache Storage caches that can hold an API response. */
  readonly clearApiCaches: () => Promise<unknown>;
  /** Deletes Serwist's IndexedDB record of what it cached and when. */
  readonly deleteApiCacheMetadata: () => Promise<unknown>;
}

export const browserEffects: ProfileEffects = {
  unsubscribe: async (serverId) => {
    // A browser without service workers has no push subscription, and nothing was ever registered from it.
    if (!("serviceWorker" in navigator)) return;
    // Never settles when no worker registers; the store stops waiting after REVOKE_STEP_TIMEOUT_MS.
    const registration = await navigator.serviceWorker.ready;
    await unsubscribe({ registration, serverId, remove: deleteSubscription });
  },
  clearApiCaches: () => clearApiCaches(),
  deleteApiCacheMetadata: () => deleteExpirationMetadata(),
};
