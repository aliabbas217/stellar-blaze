import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { crewTimeline, forecastToday, listCrews, REPLAY_DATE, SITE_DEMO, STALE_AGE_MS } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderCrews, stopBar, textOf, installSupervisorTestEnvironment } from "./support";

/*
 * The supervisor's crews screen against the mock API (F2 Task 19), through the real hooks and MSW's answers. The replay clock is
 * 3 Sep 2026 at 11:10 (`?at=` moves it); every crew's shift is 06:00 to 11:00 and 15:00 to 18:00, so at 11:10 all are off shift.
 */

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/en/supervisor",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/supervisor",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

installSupervisorTestEnvironment();
beforeEach(() => {
  search = "";
});

const focal = () => screen.findByRole("heading", { level: 2 });
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-crew]")];

describe("Crews: ready", () => {
  it("leads with the worst crew in one sentence, lists every crew worst first, and has one primary action to its plan", async () => {
    renderCrews();

    // At 11:10 every crew is off shift and orange when it is back at 15:00: equal ranks keep the API's order.
    expect(textOf(await focal())).toBe("Crew A is off shift now. Back at 15:00 into Orange.");
    // An off-shift crew does not "need you first": the kicker says what the ranking is.
    expect(textOf((await focal()).closest("section"))).toContain("Highest level, off shift now");
    expect(textOf(document.body)).not.toContain("Needs you first");
    expect(rows().map((row) => row.dataset["crew"])).toEqual(["crew-a", "crew-b", "crew-c", "crew-d"]);

    const primary = document.querySelectorAll("[data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent("Open Crew A plan");
    expect(primary[0]).toHaveAttribute("href", "/en/supervisor/crews/crew-a");
    expect(primary[0]).toHaveAttribute("data-prefetch", "false");
  });

  it("a working crew reads its level, until when, the plan's work and rest minutes, and the time to the midday break", async () => {
    search = "at=09:30";
    renderCrews();

    // 09:30: Amber until 10:00 (the 09:00 hour), the 45 minute Medium cycle from the plan, break at 12:30 in 3 h. The plan is asked for once the
    // focal crew is settled (every timeline in), so the cycle joins the sentence a moment after it.
    await waitFor(() => {
      expect(textOf(document.querySelector("h2"))).toBe("Crew A is Amber until 10:00 (work 45, rest 15); midday break in 3 h.");
    });
    // A crew on shift does need the supervisor first.
    expect(textOf((await focal()).closest("section"))).toContain("Needs you first");
    expect(textOf(document.body)).not.toContain("Highest level, off shift now");
  });

  it("asks for ONE day plan, the final focal crew's, however the timelines arrive (each plan read draws on the shared upstream pool)", async () => {
    search = "at=09:30";
    const planReads: string[] = [];
    const lateness: Record<string, number> = { "crew-a": 160, "crew-b": 120, "crew-c": 80, "crew-d": 0 };
    server.use(
      http.get("*/api/v1/crews/:crew_id/timeline", async ({ params }) => {
        await delay(lateness[String(params["crew_id"])] ?? 0);
        return undefined;
      }),
      http.get("*/api/v1/crews/:crew_id/day-plan", ({ params }) => {
        planReads.push(String(params["crew_id"]));
        return undefined;
      }),
    );
    renderCrews();

    await focal();
    await waitFor(() => {
      expect(textOf(document.querySelector("h2"))).toContain("Crew A is Amber until 10:00 (work 45, rest 15)");
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(planReads, "the focal crew moves as timelines arrive; only the settled one may be read").toEqual(["crew-a"]);
  });

  it("ranks by the crews' levels: a red crew leads, whatever the order the API listed them in", async () => {
    search = "at=09:30";
    const red = crewTimeline("crew-c", REPLAY_DATE);
    if (red === undefined) throw new Error("fixture");
    server.use(
      http.get("*/api/v1/crews/crew-c/timeline", () =>
        HttpResponse.json({ ...red, hours: red.hours.map((hour) => ({ ...hour, crew_level: "red" as const })) }),
      ),
    );
    renderCrews();

    expect(textOf(await focal())).toMatch(/^Crew C is Red until 11:00/);
    expect(rows().map((row) => row.dataset["crew"])).toEqual(["crew-c", "crew-a", "crew-b", "crew-d"]);
    expect(document.querySelector("[data-primary]")).toHaveTextContent("Open Crew C plan");
  });

  it("each crew is one link to its plan, with its level, task and plan state as text and the level runs for a screen reader", async () => {
    renderCrews();
    await focal();

    const crewB = within(rows()[1] as HTMLElement);
    const link = crewB.getByRole("link");
    expect(link).toHaveAttribute("href", "/en/supervisor/crews/crew-b");
    expect(textOf(link)).toContain("Crew B");
    expect(textOf(link)).toContain("Off, Orange at 15:00");
    expect(textOf(link)).toContain("Concrete pour");
    expect(textOf(link)).toContain("Plan unsigned");
    expect(textOf(link)).toContain("Levels by hour: Green 06:00 to 08:00; Amber 08:00 to 10:00; Orange 10:00 to 11:00; Orange 15:00 to 17:00; Amber 17:00 to 18:00.");
    expect(textOf(link)).toContain("Open plan");
  });

  it("carries the Replay stamp, the synthetic demo banner, the reset control and the legend of the bars", async () => {
    renderCrews();
    await focal();

    expect(within(document.querySelector("[data-mode-stamp]") as HTMLElement).getByRole("note")).toHaveTextContent("Replay");
    expect(screen.getByText("Synthetic demo site: no real people, no real data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset demo site" })).toBeInTheDocument();
    expect(screen.getByText(/Bar height is the crew's level/)).toBeInTheDocument();
  });

  it("a live day (the forecast and the crews' timelines both live) carries no Replay stamp", async () => {
    const day = forecastToday(SITE_DEMO, { now: new Date("2026-09-03T07:10:00Z") });
    if (day === undefined) throw new Error("fixture");
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", () => HttpResponse.json({ ...day, mode: "live" })),
      http.get("*/api/v1/crews/:crew_id/timeline", ({ params }) => {
        const timeline = crewTimeline(String(params["crew_id"]), REPLAY_DATE);
        if (timeline === undefined) throw new Error("fixture");
        return HttpResponse.json({ ...timeline, mode: "live" });
      }),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T07:10:00Z"));
    try {
      renderCrews();
      await focal();
      expect(document.querySelector("[data-mode-stamp]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // B3 ba912f3: CrewTimeline carries its own `mode` (optional in the contract). When it is there the stamp follows the crews' own data,
  // not the forecast beside it; when it is absent the forecast's mode stands, as before.
  describe("the stamp follows the crews' own mode when the timelines carry one", () => {
    let forecastServed = false;
    beforeEach(() => {
      forecastServed = false;
    });
    const timelineWith = (mode: "live" | "replay" | undefined) =>
      http.get("*/api/v1/crews/:crew_id/timeline", ({ params }) => {
        const timeline = crewTimeline(String(params["crew_id"]), REPLAY_DATE);
        if (timeline === undefined) throw new Error("fixture");
        const served: Record<string, unknown> = { ...timeline, mode };
        if (mode === undefined) delete served["mode"];
        return HttpResponse.json(served);
      });
    const forecastWith = (mode: "live" | "replay") =>
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
        const day = forecastToday(String(params["site_id"]), { now: new Date("2026-09-03T07:10:00Z") });
        if (day === undefined) throw new Error("fixture");
        forecastServed = true;
        return HttpResponse.json({ ...day, mode });
      });
    /** The screen has its crews and the forecast has been read and applied: an absent stamp is then an answer, not a wait. */
    const settled = async () => {
      await focal();
      await waitFor(() => {
        expect(forecastServed).toBe(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    };

    it("a live timeline carries no Replay stamp, although the forecast says replay", async () => {
      server.use(timelineWith("live"), forecastWith("replay"));
      renderCrews();
      await settled();
      expect(document.querySelector("[data-mode-stamp]")).toBeNull();
    });

    it("a replay timeline carries the Replay stamp, although the forecast says live", async () => {
      server.use(timelineWith("replay"), forecastWith("live"));
      renderCrews();
      await settled();
      expect(within(document.querySelector("[data-mode-stamp]") as HTMLElement).getByRole("note")).toHaveTextContent("Replay");
    });

    it("a timeline with no mode falls back to the forecast's: replay is stamped, live is not", async () => {
      server.use(timelineWith(undefined), forecastWith("replay"));
      const replay = renderCrews();
      await settled();
      expect(document.querySelector("[data-mode-stamp]")).not.toBeNull();
      replay.unmount();

      forecastServed = false;
      server.use(timelineWith(undefined), forecastWith("live"));
      renderCrews();
      await settled();
      expect(document.querySelector("[data-mode-stamp]")).toBeNull();
    });
  });
});

describe("Crews: partial (a suppressed crew)", () => {
  it("test_suppressed_crew_keeps_level_and_hides_detail: crew D keeps its row and level, the footnote says why, and nothing about restrictions appears", async () => {
    renderCrews();
    await focal();

    expect(textOf(document.querySelector("[data-suppressed-note]"))).toBe(
      "Crew D has fewer than 5 people, so its health detail is hidden to protect privacy. Its level is shown.",
    );
    const crewD = rows().find((row) => row.dataset["crew"] === "crew-d");
    expect(textOf(crewD ?? null)).toContain("Off, Orange at 15:00");
    // Crews A and C declare restrictions in the fixture; this screen says nothing about restrictions for any crew.
    expect(textOf(document.body)).not.toMatch(/restrict|protected/i);
  });

  it("the footnote names several crews with a list and the plural form when more than one is below k", async () => {
    const crews = listCrews(SITE_DEMO);
    if (crews === undefined) throw new Error("fixture");
    server.use(
      http.get("*/api/v1/sites/:site_id/crews", () => HttpResponse.json(crews)),
      http.get("*/api/v1/crews/:crew_id/timeline", ({ params }) => {
        const timeline = crewTimeline(String(params["crew_id"]), REPLAY_DATE);
        return HttpResponse.json(timeline === undefined ? timeline : { ...timeline, suppressed: ["crew-c", "crew-d"].includes(timeline.crew_id) });
      }),
    );
    renderCrews();
    await focal();

    expect(textOf(document.querySelector("[data-suppressed-note]"))).toBe(
      "Crew C and Crew D have fewer than 5 people, so their health detail is hidden to protect privacy. Their levels are shown.",
    );
  });
});

describe("Crews: stale, fresh by the API in replay, offline", () => {
  it("a stale forecast says 'No fresh forecast: protective plan', draws no heat colour, and the crews keep their levels as text", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { ageMs: STALE_AGE_MS, status: "stale" })),
      ),
    );
    renderCrews();
    await focal();

    expect(screen.getByText("No fresh forecast: protective plan")).toBeInTheDocument();
    const cells = [...document.querySelectorAll("[data-cell]")];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.getAttribute("data-heat") === "none")).toBe(true);
  });

  it("Part S0: a replay forecast the API calls fresh is not 'stale' because generated_at is a day old; it draws heat", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { now: new Date("2026-09-03T07:10:00Z"), ageMs: 20 * 60 * 60 * 1000 })),
      ),
    );
    renderCrews();
    await focal();

    expect(screen.queryByText("No fresh forecast: protective plan")).toBeNull();
    expect([...document.querySelectorAll("[data-cell]")].some((cell) => cell.getAttribute("data-heat") === "data")).toBe(true);
  });

  it("a crew whose plan is the protective fallback says so, whatever the forecast says", async () => {
    const crews = listCrews(SITE_DEMO, { forecastStatus: "fallback" });
    if (crews === undefined) throw new Error("fixture");
    server.use(http.get("*/api/v1/sites/:site_id/crews", () => HttpResponse.json(crews)));
    renderCrews();
    await focal();

    expect(screen.getByText("No fresh forecast: protective plan")).toBeInTheDocument();
  });

  it("offline: a notice, with Stop work still there", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderCrews();
    await focal();

    expect(screen.getByText("You are offline")).toBeInTheDocument();
    expect(within(stopBar()).getByRole("button", { name: /Stop work/ })).toBeEnabled();
  });
});

describe("Crews: loading, error, empty (Stop work is there in all of them)", () => {
  it("empty: no site to list (the sites answered with none) is the empty state, not a spinner, and the bar says there is no crew to stop", async () => {
    server.use(http.get("*/api/v1/sites", () => HttpResponse.json([])));
    renderCrews();

    expect(await screen.findByText("No crews at this site yet")).toBeInTheDocument();
    expect(textOf(stopBar())).toBe("There are no crews at this site to stop.");
  });

  it("loading: a skeleton at the final size, and the Stop work bar is live from the first paint", () => {
    const { container } = renderCrews();

    expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).not.toBeNull();
    expect(within(stopBar()).getByRole("button", { name: "Stop work, crew-b" })).toBeEnabled();
  });

  it("error: the failure with its request id and a retry; Stop work still there", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/crews", () =>
        HttpResponse.json(
          { type: "urn:stellar-blaze:problem:dependency-unavailable", title: "Service unavailable", status: 503, request_id: "req-503" },
          { status: 503, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    renderCrews();

    expect(await screen.findByText("Crew status did not load")).toBeInTheDocument();
    expect(screen.getByText("req-503")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(stopBar()).getByRole("button", { name: "Stop work, crew-b" })).toBeEnabled();
  });

  it("empty: no crews is an actionable state with no deferred link, and the bar says there is no crew to stop", async () => {
    server.use(http.get("*/api/v1/sites/:site_id/crews", () => HttpResponse.json([])));
    renderCrews();

    expect(await screen.findByText("No crews at this site yet")).toBeInTheDocument();
    const action = screen.getByRole("link", { name: "Back to the start" });
    expect(action).toHaveAttribute("href", "/en/");
    expect(textOf(stopBar())).toBe("There are no crews at this site to stop.");
    expect(within(stopBar()).queryByRole("button")).toBeNull();
  });
});
