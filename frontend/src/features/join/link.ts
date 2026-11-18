/*
 * The join link of a crew (redesign S6a): `/<locale>/worker/join?s=<siteId>&c=<crewId>`, what the crew's QR code and the link in the
 * crew's group both carry. A code names a site and a crew by the API's own ids; it holds nothing else and nobody's name. The page
 * reads it, asks the public API whether the site and the crew exist, and only then offers to pin the phone.
 *
 * What the query can be, decided here and nowhere else:
 *   none    no `s` and no `c`: the worker opens the join page to find the site (the picker);
 *   site    `s` alone: the picker, already at that site's crews;
 *   crew    `s` and `c`: the confirm card;
 *   invalid anything else: a crew without a site, an empty value, a value that is not an id (a torn, mistyped or edited code).
 *           The page says the code did not work and shows the picker; it never guesses what was meant.
 *
 * An id here is what the API's ids look like (letters, digits, "-" and "_", at most 64): a value outside that never reaches a request
 * path, whatever the API would answer to it.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type JoinLink =
  | { readonly kind: "none" }
  | { readonly kind: "site"; readonly siteId: string }
  | { readonly kind: "crew"; readonly siteId: string; readonly crewId: string }
  | { readonly kind: "invalid" };

export const SITE_PARAM = "s";
export const CREW_PARAM = "c";

/** The link of the join page for a site, or a site and a crew, without the locale prefix (the router adds it). */
export function joinHref(siteId?: string, crewId?: string): string {
  if (siteId === undefined) return "/worker/join";
  const query = new URLSearchParams({ [SITE_PARAM]: siteId });
  if (crewId !== undefined) query.set(CREW_PARAM, crewId);
  return `/worker/join?${query.toString()}`;
}

export function parseJoinLink(params: { get(name: string): string | null }): JoinLink {
  const site = params.get(SITE_PARAM);
  const crew = params.get(CREW_PARAM);
  if (site === null && crew === null) return { kind: "none" };
  if (site === null || !ID.test(site)) return { kind: "invalid" };
  if (crew === null) return { kind: "site", siteId: site };
  if (!ID.test(crew)) return { kind: "invalid" };
  return { kind: "crew", siteId: site, crewId: crew };
}
