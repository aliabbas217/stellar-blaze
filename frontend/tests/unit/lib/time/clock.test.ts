import { parseHhmm, replayInstant } from "@/lib/time/clock";

/*
 * The replay clock's one calculation: the instant at which a site's wall clock reads `hhmm` on `date`. It is the
 * UTC instant the whole demo hangs on (review focus 6), so it is checked against hand-computed offsets, including
 * a zone with daylight saving where a naive "date + hh:mm + fixed offset" is wrong on two days of the year.
 */

describe("replayInstant", () => {
  it("test_replay_instant_dubai: 2026-09-03 11:10 Asia/Dubai is 07:10Z (UTC+4, no daylight saving)", () => {
    expect(replayInstant("2026-09-03", "11:10", "Asia/Dubai").toISOString()).toBe("2026-09-03T07:10:00.000Z");
  });

  it("follows the zone's offset on the day: New York is UTC-5 in winter and UTC-4 in summer", () => {
    expect(replayInstant("2026-01-15", "11:10", "America/New_York").toISOString()).toBe("2026-01-15T16:10:00.000Z");
    expect(replayInstant("2026-07-15", "11:10", "America/New_York").toISOString()).toBe("2026-07-15T15:10:00.000Z");
  });

  it("is right on the days the offset changes (spring forward 8 Mar 2026, fall back 1 Nov 2026 in New York)", () => {
    // 11:10 is after the 02:00 change on both days: spring forward gives EDT (UTC-4), fall back gives EST (UTC-5).
    expect(replayInstant("2026-03-08", "11:10", "America/New_York").toISOString()).toBe("2026-03-08T15:10:00.000Z");
    expect(replayInstant("2026-11-01", "11:10", "America/New_York").toISOString()).toBe("2026-11-01T16:10:00.000Z");
    // Before the change on the same days.
    expect(replayInstant("2026-03-08", "01:30", "America/New_York").toISOString()).toBe("2026-03-08T06:30:00.000Z");
  });

  it("handles a half-hour zone and a date that crosses UTC midnight", () => {
    expect(replayInstant("2026-09-03", "00:20", "Asia/Kolkata").toISOString()).toBe("2026-09-02T18:50:00.000Z");
    expect(replayInstant("2026-09-03", "23:59", "Asia/Dubai").toISOString()).toBe("2026-09-03T19:59:00.000Z");
  });

  it.each([
    ["a date that is not a calendar date", "2026-02-30", "11:10"],
    ["a date in the wrong shape", "03/09/2026", "11:10"],
    ["an hour of 24", "2026-09-03", "24:00"],
    ["a time without the leading zero", "2026-09-03", "9:05"],
    ["text", "2026-09-03", "noon"],
  ])("rejects %s instead of returning an invalid Date", (_name, date, hhmm) => {
    expect(() => replayInstant(date, hhmm, "Asia/Dubai")).toThrow(RangeError);
  });

  it("rejects an unknown time zone", () => {
    expect(() => replayInstant("2026-09-03", "11:10", "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("parseHhmm", () => {
  it("accepts a 24-hour time with leading zeros", () => {
    expect(parseHhmm("11:10")).toBe("11:10");
    expect(parseHhmm("00:00")).toBe("00:00");
    expect(parseHhmm("23:59")).toBe("23:59");
  });

  it.each([null, "", "24:00", "9:05", "11:60", "11:1", "11-10", " 11:10", "11:10 "])("reads %j as no valid time", (raw) => {
    expect(parseHhmm(raw)).toBeNull();
  });
});
