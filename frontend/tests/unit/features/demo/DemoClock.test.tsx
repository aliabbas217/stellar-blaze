import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { queryKeys } from "@/api/query-keys";
import { DemoClock } from "@/features/demo/DemoClock";
import { stampArrival } from "@/lib/time/server-clock";
import enMessages from "../../../../messages/en.json";

/*
 * The header clock on a page the server renders per request (the supervisor plan is `force-dynamic`: `useSearchParams` does not
 * send a dynamic render to the client, so the server renders the clock itself). The server reads its clock at render time and the
 * browser reads its own at hydration: a device whose clock differs by a minute, or a page that took a minute to hydrate, reads a
 * different HH:MM, and React reports #418 (text mismatch) and re-renders the whole root on the client. The clock is therefore
 * the SAME text on the server and on the first client render (the "not yet" reading), and the time arrives right after.
 */

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/supervisor/crews/crew-b",
  useRouter: () => ({ replace: vi.fn() }),
}));

/** A query client holding a forecast response of `mode` (with the API's `now` when given), as the query function leaves it. */
function clientWith(mode: "live" | "replay" | null, now?: string): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryDefaults(["today"], { structuralSharing: false });
  if (mode !== null) {
    client.setQueryData(
      queryKeys.today("site-demo-mussafah"),
      stampArrival({ site_id: "site-demo-mussafah", date: "2026-06-14", mode, forecast_status: "fresh", hours: [], ...(now === undefined ? {} : { now }) }),
    );
  }
  return client;
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Dubai">
        <p data-testid="clock">
          <DemoClock />
        </p>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  search = "";
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DemoClock hydration", () => {
  it.each([
    ["the device clock is 3 minutes ahead of the server's", 3 * 60_000],
    ["the minute ticks between the server render and hydration", 61_000],
    ["the browser's clock is an hour off", 3_600_000],
  ])("test_demo_clock_hydrates_without_a_mismatch_when %s", (_name, skewMs) => {
    const client = clientWith("live"); // the forecast is already in the cache: the server still cannot know the time
    vi.setSystemTime(new Date("2026-11-14T10:00:30Z"));
    const html = renderToString(tree(client));

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    vi.setSystemTime(new Date(Date.parse("2026-11-14T10:00:30Z") + skewMs));
    const recoverable: unknown[] = [];
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root: ReturnType<typeof hydrateRoot> | undefined;
    act(() => {
      root = hydrateRoot(container, tree(client), {
        onRecoverableError: (error) => {
          recoverable.push(error);
        },
      });
    });

    expect(recoverable, "React recovered from a hydration mismatch").toEqual([]);
    expect(reported, "React logged a hydration error").not.toHaveBeenCalled();
    // after hydration the clock shows the browser's time, in the site's zone
    const expected = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    expect(container.textContent).toBe(expected);
    act(() => root?.unmount());
    reported.mockRestore();
    container.remove();
  });

  it("in replay mode the clock shows the API's own time after hydration, and nothing before it (no mismatch)", () => {
    const client = clientWith("replay", "2026-06-14T06:10:00Z");
    const html = renderToString(tree(client));
    expect(html).toContain(enMessages.shell.field.pendingClock);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const recoverable: unknown[] = [];
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root: ReturnType<typeof hydrateRoot> | undefined;
    act(() => {
      root = hydrateRoot(container, tree(client), {
        onRecoverableError: (error) => {
          recoverable.push(error);
        },
      });
    });
    expect(recoverable).toEqual([]);
    expect(reported).not.toHaveBeenCalled();
    expect(container.textContent).toBe("10:10"); // the API's 06:10Z in Asia/Dubai, not a constant of the app
    act(() => root?.unmount());
    reported.mockRestore();
    container.remove();
  });

  it("with no API clock known the header keeps the 'not yet' reading after hydration (it never shows the device's time)", () => {
    for (const client of [clientWith(null), clientWith("replay")]) {
      const html = renderToString(tree(client));
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.append(container);
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      let root: ReturnType<typeof hydrateRoot> | undefined;
      act(() => {
        root = hydrateRoot(container, tree(client));
      });
      expect(container.textContent).toBe(enMessages.shell.field.pendingClock);
      act(() => root?.unmount());
      container.remove();
    }
  });

  it("the server renders the 'not yet' reading, never a time", () => {
    vi.setSystemTime(new Date("2026-11-14T10:00:30Z"));
    const html = renderToString(tree(clientWith(null)));
    expect(html).toContain(enMessages.shell.field.pendingClock);
    expect(html).not.toMatch(/\d\d:\d\d/);
  });
});
