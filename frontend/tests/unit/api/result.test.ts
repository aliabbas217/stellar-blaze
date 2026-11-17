import { call, isAbortError, isAbortOrTimeout } from "@/api/result";

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

  it("rethrows the abort that a real fetch throws, whichever realm's DOMException class it is", async () => {
    // In jsdom the error `fetch` throws is Node's DOMException, which is not `instanceof` jsdom's global DOMException: a check by class
    // read a cancelled request as "Network error", and TanStack Query then recorded a failure instead of a cancellation.
    const controller = new AbortController();
    controller.abort();
    const thrown = await fetch("http://localhost:3000/api/v1/sites", { signal: controller.signal }).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(thrown instanceof Error)) throw new Error("an aborted fetch should reject with an Error");
    expect(thrown).not.toBeInstanceOf(DOMException);

    await expect(call(Promise.reject(thrown))).rejects.toBe(thrown);
  });

  it("recognises an abort by its name, not by its class", async () => {
    const foreign = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

    await expect(call(Promise.reject(foreign))).rejects.toBe(foreign);
  });

  it("does not take another failure for an abort", async () => {
    for (const other of [new TypeError("Failed to fetch"), new DOMException("x", "NetworkError"), "AbortError", null, { name: 7 }]) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of this test: rejections that are not abort Errors
      const result = await call(Promise.reject(other));
      expect(result.ok).toBe(false);
    }
  });
});

describe("isAbortError and isAbortOrTimeout", () => {
  it("accept an abort, and a timeout only where a timeout counts", () => {
    const abort = new DOMException("x", "AbortError");
    const timeout = new DOMException("x", "TimeoutError");
    const foreignTimeout = Object.assign(new Error("x"), { name: "TimeoutError" });

    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(timeout)).toBe(false);
    expect(isAbortOrTimeout(abort)).toBe(true);
    expect(isAbortOrTimeout(timeout)).toBe(true);
    expect(isAbortOrTimeout(foreignTimeout)).toBe(true);
  });

  it("refuse everything that is not an error with that name", () => {
    for (const other of [new TypeError("x"), "AbortError", null, undefined, 3, { name: "AbortErrorish" }, { message: "AbortError" }]) {
      expect(isAbortError(other)).toBe(false);
      expect(isAbortOrTimeout(other)).toBe(false);
    }
  });
});
