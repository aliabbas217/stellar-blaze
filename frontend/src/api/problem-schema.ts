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
});
