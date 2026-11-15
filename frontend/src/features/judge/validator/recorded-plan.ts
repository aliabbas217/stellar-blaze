import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { segmentsToRuns } from "./runs";
import { toAnswerView, type RecordedPlanView } from "./view";

/*
 * The recorded validator result of the common roster (data/recorded/validator-b0.json, written by
 * scripts/record-validator-run.mjs). Server-only (zod): the page reads it at build time and hands the plain `RecordedPlanView`
 * to the client. A missing or unreadable file yields null, and the screen then has no "Show a recorded result" (it never
 * invents one); a release build (SB_REQUIRE_SCORED=1) fails instead.
 */

const range = z.object({ starts_at: z.string(), ends_at: z.string() });
const violation = z.object({
  rule_id: z.string(),
  clause: z.string(),
  source_id: z.string(),
  ranges: z.array(range),
  detail: z.string(),
});
const schema = z.object({
  recorded_at: z.string(),
  source: z.enum(["msw-mock", "api"]),
  request: z.object({
    date: z.string(),
    segments: z.array(z.object({ start: z.string(), end: z.string(), state: z.enum(["work", "rest", "break"]) })),
  }),
  response: z.object({
    forecast_status: z.enum(["fresh", "stale", "fallback"]),
    validator: z.object({ passed: z.boolean(), checked_rules: z.array(z.string()), violations: z.array(violation) }),
  }),
});

export function parseRecordedPlan(value: unknown): RecordedPlanView {
  const parsed = schema.parse(value);
  // Only the members the screen draws are read; the zod shape above is the subset of the contract this view needs.
  const answer = toAnswerView(parsed.response);
  return { ...answer, source: parsed.source, recordedAt: parsed.recorded_at, date: parsed.request.date, runs: segmentsToRuns(parsed.request.segments) };
}

export async function loadRecordedPlan(root: string = process.cwd()): Promise<RecordedPlanView | null> {
  try {
    return parseRecordedPlan(JSON.parse(await readFile(path.join(root, "data", "recorded", "validator-b0.json"), "utf8")) as unknown);
  } catch (error) {
    if (process.env.SB_REQUIRE_SCORED === "1") throw error;
    console.error(`try: no recorded validator result (${error instanceof Error ? error.message : "unreadable"})`);
    return null;
  }
}
