import { useEffect } from "react";
import type { components } from "@/api/schema";
import { chooseDeviceSite } from "@/features/profile/choose-site";
import { sameContacts, toE164, useSitePin, type SiteContacts } from "@/features/profile/site-pin";

/*
 * Keeps the pinned site's call numbers on the phone (F2 Task 18). The unwell sheet must ring offline after one visit, so the
 * numbers are copied from the site record to the pin when the phone has the site list (the demo entry on Today pins a site;
 * this fills it in, and refreshes it whenever the site changes a number). They are the site's numbers, the same for every
 * worker, not personal data; `revoke()` removes them with the pin. Nothing is sent: it only reads what `list_sites` returned.
 *
 * It reads the pin without the profile store and loads the store (`chooseDeviceSite`) only when the numbers differ from the ones
 * on the phone, which is the first visit to a site and a change of number, not every visit.
 */

type SiteRecord = Pick<components["schemas"]["Site"], "id" | "supervisor_phone" | "first_aider_phone">;

/** The contacts of a site record. A value that is not an E.164 number is null: it is never offered to `tel:`. */
export function contactsOf(site: SiteRecord): SiteContacts {
  return { supervisorPhone: toE164(site.supervisor_phone), firstAiderPhone: toE164(site.first_aider_phone) };
}

export function useSiteContactsSync(sites: readonly SiteRecord[]): void {
  const pin = useSitePin();
  const siteId = pin?.siteId ?? null;
  const crewId = pin?.crewId ?? null;
  const contacts = pin?.contacts;
  useEffect(() => {
    if (siteId === null) return;
    const site = sites.find((candidate) => candidate.id === siteId);
    if (site === undefined) return;
    const next = contactsOf(site);
    // Dated when written: the sheet says how old the numbers are when it is offline (CallActions).
    if (!sameContacts(contacts, next)) void chooseDeviceSite(siteId, crewId, { ...next, savedAt: new Date().toISOString() });
  }, [sites, siteId, crewId, contacts]);
}
