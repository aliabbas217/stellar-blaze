import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import type { ReactNode } from "react";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import { useProfile } from "@/features/profile/store";
import { CLOCK_TICK_MS, useNow, useSiteToday, type SiteToday, type TodayViewModel } from "@/features/today/useSiteToday";
import { problemOnce } from "@/mocks/handlers";
import { legacyForecastToday as forecastToday, riskPolicy, SITE_DEMO, STALE_AGE_MS } from "@/mocks/fixtures";
import { server } from "@/mocks/node";

/*
 * The Today screen's data: the forecast and the risk policy through TanStack Query (client side, so the service
 * worker's cache can answer offline), joined with the on-device profile and the clock. MSW answers with the mock API's
 * fixtures: 15 hours from 05:00 to 19:00 at Asia/Dubai on 2026-11-11, generated 10 minutes before the request.
 *
 * The clock is frozen at 13:30 at Asia/Dubai on that day, so the fixture day is "today" and the 13:00 hour is the
 * current one. Only `Date` is faked: the timers the query library and MSW wait on stay real.
 */

const FORECAST_PATH = `/api/v1/sites/${SITE_DEMO}/forecast/today`;

/*
 * These tests are pinned to F1's forecast day (legacyForecastToday: 11 Nov 2026, 15 hours, the Task 9 vector), not to the
 * replay day the mock API now serves by default. Each test starts with a handler that answers that day; F2 Task 14
 * rewrites this view and its tests against the replay day, and deletes the legacy fixture then.
 */
function serveLegacyDay(ageMs?: number) {
  server.use(
    http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
      const siteId = typeof params.site_id === "string" ? params.site_id : "";
      const day = forecastToday(siteId, ageMs === undefined ? {} : { ageMs });
      // An unknown site falls through to the default handler, which answers the 404 problem.
      return day === undefined ? undefined : HttpResponse.json(day);
    }),
  );
}
const FROZEN_NOW = "2026-11-11T09:30:00Z";

// The Task 9 vector: moderate, 10 days into heat work, the 13:00 hour {26, 28, 30}: amber from the person under B3's bands, orange from the site.
const profile: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-11-11T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-11-01",
  clothingCode: "work_clothes",
};

/** A client that does not retry (so a failure shows at once) and never goes stale on its own (so only the test refetches). */
function createWrapper(queries: { retry?: number | false; retryDelay?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, ...queries } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

function mount(siteId: string = SITE_DEMO) {
  const { client, wrapper } = createWrapper();
  const rendered = renderHook(() => useSiteToday(siteId), { wrapper });
  return { client, ...rendered };
}

/** The view model of a screen that must be ready, or a failed assertion that says what it was instead. */
function viewOf(state: SiteToday): TodayViewModel {
  if (state.status !== "ready") throw new Error(`expected a ready screen, got ${state.status}`);
  return state.view;
}

/** Answers the policy with the given config_version on each call in turn (the last one repeats), and counts the calls. */
function policyVersions(configVersions: readonly number[]) {
  let calls = 0;
  server.use(
    http.get("*/api/v1/risk-policy", () => {
      const configVersion = configVersions[Math.min(calls, configVersions.length - 1)] ?? riskPolicy.config_version;
      calls += 1;
      return HttpResponse.json({ ...riskPolicy, version: `ruleset-${String(configVersion)}`, config_version: configVersion });
    }),
  );
  return { calls: () => calls };
}

function setSystemTime(instant: string) {
  act(() => {
    vi.setSystemTime(new Date(instant));
    // What a phone does when the app comes back to the front: the clock is read again at once, not at the next tick.
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  serveLegacyDay();
  localStorage.clear();
  useProfile.setState({ profile });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  useProfile.setState({ profile: null });
});

describe("useSiteToday: success", () => {
  it("starts loading, then gives the Task 9 vector: the worker's own level amber, displayed orange from the site", async () => {
    const { result } = mount();
    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    const view = viewOf(result.current);
    expect(view.currentHour?.starts_at).toBe("2026-11-11T09:00:00Z");
    expect(view.freshness).toBe("fresh");
    expect(view.siteLevel).toBe("orange");
    // The site's level is there at once; the worker's own follows the on-device code (a dynamic import after the first paint).
    await waitFor(() => {
      expect(viewOf(result.current).personal).toMatchObject({ status: "available", value: { level: "amber" } });
    });
    expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
    expect(viewOf(result.current).versions).toEqual({
      forecast: { policyVersion: "mock-0", configVersion: 1 },
      policy: { version: "mock-0", configVersion: 1 },
    });
    expect(view.forecast.hours).toHaveLength(15);
    expect(result.current.problem).toBeNull();
  });

  it("keeps the forecast and the policy under the keys ['today', siteId] and ['risk-policy']", async () => {
    const { client, result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    await waitFor(() => {
      expect(client.getQueryData(["risk-policy"])).toBeDefined();
    });

    expect(client.getQueryData(["today", SITE_DEMO])).toMatchObject({ site_id: SITE_DEMO, config_version: 1 });
    expect(client.getQueryData(["risk-policy"])).toMatchObject({ version: "mock-0", config_version: 1 });
  });

  it("asks for the forecast of the site it is given, and keeps each site's forecast apart", async () => {
    const requested: string[] = [];
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
        const siteId = String(params["site_id"]);
        requested.push(siteId);
        return HttpResponse.json({ ...forecastToday(SITE_DEMO), site_id: siteId });
      }),
    );
    const { client, wrapper } = createWrapper();
    const first = renderHook(() => useSiteToday("site-a"), { wrapper });
    const second = renderHook(() => useSiteToday("site-b"), { wrapper });

    await waitFor(() => {
      expect(first.result.current.status).toBe("ready");
      expect(second.result.current.status).toBe("ready");
    });

    expect(requested.sort()).toEqual(["site-a", "site-b"]);
    expect(client.getQueryData<{ site_id: string }>(["today", "site-a"])?.site_id).toBe("site-a");
    expect(client.getQueryData<{ site_id: string }>(["today", "site-b"])?.site_id).toBe("site-b");
  });

  it("works with no profile: the site's level, and the reason there is no personal one", async () => {
    useProfile.setState({ profile: null });
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    const view = viewOf(result.current);
    expect(view.personal).toEqual({ status: "unavailable", reason: "no-profile" });
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
  });

  it("reads the profile from the device store as it changes: saving one makes the personal level appear", async () => {
    useProfile.setState({ profile: null });
    const { result } = mount();
    await waitFor(() => {
      expect(viewOf(result.current).personal.status).toBe("unavailable");
    });

    act(() => {
      useProfile.setState({ profile });
    });

    // The on-device code is loaded after the profile appears (personal-level.ts), so the personal level follows.
    await waitFor(() => {
      expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
    });
  });
});

describe("useSiteToday: the on-device pipeline is loaded only for a phone that holds a profile (F2 W1)", () => {
  it("with no profile it never asks for the risk policy, and still has the site's level", async () => {
    let policyRequests = 0;
    server.use(
      http.get("*/api/v1/risk-policy", () => {
        policyRequests += 1;
        return HttpResponse.json(riskPolicy);
      }),
    );
    useProfile.setState({ profile: null });
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    // Give a policy request every chance to happen: effects and the query cache have run by now.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(policyRequests).toBe(0);
    expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
    expect(viewOf(result.current).versions.policy).toBeNull();
  });

  it("with a profile it asks for the policy once, and the personal level arrives after the site's", async () => {
    let policyRequests = 0;
    server.use(
      http.get("*/api/v1/risk-policy", () => {
        policyRequests += 1;
        return HttpResponse.json(riskPolicy);
      }),
    );
    act(() => {
      useProfile.setState({ profile });
    });
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    // The site's level never waits for the personal one.
    expect(viewOf(result.current).siteLevel).toBe("orange");
    await waitFor(() => {
      expect(viewOf(result.current).personal.status).toBe("available");
    });
    expect(policyRequests).toBe(1);
  });

  it("a worker whose profile is revoked while the screen is open falls back to the site's level at once", async () => {
    act(() => {
      useProfile.setState({ profile: { ...profile, heatWorkStartDate: "2026-11-11" } });
    });
    const { result } = mount();
    await waitFor(() => {
      expect(viewOf(result.current).personal.status).toBe("available");
    });
    act(() => {
      useProfile.setState({ profile: null });
    });
    expect(viewOf(result.current).personal).toEqual({ status: "unavailable", reason: "no-profile" });
  });
});

describe("useSiteToday: the forecast fails", () => {
  it("surfaces the problem with its request id, and Retry (refetch) recovers", async () => {
    server.use(problemOnce(FORECAST_PATH, 500));
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.status === "error" ? result.current.problem : null).toMatchObject({ status: 500, request_id: "mock-req-1" });

    // Hold the retry's answer back, to see the request in flight.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", async () => {
        await held;
        return HttpResponse.json(forecastToday(SITE_DEMO));
      }),
    );
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.fetching).toBe(true);
    });
    // The failure is cleared while the retry runs: the screen shows its loading state again, then the outcome.
    expect(result.current.status).toBe("loading");
    expect(result.current.problem).toBeNull();

    release();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.fetching).toBe(false);
    expect(result.current.problem).toBeNull();
    expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
  });

  it("surfaces a 404 as it is: the problem's status and detail, for an unknown site", async () => {
    const { result } = mount("no-such-site");

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.problem).toMatchObject({ status: 404, detail: "No site no-such-site.", request_id: "mock-req-1" });
  });

  it("surfaces a network failure as a problem without a request id", async () => {
    server.use(http.get("*/api/v1/sites/:site_id/forecast/today", () => HttpResponse.error()));
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.problem).toMatchObject({ status: 0 });
    expect(result.current.problem?.request_id).toBeUndefined();
  });

  it("keeps showing the forecast it has when a refresh fails, and says it failed", async () => {
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    const before = viewOf(result.current).forecast.generated_at;

    server.use(problemOnce(FORECAST_PATH, 500));
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.problem).not.toBeNull();
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.problem).toMatchObject({ status: 500, request_id: "mock-req-1" });
    expect(viewOf(result.current).forecast.generated_at).toBe(before);

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.problem).toBeNull();
    });
  });
});

describe("useSiteToday: a stale forecast (review focus 3)", () => {
  it("is marked stale when the forecast was generated 26 hours ago", async () => {
    serveLegacyDay(STALE_AGE_MS);
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    const view = viewOf(result.current);
    expect(view.freshness).toBe("stale");
    expect(view.forecast.generated_at).toBe(new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString());
  });

  it("turns stale as the clock moves on, with no new request, and follows the hours", async () => {
    let requests = 0;
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", () => {
        requests += 1;
        // Live mode: the 3 hour rule is the live mode's; a replay day takes its freshness from forecast_status (Part S0).
        const day = forecastToday(SITE_DEMO);
        return HttpResponse.json(day === undefined ? day : { ...day, mode: "live" });
      }),
    );
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(viewOf(result.current).freshness).toBe("fresh");
    expect(requests).toBe(1);

    // 16:05 at Dubai: the 16:00 hour (amber for the site; for this worker P is 0.23, also amber), forecast 2 h 45 min old.
    setSystemTime("2026-11-11T12:05:00Z");
    expect(viewOf(result.current).currentHour?.starts_at).toBe("2026-11-11T12:00:00Z");
    expect(viewOf(result.current).displayed).toEqual({ level: "amber", source: "site" });
    expect(viewOf(result.current).freshness).toBe("fresh");

    // 16:21: the forecast, generated at 13:20, is now 3 h 01 min old.
    setSystemTime("2026-11-11T12:21:00Z");
    expect(viewOf(result.current).freshness).toBe("stale");

    // 20:30: the forecast no longer covers the present: no level at all, and no personal one.
    setSystemTime("2026-11-11T16:30:00Z");
    expect(viewOf(result.current).currentHour).toBeNull();
    expect(viewOf(result.current).displayed).toBeNull();
    expect(viewOf(result.current).personal).toEqual({ status: "unavailable", reason: "outside-forecast" });

    expect(requests).toBe(1);
  });
});

describe("useSiteToday: the policy does not match the forecast (ADR 0010)", () => {
  it("fetches the policy again, once, and shows the personal level as soon as the pair matches", async () => {
    const policy = policyVersions([2, 1]);
    const { result } = mount();

    await waitFor(() => {
      expect(viewOf(result.current).personal.status).toBe("available");
    });

    expect(policy.calls()).toBe(2);
    expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
    expect(viewOf(result.current).versions.policy).toEqual({ version: "ruleset-1", configVersion: 1 });
  });

  it("shows no personal level while they differ, with both versions as the API wrote them", async () => {
    const policy = policyVersions([2]);
    const { result } = mount();

    await waitFor(() => {
      expect(policy.calls()).toBe(2);
    });
    await waitFor(() => {
      expect(viewOf(result.current).personal).toEqual({ status: "unavailable", reason: "version-mismatch" });
    });

    const view = viewOf(result.current);
    expect(view.versions).toEqual({
      forecast: { policyVersion: "mock-0", configVersion: 1 },
      policy: { version: "ruleset-2", configVersion: 2 },
    });
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
  });

  it("does not ask again and again when the policy stays different", async () => {
    const policy = policyVersions([2]);
    const { result } = mount();
    await waitFor(() => {
      expect(policy.calls()).toBe(2);
    });

    // Real time: long enough for a refetch loop to show itself. Re-renders (here, a clock reading) do not ask again either.
    setSystemTime("2026-11-11T09:31:00Z");
    await new Promise((resolve) => setTimeout(resolve, 200));
    setSystemTime("2026-11-11T09:32:00Z");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(policy.calls()).toBe(2);
    expect(viewOf(result.current).personal).toEqual({ status: "unavailable", reason: "version-mismatch" });
  });

  it("asks again when the forecast moves to another config_version and the pair differs again", async () => {
    const policy = policyVersions([1]);
    let forecastConfig = 1;
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json({
          site_id: String(params["site_id"]),
          date: "2026-11-11",
          generated_at: "2026-11-11T09:20:00Z",
          policy_version: "mock-0",
          config_version: forecastConfig,
          hours: [],
        }),
      ),
    );
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    await waitFor(() => {
      expect(viewOf(result.current).versions.policy).not.toBeNull();
    });
    expect(policy.calls()).toBe(1);

    forecastConfig = 2;
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(policy.calls()).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("useSiteToday: the policy fails", () => {
  it("shows the forecast with no personal level, says why, and Retry fetches the policy as well", async () => {
    server.use(problemOnce("/api/v1/risk-policy", 500));
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    await waitFor(() => {
      expect(viewOf(result.current).personal).toEqual({ status: "unavailable", reason: "policy-unavailable" });
    });
    expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
    expect(viewOf(result.current).versions.policy).toBeNull();

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
    });
  });
});

describe("useSiteToday: offline", () => {
  it("still asks for the forecast when the query library believes the device is offline: the service worker may hold it", async () => {
    // The default network mode would hold the request until `online`, and the worker's cache would never be asked.
    onlineManager.setOnline(false);
    const { result } = mount();

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(viewOf(result.current).displayed).toEqual({ level: "orange", source: "site" });
  });

  it("with no connection and nothing cached, keeps loading rather than failing, and recovers when the connection returns", async () => {
    // The app's own client retries a failed request once. Offline, that retry waits for a connection instead of being used up.
    let requests = 0;
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", () => {
        requests += 1;
        return requests === 1 ? HttpResponse.error() : HttpResponse.json(forecastToday(SITE_DEMO));
      }),
    );
    onlineManager.setOnline(false);
    const { wrapper } = createWrapper({ retry: 1, retryDelay: 0 });
    const { result } = renderHook(() => useSiteToday(SITE_DEMO), { wrapper });

    await waitFor(() => {
      expect(requests).toBe(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toBe(1);
    expect(result.current.status).toBe("loading");
    expect(result.current.problem).toBeNull();

    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(requests).toBe(2);
  });

  it("reports whether the browser says it is offline, and follows it", () => {
    const onLine = vi.spyOn(window.navigator, "onLine", "get");
    onLine.mockReturnValue(true);
    const { result } = mount();
    expect(result.current.offline).toBe(false);

    act(() => {
      onLine.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.offline).toBe(true);

    act(() => {
      onLine.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.offline).toBe(false);
  });
});

describe("useNow", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-11T08:59:30Z"));
  });

  it("reads the clock again every minute and when the page is shown again, and stops when it unmounts", () => {
    expect(CLOCK_TICK_MS).toBe(60_000);
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe("2026-11-11T08:59:30.000Z");

    act(() => {
      vi.advanceTimersByTime(CLOCK_TICK_MS);
    });
    expect(result.current.toISOString()).toBe("2026-11-11T09:00:30.000Z");

    // The phone slept for 40 minutes: no tick ran, and the first thing on return is the visibility change.
    act(() => {
      vi.setSystemTime(new Date("2026-11-11T09:40:00Z"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.toISOString()).toBe("2026-11-11T09:40:00.000Z");

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const frozen = result.current;
    act(() => {
      vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(frozen);
  });
});
