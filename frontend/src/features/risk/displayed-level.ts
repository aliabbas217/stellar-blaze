import { moreSevere, type Level } from "@/components/level/level";

/**
 * The level the screen leads with: the more severe of the site's and the worker's own, either of which may be absent.
 * Safety-first; flagged for B3 to confirm. Its own module so that Today can lead with the site's level before the on-device
 * risk code (personal.ts) has loaded.
 */
export function displayedLevel(site: Level | null, personal: Level | null): Level | null {
  if (site === null) return personal;
  if (personal === null) return site;
  return moreSevere(site, personal);
}
