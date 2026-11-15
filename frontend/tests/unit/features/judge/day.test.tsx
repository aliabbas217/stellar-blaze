import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { components } from "@/api/schema";
import { SEASON_BAN, banStateFor } from "@/features/judge/ban";
import type { EvalData } from "@/features/judge/data";
import { localHourOf } from "@/features/judge/day-view";
import { DayView, type DayViewProps } from "@/features/judge/DayView";
import { parseHourlySeries } from "@/features/judge/facts";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The day zoom (F2 Task 9): the chart draws only the series that exist, the four counters carry a proof or are `###` under one
 * banner (never a value without provenance), the table is the keyboard alternative, and the day is whatever the scoring
 * run's file says.
 */

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/replay/day",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

type DemoDay = components["schemas"]["DemoDay"];
const root = path.resolve(import.meta.dirname, "../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;

const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;
const hourly: DayViewProps["hourly"] = {
  series: parseHourlySeries(json(`data/${HOURLY}`)),
  file: { path: HOURLY, sha256: DATA_MANIFEST[HOURLY].sha256 },
  source: DATA_MANIFEST[HOURLY].source,
};
const syntheticDay = json("tests/fixtures/eval/demo_day.synthetic.json") as DemoDay;
const dayFile = { path: "tests/fixtures/eval/demo_day.synthetic.json", sha256: "e".repeat(64) };

const none: EvalData = {
  policy: null,
  plans: null,
  day: null,
  frontier: null,
  source: "none",
  files: { policy: null, plans: null, day: null, frontier: null },
};
const scored = (day: DemoDay = syntheticDay): EvalData => ({ ...none, day, source: "synthetic-shape", files: { ...none.files, day: dayFile } });

function view(data: EvalData | null, extra: Partial<DayViewProps> = {}) {
  return renderWithIntl(<DayView data={data} hourly={hourly} {...extra} />);
}

describe("DayView: the series that exist", () => {
  it("test_day_chart_series_absent_until_scored: before the scoring run only the raw forecast is drawn, with a note and ### counters", () => {
    const { container } = view(none);
    expect(container.querySelector("[data-series=raw]")).not.toBeNull();
    expect(container.querySelector("[data-series=ours]")).toBeNull();
    expect(container.querySelector("[data-series=truth]")).toBeNull();
    expect(container.querySelector("[data-day-shown=pending]")).not.toBeNull();
    expect(screen.getByText("Ours (5 to 95 % range) and station truth: added by the scoring run")).toBeInTheDocument();
    // legend: no empty entries for series that do not exist
    expect(container.querySelectorAll("[data-legend] li")).toHaveLength(1);
    // four ### counters under ONE banner, no number and no proof chip among them
    const counters = container.querySelector("[data-day-counters]") as HTMLElement;
    expect(counters.querySelectorAll("[data-counter-pending]")).toHaveLength(4);
    expect(counters.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(counters.querySelectorAll("[data-proof-id]")).toHaveLength(0);
    expect(within(counters).getAllByLabelText("not scored yet")).toHaveLength(4);
  });

  it("draws all three series once a scored day exists, on the day the file says", () => {
    const { container } = view(scored());
    for (const series of ["raw", "ours", "truth"]) expect(container.querySelector(`[data-series=${series}]`), series).not.toBeNull();
    expect(container.querySelector("[data-day-shown=scored]")?.textContent).toContain("6 Jul");
    expect(container.querySelectorAll("[data-legend] li")).toHaveLength(3);
  });

  it("a dev file is never read as the result: the DEV 2025 stamp sits on the page", () => {
    view(scored());
    expect(screen.getAllByText(/DEV 2025/).length).toBeGreaterThan(0);
  });

  it("without a day file the page draws the replay day of the recorded season, and the break is in force on it", () => {
    const { container } = view(none);
    expect(container.querySelector("[data-day-shown]")?.textContent).toContain("3 Sep");
    expect(container.querySelector("[data-slot=in-force]")).not.toBeNull();
  });
});

describe("DayView: counters have a proof or are not shown", () => {
  it("test_counters_have_proofs_or_hashes: each of the four counters carries its proof chip", () => {
    const { container } = view(scored());
    const ids = [...container.querySelectorAll("[data-counter-id]")].map((el) => el.getAttribute("data-counter-id"));
    expect(ids).toEqual(["high", "outside", "raw", "ours"]);
    for (const el of container.querySelectorAll("[data-counter-id]")) expect(el.querySelector("[data-proof-id]"), el.getAttribute("data-counter-id") ?? "").not.toBeNull();
    // the values are the file's own
    const text = container.querySelector("[data-day-counters]")?.textContent ?? "";
    expect(text).toContain(syntheticDay.high_hours.toFixed(1));
    expect(text).toContain(syntheticDay.p3_hits.toFixed(1));
  });

  it("a file whose provenance is incomplete shows no value at all (MissingProvenance), never the number", () => {
    const broken = { ...syntheticDay, provenance: { ...syntheticDay.provenance, git_sha: "" } };
    const { container } = view(scored(broken));
    const counters = container.querySelector("[data-day-counters]") as HTMLElement;
    expect(counters.textContent).not.toContain(syntheticDay.high_hours.toFixed(1));
    expect(counters.querySelectorAll("[data-proof-id]")).toHaveLength(0);
  });

  it("an unreadable day file is a plain message with a way to try again, and no counters", () => {
    const { container } = view(null, { failed: true });
    expect(screen.getByText("The day file could not be read")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/replay/day");
    expect(container.querySelectorAll("[data-counter-id], [data-counter-pending]")).toHaveLength(0);
    expect(container.querySelector("[data-series=raw]")).not.toBeNull();
  });
});

describe("DayView: structure and wording", () => {
  it("has one primary action, the day rule drawer button, and a hero", () => {
    const { container } = view(none);
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Read the day rule" })).toHaveAttribute("data-primary");
    expect(container.querySelectorAll("[data-hero]")).toHaveLength(1);
  });

  it("offers the hours as a table (a details, keyboard reachable) with one row per axis hour", () => {
    const { container } = view(scored());
    const details = container.querySelector("[data-day-table]") as HTMLElement;
    expect(within(details).getByText("Show the hours as a table").tagName).toBe("SUMMARY");
    expect(details.querySelectorAll("tbody tr")).toHaveLength(16);
    expect(details.querySelector("[role=region][tabindex='0']")).not.toBeNull();
  });

  it("says the midday break hour with the recorded clock time, and prints no export key, dash or ADR wording", () => {
    const { container } = view(none);
    const rows = [...container.querySelectorAll("[data-day-table] tbody tr")].map((tr) => tr.textContent);
    expect(rows.find((r) => r.startsWith("12:00"))).toContain(`from ${SEASON_BAN.start}`);
    expect(rows.find((r) => r.startsWith("13:00"))).toContain("yes");
    const text = container.textContent;
    expect(text).not.toMatch(/[a-z0-9]+_[a-z0-9_]+|—|–|ADR \d|HANDOFF|\bB[123]\b/);
  });
});

describe("the helpers", () => {
  it("places a UTC hour start on the site-local axis (Asia/Dubai is UTC+4)", () => {
    expect(localHourOf("2025-07-06T06:00:00Z")).toBe(10);
    expect(localHourOf("2025-07-06T20:00:00Z")).toBe(0);
    expect(() => localHourOf("nope")).toThrow(RangeError);
  });

  it("the break is in force inside the season and a dashed outline with the resume date outside it", () => {
    const inside = banStateFor(SEASON_BAN, "2026-09-03", "en");
    expect(inside).toMatchObject({ kind: "in-force", fromHour: 12.5, toHour: 15 });
    const outside = banStateFor(SEASON_BAN, "2026-11-20", "en");
    expect(outside).toMatchObject({ kind: "not-in-force", outline: { fromHour: 12.5, toHour: 15 } });
  });
});
