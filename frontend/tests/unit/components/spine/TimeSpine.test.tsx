import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within } from "@testing-library/react";
import { banStateFrom, type BanState, type BanWindowInput } from "@/components/spine/ban-state";
import { TimeSpine, type TimeSpineProps } from "@/components/spine/TimeSpine";
import { heatColor } from "@/lib/heat/ramp";
import { renderWithIntl } from "../../../utils/intl";

const TZ = "Asia/Dubai";
const IN_SEASON: BanWindowInput = {
  active_on_date: true,
  start: "12:30",
  end: "15:00",
  starts_at: "2026-09-03T08:30:00Z",
  ends_at: "2026-09-03T11:00:00Z",
  season_start: "06-15",
  season_end: "09-15",
  timezone: TZ,
};
const OUT_OF_SEASON: BanWindowInput = { ...IN_SEASON, active_on_date: false, starts_at: null, ends_at: null };

const IN_FORCE: BanState = banStateFrom(IN_SEASON, TZ, "2026-09-03");
const NOT_IN_FORCE: BanState = banStateFrom(OUT_OF_SEASON, TZ, "2026-11-14");

// 06:00 to 17:00: a specimen day from 28 to 39 degrees
const CELLS = Array.from({ length: 12 }, (_, i) => ({ hour: 6 + i, wbgtC: 28 + i }));

function props(overrides: Partial<TimeSpineProps> = {}): TimeSpineProps {
  return {
    orientation: "v",
    from: 6,
    to: 18,
    cells: CELLS,
    now: 11 + 10 / 60,
    ban: IN_FORCE,
    surface: "field",
    dir: "ltr",
    aria: "Shift 06:00 to 18:00",
    transitionName: null,
    ...overrides,
  };
}

function renderSpine(overrides: Partial<TimeSpineProps> = {}) {
  const view = renderWithIntl(<TimeSpine {...props(overrides)} />);
  const root = view.container.querySelector<HTMLElement>("[data-spine]");
  if (root === null) throw new Error("no [data-spine]");
  return { ...view, root };
}

/** `--t-16: 1rem` in tokens.css to pixels, the way the browser resolves it at a 16 px root. */
function tokenPx(token: string): number {
  const css = readFileSync(path.resolve(import.meta.dirname, "../../../../src/styles/tokens.css"), "utf8");
  const m = new RegExp(`${token}:\\s*([\\d.]+)(rem|px)`).exec(css);
  if (m?.[1] === undefined) throw new Error(`${token} not in tokens.css`);
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}
/** `var(--t-16)` to pixels. */
function varPx(value: string | undefined): number {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  if (m?.[1] === undefined) throw new Error(`not a var(): ${String(value)}`);
  return tokenPx(m[1]);
}
const hourAt = (units: number): number => 6 + (units * 12) / 100;

describe("TimeSpine: the qaylula slot", () => {
  // test_slot_edges_from_ban_window
  it("spans exactly 12:30 to 15:00 on a 6 to 18 vertical spine, from the window's instants", () => {
    const { root } = renderSpine();
    const slot = root.querySelector<SVGGElement>("[data-slot]");
    expect(slot).not.toBeNull();
    expect(slot?.dataset["from"]).toBe("12.5");
    expect(slot?.dataset["to"]).toBe("15");
    const rect = slot?.querySelector("rect");
    const y = Number(rect?.getAttribute("y"));
    const height = Number(rect?.getAttribute("height"));
    expect(hourAt(y)).toBeCloseTo(12.5, 2);
    expect(hourAt(y + height)).toBeCloseTo(15, 2);
  });

  it("is framed by two 1 px rules at its two edges and labelled 'Midday break' once", () => {
    const { root } = renderSpine();
    const rules = [...root.querySelectorAll<SVGLineElement>("[data-slot-rule]")];
    expect(rules).toHaveLength(2);
    expect(hourAt(Number(rules[0]?.getAttribute("y1")))).toBeCloseTo(12.5, 2);
    expect(hourAt(Number(rules[1]?.getAttribute("y1")))).toBeCloseTo(15, 2);
    for (const r of rules) {
      expect(r).toHaveAttribute("vector-effect", "non-scaling-stroke");
      expect(r.getAttribute("class")).toMatch(/stroke-edge/);
      expect(r.getAttribute("class")).toMatch(/stroke-1\b/);
    }
    expect(screen.getAllByText("Midday break")).toHaveLength(1);
    expect(screen.getByText("12:30")).toBeInTheDocument();
    expect(screen.getByText("15:00")).toBeInTheDocument();
  });

  it("is drawn in --slot, the only shape below the ground", () => {
    const { root } = renderSpine();
    expect(root.querySelector("[data-slot] rect")?.getAttribute("class")).toMatch(/fill-slot/);
  });

  it("moves with the window: a slot 13:00 to 15:30 sits at 13:00 to 15:30, not at a literal", () => {
    const shifted = banStateFrom(
      { ...IN_SEASON, starts_at: "2026-09-03T09:00:00Z", ends_at: "2026-09-03T11:30:00Z" },
      TZ,
      "2026-09-03",
    );
    const { root } = renderSpine({ ban: shifted });
    expect(root.querySelector<SVGGElement>("[data-slot]")?.dataset["from"]).toBe("13");
    expect(root.querySelector<SVGGElement>("[data-slot]")?.dataset["to"]).toBe("15.5");
  });

  it("is drawn horizontally on a 6 to 18 spine at the same fractions", () => {
    const { root } = renderSpine({ orientation: "h" });
    const rect = root.querySelector("[data-slot] rect");
    const x = Number(rect?.getAttribute("x"));
    const width = Number(rect?.getAttribute("width"));
    expect(hourAt(x)).toBeCloseTo(12.5, 2);
    expect(hourAt(x + width)).toBeCloseTo(15, 2);
  });

  // test_no_slot_out_of_season_field
  it("draws nothing at all where the break is not in force on a field surface", () => {
    const { root } = renderSpine({ ban: NOT_IN_FORCE, surface: "field" });
    expect(root.querySelector("[data-slot]")).toBeNull();
    expect(root.querySelector("[data-slot-outline]")).toBeNull();
    expect(root.querySelector("[data-slot-rule]")).toBeNull();
    expect(screen.queryByText(/Midday break/)).toBeNull();
    expect(root).toHaveAttribute("data-ban", "not-in-force");
  });

  // test_dashed_outline_out_of_season_desk
  it("draws a dashed, labelled outline (no slot) on a desk surface out of season", () => {
    const { root } = renderSpine({ ban: NOT_IN_FORCE, surface: "desk" });
    expect(root.querySelector("[data-slot]")).toBeNull();
    const outline = root.querySelector<SVGGElement>("[data-slot-outline]");
    expect(outline).not.toBeNull();
    expect(outline?.dataset["from"]).toBe("12.5");
    expect(outline?.dataset["to"]).toBe("15");
    const rect = outline?.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("none");
    expect(rect?.getAttribute("style")).toMatch(/stroke-dasharray/);
    expect(rect?.getAttribute("class")).not.toMatch(/fill-slot/);
    expect(screen.getByText(/Midday break by law: not in force until/)).toBeInTheDocument();
    expect(screen.getByText("15 Jun")).toBeInTheDocument();
    expect(screen.getAllByText(/Midday break/)).toHaveLength(1);
  });

  it("says 'not in force' without a date when the window gives none", () => {
    const state = banStateFrom({ ...OUT_OF_SEASON }, TZ, "2026-09-03");
    renderSpine({ ban: state, surface: "desk" });
    expect(screen.getByText("Midday break by law: not in force")).toBeInTheDocument();
  });

  it("draws no outline when the window gave no hours to outline", () => {
    const { root } = renderSpine({ ban: banStateFrom(null, TZ, "2026-11-14"), surface: "desk" });
    expect(root.querySelector("[data-slot-outline]")).toBeNull();
    expect(screen.getByText("Midday break by law: not in force")).toBeInTheDocument();
  });
});

describe("TimeSpine: the cells", () => {
  // test_null_hours_are_not_coloured_as_data
  it("draws a null hour, and a missing hour, in --hair with no heat colour", () => {
    const cells = CELLS.map((c) => (c.hour === 9 ? { hour: 9, wbgtC: null } : c)).filter((c) => c.hour !== 12);
    const { root } = renderSpine({ cells, ban: NOT_IN_FORCE });
    const rect = (hour: number) => root.querySelector<SVGRectElement>(`[data-cell="${String(hour)}"]`);
    for (const hour of [9, 12]) {
      const empty = rect(hour);
      expect(empty, `hour ${String(hour)}`).not.toBeNull();
      expect(empty).toHaveAttribute("data-heat", "none");
      expect(empty?.getAttribute("class")).toMatch(/fill-hair/);
      expect(empty?.getAttribute("style") ?? "").not.toMatch(/oklch/);
    }
    expect(rect(10)).toHaveAttribute("data-heat", "data");
    expect(rect(10)?.getAttribute("class")).not.toMatch(/fill-hair/);
  });

  it("colours a cell from the ramp of each theme, which the theme chooses in CSS (no client read of the theme)", () => {
    const { root } = renderSpine({ ban: NOT_IN_FORCE });
    const cell = root.querySelector<SVGRectElement>('[data-cell="14"]');
    expect(cell?.style.getPropertyValue("--heat-night")).toBe(heatColor(36, "night"));
    expect(cell?.style.getPropertyValue("--heat-sun")).toBe(heatColor(36, "sun"));
    expect(cell?.getAttribute("class")).toMatch(/fill-\(--heat-night\)/);
    expect(cell?.getAttribute("class")).toMatch(/in-data-\[theme=sun\]:fill-\(--heat-sun\)/);
  });

  it("draws one cell per hour from `from` to `to`, and none outside it", () => {
    const { root } = renderSpine({ from: 8, to: 14, cells: CELLS });
    const hours = [...root.querySelectorAll<SVGRectElement>("[data-cell]")].map((c) => c.dataset["cell"]);
    expect(hours).toEqual(["8", "9", "10", "11", "12", "13"]);
  });

  it("keeps the cells out of the accessibility tree: one labelled image, the labels as real text", () => {
    renderSpine({ ban: NOT_IN_FORCE, waypoints: [{ at: 11 + 10 / 60, title: "Now", detail: "Amber until 17:00" }] });
    const image = screen.getByRole("img", { name: "Shift 06:00 to 18:00" });
    expect(image.tagName.toLowerCase()).toBe("svg");
    const item = screen.getByText("Now").closest("li");
    expect(item).not.toBeNull();
    expect(image.contains(item)).toBe(false);
    expect(within(screen.getByRole("list")).getByText("Amber until 17:00")).toBeInTheDocument();
  });
});

describe("TimeSpine: the now line", () => {
  it("draws a --signal line at the current time", () => {
    const { root } = renderSpine({ now: 12 });
    const line = root.querySelector("[data-now]");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("class")).toMatch(/stroke-signal/);
    expect(hourAt(Number(line?.getAttribute("y1")))).toBeCloseTo(12, 2);
  });

  it("draws none for a null now or a now outside the spine", () => {
    for (const now of [null, 5, 19]) {
      const { root, unmount } = renderSpine({ now });
      expect(root.querySelector("[data-now]"), String(now)).toBeNull();
      unmount();
    }
  });
});

describe("TimeSpine: the labels", () => {
  it("writes clock times with Western digits, left to right, whatever the direction", () => {
    const { root } = renderSpine({ orientation: "h", dir: "rtl", ban: NOT_IN_FORCE, surface: "desk" });
    const ticks = [...root.querySelectorAll<HTMLElement>("[data-tick]")];
    expect(ticks.map((t) => t.textContent)).toEqual(["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00"]);
    for (const tick of ticks) expect(tick.getAttribute("dir")).toBe("ltr");
  });

  it("thins the ticks of a horizontal field spine to every 3 h so 16 px times fit a phone", () => {
    const { root } = renderSpine({ orientation: "h", surface: "field" });
    expect([...root.querySelectorAll("[data-tick]")].map((t) => t.textContent)).toEqual(["06:00", "09:00", "12:00", "15:00", "18:00"]);
  });

  it("places each waypoint by its time", () => {
    const { root } = renderSpine({ waypoints: [{ at: 9, title: "Water" }] });
    const item = root.querySelector<HTMLElement>("[data-waypoint]");
    expect(Number.parseFloat(item?.style.top ?? "")).toBeCloseTo(25, 1); // (9 - 6) / 12
  });

  // test_spine_label_sizes (the part jsdom can prove: the sizes the labels are set in resolve to the floor; the real
  // layout is measured by tests/e2e/spine.spec.ts at 390 px)
  it.each([
    ["field", 16, 16],
    ["desk", 14, 12],
  ] as const)("sets the %s surface's text at %i px and its clock ticks at %i px, never under the floor", (surface, text, tick) => {
    const { root } = renderSpine({ surface });
    expect(varPx(root.style.getPropertyValue("--spine-text"))).toBe(text);
    expect(varPx(root.style.getPropertyValue("--spine-tick"))).toBe(tick);
    const floor = surface === "field" ? 16 : 12;
    expect(varPx(root.style.getPropertyValue("--spine-text"))).toBeGreaterThanOrEqual(floor);
    expect(varPx(root.style.getPropertyValue("--spine-tick"))).toBeGreaterThanOrEqual(floor);
    for (const label of root.querySelectorAll("[data-tick], [data-slot-label], [data-waypoint]")) {
      expect(label.closest("svg")).toBeNull();
    }
  });

  it("is not drawn in an svg viewBox that scales text: the labels are HTML, so 16 px is 16 px at any width", () => {
    const { root } = renderSpine({ waypoints: [{ at: 9, title: "Water" }] });
    expect(root.querySelector("svg text")).toBeNull();
  });
});

describe("TimeSpine: right to left", () => {
  // test_spine_mirrors_in_rtl
  it("mirrors the horizontal geometry: the first hour is at the right edge, the last at the left", () => {
    const first = (root: HTMLElement) => root.querySelector('[data-cell="6"]');
    const last = (root: HTMLElement) => root.querySelector('[data-cell="17"]');
    const ltr = renderSpine({ orientation: "h", ban: NOT_IN_FORCE, dir: "ltr" });
    const lx = Number(first(ltr.root)?.getAttribute("x"));
    expect(lx).toBeLessThan(Number(last(ltr.root)?.getAttribute("x")));
    ltr.unmount();

    const rtl = renderSpine({ orientation: "h", ban: NOT_IN_FORCE, dir: "rtl" });
    const rx = Number(first(rtl.root)?.getAttribute("x"));
    expect(rx).toBeGreaterThan(Number(last(rtl.root)?.getAttribute("x")));
    expect(rx).toBeCloseTo(100 - lx - Number(first(rtl.root)?.getAttribute("width")), 2);
  });

  it("mirrors the slot and the tick positions with the cells, and not the digits", () => {
    const ltr = renderSpine({ orientation: "h", dir: "ltr" });
    const slotLtr = ltr.root.querySelector("[data-slot] rect");
    const xl = Number(slotLtr?.getAttribute("x"));
    const wl = Number(slotLtr?.getAttribute("width"));
    const leftLtr = Number.parseFloat(ltr.root.querySelector<HTMLElement>('[data-tick="12"]')?.style.left ?? "");
    ltr.unmount();

    const rtl = renderSpine({ orientation: "h", dir: "rtl" });
    const slotRtl = rtl.root.querySelector("[data-slot] rect");
    expect(Number(slotRtl?.getAttribute("x"))).toBeCloseTo(100 - xl - wl, 2);
    const tickRtl = rtl.root.querySelector<HTMLElement>('[data-tick="12"]');
    expect(Number.parseFloat(tickRtl?.style.left ?? "")).toBeCloseTo(100 - leftLtr, 2);
    expect(tickRtl?.textContent).toBe("12:00");
  });

  it("positions horizontal labels from the physical left in rtl too: the list is ltr, the label keeps the reader's direction", () => {
    const { root } = renderSpine({ orientation: "h", dir: "rtl", waypoints: [{ at: 9, title: "Water" }] });
    for (const selector of ["[data-waypoint]", "[data-slot-label]"]) {
      const label = root.querySelector(selector);
      expect(label, selector).toHaveAttribute("dir", "rtl");
      expect(label?.parentElement, selector).toHaveAttribute("dir", "ltr");
    }
  });

  it("sets the direction on the spine so a vertical one puts the ticks and the labels on the inline sides", () => {
    for (const dir of ["ltr", "rtl"] as const) {
      const { root, unmount } = renderSpine({ dir });
      expect(root).toHaveAttribute("dir", dir);
      // time still runs top to bottom in both: the slot's position does not change with the direction
      expect(root.querySelector<SVGGElement>("[data-slot]")?.dataset["from"]).toBe("12.5");
      unmount();
    }
  });

  it("uses no physical left or right class: the columns follow dir", () => {
    const { container } = renderSpine({ waypoints: [{ at: 9, title: "Water", detail: "Drink water" }] });
    expect(container.innerHTML).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[(]/);
  });
});

describe("TimeSpine: the root", () => {
  it("carries data-spine, the orientation, the surface and the ban state", () => {
    const { root } = renderSpine({ surface: "desk", orientation: "h" });
    expect(root).toHaveAttribute("data-orientation", "h");
    expect(root).toHaveAttribute("data-surface", "desk");
    expect(root).toHaveAttribute("data-ban", "in-force");
  });

  it("has no shadow, gradient, hatch or radius beyond the token", () => {
    const { container } = renderSpine({ ban: NOT_IN_FORCE, surface: "desk" });
    expect(container.innerHTML).not.toMatch(/shadow|gradient|hatch|backdrop|rounded-(md|lg|xl|2xl|3xl|full)|pattern/);
  });
});
