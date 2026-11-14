/*
 * The one place TanStack Query keys are written (F2 global constraints: "query keys in src/api/query-keys.ts").
 * `riskPolicy` and `today` are the keys the worker Today screen already uses (src/features/today/useSiteToday.ts) and
 * that tests/unit/features/today/useSiteToday.test.tsx pins: ["risk-policy"] and ["today", siteId]. Changing them
 * would split one cache entry in two.
 *
 * A `date` of undefined means "the API's default date" and is its own key (null), never the same entry as a date.
 */

export const queryKeys = {
  riskPolicy: () => ["risk-policy"] as const,
  today: (siteId: string) => ["today", siteId] as const,
  crews: (siteId: string) => ["crews", siteId] as const,
  crewTimeline: (crewId: string, date?: string) => ["crew-timeline", crewId, date ?? null] as const,
  crewDayPlan: (crewId: string, date?: string) => ["crew-day-plan", crewId, date ?? null] as const,
  transparencyLog: (siteId: string) => ["transparency-log", siteId] as const,
};
