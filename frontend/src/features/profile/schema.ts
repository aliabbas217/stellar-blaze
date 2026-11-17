import { z } from "zod";
import {
  CONSENT_VERSION,
  isCalendarDate,
  isIsoTimestamp,
  localCalendarDate,
  WORKLOAD_CLASSES,
  type Profile,
} from "@/features/profile/profile-shape";

/*
 * The worker's profile as a zod schema, for the setup form (zodResolver). It is not imported by the store or the Alerts
 * route: zod would add about 15 KB gzip there, against a 170 KB budget. The store reads what it persisted with `toProfile`
 * (profile-shape.ts), and the rules both use come from that file.
 *
 * An issue's message is a code, never text: "required" or "futureDate", the keys of `profile.errors` in messages/*.json.
 * The form translates; no user-visible string lives here.
 *
 * Measure before importing this on a worker route: classic zod is about 30 KB gzip, `zod/mini` about 15 KB (Task 7's
 * measurements). The schema only uses `safeParse`-level features, so moving it to `zod/mini` is mechanical.
 */

/**
 * Builds the schema with a clock, so a test can say what day it is. The clock is read each time the schema validates,
 * not once: a phone that stays on the setup screen past midnight must not judge "today" by yesterday.
 */
export function createProfileSchema(now: () => Date = () => new Date()) {
  return z.object({
    consentVersion: z.literal(CONSENT_VERSION, { error: "required" }),
    consentedAt: z.string({ error: "required" }).refine(isIsoTimestamp, { error: "required" }),
    siteId: z.string({ error: "required" }).min(1, { error: "required" }),
    crewId: z.string({ error: "required" }).min(1, { error: "required" }).nullable(),
    workloadClass: z.enum(WORKLOAD_CLASSES, { error: "required" }),
    heatWorkStartDate: z
      .string({ error: "required" })
      // abort: a date that is not a date must not also be called "in the future".
      .refine(isCalendarDate, { error: "required", abort: true })
      // Both sides are zero-padded YYYY-MM-DD, so comparing the text is comparing the days. The worker's day, not UTC's.
      .refine((date) => date <= localCalendarDate(now()), { error: "futureDate" }),
    clothingCode: z.string({ error: "required" }).min(1, { error: "required" }),
  });
}

export const ProfileSchema = createProfileSchema() satisfies z.ZodType<Profile>;
