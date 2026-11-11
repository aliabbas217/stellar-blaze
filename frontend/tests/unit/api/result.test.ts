import { call } from "@/api/result";

function problemResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

describe("call", () => {
  it("turns a successful response into ok with the typed data", async () => {
    const response = Response.json({ id: "sub-1" }, { status: 201 });

    const result = await call(Promise.resolve({ data: { id: "sub-1" }, response }));

    expect(result).toEqual({ ok: true, data: { id: "sub-1" } });
  });

  it("treats a 204 (no body, data undefined) as ok", async () => {
    const response = new Response(null, { status: 204 });

    const result = await call(Promise.resolve({ response }));

    expect(result.ok).toBe(true);
  });

  it("turns a problem+json error into a problem that keeps the request id", async () => {
    const body = { type: "urn:x", title: "Server error", status: 500, request_id: "mock-req-1" };

    const result = await call(Promise.resolve({ error: body, response: problemResponse(500, body) }));

    expect(result).toEqual({ ok: false, problem: body });
  });

  it("falls back to the response when the error body is not a problem", async () => {
    const response = new Response("<html>", {
      status: 504,
      statusText: "Gateway Timeout",
      headers: { "content-type": "text/html", "x-request-id": "r-9" },
    });

    const result = await call(Promise.resolve({ error: "<html>", response }));

    expect(result).toEqual({
      ok: false,
      problem: { type: "about:blank", title: "Gateway Timeout", status: 504, request_id: "r-9" },
    });
  });

  it("never rejects on a transport failure: it reports a network problem without a request id", async () => {
    const result = await call(Promise.reject(new TypeError("Failed to fetch")));

    expect(result).toEqual({
      ok: false,
      problem: { type: "urn:stellar-blaze:problem:network-error", title: "Network error", status: 0 },
    });
  });

  it("rethrows an abort so a cancelled query is not reported as a failure", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");

    await expect(call(Promise.reject(abort))).rejects.toBe(abort);
  });
});
