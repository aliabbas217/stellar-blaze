import { act, renderHook } from "@testing-library/react";
import { clearDemoRole, DEMO_ROLE_KEY, isDemoRole, readDemoRole, setDemoRole, useDemoRole } from "@/lib/demo-role";

/*
 * The demo role is a label kept in sessionStorage: no cookie, no server state. Storage that throws must never break a screen, so
 * the role then lives in memory for the page.
 */

afterEach(() => {
  vi.restoreAllMocks();
  clearDemoRole();
  window.sessionStorage.clear();
});

describe("demo role storage", () => {
  it("starts empty, sets, reads and clears, in sessionStorage only", () => {
    expect(readDemoRole()).toBeNull();
    setDemoRole("crew-lead");
    expect(readDemoRole()).toBe("crew-lead");
    expect(window.sessionStorage.getItem(DEMO_ROLE_KEY)).toBe("crew-lead");
    setDemoRole("officer");
    expect(readDemoRole()).toBe("officer");
    clearDemoRole();
    expect(readDemoRole()).toBeNull();
    expect(window.sessionStorage.getItem(DEMO_ROLE_KEY)).toBeNull();
    // Never a cookie or a persistent store.
    expect(document.cookie).toBe("");
    expect(window.localStorage.length).toBe(0);
  });

  it("ignores a stored value that is not a role", () => {
    window.sessionStorage.setItem(DEMO_ROLE_KEY, "admin");
    expect(readDemoRole()).toBeNull();
    expect(isDemoRole("admin")).toBe(false);
    expect(isDemoRole("crew-lead")).toBe(true);
    expect(isDemoRole("officer")).toBe(true);
  });

  it("does not throw when storage throws on every call, and keeps the role in memory for the page", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readDemoRole()).toBeNull();
    expect(() => {
      setDemoRole("officer");
    }).not.toThrow();
    expect(readDemoRole()).toBe("officer");
    expect(() => {
      clearDemoRole();
    }).not.toThrow();
    expect(readDemoRole()).toBeNull();
  });
});

describe("useDemoRole", () => {
  it("follows a change made in this tab", () => {
    const { result } = renderHook(() => useDemoRole());
    expect(result.current).toBeNull();
    act(() => {
      setDemoRole("crew-lead");
    });
    expect(result.current).toBe("crew-lead");
    act(() => {
      clearDemoRole();
    });
    expect(result.current).toBeNull();
  });

  it("says undefined while it has not asked the browser (the server render), so a caller can reserve its height", async () => {
    const { renderToString } = await import("react-dom/server");
    function Probe() {
      return <p>{String(useDemoRole())}</p>;
    }
    window.sessionStorage.setItem(DEMO_ROLE_KEY, "officer");
    expect(renderToString(<Probe />)).toContain("undefined");
  });
});
