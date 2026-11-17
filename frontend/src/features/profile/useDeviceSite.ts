import { useCallback, useMemo } from "react";
import { nextSitePin, type SiteContacts } from "@/features/profile/site-pin";
import { useProfile } from "@/features/profile/store";

/*
 * The site pin (F2 Task 3): which site, and optionally which crew, this phone shows. It lives in the on-device profile
 * store beside the profile and the push registration, never goes to the API, and is taken back by `revoke()` (C7).
 * It is a worker-side value: supervisor and judge code do not import it (route-group isolation); they get their site
 * from the URL and the demo context.
 *
 * This hook is for a view that CHOOSES or clears the pin (it imports the whole store). A component that only shows the
 * pin, like the worker header, reads it with `useSitePin` (site-pin.ts), which does not. The object is stable between
 * renders while the pin is unchanged, so it can sit in an effect's dependencies.
 *
 * `contacts` are the site's call numbers for the unwell sheet (site data, not personal; kept so the sheet works offline).
 * `choose` keeps the stored contacts when the same site is chosen again without new ones, and drops them when the site
 * changes: another site's supervisor number must never be offered for this one.
 */

export interface DeviceSiteApi {
  readonly siteId: string | null;
  readonly crewId: string | null;
  readonly contacts: SiteContacts | undefined;
  readonly choose: (siteId: string, crewId: string | null, contacts?: SiteContacts) => void;
  readonly clear: () => void;
}

export function useDeviceSite(): DeviceSiteApi {
  const site = useProfile((state) => state.site);
  const chooseSite = useProfile((state) => state.chooseSite);
  const clear = useProfile((state) => state.clearSite);
  const choose = useCallback(
    (siteId: string, crewId: string | null, contacts?: SiteContacts) => {
      // Read at call time, so the callback stays stable while the pin changes.
      chooseSite(nextSitePin(useProfile.getState().site, siteId, crewId, contacts));
    },
    [chooseSite],
  );
  return useMemo(
    () => ({ siteId: site?.siteId ?? null, crewId: site?.crewId ?? null, contacts: site?.contacts, choose, clear }),
    [site, choose, clear],
  );
}
