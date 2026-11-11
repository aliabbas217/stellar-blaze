import { pushCapability, type PushEnv } from "@/features/push/capability";

/*
 * What this phone can do about alerts decides what the Alerts screen offers (review focus 4: an iPhone that has not
 * installed the app, a browser without push, an insecure address). Each row of the plan's table is one case, plus the
 * order of the checks, which is what a wrong answer would come from.
 */

const full: PushEnv = {
  isSecureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIos: false,
  isStandalone: false,
};

describe("pushCapability", () => {
  it("insecure context -> insecure", () => {
    expect(pushCapability({ ...full, isSecureContext: false })).toBe("insecure");
  });

  it("iOS Safari tab, not standalone, no PushManager -> ios-needs-install", () => {
    expect(pushCapability({ ...full, isIos: true, isStandalone: false, hasPushManager: false })).toBe("ios-needs-install");
  });

  it("iOS standalone with PushManager -> supported", () => {
    expect(pushCapability({ ...full, isIos: true, isStandalone: true })).toBe("supported");
  });

  it("desktop Chrome full support -> supported", () => {
    expect(pushCapability(full)).toBe("supported");
  });

  it("no service worker -> unsupported", () => {
    expect(pushCapability({ ...full, hasServiceWorker: false })).toBe("unsupported");
  });

  it("no PushManager outside iOS -> unsupported", () => {
    expect(pushCapability({ ...full, hasPushManager: false })).toBe("unsupported");
  });

  it("no Notification API -> unsupported", () => {
    expect(pushCapability({ ...full, hasNotification: false })).toBe("unsupported");
  });

  it("an insecure iPhone is told about the address first: installing the app cannot fix it", () => {
    expect(pushCapability({ ...full, isIos: true, hasPushManager: false, isSecureContext: false })).toBe("insecure");
  });

  it("iOS standalone without PushManager (iOS before 16.4) -> unsupported, not another install prompt", () => {
    expect(pushCapability({ ...full, isIos: true, isStandalone: true, hasPushManager: false })).toBe("unsupported");
  });

  it("an iOS tab that does have PushManager can subscribe, so it is supported (features, not the user agent, decide)", () => {
    expect(pushCapability({ ...full, isIos: true, isStandalone: false, hasPushManager: true })).toBe("supported");
  });
});
