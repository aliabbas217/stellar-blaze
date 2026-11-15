import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { useClock, latestForecastStamp } from "@/features/demo/useClock";
import { queryKeys } from "@/api/query-keys";
import enMessages from "../../../../messages/en.json";

/*
 * The demo clock (review focus 6): on a replay deployment the app's "now" is the replay moment, the API's date at 11:10
 * in the site's zone, so the screens show the same hour as the recorded forecast. `?at=HH:MM` moves it. Only a
 * forecast response that says `mode: "replay"` turns it on: the switch is never the source (ADR 0051 decision 4).
 */

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/worker",
  useRouter: () => ({ replace: vi.fn() }),
}));

function forecast(mode: "replay" | "live", date: string) {
  return { site_id: "site-demo-mussafah", date, mode, forecast_status: "fresh", hours: [] };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Dubai">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  search = "";
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-14T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useClock", () => {
  it("test_use_clock_replay_vs_live: replay response gives 11:10 on the API's date in the site's zone; live gives the device clock", () => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.today("site-demo-mussafah"), forecast("replay", "2026-09-03"));
    const replay = renderHook(() => useClock(), { wrapper });
    expect(replay.result.current.toISOString()).toBe("2026-09-03T07:10:00.000Z");

    const live = setup();
    live.client.setQueryData(queryKeys.today("site-demo-mussafah"), forecast("live", "2026-11-14"));
    const liveHook = renderHook(() => useClock(), { wrapper: live.wrapper });
    expect(liveHook.result.current.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("is the device clock before any forecast has answered", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("?at=HH:MM moves the replay moment", () => {
    search = "?at=12:45";
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.today("site-demo-mussafah"), forecast("replay", "2026-09-03"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current.toISOString()).toBe("2026-09-03T08:45:00.000Z");
  });

  it("ignores a malformed ?at= and keeps 11:10", () => {
    search = "?at=noon";
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.today("site-demo-mussafah"), forecast("replay", "2026-09-03"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current.toISOString()).toBe("2026-09-03T07:10:00.000Z");
  });

  it("?at= has no effect on a live response", () => {
    search = "?at=12:45";
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.today("site-demo-mussafah"), forecast("live", "2026-11-14"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("switches when a forecast arrives after the first render", () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current.toISOString()).toBe("2026-11-14T10:00:00.000Z");

    act(() => {
      client.setQueryData(queryKeys.today("site-demo-mussafah"), forecast("replay", "2026-09-03"));
    });
    expect(result.current.toISOString()).toBe("2026-09-03T07:10:00.000Z");
  });

  it("the live clock moves on every minute", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useClock(), { wrapper });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe("2026-11-14T10:01:00.000Z");
  });
});

describe("latestForecastStamp", () => {
  it("is null with no forecast in the cache, and takes the most recently updated one otherwise", () => {
    const { client } = setup();
    expect(latestForecastStamp(client)).toBeNull();

    client.setQueryData(queryKeys.today("a"), forecast("live", "2026-11-14"), { updatedAt: 1_000 });
    client.setQueryData(queryKeys.today("b"), forecast("replay", "2026-09-03"), { updatedAt: 2_000 });
    expect(latestForecastStamp(client)).toBe("replay|2026-09-03");
  });
});
