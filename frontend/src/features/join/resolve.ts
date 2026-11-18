import type { components } from "@/api/schema";

/*
 * What a join link points at, once the public reads have answered (redesign S6a). Pure: the page's two queries go in, one verdict
 * comes out, so every case (a crew that is not at that site, a site the API does not list) is tested without a screen.
 *
 *   loading        a read has not answered yet (the caller shows a skeleton of the card's height);
 *   unknown-site   the site list answered and the site is not in it;
 *   unknown-crew   the site's crews answered and the crew is not among them. A crew that belongs to ANOTHER site is this case too:
 *                  the list is the site's own, and a crew whose `site_id` is a different site is never accepted from it either;
 *   ready          the site and the crew are both there: the card can ask "Is this your crew?".
 *
 * A failed read is not a verdict about the code: the caller handles it (retry), it never reaches here as "unknown".
 */

type Site = components["schemas"]["Site"];
type Crew = components["schemas"]["Crew"];

export type JoinTarget =
  | { readonly status: "loading" }
  | { readonly status: "unknown-site" }
  | { readonly status: "unknown-crew"; readonly site: Site }
  | { readonly status: "ready"; readonly site: Site; readonly crew: Crew };

export function resolveCrewLink(input: {
  readonly siteId: string;
  readonly crewId: string;
  readonly sites: readonly Site[] | undefined;
  readonly crews: readonly Crew[] | undefined;
}): JoinTarget {
  const { siteId, crewId, sites, crews } = input;
  if (sites === undefined) return { status: "loading" };
  const site = sites.find((candidate) => candidate.id === siteId);
  if (site === undefined) return { status: "unknown-site" };
  if (crews === undefined) return { status: "loading" };
  const crew = crews.find((candidate) => candidate.id === crewId && candidate.site_id === site.id);
  return crew === undefined ? { status: "unknown-crew", site } : { status: "ready", site, crew };
}
