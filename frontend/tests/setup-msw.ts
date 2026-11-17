import { server } from "@/mocks/node";

/*
 * Every test file runs against the MSW handlers of src/mocks (the mock API contract). A request no handler
 * answers is an error, never a silent call to the real network (MSW 3 names this option `onUnhandledFrame`;
 * it was `onUnhandledRequest` in MSW 2). Override one answer for one test with `server.use(...)`: it is undone
 * after each test.
 *
 * `listen()` runs here, at import time, not in a beforeAll hook: setup files run before a test file's imports,
 * and openapi-fetch keeps the `fetch` it finds when `createClient()` runs (importing src/api/client.ts).
 * Listening later would leave it holding the unpatched fetch, which no handler can see.
 */
server.listen({ onUnhandledFrame: "error" });

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

/*
 * A browser resolves `new Request("/api/v1/sites")` against the page's origin; Node's Request has no origin
 * and throws, which would break the same-origin `apiClient` (baseUrl "") in every jsdom test. Only a jsdom
 * environment has a `location`, so node-environment tests keep Node's behaviour. Proxying the real constructor
 * keeps `instanceof Request` and the static members intact.
 */
if (typeof location !== "undefined") {
  vi.stubGlobal(
    "Request",
    new Proxy(Request, {
      construct(target, args: [RequestInfo | URL, RequestInit?], newTarget) {
        const [input, init] = args;
        const resolved = typeof input === "string" ? new URL(input, location.href) : input;
        return Reflect.construct(target, [resolved, init], newTarget) as Request;
      },
    }),
  );
}
