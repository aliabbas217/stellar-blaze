import { z } from "zod";

/*
 * The Problem contract (openapi/stellar-blaze.openapi.json, schema `Problem`) as a zod schema. It is the statement
 * of the shape for tests and tooling: no app code imports it, because the browser bundle reads problems with the
 * hand-written reader in problem.ts (zod would add about 15 KB gzip to every route that calls the API, against a 170 KB
 * budget). tests/unit/api/problem-parity.test.ts pins that the reader and this schema agree.
 */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().optional(),
  // ShiftNotLegalProblem.violations. The hand reader keeps it only when every entry is well formed and otherwise drops just this
  // member (it never rejects the whole problem for it): the parity test pins both behaviours.
  // ReviewRequiredProblem.missing_items, read under the same rule as `violations`.
  missing_items: z.array(z.string()).optional(),
  violations: z.array(z.object({ rule_id: z.string(), clause: z.string(), source_id: z.string() })).optional(),
});
