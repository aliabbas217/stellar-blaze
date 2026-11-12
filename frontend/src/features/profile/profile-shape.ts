/*
 * The worker's on-device profile (ADR 0004, plan section 8.8): its type, its rules and a reader for what the store
 * persisted. It lives apart from schema.ts (the zod schema the form validates with) because the store is on the Alerts
 * route and zod would add about 15 KB gzip to it, against a 170 KB budget. The schema is built from the constants and
 * predicates below, so the two cannot disagree about a rule, and tests/unit/features/profile/schema.test.ts runs both
 * against the same cases.
 *
 * Governance: these seven fields are the whole profile. Nothing that names or identifies a person is in it, and it is
 * never sent to the server.
 */

/** The version of the consent text the worker agreed to. A profile saved under another version is not read back. */
export const CONSENT_VERSION = "2026-11-11" as const;

export const WORKLOAD_CLASSES = ["light", "moderate", "heavy"] as const;
export type WorkloadClass = (typeof WORKLOAD_CLASSES)[number];

export interface Profile {
  readonly consentVersion: typeof CONSENT_VERSION;
  /** When the worker agreed: an ISO 8601 date and time. */
  readonly consentedAt: string;
  readonly siteId: string;
  /** The crew the worker chose, or null for none. */
  readonly crewId: string | null;
  readonly workloadClass: WorkloadClass;
  /** The day the worker started working in heat, as a calendar date: YYYY-MM-DD, in the worker's own time zone. */
  readonly heatWorkStartDate: string;
  /** One of the clothing options of the risk policy, by code. */
  readonly clothingCode: string;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function isWorkloadClass(value: unknown): value is WorkloadClass {
  return WORKLOAD_CLASSES.some((workloadClass) => workloadClass === value);
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether the text is a real calendar date written YYYY-MM-DD: "2026-02-30" is not, and neither is a date and time.
 * Years before 0100 are refused with it: they are not a start date, and `Date` reads them as 19xx.
 */
export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The calendar date on the clock of the phone, in its own time zone: YYYY-MM-DD. Not UTC: see the schema's test. */
export function localCalendarDate(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An ISO 8601 date and time with a zone ("Z" or an offset), such as `new Date().toISOString()` gives. The date part is
 * checked as a calendar date because `Date.parse` accepts "2026-02-30" and rolls it to March.
 */
export function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP.test(value) && isCalendarDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}

/**
 * The profile in `value`, or null when it is not one. Used on what the store read back from localStorage: a value of the
 * wrong shape (an older version of the app, a hand edit, a truncated write) is treated as no profile, never trusted.
 *
 * It checks the shape, not the start date's place on the calendar: a phone whose clock was set back must not make the
 * app forget a profile the worker entered correctly. The form's schema is the one that refuses a future date.
 */
export function toProfile(value: unknown): Profile | null {
  if (typeof value !== "object" || value === null) return null;
  const { consentVersion, consentedAt, siteId, crewId, workloadClass, heatWorkStartDate, clothingCode } = value as Record<string, unknown>;
  if (consentVersion !== CONSENT_VERSION) return null;
  if (typeof consentedAt !== "string" || !isIsoTimestamp(consentedAt)) return null;
  if (!isNonEmptyString(siteId)) return null;
  if (crewId !== null && !isNonEmptyString(crewId)) return null;
  if (!isWorkloadClass(workloadClass)) return null;
  if (typeof heatWorkStartDate !== "string" || !isCalendarDate(heatWorkStartDate)) return null;
  if (!isNonEmptyString(clothingCode)) return null;
  return { consentVersion, consentedAt, siteId, crewId, workloadClass, heatWorkStartDate, clothingCode };
}
