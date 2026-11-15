import { LEVELS, levelIndex, moreSevere, type Level } from "@/components/level/level";

describe("LEVELS", () => {
  it("lists the four levels in ascending severity", () => {
    expect(LEVELS).toEqual(["green", "amber", "orange", "red"]);
  });
});

describe("levelIndex", () => {
  it("numbers the levels 1 to 4 in ascending severity", () => {
    expect(LEVELS.map(levelIndex)).toEqual([1, 2, 3, 4]);
  });

  it("returns 2 for amber", () => {
    expect(levelIndex("amber")).toBe(2);
  });
});

describe("moreSevere", () => {
  it("returns the more severe of two levels", () => {
    expect(moreSevere("orange", "amber")).toBe("orange");
    expect(moreSevere("green", "red")).toBe("red");
  });

  it("is symmetric for every pair", () => {
    for (const a of LEVELS) {
      for (const b of LEVELS) {
        expect(moreSevere(a, b)).toBe(moreSevere(b, a));
      }
    }
  });

  it("returns the level itself when both are equal", () => {
    for (const l of LEVELS) {
      expect(moreSevere(l, l)).toBe(l);
    }
  });

  it("never returns a level less severe than either input", () => {
    for (const a of LEVELS) {
      for (const b of LEVELS) {
        const result: Level = moreSevere(a, b);
        expect(levelIndex(result)).toBe(Math.max(levelIndex(a), levelIndex(b)));
      }
    }
  });
});
