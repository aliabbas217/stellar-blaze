import { useEffect } from "react";
import type { components } from "@/api/schema";
import { sameContacts, toE164, type SiteContacts } from "@/features/profile/site-pin";
import { useDeviceSite } from "@/features/profile/useDeviceSite";

/*
 * Keeps the pinned site's call numbers on the phone (F2 Task 18). The unwell sheet must ring offline after one visit, so the
 * numbers are copied from the site record to the pin when the phone has the site list (the demo entry on Today pins a site;
 * this fills it in, and refreshes it whenever the site changes a number). They are the site's numbers, the same for every
 * worker, not personal data; `revoke()` removes them with the pin. Nothing is sent: it only reads what `list_sites` returned.
 */

type SiteRecord = Pick<components["schemas"]["Site"], "id" | "supervisor_phone" | "first_aider_phone">;

/** The contacts of a site record. A value that is not an E.164 number is null: it is never offered to `tel:`. */
export function contactsOf(site: SiteRecord): SiteContacts {
  return { supervisorPhone: toE164(site.supervisor_phone), firstAiderPhone: toE164(site.first_aider_phone) };
}

export function useSiteContactsSync(sites: readonly SiteRecord[]): void {
  const { siteId, crewId, contacts, choose } = useDeviceSite();
  useEffect(() => {
    if (siteId === null) return;
    const site = sites.find((candidate) => candidate.id === siteId);
    if (site === undefined) return;
    const next = contactsOf(site);
    if (!sameContacts(contacts, next)) choose(siteId, crewId, next);
  }, [sites, siteId, crewId, contacts, choose]);
}
