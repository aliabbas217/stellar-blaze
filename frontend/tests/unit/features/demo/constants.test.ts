import { DEMO_CREW_ID, isDemoMode, parseDemoMode, pickDemoSite } from "@/features/demo/constants";

/* The one demo-mode switch (ADR 0062, D4) and the pieces every demo screen shares. */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDemoMode", () => {
  it("is off only for NEXT_PUBLIC_SB_DEMO=0", () => {
    vi.stubEnv("NEXT_PUBLIC_SB_DEMO", "0");
    expect(isDemoMode()).toBe(false);
  });

  it("is on for 1", () => {
    vi.stubEnv("NEXT_PUBLIC_SB_DEMO", "1");
    expect(isDemoMode()).toBe(true);
  });

  // A missing or malformed flag must never turn real calls on: anything but the exact "0" is demo.
  it.each(["", "false", "off", "no", " 0", "00", "true", "yes"])("is on for %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_SB_DEMO", value);
    expect(isDemoMode()).toBe(true);
  });

  it("is on when unset (a missing build flag can never dial a synthetic number)", () => {
    vi.stubEnv("NEXT_PUBLIC_SB_DEMO", undefined);
    expect(isDemoMode()).toBe(true);
  });
});

describe("pickDemoSite", () => {
  const site = (id: string, synthetic: boolean) => ({ id, name: id, timezone: "Asia/Dubai", synthetic });

  it("is the first synthetic site, never a literal id", () => {
    expect(pickDemoSite([site("real", false), site("first-demo", true), site("second-demo", true)])?.id).toBe("first-demo");
  });

  it("is null when no site is synthetic or the list is empty", () => {
    expect(pickDemoSite([site("real", false)])).toBeNull();
    expect(pickDemoSite([])).toBeNull();
  });
});

describe("parseDemoMode", () => {
  it("accepts live and replay and nothing else", () => {
    expect(parseDemoMode("live")).toBe("live");
    expect(parseDemoMode("replay")).toBe("replay");
    expect(() => parseDemoMode("LIVE")).toThrow(RangeError);
    expect(() => parseDemoMode(null)).toThrow(RangeError);
  });
});

it("the scored crew is crew-b (ADR 0057)", () => {
  expect(DEMO_CREW_ID).toBe("crew-b");
});
