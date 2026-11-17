import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw/http";
import { siteForecastQueryOptions } from "@/api/queries";
import { latestForecastStamp } from "@/features/demo/useClock";
import { siteTodayQueryOptions } from "@/features/today/useSiteToday";
import { forecastToday } from "@/mocks/fixtures";
import { server } from "@/mocks/node";

/*
 * ONE source of "now" (ADR 0034 amendment): in replay mode the web app takes the time from the API's own clock (the `now` of the
 * forecast response) and from `?at=`, nothing else. These tests fail if a time of the web app's own comes back (the 11:10 / 10:10
 * split: the app said 11:10 while the API's replay clock said 10:10), or if the reading is lost on its way into the cache.
 */

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/en/worker", useRouter: () => ({ replace: vi.fn() }) }));

const SITE = "site-demo-mussafah";
const SRC = path.resolve(import.meta.dirname, "../../../../src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("the web app has no replay moment of its own", () => {
  it("test_no_hard_coded_replay_time: REPLAY_HHMM is gone and the demo clock's code holds no clock-time literal", () => {
    for (const file of sourceFiles(SRC)) {
      expect(readFileSync(file, "utf8"), `${path.relative(SRC, file)} still names REPLAY_HHMM`).not.toContain("REPLAY_HHMM");
    }
    for (const file of ["features/demo/useClock.ts", "features/demo/constants.ts", "features/demo/DemoClock.tsx", "lib/time/server-clock.ts"]) {
      const source = readFileSync(path.join(SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(source, `${file} holds a time of day written as a literal`).not.toMatch(/["'`]\d{1,2}:\d{2}["'`]/);
    }
  });
});

describe("the forecast response carries the API's clock into the cache", () => {
  it.each([
    ["siteForecastQueryOptions (the supervisor's)", siteForecastQueryOptions],
    ["siteTodayQueryOptions (the worker's)", siteTodayQueryOptions],
  ])("%s: is not structurally shared, so a changed response keeps its arrival stamp", (_name, options) => {
    expect(options(SITE).structuralSharing).toBe(false);
  });

  it("a refetch that brings a new `now` leaves the newest reading, whichever query fetched it", async () => {
    for (const options of [siteForecastQueryOptions, siteTodayQueryOptions]) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await client.query(options(SITE));
      const first = latestForecastStamp(client) ?? "";
      expect(first).toMatch(/^replay\|2026-09-03\|\d+\|[\d.]+$/);

      server.use(
        http.get("*/api/v1/sites/:site_id/forecast/today", () => {
          const forecast = forecastToday(SITE);
          return HttpResponse.json({ ...forecast, now: "2026-09-03T07:41:00Z" });
        }),
      );
      await client.query({ ...options(SITE), staleTime: 0 });
      const second = (latestForecastStamp(client) ?? "").split("|");
      expect(second[2], "the reading of the second response").toBe(String(Date.parse("2026-09-03T07:41:00Z")));
      expect(second[3], "its arrival stamp is there").not.toBe("");
      server.resetHandlers();
    }
  });
});
