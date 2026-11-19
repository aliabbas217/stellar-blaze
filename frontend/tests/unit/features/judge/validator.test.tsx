import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { StrictMode, type ReactNode } from "react";
import { REPLAY_DATE } from "@/features/demo/constants";
import { banStateFor, SEASON_BAN } from "@/features/judge/ban";
import { TryGate } from "@/features/judge/validator/TryGate";
import { TryStatic } from "@/features/judge/validator/TryStatic";
import { filledEntries, filledRuns, normalizeTime, parseTime, rowOfLine, runProblem, runsToSegments, segmentsToRuns, templateOf, templateRuns, TEMPLATES } from "@/features/judge/validator/runs";
import { forecastToday } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * Try a plan (F2 Task 14). What is pinned here: the plan a visitor picks becomes the request the contract takes, the verdict is
 * the API's answer drawn as it came (rule ids in mono, clause text only when the API sent some, "0 rules broken" with what was
 * checked), the submit is never pre-disabled, a failure keeps the times and offers the recorded result under RECORDED, a
 * roster the validator cannot read is told per line, and the page never sends by itself.
 */

// every test here waits for the lazy island once, so the file's own ceiling sits above that wait
vi.setConfig({ testTimeout: 20_000 });
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/en/replay/try",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/replay/try",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/en${href}`} {...props}>
      {children}
    </a>
  ),
}));

const { parseRecordedPlan } = await import("@/features/judge/validator/recorded-plan");

const root = path.resolve(import.meta.dirname, "../../../..");
const recorded = parseRecordedPlan(JSON.parse(readFileSync(path.join(root, "data/recorded/validator-b0.json"), "utf8")) as unknown);
const CHECK = "Check this plan";
const heat = Array.from({ length: 24 }, () => "oklch(0.4 0.1 300)");
const ban = banStateFor(SEASON_BAN, REPLAY_DATE, "en");

function renderTry(run: typeof recorded | null = recorded) {
  return renderWithIntl(
    <TryGate date={REPLAY_DATE} heat={heat} ban={ban} dateLabel="Thu 3 Sep" recorded={run}>
      <TryStatic heat={heat} ban={ban} dateLabel="Thu 3 Sep" recorded={run} />
    </TryGate>,
  );
}

/**
 * Brings the lazy island in the way a visitor does (a click on a control: focusing or typing in a field never swaps the page, see
 * useIslandGate), waits until it has taken over (the demo site name is its first visible sign), then clicks the field.
 */
async function warmed(user: ReturnType<typeof userEvent.setup>, label: string): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: /^Common roster/ }));
  // the island is a lazy chunk: on a loaded CPU (a parallel full suite) its import can take longer than the 1 s default
  await screen.findByText("Mussafah M-14 yard (synthetic)", undefined, { timeout: 10_000 });
  const field = screen.getByLabelText(label);
  await user.click(field);
  return field;
}

const problem = (status: number, extra: Record<string, unknown> = {}) =>
  new HttpResponse(JSON.stringify({ type: "urn:stellar-blaze:problem:test", title: "Test", status, ...extra }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

/** The validator endpoint as the BFF would reach it, counting calls and keeping the bodies. */
function counting(calls: { bodies: unknown[] }) {
  server.use(
    http.post("*/api/v1/plans/validate", async ({ request }) => {
      calls.bodies.push(await request.clone().json());
      return undefined;
    }),
  );
}

describe("runs: the plan becomes the request", () => {
  it("test_runs_to_segments_rounds_trip: every template becomes work segments and comes back as the same runs", () => {
    for (const template of TEMPLATES) {
      const segments = runsToSegments(template.runs);
      expect(segments.every((segment) => segment.state === "work")).toBe(true);
      expect(segmentsToRuns(segments)).toEqual(template.runs);
      expect(templateOf(templateRuns(template.id))).toBe(template.id);
    }
    expect(runsToSegments([{ start: "6:05", end: "0930" }])).toEqual([{ start: "06:05", end: "09:30", state: "work" }]);
  });

  it("reads clock times on the 5 minute grid, paste-friendly, and says why a time does not read", () => {
    expect(parseTime(" 06 : 00 ")).toEqual({ minutes: 360 });
    expect(normalizeTime("1830")).toBe("18:30");
    expect(parseTime("06:07")).toEqual({ problem: "grid" });
    expect(parseTime("24:00")).toEqual({ problem: "format" });
    expect(parseTime("six")).toEqual({ problem: "format" });
    expect(runProblem({ start: "06:00", end: "06:00" })).toEqual({ field: "order", problem: "order" });
    expect(runProblem({ start: "06:00", end: "x" })).toEqual({ field: "end", problem: "format" });
    expect(runProblem({ start: "06:00", end: "12:30" })).toBeNull();
    expect(filledRuns([{ start: "", end: " " }, { start: "06:00", end: "" }])).toHaveLength(1);
    expect(() => runsToSegments([{ start: "09:00", end: "08:00" }])).toThrow(RangeError);
  });

  it("the three templates are the roster analysis baselines and the common roster is the recorded one", () => {
    const frontier = JSON.parse(readFileSync(path.join(root, "data/static/roster_frontier.json"), "utf8")) as { baselines: Record<string, string> };
    const text = (id: "common" | "legal"): string => (TEMPLATES.find((template) => template.id === id)?.runs ?? []).map((run) => `${run.start}-${run.end}`).join(" + ");
    expect(text("common")).toBe(frontier.baselines.B0_common_practice_non_compliant);
    expect(text("legal")).toBe(frontier.baselines.B1_legal_default);
    expect(recorded.runs).toEqual(TEMPLATES[0]?.runs);
    // the recording script sends the same plan on the same day
    const script = readFileSync(path.join(root, "scripts/record-validator-run.mjs"), "utf8");
    expect(script).toContain(`const DATE = "${REPLAY_DATE}"`);
    for (const run of TEMPLATES[0]?.runs ?? []) expect(script).toContain(`start: "${run.start}", end: "${run.end}"`);
  });
});

describe("runs: blank rows and the API's lines (Part G3 I4)", () => {
  it("test_roster_invalid_line_maps_to_the_row: Run 1 blank, Runs 2 and 3 filled: the API's line 2 is Run 3", () => {
    const runs = [
      { start: "", end: "" },
      { start: "06:00", end: "10:00" },
      { start: "15:00", end: "17:00" },
    ];
    const rows = filledEntries(runs).map((entry) => entry.row);
    expect(rows).toEqual([1, 2]);
    expect(rowOfLine(1, rows)).toBe(2);
    expect(rowOfLine(2, rows)).toBe(3);
    // an error about the whole roster (line 0) or past the segments is never put on a wrong row
    expect(rowOfLine(0, rows)).toBe(0);
    expect(rowOfLine(9, rows)).toBe(9);
    // no blank row: the lines are the rows
    expect(rowOfLine(2, filledEntries(templateRuns("common")).map((entry) => entry.row))).toBe(2);
  });
});

describe("TryPlanView: editable runs", () => {
  it("times are plain 16 px text inputs with a numeric keypad, never type=time, and paste is allowed", async () => {
    const { container } = renderTry();
    const inputs = [...container.querySelectorAll<HTMLInputElement>("[data-run] input")];
    expect(inputs).toHaveLength(6);
    for (const input of inputs) {
      expect(input.type).toBe("text");
      expect(input.getAttribute("inputmode")).toBe("numeric");
      expect(input.className).toContain("text-base");
      expect(input.placeholder).toBe("hh:mm");
    }
    expect(container.querySelector("input[type=time]")).toBeNull();
    const user = userEvent.setup();
    const third = screen.getByLabelText("Run 3: Start");
    await user.click(third);
    await user.paste("0905");
    await waitFor(() => {
      expect(screen.getByLabelText("Run 3: Start")).toHaveValue("0905");
    });
  });

  it("checks a time when its field loses focus: a time that reads is tidied to hh:mm, one that does not is said", async () => {
    renderTry();
    const user = userEvent.setup();
    await warmed(user, "Run 3: Start");
    await user.paste("0905");
    await user.tab();
    await waitFor(() => {
      expect(screen.getByLabelText("Run 3: Start")).toHaveValue("09:05");
    });
    // a half-written row is not judged yet (the end is still empty)
    expect(document.querySelector("[data-run-problem]")).toBeNull();
    await user.type(screen.getByLabelText("Run 3: End"), "09:07");
    await user.tab();
    expect(await screen.findByText("Use a multiple of 5 minutes, for example 06:05.")).toBeInTheDocument();
    expect(screen.getByLabelText("Run 3: End")).toHaveAttribute("aria-invalid", "true");
  });

  it("a plan that does not read is said under the button and sends nothing; edited times become the request as work segments", async () => {
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    const { container } = renderTry();
    const user = userEvent.setup();
    await warmed(user, "Run 3: Start");
    await user.paste("09:05");
    await user.click(screen.getByRole("button", { name: CHECK }));
    expect(await screen.findByText("Run 3: Write the time as hh:mm, for example 06:00.")).toBeInTheDocument();
    expect(calls.bodies).toHaveLength(0);
    // the visitor now has their own times: no template is pressed, and the plan strip draws only what reads
    expect(screen.getByText("Your own times")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Run 3: End"));
    await user.paste("0930");
    await user.click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(calls.bodies).toHaveLength(1);
    });
    expect(calls.bodies[0]).toMatchObject({
      segments: [
        { start: "06:00", end: "12:30", state: "work" },
        { start: "15:00", end: "17:00", state: "work" },
        { start: "09:05", end: "09:30", state: "work" },
      ],
    });
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toMatch(/answer|none/);
    });
  });
});

describe("TryGate: the lazy island", () => {
  it("first paint is the common roster on the day's heat with plain controls, and calls no API", async () => {
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    let gets = 0;
    server.use(
      http.get("*/api/v1/*", () => {
        gets += 1;
        return undefined;
      }),
    );
    const { container } = renderTry();
    expect(screen.getByRole("button", { name: CHECK })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Common roster/ })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("idle");
    expect(container.querySelectorAll("[data-plan-bar]")).toHaveLength(2);
    // three editable rows: the template fills two, the third is blank
    expect([...container.querySelectorAll<HTMLInputElement>("[data-run] input")].map((input) => input.value)).toEqual(["06:00", "12:30", "15:00", "17:00", "", ""]);
    expect(container.querySelector("[data-slot=in-force]")).not.toBeNull();
    // the assumptions are shown, editable, with the protective defaults
    expect(screen.getByLabelText(/Crew is heat-acclimatised/)).not.toBeChecked();
    expect(screen.getByLabelText("Working days per week")).toHaveValue("6");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls.bodies).toHaveLength(0);
    expect(gets).toBe(0);
  });

  it("test_b0_template_reports_p_h3_and_p_h2_daily_with_clauses: the first click loads the island and sends the one request", async () => {
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    const { container } = renderTry();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("answer");
    });
    expect(calls.bodies).toHaveLength(1);
    // the request: the replay site and day, the heavy crew of 20, the two assumptions as shown, the common roster as work segments
    expect(calls.bodies[0]).toEqual({
      site_id: "site-demo-mussafah",
      date: REPLAY_DATE,
      crew: { workload: "heavy", headcount: 20, acclimatised: false, days_per_week: 6 },
      segments: [
        { start: "06:00", end: "12:30", state: "work" },
        { start: "15:00", end: "17:00", state: "work" },
      ],
    });
    const list = container.querySelector("[data-violations]") as HTMLElement;
    const rule = (id: string) => [...list.querySelectorAll("li")].find((li) => li.textContent.includes(id)) as HTMLElement;
    // Art. 18 carries its clause text; the daily-hours rule carries none, and none is invented
    expect(within(rule("P-H3")).getByText(/Labour Art\. 18/)).toBeInTheDocument();
    expect(rule("P-H3").querySelector("[data-clause]")).not.toBeNull();
    expect(rule("P-H2.daily")).toBeDefined();
    expect(rule("P-H2.daily").querySelector("[data-clause]")).toBeNull();
    expect(screen.getByText("2 rules broken")).toBeInTheDocument();
    // numbered marks on the plan strip match the list
    expect([...container.querySelectorAll("[data-violation-mark]")].map((el) => el.getAttribute("data-violation-mark"))).toEqual(["1", "2", "2"]);
    // what was checked comes from the API's own list
    expect(container.querySelector("[data-checked]")?.textContent).toContain("P-H7.cap60");
  });

  it("the legal default answers '0 rules broken' with what was checked (the empty state)", async () => {
    const { container } = renderTry();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Legal default/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Legal default/ })).toHaveAttribute("aria-pressed", "true");
    });
    await user.click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("none");
    });
    expect(screen.getByText("0 rules broken")).toBeInTheDocument();
    expect(container.querySelector("[data-violations]")).toBeNull();
    expect(container.querySelectorAll("[data-checked] code").length).toBeGreaterThan(0);
  });

  it("test_submit_never_pre_disabled: the check button is never disabled, not before the site is known, not while it runs", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post("*/api/v1/plans/validate", async () => {
        await held;
        return problem(500);
      }),
    );
    const { container } = renderTry();
    expect(screen.getByRole("button", { name: CHECK })).not.toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("loading");
    });
    const busy = screen.getByRole("button", { name: CHECK });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    release();
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("error");
    });
  });

  it("test_error_keeps_times_and_offers_recorded_result: the times stay, the request id shows, and the recorded result is stamped RECORDED", async () => {
    server.use(http.post("*/api/v1/plans/validate", () => problem(502, { type: "urn:stellar-blaze:problem:upstream-unavailable", title: "Upstream unavailable", request_id: "req-e02b61d9" })));
    const { container } = renderTry();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Legal default/ }));
    await user.click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("error");
    });
    expect(screen.getByText("The rule checker did not answer.")).toBeInTheDocument();
    expect(screen.getByText("req-e02b61d9")).toBeInTheDocument();
    // the times the visitor chose are still there
    expect([...container.querySelectorAll<HTMLInputElement>("[data-run] input")].map((input) => input.value)).toEqual(["06:00", "11:00", "15:00", "18:00", "", ""]);
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeDisabled();
    // the recorded result: stamped, said to be the common roster, never a check of these times
    await user.click(screen.getByRole("button", { name: "Show a recorded result" }));
    const block = container.querySelector("[data-recorded]") as HTMLElement;
    expect(within(block).getByText("Recorded")).toBeInTheDocument();
    expect(block.textContent).toContain("not a check of your times");
    expect(block.textContent).toContain("P-H3");
    expect(block.querySelector("[data-violations]")).not.toBeNull();
  });

  it("a roster the validator cannot read is told per line from the 422, never as a result", async () => {
    server.use(
      http.post("*/api/v1/plans/validate", () =>
        problem(422, { type: "urn:stellar-blaze:problem:roster-invalid", title: "Roster invalid", errors: [{ line: 2, message: "end 25:00 is not a time" }] }),
      ),
    );
    const { container } = renderTry();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("invalid");
    });
    expect(container.querySelector("[data-invalid-line='2']")?.textContent).toBe("Run 2: end 25:00 is not a time");
    expect(container.querySelector("[data-answer]")).toBeNull();
  });

  it("test_roster_invalid_labels_the_row_the_visitor_typed: with Run 1 blank the API line 2 reads Run 3", async () => {
    server.use(
      http.post("*/api/v1/plans/validate", () =>
        problem(422, { type: "urn:stellar-blaze:problem:roster-invalid", title: "Roster invalid", errors: [{ line: 2, message: "end 25:00 is not a time" }] }),
      ),
    );
    const { container } = renderTry();
    const user = userEvent.setup();
    await warmed(user, "Run 1: Start");
    await user.clear(screen.getByLabelText("Run 1: Start"));
    await user.clear(screen.getByLabelText("Run 1: End"));
    await user.clear(screen.getByLabelText("Run 2: Start"));
    await user.type(screen.getByLabelText("Run 2: Start"), "06:00");
    await user.clear(screen.getByLabelText("Run 2: End"));
    await user.type(screen.getByLabelText("Run 2: End"), "10:00");
    await user.type(screen.getByLabelText("Run 3: Start"), "15:00");
    await user.type(screen.getByLabelText("Run 3: End"), "17:00");
    await user.click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("invalid");
    });
    expect(container.querySelector("[data-invalid-line='3']")?.textContent).toBe("Run 3: end 25:00 is not a time");
    expect(container.querySelector("[data-invalid-line='2']")).toBeNull();
  });

  it("a half-written row is named by its ROW, not by its place among the filled rows", async () => {
    const { container } = renderTry();
    const user = userEvent.setup();
    await warmed(user, "Run 1: Start");
    for (const label of ["Run 1: Start", "Run 1: End", "Run 2: Start", "Run 2: End"]) await user.clear(screen.getByLabelText(label));
    await user.type(screen.getByLabelText("Run 3: Start"), "09:00");
    await user.click(screen.getByRole("button", { name: CHECK }));
    expect(await screen.findByText("Run 3: Write the time as hh:mm, for example 06:00.")).toBeInTheDocument();
    expect(container.querySelector("[data-notice]")?.getAttribute("data-notice")).toBe("run");
  });

  it("test_try_uses_the_api_day_and_mode: the request carries the day the forecast reports and the page says which day it is", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", ({ params }) => HttpResponse.json({ ...forecastToday(String(params.site_id), { date: "2026-06-14" }), mode: "live" })),
    );
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    const { container } = renderTry();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(calls.bodies).toHaveLength(1);
    });
    // neither the demo feature constant nor the day the server rendered
    expect(calls.bodies[0]).toMatchObject({ date: "2026-06-14", site_id: "site-demo-mussafah" });
    expect(REPLAY_DATE).not.toBe("2026-06-14");
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toMatch(/answer|none/);
    });
    // the page draws the API's day: its label, today (live mode), the break not in force before 15 June, and no recorded heat for another day
    expect(container.textContent).toContain("Checked on Sun 14 Jun, today at the site");
    expect(container.querySelector("[data-slot=in-force]")).toBeNull();
    expect(container.textContent).not.toContain("the demo day");
  });

  it("when the day the API reports is the day the server drew, nothing is re-drawn and the replay sentence stays", async () => {
    const { container } = renderTry();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("answer");
    });
    expect(container.textContent).toContain("Checked on Thu 3 Sep, the demo day (a recorded day, replayed)");
    expect(container.querySelector("[data-slot=in-force]")).not.toBeNull();
  });

  it("a forecast that fails is said, never a silent wait, and nothing is sent", async () => {
    server.use(http.get("*/api/v1/sites/:site_id/forecast/today", () => problem(500)));
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    renderTry();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    // the query retries once (about a second) before it gives up: the check waits, shown as checking, then says so
    expect(await screen.findByText("The day to check could not be read from the site's forecast. Try again in a moment.", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(calls.bodies).toHaveLength(0);
  });

  it("test_enter_in_a_time_field_runs_the_check: a real form, Enter reads the row, one request when it reads", async () => {
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    const { container } = renderTry();
    expect(container.querySelector("form")).not.toBeNull();
    const user = userEvent.setup();
    await warmed(user, "Run 3: Start");
    await user.type(screen.getByLabelText("Run 3: Start"), "09:00{Enter}");
    // a half-written row: said, nothing sent (Enter ran the check, which read the row)
    expect(await screen.findByText("Run 3: Write the time as hh:mm, for example 06:00.")).toBeInTheDocument();
    expect(calls.bodies).toHaveLength(0);
    await user.type(screen.getByLabelText("Run 3: End"), "09:30{Enter}");
    await waitFor(() => {
      expect(calls.bodies).toHaveLength(1);
    });
  });

  it("a submit BEFORE the island loads is carried over: the typed times are checked once and the page never navigates", async () => {
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    renderTry();
    const field = screen.getByLabelText("Run 3: Start");
    fireEvent.change(field, { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("Run 3: End"), { target: { value: "09:30" } });
    // fireEvent returns false when the submit was cancelled (no navigation)
    expect(fireEvent.submit(field.closest("form") as HTMLFormElement)).toBe(false);
    await waitFor(() => {
      expect(calls.bodies).toHaveLength(1);
    });
    expect(calls.bodies[0]).toMatchObject({ segments: expect.arrayContaining([{ start: "09:00", end: "09:30", state: "work" }]) as unknown });
  });

  it("test_queued_check_runs_once_in_strict_mode: effects that run twice still send one request", async () => {
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    renderWithIntl(
      <StrictMode>
        <TryGate date={REPLAY_DATE} heat={heat} ban={ban} dateLabel="Thu 3 Sep" recorded={recorded}>
          <TryStatic heat={heat} ban={ban} dateLabel="Thu 3 Sep" recorded={recorded} />
        </TryGate>
      </StrictMode>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(calls.bodies).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls.bodies).toHaveLength(1);
  });

  it("an assumption typed before the island loads survives the swap and is what the request carries", async () => {
    const calls = { bodies: [] as unknown[] };
    counting(calls);
    renderTry();
    const days = screen.getByLabelText("Working days per week");
    const user = userEvent.setup();
    await user.clear(days);
    await user.type(days, "5");
    await user.click(screen.getByLabelText(/Crew is heat-acclimatised/));
    await user.click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(calls.bodies).toHaveLength(1);
    });
    expect(calls.bodies[0]).toMatchObject({ crew: { acclimatised: true, days_per_week: 5 } });
  });

  it("a stale or fallback forecast says 'No fresh forecast: protective plan'", async () => {
    server.use(
      http.post("*/api/v1/plans/validate", () =>
        HttpResponse.json({
          banner_code: "plan.floor_banner",
          validator: { passed: true, violations: [], checked_rules: ["P-H1"] },
          zone_hours: [],
          forecast_status: "fallback",
          ban_window: {},
          policy_version: "p",
          config_version: 1,
          model_id: null,
        }),
      ),
    );
    const { container } = renderTry();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-notice=not-fresh]")).not.toBeNull();
    });
    expect(screen.getByText("No fresh forecast: protective plan")).toBeInTheDocument();
  });

  it("prints no export key, ADR wording or dash, and never claims what it did not check", async () => {
    const { container } = renderTry();
    await userEvent.setup().click(screen.getByRole("button", { name: CHECK }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")?.getAttribute("data-try")).toBe("answer");
    });
    const text = container.querySelector("main")?.textContent ?? "";
    expect(text).not.toMatch(/B0_common|—|–|ADR \d|HANDOFF|\bB[123]\b|compliant|illness prevented/);
    expect(text).toContain("independent");
    expect(text).toContain("shares no code with the planner that builds our plans");
  });
});
