import { z } from "zod";

/*
 * The recorded governance run (data/recorded/governance-run.json): one real call of the employer request and its refusal,
 * written by scripts/record-governance-run.mjs. The page draws it at first paint so the hero exists before any call is
 * made and the page reads the same with the API stopped. `source` says what answered when it was recorded: "msw-mock" is the
 * mock API (the real API did not exist yet), "api" is the real service. The recorded body is never trusted to be safe to
 * print: AnswerCard prints only the members it knows, and the audit row's `rule` is never printed (ADR jargon).
 *
 * This module holds the zod schema and is imported by the server page only; the client code takes the plain types.
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

/** One audit row as the screens use it: the members that are safe and useful to print. The API's `rule` text is dropped here, on purpose. */
export interface AuditRow {
  readonly at: string;
  readonly policyVersion: string;
  readonly configVersion: number;
  readonly modelId: string | null;
}

/** The refusal answer as the screens use it: identifiers and the title; the API's `detail` text is dropped (AnswerCard words it). */
export interface RefusalAnswer {
  readonly status: number;
  readonly contentType: string;
  readonly answeredAt: string;
  readonly type: string;
  readonly title: string;
  readonly requestId: string | null;
}

/** The recorded run in the plain shape the client view takes: nothing in it carries ADR jargon, so none reaches the page payload. */
export interface RecordedView {
  readonly source: RecordedRun["source"];
  readonly recordedAt: string;
  readonly siteId: string;
  readonly request: { readonly path: string; readonly sentAt: string; readonly workerRef: string; readonly dataClass: string };
  readonly answer: RefusalAnswer;
  readonly entries: readonly AuditRow[];
}

export function toAuditRow(entry: { readonly at: string; readonly policy_version: string; readonly config_version: number; readonly model_id: string | null }): AuditRow {
  return { at: entry.at, policyVersion: entry.policy_version, configVersion: entry.config_version, modelId: entry.model_id };
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
