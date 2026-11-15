/*
 * The recorded governance run in the plain shape the client view takes. This module imports NOTHING (no zod): the client
 * components of /replay/governance import it, so anything it pulled in would ship in that route's JS. The zod schema lives in
 * `recorded.ts`, which only the server-only loader imports; tests/unit/lint/client-bundle-graph.test.ts fails when a client
 * entry reaches zod.
 */

/** What answered when the run was recorded: "msw-mock" is the demo mock, "api" is the real service. */
export type RecordedSource = "msw-mock" | "api";

/** One audit row as the screens use it: the members that are safe and useful to print. The API's `rule` text is dropped on purpose. */
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
  readonly source: RecordedSource;
  readonly recordedAt: string;
  readonly siteId: string;
  readonly request: { readonly path: string; readonly sentAt: string; readonly workerRef: string; readonly dataClass: string };
  readonly answer: RefusalAnswer;
  readonly entries: readonly AuditRow[];
}

export function toAuditRow(entry: { readonly at: string; readonly policy_version: string; readonly config_version: number; readonly model_id: string | null }): AuditRow {
  return { at: entry.at, policyVersion: entry.policy_version, configVersion: entry.config_version, modelId: entry.model_id };
}
