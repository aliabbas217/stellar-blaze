import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import type { ReactNode } from "react";
import type { components } from "@/api/schema";
import { FieldHeadingContext, type FieldHeadingSlot } from "@/components/shell/FieldHeading";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { DEMO_CREW_ID } from "@/features/demo/constants";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import * as chooseSite from "@/features/profile/choose-site";
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
const replace = vi.fn();
const router = { replace };
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/worker",
  useRouter: () => router,
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
  replace.mockClear();
  search = "";
  window.localStorage.clear();
  resetSitePinForTests();
  useProfile.setState({ site: null, push: null, profile: null });
});

const DEMO_CONTACTS = { supervisorPhone: "+12025550143", firstAiderPhone: "+12025550144" };

const orange = () => screen.findByRole("heading", { name: "Orange" });
const LEAD = "No fresh forecast: protective plan";
/** The lead of a not-live state: found by its heading (the live-state `orange()` would match two "Orange" signs here). */
const protectiveLead = () => screen.findByRole("heading", { name: LEAD });

/** The first non-empty text of the rendered screen, in reading (DOM) order. */
function firstText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? "";
    if (text !== "") return text;
  }
  return "";
}

/**
 * F2 W3.2 (architect ruling b): in a stale, offline or fallback state the protective-plan lead is the HERO (`data-hero`, one
 * element, the spine drops the attribute), the FIRST text in reading order, and the sign shows the protective level (High, drawn
 * orange and dashed). Called by every not-live test below.
 */
async function expectProtectiveLead(container: HTMLElement): Promise<HTMLElement> {
  const heading = await protectiveLead();
  expect(firstText(container)).toBe(LEAD);
  const heroes = document.querySelectorAll("[data-hero]");
  expect(heroes).toHaveLength(1);
  const lead = heroes[0] as HTMLElement;
  expect(lead.hasAttribute("data-protective-lead")).toBe(true);
  expect(lead.contains(heading)).toBe(true);
  // The spine stays on screen, but it is not the hero while the forecast is not live.
  expect(document.querySelector("[data-spine]")).not.toBeNull();
  expect(document.querySelector("[data-spine][data-hero]")).toBeNull();
  // No line at "now" through a spine that no forecast vouches for (W4 I1: the fallback state drew one).
  expect(document.querySelectorAll("[data-spine] [data-now]")).toHaveLength(0);
  // The sign shows the protective level, dashed (kind "fallback"), never a live one.
  const sign = lead.querySelector('[data-level-sign][data-size="hero"]');
  expect(sign?.getAttribute("data-kind")).toBe("fallback");
  expect(sign?.querySelector("[data-level-word]")?.textContent).toBe("Orange");
  expect(document.querySelector('[data-level-sign][data-kind="live"]')).toBeNull();
  return lead;
}

describe("Today: no site yet", () => {
  afterEach(() => {
    vi.restoreAllMocks(); // the W2 tests below make the store chunk fail: that must not leak into the next test
  });

  it("S6a: no site on the phone and none in the link hands over to the join page (replace), and offers one real link to it meanwhile", async () => {
    renderToday();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/worker/join");
    });
    expect(screen.getByRole("link", { name: "Join your crew" })).toHaveAttribute("href", "/en/worker/join");
    // The old dead end is gone: no demo button here, and nothing was pinned.
    expect(screen.queryByRole("button", { name: /demo yard/i })).toBeNull();
    expect(useProfile.getState().site).toBeNull();
  });

  it("W2: a site in the link that cannot be saved on the phone still shows the level, with one calm line", async () => {
    search = `?site=${SITE_DEMO}&crew=${DEMO_CREW_ID}`;
    vi.spyOn(chooseSite, "chooseDeviceSite").mockRejectedValue(new Error("Loading chunk failed"));
    renderToday();

    expect(await orange()).toBeInTheDocument();
    expect(await screen.findByText("This phone could not save the site. Reload the page to try again.")).toBeInTheDocument();
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
});

describe("Today: a pinned phone", () => {
  it("shows the action first, then the level now and until when, from the hour's codes, with the one clinical note", async () => {
    pin();
    renderToday();

    expect(await orange()).toBeInTheDocument();
    expect(screen.getByText("Site level now")).toBeInTheDocument();
    // 11:00, 12:00 and 13:00 are Orange, 14:00 is Red (the mock's placeholder levels): until 14:00.
    expect(screen.getByText(/until/).textContent).toContain("14:00");
    expect(screen.getByText("Work 20 min, rest 40 min in shade")).toBeInTheDocument();
    // D5: ONE clinical note per screen, covering the action and the list, and the old label is gone.
    expect(screen.getAllByText("Not yet checked by a clinician.")).toHaveLength(1);
    expect(screen.queryByText(/Draft wording/)).toBeNull();
    // The action is the first thing of the level card; the level row follows it.
    const lead = document.querySelector("[data-action-lead]") as HTMLElement;
    const sign = document.querySelector("[data-level-sign]") as HTMLElement;
    expect(lead.compareDocumentPosition(sign) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sign.querySelector("[data-level-word]")).toHaveTextContent("Orange");
    const also = screen.getByRole("heading", { name: "Also now" }).closest("section") as HTMLElement;
    expect(within(also).getByText("Drink water")).toBeInTheDocument();
    expect(within(also).getByText("Never work alone")).toBeInTheDocument();
    // No quantity of water anywhere (clinical review pending): the code that mentions litres is shown as "Drink water".
    expect(document.body.textContent).not.toMatch(/litre|1\.2/i);
  });

  it("test_employer_duties_are_not_on_the_workers_screen: the Orange hour of the real ruleset lists only what the worker does, each with its own glyph", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
        const forecast = forecastToday(String(params["site_id"]));
        if (forecast === undefined) return new HttpResponse(null, { status: 404 });
        const orangeCodes = ["cycle.high.heavy.20-40", "no-lone-work", "no-unacclimatised", "fluids.over-1.2l", "high-risk-induction", "personal-water-bottle-2l", "self-paced-work"];
        return HttpResponse.json({ ...forecast, hours: forecast.hours.map((hour) => ({ ...hour, action_codes: orangeCodes })) });
      }),
    );
    pin();
    renderToday();

    expect(await orange()).toBeInTheDocument();
    const also = screen.getByRole("heading", { name: "Also now" }).closest("section") as HTMLElement;
    // The three employer duties (ADOSH text written for duty holders) are nowhere on the screen: not as a line, not as text.
    for (const duty of ["No unacclimatised person to work", "High Risk induction required", "Provide personal water bottle"]) {
      expect(screen.queryByText(new RegExp(duty))).toBeNull();
    }
    // What is left is what the worker does: at most three lines, one glyph per rule, no two the same.
    const rows = within(also).getAllByRole("listitem");
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows.map((row) => row.textContent)).toEqual(["Never work alone", "Drink water", expect.stringMatching(/^Self-paced work/)]);
    const glyphs = rows.map((row) => row.querySelector("[data-pictogram]")?.getAttribute("data-pictogram"));
    expect(glyphs).toEqual(["buddy", "water", "clock"]);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    // One note for the whole screen, not one under the list as well.
    expect(screen.getAllByText("Not yet checked by a clinician.")).toHaveLength(1);
  });

  it("test_warnings_off_is_a_quiet_row_when_push_off: Turn on is a link to Alerts, not a primary action; none once push is on", async () => {
    pin();
    renderToday();
    await orange();

    const row = document.querySelector("[data-warnings-off]") as HTMLElement;
    expect(row).toHaveTextContent("Warnings are off on this phone");
    const turnOn = within(row).getByRole("link", { name: "Turn on warnings" });
    expect(turnOn).toHaveTextContent("Turn on");
    expect(turnOn).toHaveAttribute("href", "/en/worker/alerts");
    expect(turnOn).toHaveAttribute("data-prefetch", "false");
    // The screen has no primary action of its own: the unwell slab is the dock's, and one-time setup is quiet.
    expect(document.querySelectorAll("[data-primary]")).toHaveLength(0);
  });

  it("has no primary action once warnings are on (a push registration exists on this phone)", async () => {
    pin();
    act(() => {
      useProfile.getState().setPush({ serverId: "sub-1", endpoint: "https://push.example/1", siteId: SITE_DEMO });
    });
    renderToday();
    await orange();

    expect(document.querySelectorAll("[data-primary]")).toHaveLength(0);
    expect(document.querySelector("[data-warnings-off]")).toBeNull();
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
  it("test_stale_and_fallback_are_not_live: a stale forecast leads with the protective plan; the last known level is secondary and dashed, with its time and age", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { ageMs: STALE_AGE_MS, status: "stale" })),
      ),
    );
    pin();
    const { container } = renderToday();

    const lead = await expectProtectiveLead(container);
    expect(screen.queryByText("Site level now")).toBeNull();
    expect(screen.getByText("Protective level")).toBeInTheDocument();
    // The last known level: a mini sign, dashed, inside the lead, with when it was written.
    const lastKnown = lead.querySelector('[data-level-sign][data-kind="stale"][data-size="mini"]');
    expect(lastKnown?.textContent).toContain("Last known level");
    expect(lastKnown?.querySelector("[data-level-word]")?.textContent).toBe("Orange");
    expect(lead.textContent).toMatch(/Updated .* ago\./);
  });

  it("W4 I5: a last known level ABOVE the protective Orange (Red) is said in the lead's own words, and an Orange or lower one is not", async () => {
    const stale = (): void => {
      server.use(
        http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
          HttpResponse.json(forecastToday(String(params["site_id"]), { ageMs: STALE_AGE_MS, status: "stale" })),
        ),
      );
    };
    // 14:30 is the Red hour of the mock's placeholder levels
    search = "at=14:30";
    stale();
    pin();
    const red = renderToday();
    const lead = await expectProtectiveLead(red.container);
    expect(lead.querySelector("[data-last-known-higher]")?.textContent).toBe("Last known level: Red");
    expect(lead.querySelector('[data-level-sign][data-kind="stale"][data-size="mini"] [data-level-word]')?.textContent).toBe("Red");
    // the protective sign itself is still Orange and dashed: the sentence is added, nothing is hidden
    expect(lead.querySelector('[data-level-sign][data-size="hero"] [data-level-word]')?.textContent).toBe("Orange");
    red.unmount();

    search = "at=11:10";
    pin();
    const orange = renderToday();
    const orangeLead = await expectProtectiveLead(orange.container);
    expect(orangeLead.querySelector("[data-last-known-higher]")).toBeNull();
  });

  it("test_stale_and_fallback_are_not_live (I2): a last known level is secondary: the lead is the protective plan, the spine has no heat and no line at now", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { ageMs: STALE_AGE_MS, status: "stale" })),
      ),
    );
    pin();
    const { container } = renderToday();
    await expectProtectiveLead(container);

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

  it("a fallback forecast leads with the protective plan and shows the protective level, with no last known level", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) =>
        HttpResponse.json(forecastToday(String(params["site_id"]), { status: "fallback" })),
      ),
    );
    pin();
    const { container } = renderToday();

    const lead = await expectProtectiveLead(container);
    expect(screen.getByText("Site rules: rest in shade every hour, drink water")).toBeInTheDocument();
    // No forecast was ever read: nothing to show as "last known", and no updated line.
    expect(lead.querySelector('[data-kind="stale"]')).toBeNull();
    expect(lead.textContent).not.toMatch(/Updated/);
    expect(await screen.findByRole("button", { name: "Why site rules?" })).toBeInTheDocument();
  });

  it("an offline phone leads with the protective plan and says why, with the saved level secondary and dashed", async () => {
    pin();
    const online = vi.spyOn(window.navigator, "onLine", "get");
    online.mockReturnValue(true);
    const { container } = renderToday();
    await orange();
    // The phone loses its signal after the level was read: the same screen turns into the protective lead.
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    const lead = await expectProtectiveLead(container);
    expect(lead.textContent).toContain("You are offline");
    expect(lead.textContent).toContain("Showing what this phone saved.");
    expect(lead.querySelector('[data-level-sign][data-kind="stale"][data-size="mini"]')).not.toBeNull();
    expect(screen.getByText("Site rules: rest in shade every hour, drink water")).toBeInTheDocument();
    // TanStack Query's online manager is a module singleton that listens to these events: put it back for the tests that follow.
    online.mockRestore();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
  });

  it("a live day has no protective lead: the spine is the hero and the sign is live", async () => {
    pin();
    renderToday();
    await orange();
    expect(screen.queryByRole("heading", { name: LEAD })).toBeNull();
    expect(document.querySelector("[data-protective-lead]")).toBeNull();
    expect(document.querySelectorAll("[data-hero]")).toHaveLength(1);
    expect(document.querySelector("[data-hero] [data-spine]")).not.toBeNull();
    expect(document.querySelector('[data-level-sign][data-kind="live"]')).not.toBeNull();
  });

  it("the shift is ONE horizontal strip: only Now is on it, the rest of the day is one plain line under it, and the card and the strip are the hero", async () => {
    pin();
    renderToday();
    await orange();
    const hero = document.querySelector("[data-hero]") as HTMLElement;
    const strip = hero.querySelector('[data-spine][data-orientation="h"][data-surface="field"]') as HTMLElement;
    expect(strip, "a horizontal field spine inside the hero").not.toBeNull();
    // Only "Now" is stacked over the band; the slot's own label is off (the line says it) and the slot is still drawn.
    expect([...strip.querySelectorAll("[data-waypoint]")].map((item) => item.textContent)).toEqual(["Now"]);
    expect(strip.querySelector("[data-slot-label]")).toBeNull();
    expect(strip.querySelector("[data-slot]")).not.toBeNull();
    // The one plain line: the break, back to work and the shift's end, as separate phrases.
    // The crew's timeline (the shift's end) arrives after the forecast.
    await waitFor(() => {
      expect(hero.querySelector("[data-shift-line]")?.textContent).toContain("Shift ends");
    });
    const line = hero.querySelector("[data-shift-line]") as HTMLElement;
    expect([...line.querySelectorAll("span")].map((span) => span.textContent.replace(/[⁦⁩]/g, ""))).toEqual([
      "Break in 1 h 20 min",
      "Back to work 15:00",
      "Shift ends 18:00",
    ]);
    // The card (action, then level) and the strip stand together; the card is a panel.
    expect(hero.querySelector("[data-action-lead]")).not.toBeNull();
    expect(hero.querySelector("[data-level-sign]")).not.toBeNull();
  });

  it("out of season the line says why there is no break, once, and the strip draws no slot", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
        const forecast = forecastToday(String(params["site_id"]));
        if (forecast === undefined) return new HttpResponse(null, { status: 404 });
        return HttpResponse.json({ ...forecast, ban_window: { ...forecast.ban_window, active_on_date: false, starts_at: null, ends_at: null, season_end: "08-01" } });
      }),
    );
    pin();
    renderToday();
    await orange();
    const line = document.querySelector("[data-shift-line]") as HTMLElement;
    expect(line.textContent).toMatch(/No midday break by law after 1 Aug/);
    expect(line.textContent).not.toMatch(/Break in/);
    expect(document.querySelector("[data-spine] [data-slot]")).toBeNull();
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
    expect(container.querySelectorAll('[data-today-skeleton] [data-skeleton]')).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Join your crew" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Orange" })).toBeNull();
    // ...and the skeleton goes when the level comes.
    await orange();
    expect(container.querySelector("[data-today-skeleton]")).toBeNull();
  });

  it("an unpinned phone hands over to the join page at once, not a Today skeleton that never ends", async () => {
    const { container } = renderToday();
    expect(await screen.findByRole("link", { name: "Join your crew" })).toBeInTheDocument();
    expect(container.querySelector("[data-today-skeleton]")).toBeNull();
  });
});

describe("Today: replay mode (Part S0, review focus 6)", () => {
  const REPLAY_NOW = new Date("2026-09-03T07:10:00Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A live day is read at the phone's own clock, so the phone's clock is set to the moment the mock day covers. */
  function phoneClockAtReplayMoment() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(REPLAY_NOW);
  }

  function serveDay(change: (day: components["schemas"]["SiteForecastToday"]) => components["schemas"]["SiteForecastToday"], ageMs: number) {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => {
        const day = forecastToday(String(params["site_id"]), { now: REPLAY_NOW, ageMs });
        return HttpResponse.json(day === undefined ? day : change(day));
      }),
    );
  }

  it("a replay day carries a Replay stamp, once the forecast has arrived", async () => {
    pin();
    const { container } = renderToday();
    expect(container.querySelector("[data-mode-stamp]")).toBeNull();

    await orange();
    expect(within(container.querySelector("[data-mode-stamp]") as HTMLElement).getByRole("note")).toHaveTextContent("Replay");
  });

  it("a live day carries no stamp", async () => {
    phoneClockAtReplayMoment();
    serveDay((day) => ({ ...day, mode: "live" }), 10 * 60_000);
    pin();
    const { container } = renderToday();

    await orange();
    expect(container.querySelector("[data-mode-stamp]")).toBeNull();
    expect(screen.queryByText("Replay")).toBeNull();
  });

  it("a replay forecast the API calls fresh is drawn live although generated_at is 20 hours before the replay clock", async () => {
    serveDay((day) => day, 20 * 60 * 60 * 1000);
    pin();
    renderToday();

    await orange();
    expect(screen.getByText("Site level now")).toBeInTheDocument();
    expect(screen.queryByText("Last known level")).toBeNull();
    expect(document.querySelector('[data-kind="live"]')).not.toBeNull();
    expect(document.querySelector('[data-kind="stale"]')).toBeNull();
  });

  it("a live forecast generated 20 hours before is last known", async () => {
    phoneClockAtReplayMoment();
    serveDay((day) => ({ ...day, mode: "live" }), 20 * 60 * 60 * 1000);
    pin();
    const { container } = renderToday();

    await expectProtectiveLead(container);
    expect(screen.getAllByText("Last known level").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-kind="live"]')).toBeNull();
  });
});
