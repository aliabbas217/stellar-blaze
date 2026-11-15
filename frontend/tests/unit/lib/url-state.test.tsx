import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { useUrlParam } from "@/lib/url-state";

/*
 * URL state (F2 ruling: not nuqs, the worker route family has no room for it): a filter lives in the query string,
 * is read with the framework's useSearchParams, and is written with router.replace and scroll: false so a tap does
 * not jump the page or fill the history. The two framework hooks are replaced by one fake location.
 */

const location = { pathname: "/en/replay", search: "", replace: vi.fn<(href: string, options?: { scroll?: boolean }) => void>() };
const listeners = new Set<() => void>();

function setSearch(search: string): void {
  location.search = search;
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => location.search, () => location.search)),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => ({ replace: location.replace }),
}));

beforeEach(() => {
  location.search = "";
  location.replace.mockReset();
  location.replace.mockImplementation((href) => {
    const query = href.includes("?") ? href.slice(href.indexOf("?")) : "";
    setSearch(query);
  });
});

const parseMode = (raw: string | null): "live" | "replay" => {
  if (raw === "live" || raw === "replay") return raw;
  throw new RangeError("not a mode");
};

function Probe({ fallback = "replay" as "live" | "replay" }) {
  const [mode, setMode] = useUrlParam("demo", parseMode, fallback);
  return (
    <>
      <p data-testid="value">{mode}</p>
      <button type="button" onClick={() => { setMode("live"); }}>live</button>
      <button type="button" onClick={() => { setMode("replay"); }}>replay</button>
    </>
  );
}

describe("useUrlParam", () => {
  it("test_url_state_roundtrip_and_fallback_on_bad_value: writes the value, reads it back, and falls back on garbage", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(screen.getByTestId("value")).toHaveTextContent("replay");

    await user.click(screen.getByRole("button", { name: "live" }));
    expect(location.replace).toHaveBeenLastCalledWith("/en/replay?demo=live", { scroll: false });
    expect(screen.getByTestId("value")).toHaveTextContent("live");

    act(() => {
      setSearch("?demo=banana");
    });
    expect(screen.getByTestId("value")).toHaveTextContent("replay");
  });

  it("reads the value already in the URL on first render", () => {
    location.search = "?demo=live";
    render(<Probe />);
    expect(screen.getByTestId("value")).toHaveTextContent("live");
  });

  it("falls back when the parameter is absent (parse is called with null and may throw)", () => {
    render(<Probe fallback="live" />);
    expect(screen.getByTestId("value")).toHaveTextContent("live");
  });

  it("removes the parameter when the value equals the fallback, so the URL stays clean", async () => {
    const user = userEvent.setup();
    location.search = "?demo=live";
    render(<Probe />);

    await user.click(screen.getByRole("button", { name: "replay" }));

    expect(location.replace).toHaveBeenLastCalledWith("/en/replay", { scroll: false });
  });

  it("keeps the other query parameters when it writes its own", async () => {
    const user = userEvent.setup();
    location.search = "?at=11:30&site=x";
    render(<Probe />);

    await user.click(screen.getByRole("button", { name: "live" }));

    const href = location.replace.mock.lastCall?.[0] ?? "";
    const query = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(Object.fromEntries(query)).toEqual({ at: "11:30", site: "x", demo: "live" });
  });

  it("always passes scroll: false (a filter tap must not move the page)", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByRole("button", { name: "live" }));
    expect(location.replace.mock.lastCall?.[1]).toEqual({ scroll: false });
  });
});
