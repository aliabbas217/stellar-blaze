import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Middleware } from "openapi-fetch";
import { IDBFactory } from "fake-indexeddb";
import { http, HttpResponse } from "msw/http";
import { types } from "node:util";
import type { ReactNode } from "react";
import en from "../../../../../messages/en.json";
import { apiClient } from "@/api/client";
import { crewDayPlan, crewStops, crewTimeline, forecastToday, listCrews, REPLAY_DATE, SITE_DEMO } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { describeQueries, installSupervisorTestEnvironment, renderPlan, stopBar, textOf } from "../support";

/*
 * The supervisor's plan screen with sign-off (F2 Task 20), through the real hooks and MSW. Crew B is the demo crew (unsigned, heavy
 * work, four acknowledgement items on the canned day); Crew A is signed, Crew C changed since signed, Crew D below k. The replay
 * clock is 3 Sep at 11:10 (every crew is off shift then); `?at=` moves it. Stop work is held to the same rules as on the crews
 * screen: this file asserts the ones the plan adds (it is outside the form and untouched by sign-off).
 */

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/en/supervisor/crews/crew-b",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/supervisor/crews/crew-b",
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
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const middleware of scenarioMiddleware.splice(0)) apiClient.eject(middleware);
});

const DAY_PLAN = "*/api/v1/crews/:crew_id/day-plan";
const SIGN_OFF = "*/api/v1/crews/:crew_id/day-plan/sign-off";

const problemBody = (extra: Record<string, unknown>) => ({ title: "x", request_id: "req-plan-1", ...extra });
const json = (status: number, body: Record<string, unknown>) =>
  HttpResponse.json(body, { status, headers: { "content-type": "application/problem+json" } });

/** Sends `x-sb-mock-scenario` with every request, as the e2e does. */
const scenarioMiddleware: Middleware[] = [];
function scenario(value: string): void {
  const middleware: Middleware = {
    onRequest({ request }) {
      request.headers.set("x-sb-mock-scenario", value);
      return request;
    },
  };
  scenarioMiddleware.push(middleware);
  apiClient.use(middleware);
}

const barText = () => textOf(stopBar());
/** Waits until the page's text (whitespace collapsed, `<bdi>` isolates read through) contains `text`: a sentence is split over several elements. */
const pageSays = (text: string | RegExp) =>
  waitFor(() => {
    const page = textOf(document.body);
    if (typeof text === "string") expect(page).toContain(text);
    else expect(page).toMatch(text);
  });
const heading = (name: string) => screen.findByRole("heading", { level: 2, name });
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-block]")];

describe("the plan screen: the replay stamp follows the plan's own mode", () => {
  // B3 ba912f3: DayPlan and CrewTimeline carry `mode` (optional in the contract). The plan's own wins, then the timeline's, then
  // the forecast's, which is what the screen used before the contract had the member.
  const FORECAST = "*/api/v1/sites/:site_id/forecast/today";
  const TIMELINE = "*/api/v1/crews/:crew_id/timeline";
  let forecastServed = false;
  beforeEach(() => {
    forecastServed = false;
  });
  const planWith = (mode: "live" | "replay" | undefined) =>
    http.get(DAY_PLAN, ({ params }) => {
      const plan = crewDayPlan(String(params["crew_id"]), REPLAY_DATE);
      if (plan === undefined) throw new Error("fixture");
      const served: Record<string, unknown> = { ...plan, mode };
      if (mode === undefined) delete served["mode"];
      return HttpResponse.json(served);
    });
  const timelineWith = (mode: "live" | "replay" | undefined) =>
    http.get(TIMELINE, ({ params }) => {
      const timeline = crewTimeline(String(params["crew_id"]), REPLAY_DATE);
      if (timeline === undefined) throw new Error("fixture");
      const served: Record<string, unknown> = { ...timeline, mode };
      if (mode === undefined) delete served["mode"];
      return HttpResponse.json(served);
    });
  const forecastWith = (mode: "live" | "replay") =>
    http.get(FORECAST, ({ params }) => {
      const day = forecastToday(String(params["site_id"]), { now: new Date("2026-09-03T07:10:00Z") });
      if (day === undefined) throw new Error("fixture");
      forecastServed = true;
      return HttpResponse.json({ ...day, mode });
    });
  const stamp = () => document.querySelector("[data-mode-stamp]");
  /** The plan is drawn and the forecast has been read and applied: an absent stamp is then an answer, not a wait. */
  const settled = async () => {
    await heading("Crew B plan");
    await waitFor(() => {
      expect(rows().length).toBeGreaterThan(0);
      expect(forecastServed).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  it("while the forecast is still being read the plan does not call it stale, and the strip's place is held (no notice flashes, nothing moves when it arrives)", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      planWith("live"),
      http.get(FORECAST, async ({ params }) => {
        await held;
        const day = forecastToday(String(params["site_id"]), { now: new Date("2026-09-03T07:10:00Z") });
        if (day === undefined) throw new Error("fixture");
        forecastServed = true;
        return HttpResponse.json({ ...day, mode: "live" });
      }),
    );
    renderPlan("crew-b");
    await heading("Crew B plan");
    await waitFor(() => {
      expect(rows().length).toBeGreaterThan(0);
    });
    // The forecast is unknown, not stale: "No fresh forecast: protective plan" would be a false statement for a moment, and its block
    // (a hundred pixels) pushed the strip and the rows down when it left (layout shift 0.076 on the plan screen, Lighthouse).
    expect(screen.queryByText(en.supervisor.crews.stale.title)).toBeNull();
    expect(document.querySelector("[data-plan-strip-pending]")).not.toBeNull();
    expect(document.querySelector("[data-plan-strip]")).toBeNull();
    release();
    await waitFor(() => {
      expect(document.querySelector("[data-plan-strip]")).not.toBeNull();
    });
    expect(document.querySelector("[data-plan-strip-pending]")).toBeNull();
    // (At this test's clock the fixture forecast IS old, so once it is known the notice may rightly show: that is an answer, not a wait.)
  });

  it("a live plan carries no Replay stamp, although the forecast says replay", async () => {
    server.use(planWith("live"), forecastWith("replay"));
    renderPlan("crew-b");
    await settled();
    expect(stamp()).toBeNull();
  });

  it("a replay plan carries the Replay stamp, although the forecast says live", async () => {
    server.use(planWith("replay"), forecastWith("live"));
    renderPlan("crew-b");
    await settled();
    expect(stamp()).not.toBeNull();
  });

  it("a plan with no mode falls back to the timeline's, then the forecast's", async () => {
    // Neither the plan nor the timeline says: the forecast's mode stands (replay stamped, live not).
    server.use(planWith(undefined), timelineWith(undefined), forecastWith("replay"));
    const replay = renderPlan("crew-b");
    await settled();
    expect(stamp()).not.toBeNull();
    replay.unmount();

    forecastServed = false;
    server.use(planWith(undefined), timelineWith(undefined), forecastWith("live"));
    const live = renderPlan("crew-b");
    await settled();
    expect(stamp()).toBeNull();
    live.unmount();

    // The timeline says live, the forecast replay: the timeline is read before the forecast.
    forecastServed = false;
    server.use(planWith(undefined), timelineWith("live"), forecastWith("replay"));
    renderPlan("crew-b");
    await settled();
    expect(stamp()).toBeNull();
  });
});

describe("the plan screen: the ideal state", () => {
  it("leads with the crew and its level, draws the plan with a slot and the stamp, and lists every block", async () => {
    renderPlan("crew-b");

    await heading("Crew B plan");
    await pageSays("Crew B is off shift now. Back at 15:00 into Orange.");
    expect(screen.getByText("Crew level now")).toBeInTheDocument();
    // what the crew does and how many people: no restriction text for a crew with none
    expect(document.querySelector("[data-crew-subtitle]")?.textContent).toBe("Concrete pour · heavy work · 20 people");
    // the hero is the chart and the blocks, with the slot (the ban is in force on the replay day) and one now line
    const hero = document.querySelector("[data-hero]");
    expect(hero).not.toBeNull();
    expect(hero?.querySelector("[data-slot='in-force']")).not.toBeNull();
    expect(hero?.querySelectorAll("[data-now]")).toHaveLength(1);
    expect(hero?.hasAttribute("data-spine")).toBe(true);
    // every non-off segment of the day is a row
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    expect(rows()).toHaveLength(plan?.segments.length ?? -1);
    // governance and provenance on the screen
    expect(screen.getByText(en.supervisor.plan.floorBanner)).toBeInTheDocument();
    expect(document.querySelector("[data-mode-stamp]")).not.toBeNull();
    expect(screen.getByText(en.shell.demo.banner)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.shell.demo.reset.button })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Stop work, Crew B" })).toBeEnabled();
  });

  it("test_blocks_are_rows_with_44px_targets: each block is a native button row at least 44 px tall, never an SVG shape", async () => {
    renderPlan("crew-b");
    await heading("Crew B plan");
    await waitFor(() => {
      expect(rows().length).toBeGreaterThan(0);
    });

    for (const row of rows()) {
      const button = row.querySelector("button");
      expect(button, "a row is a button").not.toBeNull();
      expect(button?.className).toMatch(/\bmin-h-11\b/);
      expect(button).toHaveAttribute("aria-expanded", "false");
    }
    // nothing in the chart is a control
    expect(document.querySelector("[data-plan-bars] button, [data-plan-bars] [role='button'], [data-plan-bars] a")).toBeNull();
    // the states read in words: work, rest in shade, the midday break
    const text = textOf(document.querySelector("[data-block-rows]"));
    for (const word of ["Work", "Rest in shade", "Midday break"]) expect(text).toContain(word);
  });

  it("a row opens to its clause and the rule's id, and says so when the API sent no clause", async () => {
    const user = userEvent.setup();
    renderPlan("crew-b");
    await waitFor(() => {
      expect(rows().length).toBeGreaterThan(0);
    });
    const ban = rows().find((row) => row.getAttribute("data-block") === "ban");
    const work = rows().find((row) => row.getAttribute("data-block") === "work");
    if (ban === undefined || work === undefined) throw new Error("rows missing");

    const opener = within(ban).getByRole("button");
    expect(within(ban).queryByText(/Ministerial Resolution 44/)).not.toBeVisible();
    await user.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(within(ban).getByText(/Ministerial Resolution 44 of 2022/)).toBeVisible();
    // The clause is the API's English text: in a right-to-left page it is an English, left-to-right block (F2 Task 22).
    expect(within(ban).getByText(/Ministerial Resolution 44 of 2022/)).toHaveAttribute("lang", "en");
    expect(within(ban).getByText(/Ministerial Resolution 44 of 2022/)).toHaveAttribute("dir", "ltr");
    expect(within(ban).getByText("P-H1")).toBeVisible();
    await user.click(within(work).getByRole("button"));
    expect(within(work).getByText(en.supervisor.plan.blocks.noClause)).toBeVisible();
    // The "no clause" line is the app's own sentence, in the page's language: it is not marked English.
    expect(within(work).getByText(en.supervisor.plan.blocks.noClause)).not.toHaveAttribute("lang");
  });

  it("the current block is marked at the replay time (at 09:30 the Medium work block holds now)", async () => {
    search = "at=09:30";
    renderPlan("crew-b");
    await waitFor(() => {
      expect(document.querySelector("[data-current]")).not.toBeNull();
    });
    const current = document.querySelector("[data-current]") as HTMLElement;
    expect(current).toHaveAttribute("aria-current", "time");
    expect(textOf(current)).toContain("09:15 to 10:00");
    await pageSays(/Crew B is Amber until 10:00/);
  });
});

describe("the plan screen: sign-off", () => {
  it("test_unsigned_banner_says_alerts_and_stop_do_not_wait", async () => {
    renderPlan("crew-b");
    expect(
      await screen.findByText("Not signed. Crews see the rule plan, labelled unsigned fallback. Alerts and Stop work do not wait for you."),
    ).toBeInTheDocument();
  });

  it("test_signoff_blocks_until_ticked_without_disabling_submit: pressing with items unticked says how many are left, sends nothing, and focuses the first box", async () => {
    let posts = 0;
    server.use(
      http.post(SIGN_OFF, () => {
        posts += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    renderPlan("crew-b");
    const submit = await screen.findByRole("button", { name: "Sign off" });

    expect(submit).toBeEnabled();
    expect(await screen.findByText(/^4 items need a tick: /)).toBeInTheDocument();
    await user.click(submit);

    expect(await screen.findByText("Tick 4 more items to sign")).toBeInTheDocument();
    expect(submit).toBeEnabled();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toHaveFocus();
    expect(posts).toBe(0);

    await user.click(boxes[0] as HTMLElement);
    await user.click(boxes[2] as HTMLElement);
    await user.click(submit);
    expect(await screen.findByText("Tick 2 more items to sign")).toBeInTheDocument();
    expect(boxes[1]).toHaveFocus();
    expect(posts).toBe(0);
  });

  it("ticking every item and pressing Sign off records it: the 201 is what says Signed, with the time and the role in words", async () => {
    const user = userEvent.setup();
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);

    await user.click(screen.getByRole("button", { name: "Sign off" }));

    await pageSays("Signed 11:10 by the site supervisor. Crews see this plan.");
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    expect(screen.queryByText(/^Not signed/)).toBeNull();
    // the API has it, with exactly the ids the server named
    expect(listCrews(SITE_DEMO)?.find((crew) => crew.id === "crew-b")?.signoff_state).toBe("signed");
  });

  it("test_stop_works_while_signoff_pending: Stop is recorded while the sign-off request is still in flight, and a sign-off that fails never touches the bar", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(SIGN_OFF, async () => {
        await held;
        return json(500, problemBody({ type: "urn:x", status: 500 }));
      }),
    );
    const user = userEvent.setup();
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Sign off" }));
    // in flight: the button keeps its label and a spinner, and is not disabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign off" })).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getByRole("button", { name: "Sign off" })).toBeEnabled();

    await user.click(await screen.findByRole("button", { name: "Stop work, Crew B" }));
    await waitFor(() => {
      expect(barText()).toContain("Stop recorded.");
    });
    expect(crewStops("crew-b")).toHaveLength(1);
    // the bar is not inside the form
    expect(stopBar().closest("form")).toBeNull();

    release();
    expect(await screen.findByText(en.supervisor.plan.signOff.failed)).toBeInTheDocument();
    expect(barText()).toContain("Stop recorded.");
    expect(within(stopBar()).getByRole("button", { name: /^Undo/ })).toBeEnabled();
  });

  it("a 409 review-required lists the server's missing ids, unticks them and focuses the first", async () => {
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    const missing = plan?.ack_items[1]?.id ?? "";
    server.use(http.post(SIGN_OFF, () => json(409, problemBody({ type: "urn:stellar-blaze:problem:review-required", status: 409, missing_items: [missing] }))));
    const user = userEvent.setup();
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);

    await user.click(screen.getByRole("button", { name: "Sign off" }));

    const message = await screen.findByText(/^These items still need a tick: /);
    expect(message.textContent).toContain("High, 10:00 to 11:00");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[1]).not.toBeChecked();
    expect(boxes[1]).toHaveFocus();
    expect(boxes[0]).toBeChecked();
    expect(screen.queryByText(/^Signed/)).toBeNull();
  });

  // Live run against B3 ba912f3: the plan can change under the supervisor (a stop cleared after the undo window brings work, and its items,
  // back), and the 409 then names ids the screen never listed. They must become boxes to tick: the screen re-reads the plan, or the
  // supervisor is told what to tick and given nothing to tick.
  it("a 409 for items the screen did not list re-reads the plan: the new items appear unticked, named, the first focused", async () => {
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    if (plan === undefined) throw new Error("fixture");
    const added = plan.ack_items[plan.ack_items.length - 1];
    if (added === undefined) throw new Error("fixture");
    let reads = 0;
    server.use(
      http.get(DAY_PLAN, () => {
        reads += 1;
        // The first read is the plan as it was; every later one has the item the plan gained.
        return HttpResponse.json(reads === 1 ? { ...plan, ack_items: plan.ack_items.slice(0, -1) } : plan);
      }),
      http.post(SIGN_OFF, () => json(409, problemBody({ type: "urn:stellar-blaze:problem:review-required", status: 409, missing_items: [added.id] }))),
    );
    const user = userEvent.setup();
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    const before = screen.getAllByRole("checkbox");
    expect(before).toHaveLength(plan.ack_items.length - 1);
    for (const box of before) await user.click(box);

    await user.click(screen.getByRole("button", { name: "Sign off" }));

    await waitFor(() => {
      expect(screen.getAllByRole("checkbox")).toHaveLength(plan.ack_items.length);
    });
    const boxes = screen.getAllByRole("checkbox");
    const gained = boxes.find((box) => (box as HTMLInputElement).value === added.id);
    expect(gained).toBeDefined();
    expect(gained).not.toBeChecked();
    await waitFor(() => {
      expect(gained).toHaveFocus();
    });
    expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toHaveLength(plan.ack_items.length - 1);
    // named by what it is (zone and times), never by its id
    const message = await screen.findByText(/^These items still need a tick: /);
    expect(message.textContent).not.toContain(added.id);
    expect(screen.queryByText(/^Signed/)).toBeNull();
  });

  it("test_shift_not_legal_signoff_is_informative: a 422 on the sign-off lists the violations as rows, not as a failure", async () => {
    server.use(
      http.post(SIGN_OFF, () =>
        json(
          422,
          problemBody({
            type: "urn:stellar-blaze:problem:shift-not-legal",
            status: 422,
            violations: [{ rule_id: "P-H2.daily", clause: "Art. 17(1): maximum normal working hours are eight hours per day.", source_id: "fdl-33-2021" }],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Sign off" }));

    const result = await screen.findByText("This shift is not legal as planned");
    const section = result.closest("[data-shift-not-legal]") as HTMLElement;
    expect(section).toHaveAttribute("role", "status");
    expect(within(section).getByText("P-H2.daily")).toBeInTheDocument();
    expect(within(section).getByText(/maximum normal working hours/)).toBeInTheDocument();
    expect(screen.queryByText(en.supervisor.plan.signOff.failed)).toBeNull();
  });

  it("no signal and a 429 read as not recorded, never as signed", async () => {
    const user = userEvent.setup();
    server.use(http.post(SIGN_OFF, () => json(429, problemBody({ type: "urn:stellar-blaze:problem:rate-limited", status: 429 }))));
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Sign off" }));

    expect(await screen.findByText(en.supervisor.plan.signOff.failed)).toBeInTheDocument();
    expect(screen.getByText("req-plan-1")).toBeInTheDocument();
    expect(screen.queryByText(/^Signed/)).toBeNull();
    // and it can be tried again
    expect(screen.getByRole("button", { name: "Sign off" })).toBeEnabled();
  });

  it("a signed plan shows when and by whom, with no form (Crew A)", async () => {
    renderPlan("crew-a");
    await pageSays("Signed 05:40 by the site supervisor. Crews see this plan.");
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    expect(screen.queryByText(/^Not signed/)).toBeNull();
  });

  it("a signed plan with no time on record still reads 'Signed' (never neither the row nor the form)", async () => {
    const plan = crewDayPlan("crew-a", REPLAY_DATE);
    if (plan === undefined) throw new Error("no plan");
    server.use(http.get(DAY_PLAN, () => HttpResponse.json({ ...plan, signoff_state: "signed", signed_at: null })));
    renderPlan("crew-a");

    await pageSays("Signed. Crews see this plan.");
    expect(document.querySelector("[data-signed]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
  });

  it("test_plan_zone_labels: the sign-off items say 'Plan zone', never a bare zone name next to the hourly level, and a note says why they can differ", async () => {
    renderPlan("crew-b");
    const list = await screen.findByText(/^4 items need a tick: /);

    expect(textOf(list)).toContain("Plan zone Medium, 08:00 to 10:00");
    expect(textOf(list)).not.toMatch(/(^|: |, )(Medium|High|Red), \d/);
    const labels = screen.getAllByRole("checkbox").map((box) => textOf(box.closest("label")));
    expect(labels).toHaveLength(4);
    for (const text of labels) expect(text, text).toMatch(/^Plan zone (Medium|High|Red), \d\d:\d\d to \d\d:\d\d/);
    const note = document.querySelector("[data-zone-note]");
    expect(textOf(note)).toBe("A plan zone is set for each block from the plan's protective heat reading. The level shown above is the hourly warning, so the two can differ.");
    // The level sentence names a level, not a plan zone.
    await pageSays(/Crew B is /);
    expect(textOf(document.querySelector("#focal"))).toMatch(/(Green|Amber|Orange|Red)/);
    expect(textOf(document.querySelector("#focal"))).not.toContain("Plan zone");
  });

  it("a plan changed since it was signed says so, names the earlier time, and offers the form (Crew C)", async () => {
    renderPlan("crew-c");
    await pageSays(/Changed since signed at 05:40\. Crews see the current rule plan/);
    expect(await screen.findByRole("button", { name: "Sign off" })).toBeInTheDocument();
  });

  it("an all-Low day has nothing to tick and signs with an empty list", async () => {
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    if (plan === undefined) throw new Error("no plan");
    let sent: unknown = null;
    server.use(
      // the server's word follows the sign-off: after the 201 the plan reads signed
      http.get(DAY_PLAN, () => HttpResponse.json(sent === null ? { ...plan, ack_items: [] } : { ...plan, ack_items: [], signoff_state: "signed", signed_at: "2026-09-03T07:10:00Z", signed_by_role: "supervisor", signoff_label_code: null })),
      http.post(SIGN_OFF, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          { crew_id: "crew-b", date: REPLAY_DATE, signoff_state: "signed", signed_at: "2026-09-03T07:10:00Z", signed_by_role: "supervisor", acknowledged_items: [], deviation_reason_code: null },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPlan("crew-b");
    expect(await screen.findByText(en.supervisor.plan.signOff.none)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign off" }));

    await pageSays(/Signed 11:10 by the site supervisor/);
    expect(sent).toEqual({ acknowledged_items: [] });
  });
});

describe("the plan screen: refused and empty states", () => {
  it("test_validator_failed_plan_is_never_shown_and_signoff_off: 500 plan-invalid says so, shows no blocks and no form, quotes the request id, keeps Stop", async () => {
    scenario("plan-invalid");
    renderPlan("crew-b");

    expect(await screen.findByText("This plan failed the rule check and is not shown.")).toBeInTheDocument();
    expect(screen.getByText(/Crews see the site-rules fallback, never less protective than the midday ban\. Sign-off is off until a plan passes\./)).toBeInTheDocument();
    expect(screen.getByText("mock-req-1")).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("[data-plan-bars]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(await screen.findByRole("button", { name: "Stop work, Crew B" })).toBeEnabled();
  });

  it("test_shift_not_legal_is_informative: 422 on the plan lists each violation with its rule id, as a status, never an alert", async () => {
    scenario("shift-not-legal");
    renderPlan("crew-b");

    const title = await screen.findByText("This shift is not legal as planned");
    const section = title.closest("[data-shift-not-legal]") as HTMLElement;
    expect(section).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(section).getAllByText(/^P-H/).length).toBeGreaterThan(0);
    expect(within(section).getByText("Rules the shift breaks")).toBeInTheDocument();
    // no plan, no sign-off, but Stop work is there
    expect(rows()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Stop work, Crew B" })).toBeEnabled();
  });

  it("clause text is shown only when the API sent some", async () => {
    server.use(
      http.get(DAY_PLAN, () =>
        json(
          422,
          problemBody({
            type: "urn:stellar-blaze:problem:shift-not-legal",
            status: 422,
            violations: [
              { rule_id: "P-H5.window", clause: "", source_id: "fdl-33-2021" },
              { rule_id: "P-H2.daily", clause: "Art. 17(1): eight hours per day.", source_id: "fdl-33-2021" },
            ],
          }),
        ),
      ),
    );
    renderPlan("crew-b");
    const section = (await screen.findByText("This shift is not legal as planned")).closest("[data-shift-not-legal]") as HTMLElement;
    const first = within(section).getByText("P-H5.window").closest("li") as HTMLElement;
    expect(first.querySelectorAll("p")).toHaveLength(0);
    expect(within(section).getByText("Art. 17(1): eight hours per day.")).toBeInTheDocument();
  });

  it("an error names the failure with its request id, says crews see the rule plan, offers Try again and keeps Stop work", async () => {
    scenario("error");
    renderPlan("crew-b");

    expect(await screen.findByText(en.supervisor.plan.error.title)).toBeInTheDocument();
    expect(screen.getByText(en.supervisor.plan.error.detail)).toBeInTheDocument();
    expect(screen.getByText("mock-req-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.states.retry })).toBeEnabled();
    expect(await screen.findByRole("button", { name: /^Stop work/ })).toBeEnabled();
  });

  it("an empty plan is an actionable state with a link that exists and no promise about crews", async () => {
    scenario("empty");
    renderPlan("crew-b");

    expect(await screen.findByText(en.supervisor.plan.empty.title)).toBeInTheDocument();
    // the back link and the empty state's own action both go to the crews screen
    for (const link of screen.getAllByRole("link", { name: en.supervisor.plan.empty.primary })) expect(link).toHaveAttribute("href", "/en/supervisor");
    expect(await screen.findByRole("button", { name: /^Stop work/ })).toBeEnabled();
  });

  it("a crew that does not exist is a calm not-found with a way back, and no crew to stop", async () => {
    renderPlan("crew-zzz");

    expect(await screen.findByText(en.supervisor.plan.notFound.title)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: en.supervisor.plan.notFound.primary }).length).toBeGreaterThan(0);
    expect(barText()).toBe(en.supervisor.stop.noCrews);
  });

  it("while the plan loads, the skeleton is shown and Stop work is already live", async () => {
    server.use(http.get(DAY_PLAN, () => new Promise<Response>(() => undefined)));
    renderPlan("crew-b");

    expect(document.querySelector('[aria-busy="true"] [data-skeleton]')).not.toBeNull();
    expect(await screen.findByRole("button", { name: /^Stop work/ })).toBeEnabled();
  });
});

describe("the plan screen: forecast, k and restrictions", () => {
  it("a stale forecast says 'No fresh forecast: protective plan', draws no heat colour, and shows the fallback plan", async () => {
    scenario("stale");
    renderPlan("crew-b");

    expect(await screen.findByText("No fresh forecast: protective plan")).toBeInTheDocument();
    await waitFor(() => {
      expect(rows().length).toBeGreaterThan(0);
    });
    // no heat on the strip, and no note about it
    const heat = [...document.querySelectorAll<HTMLElement>("[data-plan-heat] span")];
    expect(heat.length).toBeGreaterThan(0);
    expect(heat.every((cell) => cell.style.backgroundColor === "" && !cell.style.getPropertyValue("--heat-night"))).toBe(true);
    expect(screen.queryByText(en.supervisor.plan.strip.heatNote)).toBeNull();
    // the rule is the fallback's
    expect(textOf(document.querySelector("[data-block-rows]"))).toContain("Work");
  });

  it("a fresh forecast draws the heat of each hour on the strip, from the API's own numbers", async () => {
    renderPlan("crew-b");
    try {
      await waitFor(() => {
        expect(document.querySelectorAll<HTMLElement>("[data-plan-heat] span[style*='--heat-night']").length).toBeGreaterThan(0);
      });
    } catch (error) {
      // The strip waits for the site, the crews and the forecast; say which of them did not arrive and why. The site request is asked
      // again outside the query (which turns every exception into "Network error") so that what it throws is on record.
      let probe: string;
      try {
        const result = await apiClient.GET("/api/v1/sites");
        probe = `GET /api/v1/sites answers now: HTTP ${String(result.response.status)}`;
      } catch (thrown) {
        probe =
          thrown instanceof Error
            ? `GET /api/v1/sites throws now: ${thrown.name}: ${thrown.message} (cause: ${String(thrown.cause)})\n${thrown.stack ?? ""}`
            : `GET /api/v1/sites throws now: ${String(thrown)}`;
      }
      const globals = `Request is the setup proxy: ${String(types.isProxy(Request))}; location ${location.href}`;
      throw new Error(`${String(error)}\nqueries: ${describeQueries()}\n${probe}\n${globals}`, { cause: error });
    }
    expect(screen.getByText(en.supervisor.plan.strip.heatNote)).toBeInTheDocument();
  });

  it("test_suppressed_crew_shows_level_and_k_and_nothing_about_restrictions (Crew D is below k)", async () => {
    renderPlan("crew-d");

    await pageSays(/Crew D is /);
    const subtitle = await waitFor(() => {
      const node = document.querySelector("[data-crew-subtitle]");
      expect(node?.textContent).toContain("fewer than 5 people, health detail hidden");
      return node as HTMLElement;
    });
    expect(subtitle.textContent).not.toMatch(/\b4 people\b|restrict/i);
    expect(document.body.textContent).not.toMatch(/restrict/i);
  });

  it("an every-crew-suppressed site hides restrictions for Crew A too (the headcount would single members out)", async () => {
    scenario("suppressed");
    renderPlan("crew-a");

    await waitFor(() => {
      expect(document.querySelector("[data-crew-subtitle]")?.textContent).toContain("fewer than 5 people, health detail hidden");
    });
    expect(document.body.textContent).not.toMatch(/restrict/i);
  });

  it("a crew with declared restrictions says 'restrictions declared for N members' and never that anyone is protected", async () => {
    renderPlan("crew-a");

    await waitFor(() => {
      expect(document.querySelector("[data-crew-subtitle]")?.textContent).toContain("restrictions declared for 2 members");
    });
    expect(document.body.textContent).not.toMatch(/protected/i);
  });

  it("server truth: a Red stop run the server still serves after the crew list says nothing is stopped is shown, not hidden", async () => {
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    if (plan === undefined) throw new Error("no plan");
    const stopped = plan.segments.map((segment) =>
      segment.state === "work" && segment.zone === "high" ? { ...segment, state: "stopped" as const, zone: "red" as const, rule_id: "STOP.red", clause: "" } : segment,
    );
    server.use(http.get(DAY_PLAN, () => HttpResponse.json({ ...plan, segments: stopped })));
    renderPlan("crew-b");

    await waitFor(() => {
      expect(rows().some((row) => row.getAttribute("data-block") === "stopped")).toBe(true);
    });
    expect(textOf(document.querySelector("[data-block-rows]"))).toContain("Stop work");
    expect(await screen.findByRole("button", { name: "Stop work, Crew B" })).toBeEnabled();
  });
});

describe("the plan screen: the request budget", () => {
  it("fetches the day plan once for a page load (the BFF's general budget), and again only after something changed it", async () => {
    let planGets = 0;
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET" && /\/day-plan(\?|$)/.test(new URL(request.url).pathname + new URL(request.url).search)) planGets += 1;
    });
    const user = userEvent.setup();
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(planGets).toBe(1);

    // Something changed the plan (a stop raises the crew's hours): the mutation invalidates it, and that is exactly one more read.
    await user.click(await screen.findByRole("button", { name: "Stop work, Crew B" }));
    await waitFor(() => {
      expect(planGets).toBe(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(planGets).toBe(2);
  });
});

describe("the plan screen: a plan that starts failing after it loaded (W5 I3)", () => {
  const PLAN_INVALID = () => json(500, problemBody({ type: "urn:stellar-blaze:problem:plan-invalid", status: 500 }));
  const NOT_LEGAL = () =>
    json(
      422,
      problemBody({
        type: "urn:stellar-blaze:problem:shift-not-legal",
        status: 422,
        violations: [{ rule_id: "P-H1.midday-break", clause: "", source_id: "ae-heat-2026.1" }],
      }),
    );

  /** Loads the plan fine, then makes the NEXT plan read fail the given way and forces that read with a Stop (which refreshes the plan). */
  async function loadThenFail(failure: () => Response): Promise<void> {
    const user = userEvent.setup();
    renderPlan("crew-b");
    await screen.findByRole("button", { name: "Sign off" });
    expect(rows().length).toBeGreaterThan(0);

    server.use(http.get(DAY_PLAN, failure));
    await user.click(await screen.findByRole("button", { name: "Stop work, Crew B" }));
    await pageSays("Stop recorded");
  }

  it("test_plan_that_fails_its_validator_after_loading_is_removed: plan-invalid on the refetch shows no blocks and no form, and Stop is still there", async () => {
    await loadThenFail(PLAN_INVALID);

    expect(await screen.findByText("This plan failed the rule check and is not shown.")).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("[data-plan-bars]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(within(stopBar()).getByRole("button", { name: /Undo/ })).toBeInTheDocument();
  });

  it("test_plan_that_becomes_not_legal_after_loading_is_removed: shift-not-legal on the refetch lists the violations, no blocks, no form", async () => {
    await loadThenFail(NOT_LEGAL);

    const title = await screen.findByText("This shift is not legal as planned");
    expect(title.closest("[data-shift-not-legal]")).toHaveAttribute("role", "status");
    expect(rows()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    expect(stopBar()).toBeInTheDocument();
  });

  it("a generic failure keeps the last plan under a 'could not be refreshed' notice, and offers no sign-off on it", async () => {
    await loadThenFail(() => json(503, problemBody({ type: "urn:stellar-blaze:problem:unavailable", status: 503 })));

    await pageSays("This plan could not be refreshed");
    // The last plan stays readable, but sign-off is never offered on a plan whose latest read failed.
    expect(rows().length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(stopBar()).toBeInTheDocument();
  });

  it("when the plan reads again, the form is back", async () => {
    const user = userEvent.setup();
    await loadThenFail(() => json(503, problemBody({ type: "urn:stellar-blaze:problem:unavailable", status: 503 })));
    await pageSays("This plan could not be refreshed");

    server.resetHandlers();
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Sign off" })).toBeInTheDocument();
    expect(textOf(document.body)).not.toContain("could not be refreshed");
  });
});

describe("the plan screen: clause text from the real ruleset carries no ADR jargon (W5)", () => {
  const REAL_P_H3 =
    'Art. 18: "The worker may not work for more than (5) five consecutive hours without a break or breaks of not less than an hour in total, provided that these periods are not included in the working hours." PROTECTIVE READING (ADR 0011 P-H3): ban time and ADOSH cycle rest are not credited as the break';

  it("a block row shows its clause without the ADR reference, and the law's own words as sent", async () => {
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    if (plan === undefined) throw new Error("no plan");
    server.use(
      http.get(DAY_PLAN, () =>
        HttpResponse.json({
          ...plan,
          segments: plan.segments.map((segment) => (segment.state === "work" ? { ...segment, rule_id: "P-H3", clause: REAL_P_H3 } : segment)),
        }),
      ),
    );
    const user = userEvent.setup();
    renderPlan("crew-b");
    await waitFor(() => {
      expect(rows().length).toBeGreaterThan(0);
    });
    const work = rows().find((row) => row.getAttribute("data-block") === "work");
    if (work === undefined) throw new Error("no work row");
    await user.click(within(work).getByRole("button"));

    const clause = textOf(work);
    expect(clause).not.toMatch(/ADR\s*\d/);
    expect(clause).not.toContain("PROTECTIVE READING");
    expect(clause).toContain("The worker may not work for more than (5) five consecutive hours without a break or breaks of not less than an hour in total");
    expect(clause).toContain("Protective reading: ban time and ADOSH cycle rest are not credited as the break");
    // The rule id is still shown beside it, as an identifier.
    expect(within(work).getByText("P-H3")).toBeInTheDocument();
  });

  it("a shift-not-legal row shows its clause without the ADR reference", async () => {
    server.use(
      http.get(DAY_PLAN, () =>
        json(422, {
          type: "urn:stellar-blaze:problem:shift-not-legal",
          title: "Shift not legal",
          status: 422,
          request_id: "req-nl",
          violations: [{ rule_id: "P-H3", clause: REAL_P_H3, source_id: "fdl-33-2021" }],
        }),
      ),
    );
    renderPlan("crew-b");

    const title = await screen.findByText("This shift is not legal as planned");
    const section = title.closest("[data-shift-not-legal]") as HTMLElement;
    expect(textOf(section)).not.toMatch(/ADR\s*\d/);
    expect(textOf(section)).toContain("Protective reading: ban time and ADOSH cycle rest are not credited as the break");
  });
});
