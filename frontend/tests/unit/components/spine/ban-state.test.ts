import { banStateFrom, type BanWindowInput } from "@/components/spine/ban-state";

const TZ = "Asia/Dubai";

/** The frozen B3 v1 shape (BanWindow in src/api/schema.d.ts): in season the instants are set, out of season they are null. */
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

describe("banStateFrom", () => {
  // test_ban_state_from_window_in_and_out_of_season
  it("is in force on the replay day, with the edges read from the window's instants in the site zone", () => {
    expect(banStateFrom(IN_SEASON, TZ, "2026-09-03")).toEqual({ kind: "in-force", fromHour: 12.5, toHour: 15 });
  });

  it("takes the edges from the instants, never from a literal: 30 minutes off in the window moves the slot", () => {
    const shifted = { ...IN_SEASON, starts_at: "2026-09-03T09:00:00Z", ends_at: "2026-09-03T11:30:00Z" };
    expect(banStateFrom(shifted, TZ, "2026-09-03")).toEqual({ kind: "in-force", fromHour: 13, toHour: 15.5 });
  });

  it("converts to the zone it is given, not to UTC or the browser's zone", () => {
    expect(banStateFrom(IN_SEASON, "UTC", "2026-09-03")).toEqual({ kind: "in-force", fromHour: 8.5, toHour: 11 });
  });

  it("ignores active_on_date: the instants and the season decide", () => {
    const stale = { ...IN_SEASON, active_on_date: false };
    expect(banStateFrom(stale, TZ, "2026-09-03").kind).toBe("in-force");
  });

  it("is not in force out of season, and says when the break resumes", () => {
    expect(banStateFrom(OUT_OF_SEASON, TZ, "2026-11-14")).toMatchObject({ kind: "not-in-force", resumesLabel: "15 Jun" });
    expect(banStateFrom(OUT_OF_SEASON, TZ, "2026-03-01")).toMatchObject({ kind: "not-in-force", resumesLabel: "15 Jun" });
  });

  it("is not in force on a date outside the season even when the window still carries instants", () => {
    const leaked = { ...IN_SEASON, starts_at: "2026-11-14T08:30:00Z", ends_at: "2026-11-14T11:00:00Z" };
    expect(banStateFrom(leaked, TZ, "2026-11-14").kind).toBe("not-in-force");
  });

  it("treats the season dates as inclusive local dates", () => {
    const at = (date: string) => ({
      ...IN_SEASON,
      starts_at: `${date}T08:30:00Z`,
      ends_at: `${date}T11:00:00Z`,
    });
    const kinds = ["2026-06-14", "2026-06-15", "2026-09-15", "2026-09-16"].map((d) => banStateFrom(at(d), TZ, d).kind);
    expect(kinds).toEqual(["not-in-force", "in-force", "in-force", "not-in-force"]);
  });

  it("is not in force when either instant is null, even inside the season", () => {
    expect(banStateFrom({ ...IN_SEASON, ends_at: null }, TZ, "2026-09-03")).toMatchObject({ kind: "not-in-force" });
    expect(banStateFrom({ ...IN_SEASON, starts_at: null }, TZ, "2026-09-03")).toMatchObject({ kind: "not-in-force" });
    // inside the season there is no "until", so no resume label
    expect(banStateFrom({ ...OUT_OF_SEASON }, TZ, "2026-09-03")).toEqual({
      kind: "not-in-force",
      resumesLabel: null,
      outline: { fromHour: 12.5, toHour: 15 },
    });
  });

  it("is not in force when the instants are not on the date being drawn", () => {
    expect(banStateFrom(IN_SEASON, TZ, "2026-09-04").kind).toBe("not-in-force");
  });

  it("is not in force for no window at all, a malformed one or a date it cannot read (null, undefined, garbage)", () => {
    const none = { kind: "not-in-force", resumesLabel: null, outline: null };
    expect(banStateFrom(null, TZ, "2026-09-03")).toEqual(none);
    expect(banStateFrom(undefined, TZ, "2026-09-03")).toEqual(none);
    expect(banStateFrom(IN_SEASON, TZ, "not-a-date")).toMatchObject({ kind: "not-in-force" });
    expect(banStateFrom({ ...IN_SEASON, starts_at: "soon" }, TZ, "2026-09-03")).toMatchObject({ kind: "not-in-force" });
    // an end before the start cannot be a slot
    const inverted = { ...IN_SEASON, starts_at: IN_SEASON.ends_at, ends_at: IN_SEASON.starts_at };
    expect(banStateFrom(inverted, TZ, "2026-09-03").kind).toBe("not-in-force");
  });

  it("keeps the outline where the break would be, from the window's own HH:MM, so a desk axis can draw it dashed", () => {
    expect(banStateFrom(OUT_OF_SEASON, TZ, "2026-11-14")).toMatchObject({ outline: { fromHour: 12.5, toHour: 15 } });
  });

  it("labels the resume date with Western digits in every locale", () => {
    for (const locale of ["en", "ar", "ur", "hi", "bn", "ne"]) {
      const state = banStateFrom(OUT_OF_SEASON, TZ, "2026-11-14", locale);
      expect(state.kind === "not-in-force" ? state.resumesLabel : "", locale).toMatch(/\b15\b/);
    }
  });
});
