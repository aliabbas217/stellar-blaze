import { nextSitePin, readSitePin, type SiteContacts } from "@/features/profile/site-pin";

/*
 * Pins the phone to a site, loading the profile store only now (F2 W1). Today and the contacts sync run on every worker visit,
 * and most phones never pin anything: a phone that only reads the pin (`useSitePin`) must not carry the store, zustand's persist
 * middleware and `revoke` in the first load of the page. The store is a dynamic import here, fetched on the first call (the
 * visitor's tap on the demo yard, a `?site=` link, a site whose numbers changed), which is also where the pin is written.
 *
 * Contacts are kept or dropped by `nextSitePin`, the same rule `useDeviceSite` applies.
 */
export async function chooseDeviceSite(siteId: string, crewId: string | null, contacts?: SiteContacts): Promise<void> {
  const { useProfile } = await import("@/features/profile/store");
  // Read after the import, from the store itself: the pin another tab wrote while the chunk loaded is the one to keep.
  useProfile.getState().chooseSite(nextSitePin(useProfile.getState().site ?? readSitePin(), siteId, crewId, contacts));
}
