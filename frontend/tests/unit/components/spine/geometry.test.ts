import { formatClock, labelPlacement, percentAt, screenPercent, tickHours } from "@/components/spine/geometry";

describe("spine geometry", () => {
  it("puts an hour at its fraction of the track", () => {
    expect(percentAt(12.5, 6, 18)).toBeCloseTo(54.1667, 3);
    expect(percentAt(6, 6, 18)).toBe(0);
    expect(percentAt(18, 6, 18)).toBe(100);
  });

  it("mirrors only a horizontal track in rtl", () => {
    expect(screenPercent(25, "h", "rtl")).toBe(75);
    expect(screenPercent(25, "h", "ltr")).toBe(25);
    expect(screenPercent(25, "v", "rtl")).toBe(25);
  });

  it("formats clock times with Western digits", () => {
    expect(formatClock(12.5)).toBe("12:30");
    expect(formatClock(6)).toBe("06:00");
    expect(formatClock(11 + 10 / 60)).toBe("11:10");
  });

  it("ticks every 2 h on a shift and every 3 h on a long day or when coarse", () => {
    expect(tickHours(6, 18)).toEqual([6, 8, 10, 12, 14, 16, 18]);
    expect(tickHours(0, 24)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24]);
    expect(tickHours(6, 18, true)).toEqual([6, 9, 12, 15, 18]);
  });

  it("keeps a label inside the track: centred with room both sides, else held to the nearer end, never wider than the room", () => {
    expect(labelPlacement(50)).toEqual({ shift: "-50%", maxWidth: "100%" });
    expect(labelPlacement(46)).toEqual({ shift: "-50%", maxWidth: "92%" });
    expect(labelPlacement(10)).toEqual({ shift: "0%", maxWidth: "90%" });
    expect(labelPlacement(95)).toEqual({ shift: "-100%", maxWidth: "95%" });
  });
});
