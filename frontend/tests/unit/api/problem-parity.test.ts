import type { z } from "zod";
import { toProblem, type Problem } from "@/api/problem";
import { ProblemSchema } from "@/api/problem-schema";

/*
 * toProblem reads a problem+json body with a hand-written reader instead of ProblemSchema, so that the browser bundle
 * does not carry a validation library for six fields (the worker routes have a 170 KB budget). The schema stays as the
 * statement of the contract; this pins that the reader and the schema accept and drop exactly the same things.
 */

it("has the same type as the schema infers", () => {
  expectTypeOf<Problem>().toEqualTypeOf<z.infer<typeof ProblemSchema>>();
});

const FALLBACK = new Response("<h1>Bad gateway</h1>", {
  status: 502,
  statusText: "Bad Gateway",
  headers: { "content-type": "text/html", "x-request-id": "hdr-1" },
});

const fallback = () => toProblem(FALLBACK.clone(), "<h1>Bad gateway</h1>");

describe("toProblem agrees with ProblemSchema", () => {
  it("has a distinct fallback to compare against", () => {
    expect(fallback()).toEqual({ type: "about:blank", title: "Bad Gateway", status: 502, request_id: "hdr-1" });
  });

  it.each([
    ["the required members only", { type: "urn:x", title: "Nope", status: 403 }],
    ["every member", { type: "urn:x", title: "Nope", status: 404, detail: "No site.", instance: "/api/v1/sites/x", request_id: "r-1" }],
    ["members this client does not know", { type: "urn:x", title: "Nope", status: 422, errors: [{ field: "a" }], trace: "t" }],
    ["status 0", { type: "urn:x", title: "Network", status: 0 }],
    ["a negative status", { type: "urn:x", title: "Odd", status: -1 }],
  ])("accepts %s and returns the same members", (_name, body) => {
    const schema = ProblemSchema.safeParse(body);
    expect(schema.success).toBe(true);
    expect(toProblem(FALLBACK.clone(), body)).toEqual(schema.data);
  });

  it.each([
    ["a fractional status", { type: "urn:x", title: "Nope", status: 503.5 }],
    ["a status that is not a safe integer", { type: "urn:x", title: "Nope", status: 2 ** 60 }],
    ["a string status", { type: "urn:x", title: "Nope", status: "403" }],
    ["a missing title", { type: "urn:x", status: 403 }],
    ["a missing type", { title: "Nope", status: 403 }],
    ["a numeric type", { type: 7, title: "Nope", status: 403 }],
    ["a numeric detail", { type: "urn:x", title: "Nope", status: 403, detail: 5 }],
    ["a null request_id", { type: "urn:x", title: "Nope", status: 403, request_id: null }],
    ["a numeric instance", { type: "urn:x", title: "Nope", status: 403, instance: 1 }],
    ["an empty object", {}],
    ["null", null],
    ["an array", [{ type: "urn:x", title: "Nope", status: 403 }]],
    ["text", "Internal Server Error"],
    ["a number", 500],
  ])("rejects %s, as the schema does, and describes the response instead", (_name, body) => {
    expect(ProblemSchema.safeParse(body).success).toBe(false);
    expect(toProblem(FALLBACK.clone(), body)).toEqual(fallback());
  });
});
