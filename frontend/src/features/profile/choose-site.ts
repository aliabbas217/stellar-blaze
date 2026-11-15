import { nextSitePin, readSitePin, type SiteContacts } from "@/features/profile/site-pin";

/*
 * Pins the phone to a site, loading the profile store only now (F2 W1). Today and the contacts sync run on every worker visit,
 * and most phones never pin anything: a phone that only reads the pin (`useSitePin`) must not carry the store, zustand's persist
 * middleware and `revoke` in the first load of the page. The store is a dynamic import here, fetched on the first call (the
 * visitor's tap on the demo yard, a `?site=` link, a site whose numbers changed), which is also where the pin is written.
 *
 * Contacts are kept or dropped by `nextSitePin`, the same rule `useDeviceSite` applies.
 *
 * Two failures are the caller's to handle, not swallowed here: the import can REJECT (a stale chunk after a deploy, no signal),
 * and the choice can be OVERTAKEN. Once the store is loaded, a call reads its `revokeEpoch` when it begins (the epoch counts every
 * revoke, this tab's or another's); if a revoke happened before the choice was written the pin is NOT written (the worker took
 * their data back, and a choice that was still resolving must not bring it back). It resolves `true` when it wrote the pin and
 * `false` when it was overtaken. A phone whose store has not been loaded yet cannot have been revoked in this tab: nothing to compare.
 */
type StoreModule = typeof import("@/features/profile/store");
let loaded: StoreModule | null = null;

export async function chooseDeviceSite(siteId: string, crewId: string | null, contacts?: SiteContacts): Promise<boolean> {
  const epochAtStart = loaded?.useProfile.getState().revokeEpoch ?? null;
  loaded = await import("@/features/profile/store");
  const store = loaded.useProfile;
  if (epochAtStart !== null && store.getState().revokeEpoch !== epochAtStart) return false;
  // Read after the import, from the store itself: the pin another tab wrote while the chunk loaded is the one to keep.
  store.getState().chooseSite(nextSitePin(store.getState().site ?? readSitePin(), siteId, crewId, contacts));
  return true;
}
