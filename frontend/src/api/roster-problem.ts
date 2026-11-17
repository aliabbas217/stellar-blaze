import { ApiProblem, type Problem } from "@/api/problem";
import type { components } from "@/api/schema";

/*
 * The 422 of `validate_plan` when the roster does not parse (`roster-invalid`): its `errors` name the lines. The shared
 * problem reader keeps only the six members every problem has, so the lines would be dropped; this reads them from the raw
 * body and carries them on an `ApiProblem` subclass, so a screen can show "line 2: end 25:00 is not a time" and every
 * other caller still sees a plain `ApiProblem`.
 */

export type RosterError = components["schemas"]["RosterError"];

export const ROSTER_INVALID_TYPE = "urn:stellar-blaze:problem:roster-invalid";

export class RosterInvalidProblem extends ApiProblem {
  readonly errors: readonly RosterError[];

  constructor(problem: Problem, errors: readonly RosterError[]) {
    super(problem);
    this.name = "RosterInvalidProblem";
    this.errors = errors;
  }
}

/** The per-line errors of a raw problem body, or null when it is not a well-formed `roster-invalid` body. */
export function rosterErrorsOf(body: unknown): RosterError[] | null {
  if (typeof body !== "object" || body === null) return null;
  const { errors } = body as { errors?: unknown };
  if (!Array.isArray(errors)) return null;
  const out: RosterError[] = [];
  for (const item of errors as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { line, message } = item as { line?: unknown; message?: unknown };
    if (typeof line !== "number" || !Number.isSafeInteger(line) || typeof message !== "string") return null;
    out.push({ line, message });
  }
  return out;
}
