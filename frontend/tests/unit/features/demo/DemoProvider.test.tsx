import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DemoProvider, useDemo } from "@/features/demo/DemoProvider";
import { REPLAY_DATE } from "@/features/demo/constants";
import { DEMO_STORAGE_KEY } from "@/lib/sun/theme-storage";

/*
 * The demo context: the mode (`?demo=live|replay`, replay by default and on the server), the date the calls pass in each
 * mode, and the demo site (the first synthetic entry of list_sites, never a literal id). The mode is mirrored to
 * localStorage["sb-demo"] because the inline sun script reads it before paint.
 */

let search = "";
const replace = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/en/worker",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/worker",
  useRouter: () => ({ replace }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <DemoProvider>{children}</DemoProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  search = "";
  replace.mockReset();
  window.localStorage.clear();
});

describe("DemoProvider", () => {
  it("is replay by default, and passes the replay date explicitly", () => {
    const { result } = renderHook(() => useDemo(), { wrapper });
    expect(result.current.demo).toBe("replay");
    expect(result.current.replayDate).toBe(REPLAY_DATE);
  });

  it("live omits the date: the server decides", async () => {
    search = "?demo=live";
    const { result } = renderHook(() => useDemo(), { wrapper });
    await waitFor(() => {
      expect(result.current.demo).toBe("live");
    });
    expect(result.current.replayDate).toBeUndefined();
  });

  it("mirrors the mode to localStorage for the inline sun script", async () => {
    search = "?demo=live";
    renderHook(() => useDemo(), { wrapper });
    await waitFor(() => {
      expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBe("live");
    });
  });

  it("restores the stored mode when the URL has none", async () => {
    window.localStorage.setItem(DEMO_STORAGE_KEY, "live");
    const { result } = renderHook(() => useDemo(), { wrapper });
    await waitFor(() => {
      expect(result.current.demo).toBe("live");
    });
  });

  it("an unknown ?demo= value changes nothing", () => {
    search = "?demo=banana";
    const { result } = renderHook(() => useDemo(), { wrapper });
    expect(result.current.demo).toBe("replay");
  });

  it("setDemo writes the URL (replace, no scroll), the storage and the state", () => {
    const { result } = renderHook(() => useDemo(), { wrapper });
    act(() => {
      result.current.setDemo("live");
    });
    expect(replace).toHaveBeenLastCalledWith("/en/worker?demo=live", { scroll: false });
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBe("live");
    expect(result.current.demo).toBe("live");
  });

  it("resolves the demo site from list_sites: the first synthetic one", async () => {
    const { result } = renderHook(() => useDemo(), { wrapper });
    expect(result.current.site).toBeNull();
    await waitFor(() => {
      expect(result.current.site).not.toBeNull();
    });
    expect(result.current.site?.synthetic).toBe(true);
  });

  it("throws a clear error outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useDemo())).toThrow(/DemoProvider/);
  });
});
