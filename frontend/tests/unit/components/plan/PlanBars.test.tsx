import { render } from "@testing-library/react";
import { PLAN_STATE_CLASS, PlanBars, type PlanBlockState } from "@/components/plan/PlanBars";
import type { BanState } from "@/components/spine/ban-state";

/*
 * The shared plan chart (lane A's try-a-plan strip and lane B's plan screen). Presentational: minutes and words in, shapes out.
 * What is pinned here is what the screens rely on: each plan state is drawn in its own shape (never colour alone), the ban and
 * off states are not bars (the slot is the ban), the slot goes through the chart on request, the now line sits at its minute, and
 * the phone's hour labels are 16 px labels that stay inside the axis.
 */

const IN_FORCE: BanState = { kind: "in-force", fromHour: 12.5, toHour: 15 };
const labels = { ariaLabel: "plan", slot: "Midday break", outline: "Midday break by law: not in force until 15 Jun" };
const heat = Array.from({ length: 24 }, () => null);

const props = { heat, fromHour: 6, toHour: 18, labels } as const;

describe("PlanBars: states", () => {
  const states: PlanBlockState[] = ["work", "adosh_rest", "art18_break", "stopped"];

  it("draws work, rest, Art. 18 break and stop work each in a different shape", () => {
    const { container } = render(
      <PlanBars {...props} ban={IN_FORCE} blocks={states.map((state, index) => ({ state, fromMin: 360 + index * 60, toMin: 360 + index * 60 + 30 }))} />,
    );
    const drawn = [...container.querySelectorAll<HTMLElement>("[data-plan-block]")];
    expect(drawn.map((el) => el.getAttribute("data-plan-block"))).toEqual(states);
    const classes = drawn.map((el) => el.className.split(" ").filter((name) => /^(bg-|border)/.test(name)).join(" "));
    // four states, four distinct looks: a plain colour difference would not be one
    expect(new Set(classes).size).toBe(4);
    for (const state of states) expect(PLAN_STATE_CLASS[state]).not.toBe("");
    expect(PLAN_STATE_CLASS.adosh_rest).toContain("border-ink");
    expect(PLAN_STATE_CLASS.art18_break).toContain("border-double");
    expect(PLAN_STATE_CLASS.stopped).toContain("border-dashed");
  });

  it("does not draw `ban` or `off` as bars (the slot is the ban; off is absence)", () => {
    const { container } = render(
      <PlanBars
        {...props}
        ban={IN_FORCE}
        blocks={[
          { state: "work", fromMin: 360, toMin: 420 },
          { state: "ban", fromMin: 750, toMin: 900 },
          { state: "off", fromMin: 900, toMin: 960 },
        ]}
      />,
    );
    expect(container.querySelectorAll("[data-plan-block]")).toHaveLength(1);
  });

  it("positions a block by its minutes on the axis", () => {
    const { container } = render(<PlanBars {...props} ban={IN_FORCE} blocks={[{ state: "work", fromMin: 540, toMin: 720 }]} />);
    const block = container.querySelector<HTMLElement>("[data-plan-block]");
    // 09:00 to 12:00 on a 06:00 to 18:00 axis: from 25 % wide 25 %
    expect(block?.style.left).toBe("25%");
    expect(block?.style.width).toBe("25%");
  });

  it("keeps the try-a-plan strip's `bars` as they were: solid work bars", () => {
    const { container } = render(<PlanBars {...props} ban={IN_FORCE} bars={[{ fromMin: 360, toMin: 420 }]} />);
    const bar = container.querySelector("[data-plan-bar]");
    expect(bar?.className).toContain("bg-ink");
    expect(bar?.hasAttribute("data-plan-block")).toBe(false);
  });
});

describe("PlanBars: slot, now and heat", () => {
  it("cuts the slot through the whole chart on request, and only at the foot otherwise", () => {
    const through = render(<PlanBars {...props} ban={IN_FORCE} slotThrough />);
    expect(through.container.querySelector("[data-slot='in-force']")?.parentElement?.className).toContain("top-0");
    through.unmount();
    const foot = render(<PlanBars {...props} ban={IN_FORCE} />);
    const parent = foot.container.querySelector("[data-slot='in-force']")?.parentElement;
    expect(parent?.className).toContain("h-6");
    expect(parent?.className).not.toContain("top-0");
  });

  it("draws no slot out of season, only a dashed outline (and still only the outline when asked to cut through)", () => {
    const out: BanState = { kind: "not-in-force", resumesLabel: "15 Jun", outline: { fromHour: 12.5, toHour: 15 } };
    const { container } = render(<PlanBars {...props} ban={out} slotThrough />);
    expect(container.querySelector("[data-slot='in-force']")).toBeNull();
    expect(container.querySelector("[data-slot='outline']")).not.toBeNull();
    const none = render(<PlanBars {...props} ban={{ kind: "not-in-force", resumesLabel: null, outline: null }} />);
    expect(none.container.querySelector("[data-slot]")).toBeNull();
  });

  it("draws the now line at its minute, once, and none outside the axis", () => {
    const { container, rerender } = render(<PlanBars {...props} ban={IN_FORCE} nowMin={9 * 60} />);
    expect(container.querySelectorAll("[data-now]")).toHaveLength(1);
    expect(container.querySelector<HTMLElement>("[data-now]")?.style.left).toBe("25%");
    rerender(<PlanBars {...props} ban={IN_FORCE} nowMin={20 * 60} />);
    expect(container.querySelector("[data-now]")).toBeNull();
    rerender(<PlanBars {...props} ban={IN_FORCE} nowMin={null} />);
    expect(container.querySelector("[data-now]")).toBeNull();
  });

  it("paints a per-theme heat as two custom properties, a single colour as itself, and nothing for an hour with no forecast", () => {
    const cells = Array.from({ length: 24 }, () => null) as (string | { night: string; sun: string } | null)[];
    cells[6] = { night: "oklch(0.3 0.1 300)", sun: "oklch(0.9 0.05 90)" };
    cells[7] = "rgb(1, 2, 3)";
    const { container } = render(<PlanBars {...props} heat={cells} ban={IN_FORCE} />);
    const spans = [...container.querySelectorAll<HTMLElement>("[data-plan-heat] span")];
    expect(spans[0]?.style.getPropertyValue("--heat-night")).toBe("oklch(0.3 0.1 300)");
    expect(spans[0]?.style.getPropertyValue("--heat-sun")).toBe("oklch(0.9 0.05 90)");
    expect(spans[1]?.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(spans[2]?.getAttribute("style")).toBeNull();
  });
});

describe("PlanBars: hour labels", () => {
  it("on a phone a day of nine hours or more is labelled every three hours, the end of the axis included, the edges flush", () => {
    const { container } = render(<PlanBars {...props} ban={IN_FORCE} field />);
    const labelsShown = [...container.querySelectorAll<HTMLElement>("[data-time-label]")];
    // 16 px labels at 60 px spacing would touch: three hours leave 90 px
    expect(labelsShown.map((el) => el.textContent)).toEqual(["06:00", "09:00", "12:00", "15:00", "18:00"]);
    expect(labelsShown[0]?.className).not.toContain("translate");
    expect(labelsShown.at(-1)?.className).toContain("-translate-x-full");
    expect(labelsShown[0]?.parentElement?.className).toContain("text-base");
  });

  it("a short day on a phone is labelled every two hours", () => {
    const { container } = render(<PlanBars {...props} fromHour={9} toHour={15} ban={IN_FORCE} field />);
    expect([...container.querySelectorAll<HTMLElement>("[data-time-label]")].map((el) => el.textContent)).toEqual(["09:00", "11:00", "13:00", "15:00"]);
  });

  it("is unchanged without `field`: the desk's 12 px labels", () => {
    const { container } = render(<PlanBars {...props} ban={IN_FORCE} />);
    expect(container.querySelector("[data-time-label]")).toBeNull();
    expect(container.querySelector("[data-plan-bars] > div:last-child")?.className).toContain("text-xs");
  });
});
