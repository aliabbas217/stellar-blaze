import { isCachedApiPath } from "@/features/pwa/api-cache";

/*
 * The service worker keeps exactly two API responses for offline use: today's forecast of one site and the risk
 * policy. Everything else under /api/v1 must stay on the default rules, so a push subscription call or a crew
 * timeline is never answered from this cache by accident.
 */

describe("isCachedApiPath", () => {
  it.each(["/api/v1/sites/site-1/forecast/today", "/api/v1/sites/0b7e2c1a-77aa/forecast/today", "/api/v1/risk-policy"])(
    "%s is cached for offline use",
    (pathname) => {
      expect(isCachedApiPath(pathname)).toBe(true);
    },
  );

  it.each([
    "/api/v1/sites",
    "/api/v1/sites/site-1",
    "/api/v1/sites/site-1/crews",
    "/api/v1/sites/site-1/forecast",
    "/api/v1/sites/site-1/forecast/tomorrow",
    "/api/v1/sites/site-1/forecast/today/extra",
    "/api/v1/sites//forecast/today",
    "/api/v1/sites/a/b/forecast/today",
    "/api/v1/risk-policy/extra",
    "/api/v1/crews/crew-1/timeline",
    "/api/v1/push/subscriptions",
    "/api/healthz",
    "/en/api/v1/risk-policy",
    "/risk-policy",
  ])("%s is not", (pathname) => {
    expect(isCachedApiPath(pathname)).toBe(false);
  });
});
