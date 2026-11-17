import {
  consoleLineToRecord,
  isHydrationText,
  isUrllessResourceLine,
  requestFailure,
  responseError,
  routePath,
  UNBUILT_CORE_ROUTES,
} from "../../e2e/gate-console";

describe("responseError", () => {
  it("passes a response below 400", () => {
    expect(responseError(200, "http://localhost:3101/en/replay")).toBeNull();
    expect(responseError(304, "http://localhost:3101/en/replay")).toBeNull();
  });

  it("records an HTTP error with its URL", () => {
    expect(responseError(500, "http://localhost:3101/en/replay")).toBe("HTTP 500 http://localhost:3101/en/replay");
    expect(responseError(404, "http://localhost:3101/en/nowhere")).toBe("HTTP 404 http://localhost:3101/en/nowhere");
  });

  it.each(UNBUILT_CORE_ROUTES)("ignores ONLY a 404 on the unbuilt route %s", (route) => {
    expect(responseError(404, `http://localhost:3101/en${route}`)).toBeNull();
    expect(responseError(404, `http://localhost:3101${route}`)).toBeNull();
    // a 500 (or a 401, or a 503) on the same path is a failure
    for (const status of [400, 401, 403, 500, 502, 503]) {
      expect(responseError(status, `http://localhost:3101/en${route}`), String(status)).toBe(`HTTP ${String(status)} http://localhost:3101/en${route}`);
    }
  });

  it("does not list a route that is built (the governance view exists)", () => {
    expect(UNBUILT_CORE_ROUTES).not.toContain("/replay/governance");
    expect(responseError(404, "http://localhost:3101/en/replay/governance")).not.toBeNull();
  });
});

describe("requestFailure", () => {
  it("records a network-layer failure with its URL and reason", () => {
    expect(requestFailure("http://localhost:3101/api/x", "net::ERR_CONNECTION_REFUSED")).toBe(
      "request failed http://localhost:3101/api/x (net::ERR_CONNECTION_REFUSED)",
    );
    expect(requestFailure("https://fonts.example/f.woff2", "net::ERR_BLOCKED_BY_CSP")).toContain("https://fonts.example/f.woff2");
    expect(requestFailure("http://localhost:3101/x", undefined)).toBe("request failed http://localhost:3101/x");
  });

  it("does not count a request the page cancelled itself", () => {
    expect(requestFailure("http://localhost:3101/en/worker?_rsc=1", "net::ERR_ABORTED")).toBeNull();
  });
});

describe("the console line for a failed resource", () => {
  it("is URL-less, so the response and requestfailed reports stand in for it", () => {
    expect(isUrllessResourceLine("Failed to load resource: the server responded with a status of 500 (Internal Server Error)")).toBe(true);
    expect(isUrllessResourceLine("Uncaught TypeError: x is not a function")).toBe(false);
  });
});

describe("routePath", () => {
  it("drops the locale prefix and nothing else", () => {
    expect(routePath("http://h/en/replay/day")).toBe("/replay/day");
    expect(routePath("http://h/replay/day?x=1")).toBe("/replay/day");
    expect(routePath("http://h/ur/replay/proof/forecast.hours_over_limit")).toBe("/replay/proof/forecast.hours_over_limit");
  });
});

describe("isHydrationText", () => {
  it.each([
    "Minified React error #418; visit https://react.dev/errors/418?args[]=text for the full message",
    "Minified React error #423",
    "Minified React error #425",
    "Minified React error #422",
    "Hydration failed because the server rendered text didn't match the client.",
    "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.",
    'Warning: Text content did not match. Server: "11:09" Client: "11:12"',
  ])("is a hydration message: %s", (text) => {
    expect(isHydrationText(text)).toBe(true);
  });

  it.each([
    "Uncaught TypeError: x is not a function",
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
    "Minified React error #321; visit https://react.dev/errors/321",
    "Download the React DevTools for a better development experience",
  ])("is not: %s", (text) => {
    expect(isHydrationText(text)).toBe(false);
  });
});

describe("consoleLineToRecord", () => {
  it("records an error that is not the URL-less resource line", () => {
    expect(consoleLineToRecord("error", "boom", false)).toBe("boom");
    expect(consoleLineToRecord("error", "Failed to load resource: 500", false)).toBeNull();
  });

  it("records a warning only when warnings are asked for, and marks it as one", () => {
    expect(consoleLineToRecord("warning", "deprecated", false)).toBeNull();
    expect(consoleLineToRecord("warning", "deprecated", true)).toBe("warning: deprecated");
  });

  it("records a hydration message of ANY type, whatever the options", () => {
    for (const type of ["log", "info", "debug", "warning", "error"]) {
      expect(consoleLineToRecord(type, "Hydration failed because", false), type).not.toBeNull();
    }
    expect(consoleLineToRecord("log", "plain log line", true)).toBeNull();
  });
});
