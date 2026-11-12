import type { z } from "zod";
import { createProfileSchema, ProfileSchema } from "@/features/profile/schema";
import { CONSENT_VERSION, isCalendarDate, localCalendarDate, toProfile, type Profile } from "@/features/profile/profile-shape";

/*
 * The worker's on-device profile (ADR 0004): the form validates with `ProfileSchema`; the store reads what it persisted
 * with the zod-free `toProfile` (zod would add about 15 KB gzip to the Alerts route). Both are tested here against the
 * same cases, so the two statements of the shape cannot drift apart unnoticed.
 */

const valid: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-11-11T08:30:00.000Z",
  siteId: "site-demo-mussafah",
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-11-01",
  clothingCode: "work_clothes",
};

/** A local-time clock: `new Date(y, m, d, ...)` has local components in any host time zone. */
const clockAt =
  (...args: [year: number, monthIndex: number, day: number, hours?: number, minutes?: number]) =>
  () =>
    new Date(...args);

const today = clockAt(2026, 10, 11, 12, 0);
const schema = createProfileSchema(today);

function issues(input: unknown): { path: string; message: string }[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("ProfileSchema", () => {
  it("accepts a complete profile, with or without a crew", () => {
    expect(schema.parse(valid)).toEqual(valid);
    expect(schema.parse({ ...valid, crewId: "crew-a" })).toEqual({ ...valid, crewId: "crew-a" });
  });

  it("is exported ready to use with the real clock", () => {
    expect(ProfileSchema.safeParse({ ...valid, heatWorkStartDate: "2000-01-01" }).success).toBe(true);
  });

  describe("heatWorkStartDate", () => {
    it("rejects a date in the future, with a code the form maps to profile.errors.futureDate", () => {
      expect(issues({ ...valid, heatWorkStartDate: "2026-11-12" })).toEqual([{ path: "heatWorkStartDate", message: "futureDate" }]);
      expect(issues({ ...valid, heatWorkStartDate: "2027-01-01" })).toEqual([{ path: "heatWorkStartDate", message: "futureDate" }]);
    });

    it("accepts today and any earlier day", () => {
      expect(schema.safeParse({ ...valid, heatWorkStartDate: "2026-11-11" }).success).toBe(true);
      expect(schema.safeParse({ ...valid, heatWorkStartDate: "2026-11-10" }).success).toBe(true);
      expect(schema.safeParse({ ...valid, heatWorkStartDate: "2019-03-02" }).success).toBe(true);
    });

    it("reads 'today' from the clock each time it validates, not once at import", () => {
      let now = new Date(2026, 10, 11, 23, 59);
      const live = createProfileSchema(() => now);
      expect(live.safeParse({ ...valid, heatWorkStartDate: "2026-11-12" }).success).toBe(false);
      now = new Date(2026, 10, 12, 0, 1);
      expect(live.safeParse({ ...valid, heatWorkStartDate: "2026-11-12" }).success).toBe(true);
    });

    it("compares calendar dates in the phone's local time zone, not UTC", () => {
      // 01:00 on 12 November in Dubai (UTC+4) is still 21:00 on 11 November in UTC: a UTC "today" would reject the
      // worker's own date for the first four hours of every day.
      vi.stubEnv("TZ", "Asia/Dubai");
      try {
        expect(new Date(2026, 10, 12, 1, 0).getTimezoneOffset(), "the TZ override took effect").toBe(-240);
        const dubai = createProfileSchema(clockAt(2026, 10, 12, 1, 0));
        expect(dubai.safeParse({ ...valid, heatWorkStartDate: "2026-11-12" }).success).toBe(true);
        expect(dubai.safeParse({ ...valid, heatWorkStartDate: "2026-11-13" }).success).toBe(false);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it.each(["", "yesterday", "2026-1-5", "11/11/2026", "2026-02-30", "2026-13-01", "2026-11-00", "2026-11-11T00:00:00Z", "0050-01-01"])(
      "rejects %j, which is not a calendar date",
      (value) => {
        expect(issues({ ...valid, heatWorkStartDate: value })).toEqual([{ path: "heatWorkStartDate", message: "required" }]);
      },
    );

    it("accepts a leap day only in a leap year", () => {
      expect(isCalendarDate("2024-02-29")).toBe(true);
      expect(isCalendarDate("2026-02-29")).toBe(false);
    });
  });

  it("rejects an unknown workloadClass", () => {
    for (const workloadClass of ["extreme", "", "Heavy", "HEAVY", 3, null]) {
      expect(issues({ ...valid, workloadClass }), String(workloadClass)).toEqual([{ path: "workloadClass", message: "required" }]);
    }
  });

  it("accepts each of the three workload classes", () => {
    for (const workloadClass of ["light", "moderate", "heavy"] as const) {
      expect(schema.parse({ ...valid, workloadClass }).workloadClass).toBe(workloadClass);
    }
  });

  it("rejects an empty siteId, clothingCode or crewId (a crew is null, never an empty string)", () => {
    expect(issues({ ...valid, siteId: "" })).toEqual([{ path: "siteId", message: "required" }]);
    expect(issues({ ...valid, clothingCode: "" })).toEqual([{ path: "clothingCode", message: "required" }]);
    expect(issues({ ...valid, crewId: "" })).toEqual([{ path: "crewId", message: "required" }]);
  });

  it("rejects a missing field and a wrong type", () => {
    const without = (field: keyof Profile) => Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
    expect(schema.safeParse(without("siteId")).success).toBe(false);
    expect(schema.safeParse(without("crewId")).success).toBe(false);
    expect(schema.safeParse({ ...valid, siteId: 7 }).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse("profile").success).toBe(false);
  });

  it("rejects a consent version other than the one the app shows", () => {
    expect(issues({ ...valid, consentVersion: "2026-01-01" })).toEqual([{ path: "consentVersion", message: "required" }]);
  });

  it.each(["", "yesterday", "2026-11-11", "2026-11-11 08:30:00", "2026-13-11T08:30:00Z", "2026-11-11T25:00:00Z"])(
    "rejects %j as the moment of consent",
    (consentedAt) => {
      expect(issues({ ...valid, consentedAt })).toEqual([{ path: "consentedAt", message: "required" }]);
    },
  );

  it.each(["2026-11-11T08:30:00Z", "2026-11-11T08:30:00.123Z", "2026-11-11T12:30:00+04:00"])("accepts %j as the moment of consent", (consentedAt) => {
    expect(schema.safeParse({ ...valid, consentedAt }).success).toBe(true);
  });

  it("states the same type as Profile (a change to one without the other fails type-checking)", () => {
    expectTypeOf<z.infer<typeof ProfileSchema>>().toExtend<Profile>();
    expectTypeOf<Profile>().toExtend<z.infer<typeof ProfileSchema>>();
  });
});

describe("localCalendarDate", () => {
  it("is the local year, month and day with zero padding", () => {
    expect(localCalendarDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localCalendarDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("toProfile (what the store trusts from storage) agrees with ProfileSchema", () => {
  const cases: [name: string, input: unknown][] = [
    ["a valid profile", valid],
    ["a valid profile with a crew", { ...valid, crewId: "crew-a" }],
    ["each workload class: light", { ...valid, workloadClass: "light" }],
    ["each workload class: heavy", { ...valid, workloadClass: "heavy" }],
    ["an unknown workload class", { ...valid, workloadClass: "extreme" }],
    ["a non-string workload class", { ...valid, workloadClass: 3 }],
    ["an empty site", { ...valid, siteId: "" }],
    ["a numeric site", { ...valid, siteId: 7 }],
    ["an empty crew string", { ...valid, crewId: "" }],
    ["an undefined crew", { ...valid, crewId: undefined }],
    ["an empty clothing code", { ...valid, clothingCode: "" }],
    ["another consent version", { ...valid, consentVersion: "2026-01-01" }],
    ["no consent version", { ...valid, consentVersion: undefined }],
    ["a consent time that is not ISO 8601", { ...valid, consentedAt: "yesterday" }],
    ["an empty consent time", { ...valid, consentedAt: "" }],
    ["a consent time with an offset", { ...valid, consentedAt: "2026-11-11T12:30:00+04:00" }],
    ["an impossible start date", { ...valid, heatWorkStartDate: "2026-02-30" }],
    ["a start date in another format", { ...valid, heatWorkStartDate: "11/11/2026" }],
    ["an empty start date", { ...valid, heatWorkStartDate: "" }],
    ["null", null],
    ["a string", "profile"],
    ["an array", []],
    ["an empty object", {}],
  ];

  it.each(cases)("%s", (_name, input) => {
    const accepted = ProfileSchema.safeParse(input).success;
    expect(toProfile(input) !== null).toBe(accepted);
  });

  it("returns exactly the profile fields: anything else in storage is dropped", () => {
    expect(toProfile({ ...valid, extra: "x", nested: { a: 1 } })).toEqual(valid);
    expect(Object.keys(toProfile({ ...valid, extra: "x" }) ?? {}).sort()).toEqual(Object.keys(valid).sort());
  });

  it("does not apply the future-date rule to what is already stored: a phone clock that moved back must not erase a profile", () => {
    const stored = { ...valid, heatWorkStartDate: "2999-01-01" };
    expect(ProfileSchema.safeParse(stored).success).toBe(false);
    expect(toProfile(stored)).toEqual(stored);
  });
});
