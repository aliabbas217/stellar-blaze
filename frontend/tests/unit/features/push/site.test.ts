import { DEBUG_DEFAULT_SITE_ID, isPushDebug, siteIdFromSearch } from "@/features/push/site";
import { SITE_DEMO } from "@/mocks/fixtures";

/*
 * Until the on-device profile holds the worker's site, the Alerts page takes it from ?site=. The one default is the
 * spike's: with ?debug=push and no site, the first fixture site, so a phone can subscribe without a profile.
 */

describe("siteIdFromSearch", () => {
  it("reads ?site=", () => {
    expect(siteIdFromSearch({ site: "site-a" })).toBe("site-a");
  });

  it("trims it and takes the first of a repeated parameter", () => {
    expect(siteIdFromSearch({ site: "  site-a " })).toBe("site-a");
    expect(siteIdFromSearch({ site: ["site-b", "site-c"] })).toBe("site-b");
  });

  it("prefers an explicit site over the debug default", () => {
    expect(siteIdFromSearch({ site: "site-a", debug: "push" })).toBe("site-a");
  });

  it("defaults to the first fixture site only with ?debug=push", () => {
    expect(siteIdFromSearch({ debug: "push" })).toBe(DEBUG_DEFAULT_SITE_ID);
    expect(siteIdFromSearch({ site: "", debug: "push" })).toBe(DEBUG_DEFAULT_SITE_ID);
    expect(siteIdFromSearch({ site: "   ", debug: "push" })).toBe(DEBUG_DEFAULT_SITE_ID);
  });

  it("has no site without ?debug=push: a missing site stays missing", () => {
    expect(siteIdFromSearch({})).toBeNull();
    expect(siteIdFromSearch({ site: "" })).toBeNull();
    expect(siteIdFromSearch({ debug: "yes" })).toBeNull();
    expect(siteIdFromSearch({ debug: undefined })).toBeNull();
  });

  it("uses the same id as the first site of the mock API's fixtures", () => {
    expect(DEBUG_DEFAULT_SITE_ID).toBe(SITE_DEMO);
  });
});

describe("isPushDebug", () => {
  it("is true for debug=push only", () => {
    expect(isPushDebug("push")).toBe(true);
    expect(isPushDebug(["push", "other"])).toBe(true);
    expect(isPushDebug("1")).toBe(false);
    expect(isPushDebug("PUSH")).toBe(false);
    expect(isPushDebug(undefined)).toBe(false);
  });
});
