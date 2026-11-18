import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsSheet } from "@/components/shell/SettingsSheet";
import { installDialogPolyfill } from "../../utils/dialog-polyfill";
import { renderWithIntl } from "../../utils/intl";

/*
 * The settings sheet's rows, colours and "Change crew" are a module of their own (SettingsSheetBody.tsx), loaded on the first opening
 * and fetched in the browser's idle time before that, so that the header every field route shares stays inside the first-load ceiling.
 * Here the module cannot be loaded (a chunk that was never fetched and is not cached: offline, or a deploy that replaced it): the
 * sheet must still open with its title and Close and close again, never take the page down; and the idle fetch must be scheduled,
 * cancelled when the header goes away, and left alone when the phone asks to save data.
 */

vi.mock("@/components/shell/SettingsSheetBody", () => {
  throw new Error("Loading chunk failed");
});
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/worker/alerts",
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));

beforeAll(installDialogPolyfill);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "connection");
});

describe("when the sheet's body cannot be loaded", () => {
  it("still opens with its title and Close, and closes with Close, with no error on the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWithIntl(<SettingsSheet />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Settings/ }));
    const sheet = await screen.findByRole("dialog", { name: "Settings" });
    expect(sheet).toHaveAttribute("open");
    expect(within(sheet).getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // the body never arrives: no rows, no colours, no link, and the sheet stays usable. (jsdom does not surface a rejected lazy module
    // to the nearest error boundary, so this test does not prove the boundary: removing it still passes here. That contract is React's
    // own and was checked in a real browser build, with the chunk blocked: see the commit that added SettingsSheetBody.tsx.)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(within(sheet).queryByRole("group", { name: "Screen colors" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("link")).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(sheet).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /Settings/ })).toHaveFocus();
  });
});

describe("the idle fetch of the body", () => {
  it("is scheduled once when the browser has idle time, and cancelled when the header goes away", () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);

    const { unmount } = renderWithIntl(<SettingsSheet />);
    expect(request).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("falls back to a timer where the browser has no idle callback, and clears it on unmount", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const set = vi.spyOn(window, "setTimeout");
    const clear = vi.spyOn(window, "clearTimeout");

    const { unmount } = renderWithIntl(<SettingsSheet />);
    expect(set.mock.calls.some(([, delay]) => delay === 1500)).toBe(true);

    unmount();
    expect(clear).toHaveBeenCalled();
  });

  it("is not scheduled at all when the phone asks to save data", () => {
    const request = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", request);
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });

    renderWithIntl(<SettingsSheet />);
    expect(request).not.toHaveBeenCalled();
  });
});
