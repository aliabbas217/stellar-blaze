import {
  ACTION_PRIMARY,
  ACTION_PRIMARY_DENSE,
  ACTION_QUIET,
  ACTION_SECONDARY,
  ACTION_SECONDARY_DENSE,
  ACTION_STOP,
  CHIP,
  NAV_TAB,
  SEGMENT,
  SEGMENTS,
} from "@/components/states/actions";

/*
 * The control tiers of DESIGN.md 5.1. They are class lists, so the contract is checked on the lists: what each tier fills with, how tall
 * it is, that it is rounded as a control (never the 2 px of a data mark), that it never carries a fixed height (Nastaliq must grow it),
 * and that Stop is the only tier that is a solid ink slab.
 */
const TIERS = {
  primary: ACTION_PRIMARY,
  secondary: ACTION_SECONDARY,
  primaryDense: ACTION_PRIMARY_DENSE,
  secondaryDense: ACTION_SECONDARY_DENSE,
  quiet: ACTION_QUIET,
  stop: ACTION_STOP,
} as const;

const tokens = (list: string): string[] => list.split(/\s+/);

describe("control tiers (actions.ts)", () => {
  it.each(Object.entries(TIERS))("%s is rounded as a control, never the 2 px data corner, and has a min-height but no fixed height", (_name, list) => {
    expect(tokens(list)).toContain("rounded-ctl");
    expect(tokens(list)).not.toContain("rounded-sign");
    expect(list).toMatch(/min-h-\(--target(-field|-stop)?\)/);
    expect(list).not.toMatch(/(^|\s)(h-|size-)\S+/);
  });

  it("sizes: 52 px primary and secondary, 44 px dense and quiet, 56 px Stop (one min-height each)", () => {
    for (const list of [ACTION_PRIMARY, ACTION_SECONDARY]) expect(list.match(/min-h-\S+/g)).toEqual(["min-h-(--target-field)"]);
    for (const list of [ACTION_PRIMARY_DENSE, ACTION_SECONDARY_DENSE, ACTION_QUIET]) expect(list.match(/min-h-\S+/g)).toEqual(["min-h-(--target)"]);
    expect(ACTION_STOP.match(/min-h-\S+/g)).toEqual(["min-h-(--target-stop)"]);
  });

  it("a tier never carries two font sizes or two paddings (the second would race the first in the stylesheet)", () => {
    for (const [name, list] of Object.entries(TIERS)) {
      expect(tokens(list).filter((c) => /^text-(xs|sm|base|lg|xl|\d+)$/.test(c)), `${name} font size`).toHaveLength(1);
      expect(tokens(list).filter((c) => /^px-/.test(c)), `${name} padding`).toHaveLength(1);
    }
  });

  it("primary is the signal fill with its own text colour; secondary is a tonal fill with a 1.5 px edge ring; quiet has no fill", () => {
    for (const list of [ACTION_PRIMARY, ACTION_PRIMARY_DENSE]) {
      expect(tokens(list)).toEqual(expect.arrayContaining(["bg-signal", "text-on-signal"]));
      expect(tokens(list)).not.toContain("bg-ink");
    }
    for (const list of [ACTION_SECONDARY, ACTION_SECONDARY_DENSE]) {
      expect(tokens(list)).toEqual(expect.arrayContaining(["bg-raised", "text-ink", "inset-ring-[1.5px]", "inset-ring-edge"]));
      expect(list).not.toMatch(/(^|\s)border(\s|-)/);
    }
    expect(tokens(ACTION_QUIET).some((c) => /^bg-/.test(c))).toBe(false);
  });

  it("Stop is the only tier that is a solid ink slab", () => {
    expect(tokens(ACTION_STOP)).toEqual(expect.arrayContaining(["bg-ink", "text-ground", "w-full"]));
    for (const [name, list] of Object.entries(TIERS)) {
      if (name !== "stop") expect(tokens(list), name).not.toContain("bg-ink");
    }
  });

  it("every filled tier has hover and pressed fills from the --mix-* tokens (the ones scripts/contrast.mjs measures) and a 120 ms press", () => {
    for (const [name, list] of Object.entries(TIERS)) {
      if (name === "quiet") continue;
      expect(list, `${name} hover`).toMatch(/hover:bg-\[color-mix\(in_oklch,[^\]]*var\(--mix-[a-z-]+\)\)\]/);
      expect(list, `${name} pressed`).toMatch(/active:bg-\[color-mix\(in_oklch,[^\]]*var\(--mix-[a-z-]+\)\)\]/);
      expect(list, `${name} motion`).toContain("duration-(--dur-press)");
      expect(list, `${name} motion`).toContain("active:scale-[0.985]");
      expect(list, `${name} colour transition`).not.toMatch(/transition-(all|colors)/);
    }
  });

  it("primary and secondary have the busy state (label kept, opacity, ring spinner) and a disabled state; neither is hidden by pointer-events", () => {
    for (const list of [ACTION_PRIMARY, ACTION_SECONDARY, ACTION_PRIMARY_DENSE, ACTION_SECONDARY_DENSE]) {
      expect(tokens(list)).toEqual(expect.arrayContaining(["aria-busy:opacity-85", "aria-busy:after:animate-spin", "disabled:opacity-50", "disabled:cursor-not-allowed"]));
      expect(list).not.toContain("pointer-events-none");
    }
  });
});

describe("selection controls (actions.ts)", () => {
  it("a chip is a 44 px pill; the selected one (pressed or current) is the filled ink pill with a check and weight 600", () => {
    expect(tokens(CHIP)).toEqual(expect.arrayContaining(["rounded-pill", "min-h-(--target)"]));
    for (const state of ["aria-pressed", "aria-[current=true]"]) {
      expect(tokens(CHIP), state).toEqual(
        expect.arrayContaining([`${state}:bg-ink`, `${state}:text-ground`, `${state}:font-semibold`, `${state}:before:content-['']`]),
      );
    }
    expect(CHIP).not.toContain("rounded-sign");
    // no padding or font size of its own: a second `px-*` or `text-*` from the caller would race it in the stylesheet
    expect(tokens(CHIP).filter((c) => /^(px-|text-(xs|sm|base|lg|xl|\d+)$)/.test(c))).toEqual([]);
  });

  it("the tab bar is a segmented pill whose current tab is raised with the edge ring", () => {
    expect(tokens(SEGMENTS)).toContain("rounded-pill");
    expect(tokens(SEGMENT)).toEqual(expect.arrayContaining(["rounded-pill", "min-h-(--target)", "aria-[current=page]:bg-raised", "aria-[current=page]:inset-ring-edge"]));
    expect(tokens(NAV_TAB)).toEqual(expect.arrayContaining(["rounded-pill", "min-h-(--target)", "aria-[current=page]:bg-raised", "aria-[current=step]:bg-raised"]));
  });
});
