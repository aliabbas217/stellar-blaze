import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { useClock, useClockOrDevice, latestForecastStamp } from "@/features/demo/useClock";
import { queryKeys } from "@/api/query-keys";
import { stampArrival } from "@/lib/time/server-clock";
import enMessages from "../../../../messages/en.json";

/*
 * The demo clock (review focus 6; ADR 0034 amendment, one source of "now"): on a replay deployment the app's "now" is the
 * API's own clock: the `now` its forecast response carries, plus the time elapsed since the response arrived. It is never a
 * constant of the web app, so the web and the API cannot disagree about the hour. `?at=HH:MM` is the judge's time travel.
 * Only a forecast response that says `mode: "replay"` turns it on: the switch is never the source (ADR 0051 decision 4).
 * With no known time the clock is null: nothing invents one.
 */

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/worker",
  useRouter: () => ({ replace: vi.fn() }),
}));

/** A forecast response as the query function leaves it: parsed, and stamped with the monotonic time it arrived. */
function forecast(mode: "replay" | "live", date: string, now?: string) {
  return stampArrival({ site_id: "site-demo-mussafah", date, mode, forecast_status: "fresh", hours: [], ...(now === undefined ? {} : { now }) });
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // What both forecast queries set on themselves (a shared copy of a changed response would lose its arrival stamp).
  client.setQueryDefaults(["today"], { structuralSharing: false });
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
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "performance"] });
  vi.setSystemTime(new Date("2026-11-14T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const KEY = queryKeys.today("site-demo-mussafah");

describe("useClock", () => {
  it("test_use_clock_replay_vs_live: a replay response gives the API's own now; a live one gives the device clock", () => {
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:10:00Z"));
    const replay = renderHook(() => useClock(), { wrapper });
    expect(replay.result.current?.toISOString()).toBe("2026-06-14T06:10:00.000Z"); // 10:10 in Asia/Dubai, not 11:10

    const live = setup();
    live.client.setQueryData(KEY, forecast("live", "2026-11-14", "2026-11-14T06:00:00Z"));
    const liveHook = renderHook(() => useClock(), { wrapper: live.wrapper });
    expect(liveHook.result.current?.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("follows whatever the API says: no hour is a constant of the web app (the regression guard of the 11:10 / 10:10 split)", () => {
    for (const apiNow of ["2026-06-14T06:10:00Z", "2026-06-14T06:40:00Z", "2026-06-14T13:25:00Z", "2026-09-03T07:10:00Z"]) {
      const { client, wrapper } = setup();
      client.setQueryData(KEY, forecast("replay", apiNow.slice(0, 10), apiNow));
      const { result } = renderHook(() => useClock(), { wrapper });
      expect(result.current?.toISOString(), apiNow).toBe(apiNow.replace(":00Z", ":00.000Z"));
    }
  });

  it("is null, not a time, before any forecast has answered", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current).toBeNull();
  });

  it("is null, not a made-up moment, when a replay response carries no reading of the API's clock", () => {
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("replay", "2026-06-14"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current).toBeNull();
  });

  it("is null for a reading that was never stamped on arrival: how long ago it arrived is not known", () => {
    const { client, wrapper } = setup();
    client.setQueryData(KEY, { site_id: "site-demo-mussafah", date: "2026-06-14", mode: "replay", forecast_status: "fresh", hours: [], now: "2026-06-14T06:10:00Z" });
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current).toBeNull();
  });

  it("?at=HH:MM moves the replay moment, on the response's own date", () => {
    search = "?at=12:45";
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:10:00Z"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current?.toISOString()).toBe("2026-06-14T08:45:00.000Z");
  });

  it("?at= works with an API that sends no reading (the judge's time travel needs no API clock)", () => {
    search = "?at=09:30";
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("replay", "2026-06-14"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current?.toISOString()).toBe("2026-06-14T05:30:00.000Z");
  });

  it("ignores a malformed ?at= and keeps the API's clock", () => {
    search = "?at=noon";
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:10:00Z"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current?.toISOString()).toBe("2026-06-14T06:10:00.000Z");
  });

  it("?at= has no effect on a live response", () => {
    search = "?at=12:45";
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("live", "2026-11-14", "2026-11-14T06:00:00Z"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current?.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("switches when a forecast arrives after the first render", () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current).toBeNull();

    act(() => {
      client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:10:00Z"));
    });
    expect(result.current?.toISOString()).toBe("2026-06-14T06:10:00.000Z");
  });

  it("the replay clock ticks with monotonic time since the response, and the next response re-syncs it", () => {
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:10:00Z"));
    const { result } = renderHook(() => useClock(), { wrapper });
    expect(result.current?.toISOString()).toBe("2026-06-14T06:10:00.000Z");

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(result.current?.toISOString()).toBe("2026-06-14T06:15:00.000Z");

    // A later response carries the API's newer reading (here: it ran 40 s slower than the monotonic clock suggested).
    act(() => {
      client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:14:20Z"));
    });
    expect(result.current?.toISOString()).toBe("2026-06-14T06:14:00.000Z");
  });

  it("does not follow the device's wall clock: a corrected or wrong device clock does not move the API's time", () => {
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:10:00Z"));
    const { result } = renderHook(() => useClock(), { wrapper });
    act(() => {
      vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current?.toISOString()).toBe("2026-06-14T06:10:00.000Z");
  });

  it("the live clock moves on every minute", () => {
    const { client, wrapper } = setup();
    client.setQueryData(KEY, forecast("live", "2026-11-14"));
    const { result } = renderHook(() => useClock(), { wrapper });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current?.toISOString()).toBe("2026-11-14T10:01:00.000Z");
  });
});

describe("useClockOrDevice", () => {
  it("is pending (the screen waits) until the API's clock is known, and the device clock only when the forecast cannot answer", () => {
    const { client, wrapper } = setup();
    const waiting = renderHook(() => useClockOrDevice(false), { wrapper });
    expect(waiting.result.current.pending).toBe(true);
    const failed = renderHook(() => useClockOrDevice(true), { wrapper });
    expect(failed.result.current.pending).toBe(false);
    expect(failed.result.current.now.toISOString()).toBe("2026-11-14T10:00:00.000Z");

    act(() => {
      client.setQueryData(KEY, forecast("replay", "2026-06-14", "2026-06-14T06:10:00Z"));
    });
    expect(waiting.result.current.pending).toBe(false);
    expect(waiting.result.current.now.toISOString()).toBe("2026-06-14T06:10:00.000Z");
  });
});

describe("latestForecastStamp", () => {
  it("is null with no forecast in the cache, and takes the most recently updated one otherwise", () => {
    const { client } = setup();
    expect(latestForecastStamp(client)).toBeNull();

    client.setQueryData(queryKeys.today("a"), forecast("live", "2026-11-14"), { updatedAt: 1_000 });
    client.setQueryData(queryKeys.today("b"), forecast("replay", "2026-06-14"), { updatedAt: 2_000 });
    expect(latestForecastStamp(client)).toBe("replay|2026-06-14||");
  });
});
