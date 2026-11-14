import { useProfile } from "@/features/profile/store";

/*
 * The site pin (F2 Task 3): which site, and optionally which crew, this phone shows. It lives in the on-device profile
 * store beside the profile and the push registration, never goes to the API, and is taken back by `revoke()` (C7).
 * It is a worker-side value: supervisor and judge code do not import it (route-group isolation); they get their site
 * from the URL and the demo context.
 */

export interface DeviceSiteApi {
  readonly siteId: string | null;
  readonly crewId: string | null;
  choose(siteId: string, crewId: string | null): void;
  clear(): void;
}

export function useDeviceSite(): DeviceSiteApi {
  const site = useProfile((state) => state.site);
  const chooseSite = useProfile((state) => state.chooseSite);
  const clearSite = useProfile((state) => state.clearSite);
  return {
    siteId: site?.siteId ?? null,
    crewId: site?.crewId ?? null,
    choose: (siteId, crewId) => {
      chooseSite({ siteId, crewId });
    },
    clear: clearSite,
  };
}
