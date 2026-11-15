import { CLINICAL_REVIEW, reviewLabel } from "@/features/unwell/clinical-review";
import { formatElapsed, KEEP_TAP_MS, rulerFraction, tapTime, TAP_KEY, type TapStorage } from "@/features/unwell/elapsed";

/*
 * The unwell sheet's timer logic and the clinical-review record. The timer is the worker's own clock on the phone: it must
 * survive a reload, not count from a different episode, and never throw when storage is blocked.
 */

function memoryStorage(initial: Record<string, string> = {}): TapStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const NOW = 1_800_000_000_000;

describe("tapTime", () => {
  it("stores now on the first open and returns it", () => {
    const storage = memoryStorage();
    expect(tapTime(NOW, storage)).toBe(NOW);
    expect(storage.data.get(TAP_KEY)).toBe(String(NOW));
  });

  it("keeps the stored tap on a reload", () => {
    const storage = memoryStorage({ [TAP_KEY]: String(NOW - 4 * 60_000) });
    expect(tapTime(NOW, storage)).toBe(NOW - 4 * 60_000);
    expect(storage.data.get(TAP_KEY)).toBe(String(NOW - 4 * 60_000));
  });

  it.each([
    ["an older episode", String(NOW - KEEP_TAP_MS - 1)],
    ["a time in the future (the clock moved)", String(NOW + 1)],
    ["text", "soon"],
    ["a negative number", "-5"],
    ["a decimal", "12.5"],
    ["an empty string", ""],
  ])("starts a new tap over %s", (_, stored) => {
    const storage = memoryStorage({ [TAP_KEY]: stored });
    expect(tapTime(NOW, storage)).toBe(NOW);
    expect(storage.data.get(TAP_KEY)).toBe(String(NOW));
  });

  it("keeps a tap exactly at the keep limit", () => {
    expect(tapTime(NOW, memoryStorage({ [TAP_KEY]: String(NOW - KEEP_TAP_MS) }))).toBe(NOW - KEEP_TAP_MS);
  });

  it("works with no storage, and with a storage that throws (a private window): the timer runs in memory", () => {
    expect(tapTime(NOW, null)).toBe(NOW);
    const blocked: TapStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(tapTime(NOW, blocked)).toBe(NOW);
  });
});

describe("formatElapsed and rulerFraction", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [600_000, "10:00"],
    [3_725_000, "62:05"],
    [-5000, "0:00"],
  ])("%d ms is %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });

  it("the ruler fills over ten minutes and stops at the end", () => {
    expect(rulerFraction(0)).toBe(0);
    expect(rulerFraction(300_000)).toBe(0.5);
    expect(rulerFraction(600_000)).toBe(1);
    expect(rulerFraction(1_200_000)).toBe(1);
    expect(rulerFraction(-1)).toBe(0);
  });
});

describe("the clinical review record (ADR 0035)", () => {
  it("nobody has reviewed the wording: the constant is null", () => {
    expect(CLINICAL_REVIEW).toBeNull();
  });

  it("is reviewed only for a non-blank date", () => {
    expect(reviewLabel(null)).toEqual({ kind: "not-reviewed" });
    expect(reviewLabel("")).toEqual({ kind: "not-reviewed" });
    expect(reviewLabel("   ")).toEqual({ kind: "not-reviewed" });
    expect(reviewLabel("2026-12-01")).toEqual({ kind: "reviewed", date: "2026-12-01" });
  });
});
