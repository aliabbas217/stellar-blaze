// @vitest-environment node
import { isLive, liveApiOrigin, liveEmployerToken, LIVE_SKIP_MESSAGE, NO_TOKEN_SKIP_MESSAGE } from "../../e2e/live/env";

describe("isLive", () => {
  it("is on only for E2E_LIVE=1, so a plain `pnpm e2e` never runs the live project", () => {
    expect(isLive({ E2E_LIVE: "1" })).toBe(true);
    for (const value of [undefined, "", "0", "true", "yes", " 1"]) expect(isLive({ E2E_LIVE: value }), String(value)).toBe(false);
    expect(isLive({})).toBe(false);
  });
});

describe("liveApiOrigin", () => {
  it("is null when unset or blank: the live specs skip with a message", () => {
    expect(liveApiOrigin({})).toBeNull();
    expect(liveApiOrigin({ E2E_API_ORIGIN: "" })).toBeNull();
    expect(liveApiOrigin({ E2E_API_ORIGIN: "   " })).toBeNull();
  });

  it.each([
    ["http://127.0.0.1:8000", "http://127.0.0.1:8000"],
    ["http://127.0.0.1:8000/", "http://127.0.0.1:8000"],
    [" https://api.example.test ", "https://api.example.test"],
  ])("normalizes %s to the origin %s", (raw, origin) => {
    expect(liveApiOrigin({ E2E_API_ORIGIN: raw })).toBe(origin);
  });

  it.each(["not a url", "ftp://host", "http://user:pw@host", "http://host/api/v1", "http://host/?x=1", "http://host/#frag"])("refuses %s", (raw) => {
    expect(() => liveApiOrigin({ E2E_API_ORIGIN: raw })).toThrow(/E2E_API_ORIGIN/);
  });

  it("does not echo a refused value, which may carry credentials", () => {
    let message = "";
    try {
      liveApiOrigin({ E2E_API_ORIGIN: "http://user:hunter2@host" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("E2E_API_ORIGIN");
    expect(message).not.toContain("hunter2");
  });
});

describe("liveEmployerToken", () => {
  it("is the trimmed token, or null when unset or blank", () => {
    expect(liveEmployerToken({ E2E_DEMO_EMPLOYER_TOKEN: " synthetic-token " })).toBe("synthetic-token");
    expect(liveEmployerToken({})).toBeNull();
    expect(liveEmployerToken({ E2E_DEMO_EMPLOYER_TOKEN: " " })).toBeNull();
  });
});

describe("the skip messages", () => {
  it("name the variable the operator must set", () => {
    expect(LIVE_SKIP_MESSAGE).toContain("E2E_API_ORIGIN");
    expect(NO_TOKEN_SKIP_MESSAGE).toContain("E2E_DEMO_EMPLOYER_TOKEN");
  });
});
