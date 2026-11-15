import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import type { ReactNode } from "react";
import { FieldHeadingContext, type FieldHeadingSlot } from "@/components/shell/FieldHeading";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { DEMO_CREW_ID } from "@/features/demo/constants";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import { resetSitePinForTests } from "@/features/profile/site-pin";
import { useProfile } from "@/features/profile/store";
import { TodayView } from "@/features/today/TodayView";
import { crewTimeline, forecastToday, SITE_DEMO, STALE_AGE_MS } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The Today screen against the mock API (F2 Task 16): what a worker sees for each state, through the real hooks, the real
 * store and MSW's answers. The replay clock is the API's date at 11:10 (useClock), so the day is 3 Sep 2026 at 11:10 whatever
 * the machine says; the 11:00 hour is Orange. The decisions themselves (stale is never live, no slot out of season...) are
 * pinned in describe.test.ts; these tests are about what reaches the glass.
 */

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/en/worker",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/worker",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

function renderToday(slot?: FieldHeadingSlot) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  const view = (
    <QueryClientProvider client={client}>
      <DemoProvider>
        <TodayView />
      </DemoProvider>
    </QueryClientProvider>
  );
  return renderWithIntl(slot === undefined ? view : <FieldHeadingContext.Provider value={slot}>{view}</FieldHeadingContext.Provider>);
}

function pin(crewId: string | null = DEMO_CREW_ID): void {
  act(() => {
    useProfile.getState().chooseSite({ siteId: SITE_DEMO, crewId });
  });
}

const profile: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-09-01T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-09-01",
  clothingCode: "work_clothes",
};

beforeEach(() => {
  search = "";
  window.localStorage.clear();
  resetSitePinForTests();
  useProfile.setState({ site: null, push: null, profile: null });
});

const DEMO_CONTACTS = { supervisorPhone: "+12025550143", firstAiderPhone: "+12025550144" };

const orange = () => screen.findByRole("heading", { name: "Orange" });

describe("Today: no site yet", () => {
  it("test_demo_yard_entry_pins_site_and_crew: the demo yard is one tap, and it shows a level", async () => {
    renderToday();

    expect(await screen.findByRole("heading", { name: "Scan your crew's code" })).toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole("button", { name: "See the demo yard" }));

    // The pin also takes the site's call numbers (synthetic on the demo site) for the unwell sheet to use offline (F2 Task 18).
    await waitFor(() => {
      expect(useProfile.getState().site?.contacts).toMatchObject(DEMO_CONTACTS);
    });
    expect(useProfile.getState().site).toMatchObject({ siteId: SITE_DEMO, crewId: DEMO_CREW_ID });
    // Dated when the phone saved them, so the sheet can say how old they are when it is offline.
    expect(Date.parse(useProfile.getState().site?.contacts?.savedAt ?? "")).not.toBeNaN();
    expect(await orange()).toBeInTheDocument();
  });

  it("the entry is the one primary action, and it is not disabled while the demo yard is being found", async () => {
    renderToday();
    const entry = await screen.findByRole("heading", { name: "Scan your crew's code" });
    const section = entry.closest("section");
    expect(section).not.toBeNull();
    await waitFor(() => {
      expect(within(section as HTMLElement).getByRole("button", { name: "See the demo yard" })).toBeEnabled();
    });
    expect(section?.querySelectorAll("[data-primary]")).toHaveLength(1);
  });

  it("?site= and ?crew= pin the phone (a shared link, an e2e) and show that site's level", async () => {
    search = `?site=${SITE_DEMO}&crew=crew-a`;
    renderToday();

    expect(await orange()).toBeInTheDocument();
    await waitFor(() => {
      expect(useProfile.getState().site?.contacts).toMatchObject(DEMO_CONTACTS);
    });
    expect(useProfile.getState().site).toMatchObject({ siteId: SITE_DEMO, crewId: "crew-a" });
  });

  it("when the site list cannot be loaded it says so and offers the retry, never a dead button", async () => {
    server.use(http.get("*/api/v1/sites", () => HttpResponse.json({ type: "urn:x", title: "down", status: 503 }, { status: 503 })));
    renderToday();

    expect(await screen.findByText(/demo yard could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "See the demo yard" })).toBeNull();
  });
});

describe("Today: a pinned phone", () => {
  it("shows the level now, until when, the action from the hour's codes, and the draft label", async () => {
    pin();
    renderToday();

    expect(await orange()).toBeInTheDocument();
    expect(screen.getByText("Site level now")).toBeInTheDocument();
    // 11:00, 12:00 and 13:00 are Orange, 14:00 is Red (the mock's placeholder levels): until 14:00.
    expect(screen.getByText(/until/).textContent).toContain("14:00");
    expect(screen.getByText("Work 20 min, rest 40 min in shade")).toBeInTheDocument();
    expect(screen.getByText("Draft wording, awaiting clinical review")).toBeInTheDocument();
    const also = screen.getByRole("heading", { name: "Also now" }).closest("section") as HTMLElement;
    expect(within(also).getByText("Drink water")).toBeInTheDocument();
    expect(within(also).getByText("Never work alone")).toBeInTheDocument();
    // No quantity of water anywhere (clinical review pending): the code that mentions litres is shown as "Drink water".
    expect(document.body.textContent).not.toMatch(/litre|1\.2/i);
  });

  it("test_primary_action_is_turn_on_warnings_when_push_off: one primary action, to Alerts; none once push is on", async () => {
    pin();
    renderToday();
    await orange();

    const primary = document.querySelectorAll("[data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent("Turn on warnings");
    expect(primary[0]).toHaveAttribute("href", "/en/worker/alerts");
    expect(primary[0]).toHaveAttribute("data-prefetch", "false");
  });

  it("has no primary action once warnings are on (a push registration exists on this phone)", async () => {
    pin();
    act(() => {
      useProfile.getState().setPush({ serverId: "sub-1", endpoint: "https://push.example/1", siteId: SITE_DEMO });
    });
    renderToday();
    await orange();

    expect(document.querySelectorAll("[data-primary]")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Turn on warnings" })).toBeNull();
  });

  it("names the crew in the header slot through the shell (no layout query), and takes the name back when the screen goes", async () => {
    pin();
    const setCrewLabel = vi.fn();
    const setSiteLabel = vi.fn();
    const { unmount } = renderToday({ setCrewLabel, setSiteLabel });
    await orange();

    // The name comes from the crew's timeline, which only this screen asks for: it reaches the header through the slot.
    const crewName = crewTimeline(DEMO_CREW_ID, "2026-09-03")?.crew_name;
    expect(crewName).toBeTruthy();
    await waitFor(() => {
      expect(setCrewLabel).toHaveBeenCalledWith(crewName);
    });
    unmount();
    expect(setCrewLabel).toHaveBeenLastCalledWith(null);
  });

  it("a worker's own level above the site's leads and says so", async () => {
    pin();
    act(() => {
      useProfile.getState().save({ ...profile, heatWorkStartDate: "2026-09-03" });
    });
    renderToday();

    // Day 0 of heat work at a moderate workload is Red at the mock policy's numbers, above the site's Orange: the sign leads with
    // the worker's own level, says whose it is, and says it is higher.
    expect(await screen.findByRole("heading", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByText("Your level now")).toBeInTheDocument();
    expect(screen.getByText("Your own level is higher than the site level.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Orange" })).toBeNull();
  });
});

describe("Today: states", () => {
  it("test_stale_and_fallback_are_not_live: a stale forecast reads 'Last known level' with its time and age", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { ageMs: STALE_AGE_MS, status: "stale" })),
      ),
    );
    pin();
    renderToday();

    await orange();
    expect(screen.getAllByText("Last known level").length).toBeGreaterThan(0);
    expect(screen.queryByText("Site level now")).toBeNull();
    expect(screen.getByText(/This may be out of date/)).toBeInTheDocument();
    expect(document.querySelector('[data-kind="stale"]')).not.toBeNull();
    expect(document.querySelector('[data-kind="live"]')).toBeNull();
  });

  it("test_stale_and_fallback_are_not_live (I2): a last known level is secondary: the lead is the protective plan, the spine has no heat and no line at now", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { ageMs: STALE_AGE_MS, status: "stale" })),
      ),
    );
    pin();
    renderToday();
    await orange();

    // The lead says there is no fresh forecast and gives the site rules, never the stale hour's own cycle or its extra lines.
    const lead = document.querySelector("[data-action-lead]") as HTMLElement;
    expect(lead.textContent).toBe("Site rules: rest in shade every hour, drink water");
    expect(screen.getByText("No fresh forecast: protective plan")).toBeInTheDocument();
    expect(screen.queryByText(/Work \d+ min, rest/)).toBeNull();
    expect(screen.queryByText("Also now")).toBeNull();
    // The spine: every cell is "no data", and there is no line at now.
    const cells = [...document.querySelectorAll("[data-spine] [data-cell]")];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.getAttribute("data-heat") === "none")).toBe(true);
    expect(document.querySelector("[data-spine] [data-now]")).toBeNull();
    // No promise of how long the old level holds.
    expect(screen.queryByText(/^until /)).toBeNull();
  });

  it("control for the test above: a live day has heat in the spine, a line at now and the hour's own lead", async () => {
    pin();
    renderToday();
    await orange();

    expect([...document.querySelectorAll("[data-spine] [data-cell]")].some((cell) => cell.getAttribute("data-heat") === "data")).toBe(true);
    expect(document.querySelector("[data-spine] [data-now]")).not.toBeNull();
    expect(screen.queryByText("No fresh forecast: protective plan")).toBeNull();
  });

  it("a fallback forecast shows no level: the fixed site rules, in every hour", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { status: "fallback" })),
      ),
    );
    pin();
    renderToday();

    expect(await screen.findByRole("heading", { name: "Site rules" })).toBeInTheDocument();
    expect(screen.getByText("No fresh forecast: protective plan")).toBeInTheDocument();
    expect(screen.getByText("Site rules: rest in shade every hour, drink water")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Orange" })).toBeNull();
    expect(document.querySelector('[data-kind="live"]')).toBeNull();
    expect(await screen.findByRole("button", { name: "Why site rules?" })).toBeInTheDocument();
  });

  it("an error shows the site rules, a retry and the request id: never a dead end", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", () =>
        HttpResponse.json(
          { type: "urn:stellar-blaze:problem:internal", title: "Internal", status: 500, request_id: "req-7f3a" },
          { status: 500, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    pin();
    renderToday();

    expect(await screen.findByText(/follow the site rules: rest in shade every hour, drink water/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByText("req-7f3a")).toBeInTheDocument();
  });

  it("test_out_of_season_has_no_slot: after the ban season no slot is drawn and the day says why", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { date: "2026-09-24" })),
      ),
      http.get("*/api/v1/crews/:crew_id/timeline", ({ params }) =>
        HttpResponse.json(crewTimeline(String(params["crew_id"]), "2026-09-24")),
      ),
    );
    pin();
    renderToday();

    expect(await screen.findByText("No midday break by law after 15 Sep")).toBeInTheDocument();
    expect(document.querySelector("[data-slot]")).toBeNull();
    expect(document.querySelector('[data-spine][data-ban="not-in-force"]')).not.toBeNull();
    expect(screen.queryByText(/Break in/)).toBeNull();
  });

  it("on a replay day the slot is drawn where the window says, with Break in, Back to work and Shift ends", async () => {
    pin();
    renderToday();
    await orange();

    expect(document.querySelector("[data-slot]")).not.toBeNull();
    expect(screen.getByText("Break in 1 h 20 min")).toBeInTheDocument();
    expect(screen.getByText(/Back to work/).textContent).toContain("15:00");
    // The shift comes with the crew's timeline, a second request.
    expect((await screen.findByText(/Shift ends/)).textContent).toContain("18:00");
  });

  it("no shift: the crew's name, why, and the site level still shown; no spine and no lead", async () => {
    server.use(
      http.get("*/api/v1/crews/:crew_id/timeline", ({ params }) =>
        HttpResponse.json({ ...crewTimeline(String(params["crew_id"]), "2026-09-03"), shift: [] }),
      ),
    );
    pin();
    renderToday();

    expect(await screen.findByRole("heading", { name: "No shift for Crew B today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Orange" })).toBeInTheDocument();
    expect(document.querySelector("[data-spine]")).toBeNull();
    expect(screen.getByRole("link", { name: "Turn on warnings" })).toHaveAttribute("href", "/en/worker/alerts");
  });

  it("an unknown action code reads 'Follow the site rules', never invented wording", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
        const day = forecastToday(String(params["site_id"]));
        return HttpResponse.json(day === undefined ? day : { ...day, hours: day.hours.map((hour) => ({ ...hour, action_codes: ["wibble"] })) });
      }),
    );
    pin();
    renderToday();

    await orange();
    expect(screen.getByText("Follow the site rules")).toBeInTheDocument();
    expect(screen.queryByText(/wibble/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Also now" })).toBeNull();
  });

  it("test_personal_level_never_shown_when_forecast_does_not_cover_now: a forecast for another day gives the site rules", async () => {
    server.use(
      // The replay stamp says 3 Sep; the answer's hours are 24 Sep, so none covers the replayed 11:10.
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
        const day = forecastToday(String(params["site_id"]));
        const other = forecastToday(String(params["site_id"]), { date: "2026-09-24" });
        return HttpResponse.json(day === undefined || other === undefined ? day : { ...day, hours: other.hours });
      }),
    );
    pin();
    act(() => {
      useProfile.getState().save(profile);
    });
    renderToday();

    expect(await screen.findByText("No forecast for this hour")).toBeInTheDocument();
    expect(screen.queryByText(/Your own level/)).toBeNull();
    expect(screen.queryByText("Your level now")).toBeNull();
  });

  it("a pinned phone's loading screen is a skeleton, never the 'no site' entry, and it ends in the level", async () => {
    pin();
    const { container } = renderToday();
    // Synchronously after the first render: the forecast has not arrived, so the screen is the skeleton, and a pinned phone must
    // never flash the entry for a phone that has no site.
    expect(container.querySelector('[role="status"][aria-busy="true"] [data-skeleton="level-sign"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Scan your crew's code" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Orange" })).toBeNull();
    // ...and the skeleton goes when the level comes.
    await orange();
    expect(container.querySelector('[data-skeleton="level-sign"]')).toBeNull();
  });

  it("an unpinned phone shows the entry at once, not a skeleton that never ends", async () => {
    const { container } = renderToday();
    expect(await screen.findByRole("heading", { name: "Scan your crew's code" })).toBeInTheDocument();
    expect(container.querySelector('[data-skeleton="level-sign"]')).toBeNull();
  });
});
