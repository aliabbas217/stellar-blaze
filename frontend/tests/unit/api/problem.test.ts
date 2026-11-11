import { ApiProblem, ProblemSchema, toProblem } from "@/api/problem";

function problemJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": "header-id" },
  });
}

describe("toProblem", () => {
  it("parses an application/problem+json body into an ApiProblem with its request_id", async () => {
    const res = problemJsonResponse({ type: "urn:x", title: "Nope", status: 403, request_id: "r-1" }, 403);

    const error = new ApiProblem(toProblem(res, await res.json()));

    expect(error).toBeInstanceOf(ApiProblem);
    expect(error).toBeInstanceOf(Error);
    expect(error.problem).toEqual({ type: "urn:x", title: "Nope", status: 403, request_id: "r-1" });
    expect(error.problem.request_id).toBe("r-1");
    expect(error.message).toContain("Nope");
  });

  it("falls back to the response when a text/html 500 carries only an x-request-id header", async () => {
    const res = new Response("<h1>Bad gateway</h1>", {
      status: 500,
      statusText: "Internal Server Error",
      headers: { "content-type": "text/html", "x-request-id": "r-2" },
    });

    const problem = toProblem(res, await res.text());

    expect(problem).toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      request_id: "r-2",
    });
  });

  it("leaves request_id undefined when the fallback response has no x-request-id header", () => {
    const res = new Response("down", { status: 503, statusText: "Service Unavailable" });

    expect(toProblem(res, "down").request_id).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["a string", "oops"],
    ["a JSON object that is not a problem", { error: "boom" }],
    ["a problem without a status", { type: "urn:x", title: "Nope" }],
  ])("falls back for %s", (_label, body) => {
    const res = new Response(null, { status: 502, statusText: "Bad Gateway" });

    expect(toProblem(res, body)).toMatchObject({ type: "about:blank", title: "Bad Gateway", status: 502 });
  });

  it("keeps the optional members and ignores members it does not know", async () => {
    const res = problemJsonResponse(
      {
        type: "urn:x",
        title: "Unprocessable",
        status: 422,
        detail: "date is required",
        instance: "/api/v1/crews/crew-a/timeline",
        request_id: "r-3",
        added_later: true,
      },
      422,
    );

    const problem = toProblem(res, await res.json());

    expect(problem).toEqual({
      type: "urn:x",
      title: "Unprocessable",
      status: 422,
      detail: "date is required",
      instance: "/api/v1/crews/crew-a/timeline",
      request_id: "r-3",
    });
  });
});

describe("ProblemSchema", () => {
  it("rejects a body whose status is not an integer", () => {
    expect(ProblemSchema.safeParse({ type: "urn:x", title: "Nope", status: "403" }).success).toBe(false);
  });
});
