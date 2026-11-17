import { z } from "zod";
import { toAuditRow, type RecordedView } from "./recorded-view";

/*
 * The recorded governance run (data/recorded/governance-run.json): one real call of the employer request and its refusal,
 * written by scripts/record-governance-run.mjs. The page draws it at first paint so the hero exists before any call is
 * made and the page reads the same with the API stopped. `source` says what answered when it was recorded: "msw-mock" is the
 * mock API (the real API did not exist yet), "api" is the real service. The recorded body is never trusted to be safe to
 * print: AnswerCard prints only the members it knows, and the audit row's `rule` is never printed (ADR jargon).
 *
 * This module holds the zod schema and is imported by the server-only loader (load-recorded.ts) only. Client code takes the
 * plain types from ./recorded-view, which imports nothing: the schema must never reach a client chunk.
 */

const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().optional(),
});

const entry = z.object({
  at: z.string(),
  kind: z.literal("data_request.refused"),
  outcome: z.literal("refused"),
  actor_role: z.literal("employer"),
  rule: z.string(),
  policy_version: z.string(),
  config_version: z.number().int(),
  model_id: z.string().nullable(),
});

export const recordedRunSchema = z.object({
  recorded_at: z.string(),
  source: z.enum(["msw-mock", "api"]),
  site_id: z.string(),
  request: z.object({
    method: z.literal("POST"),
    path: z.string(),
    sent_at: z.string(),
    body: z.object({ subject: z.literal("worker"), data_class: z.enum(["health", "personal", "exposure"]), worker_ref: z.string() }),
  }),
  response: z.object({
    status: z.literal(403),
    content_type: z.string(),
    answered_at: z.string(),
    body: problem,
  }),
  log: z.object({ site_id: z.string(), entries: z.array(entry).min(1) }),
});

export type RecordedRun = z.infer<typeof recordedRunSchema>;

/** Parses the contents of governance-run.json; throws a ZodError naming the field when it is not the shape above. */
export function parseRecordedRun(value: unknown): RecordedRun {
  return recordedRunSchema.parse(value);
}

export function toRecordedView(run: RecordedRun): RecordedView {
  return {
    source: run.source,
    recordedAt: run.recorded_at,
    siteId: run.site_id,
    request: { path: run.request.path, sentAt: run.request.sent_at, workerRef: run.request.body.worker_ref, dataClass: run.request.body.data_class },
    answer: {
      status: run.response.status,
      contentType: run.response.content_type,
      answeredAt: run.response.answered_at,
      type: run.response.body.type,
      title: run.response.body.title,
      requestId: run.response.body.request_id ?? null,
    },
    entries: run.log.entries.map(toAuditRow),
  };
}
