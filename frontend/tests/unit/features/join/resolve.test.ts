import type { components } from "@/api/schema";
import { resolveCrewLink } from "@/features/join/resolve";
import { listCrews, listSites, SITE_DEMO, SITE_EMPTY } from "@/mocks/fixtures";

/*
 * What a join link points at once the two public reads have answered (redesign S6a): every verdict, from the mock API's own records.
 */

type Crew = components["schemas"]["Crew"];

const sites = listSites();
const crews = listCrews(SITE_DEMO) ?? [];

describe("resolveCrewLink", () => {
  it("a site and a crew the API lists: ready, with both records", () => {
    const target = resolveCrewLink({ siteId: SITE_DEMO, crewId: "crew-c", sites, crews });
    expect(target.status).toBe("ready");
    if (target.status !== "ready") return;
    expect(target.site.id).toBe(SITE_DEMO);
    expect(target.crew).toMatchObject({ id: "crew-c", name: "Crew C", site_id: SITE_DEMO });
  });

  it("loading until the site list has answered, and until the crews have", () => {
    expect(resolveCrewLink({ siteId: SITE_DEMO, crewId: "crew-c", sites: undefined, crews: undefined }).status).toBe("loading");
    expect(resolveCrewLink({ siteId: SITE_DEMO, crewId: "crew-c", sites, crews: undefined }).status).toBe("loading");
  });

  it("a site the API does not list is unknown, whatever the crews say", () => {
    expect(resolveCrewLink({ siteId: "site-gone", crewId: "crew-c", sites, crews }).status).toBe("unknown-site");
    expect(resolveCrewLink({ siteId: "site-gone", crewId: "crew-c", sites, crews: undefined }).status).toBe("unknown-site");
  });

  it("a crew the site does not have is unknown, and the verdict carries the site so the picker can show its crews", () => {
    const target = resolveCrewLink({ siteId: SITE_DEMO, crewId: "crew-zzz", sites, crews });
    expect(target.status).toBe("unknown-crew");
    if (target.status === "unknown-crew") expect(target.site.id).toBe(SITE_DEMO);
  });

  it("a crew that belongs to ANOTHER site is not accepted, even when the list holds it", () => {
    const foreign: Crew = { ...(crews[0] as Crew), id: "crew-x", site_id: "site-other" };
    expect(resolveCrewLink({ siteId: SITE_DEMO, crewId: "crew-x", sites, crews: [...crews, foreign] }).status).toBe("unknown-crew");
  });

  it("a site with no crews: any crew is unknown", () => {
    expect(resolveCrewLink({ siteId: SITE_EMPTY, crewId: "crew-a", sites, crews: [] }).status).toBe("unknown-crew");
  });
});
