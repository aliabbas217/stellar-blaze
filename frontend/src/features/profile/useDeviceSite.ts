import { useCallback, useMemo } from "react";
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
 */

export interface DeviceSiteApi {
  readonly siteId: string | null;
  readonly crewId: string | null;
  readonly choose: (siteId: string, crewId: string | null) => void;
  readonly clear: () => void;
}

export function useDeviceSite(): DeviceSiteApi {
  const site = useProfile((state) => state.site);
  const chooseSite = useProfile((state) => state.chooseSite);
  const clear = useProfile((state) => state.clearSite);
  const choose = useCallback(
    (siteId: string, crewId: string | null) => {
      chooseSite({ siteId, crewId });
    },
    [chooseSite],
  );
  return useMemo(() => ({ siteId: site?.siteId ?? null, crewId: site?.crewId ?? null, choose, clear }), [site, choose, clear]);
}
