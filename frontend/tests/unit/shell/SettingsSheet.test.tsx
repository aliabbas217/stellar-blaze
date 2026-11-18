import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsSheet } from "@/components/shell/SettingsSheet";
import { routing } from "@/i18n/routing";
import { THEME_COLORS } from "@/lib/sun/theme-colors";
import { THEME_STORAGE_KEY } from "@/lib/sun/theme-storage";
import arMessages from "../../../messages/ar.json";
import { installDialogPolyfill } from "../../utils/dialog-polyfill";
import { renderWithIntl } from "../../utils/intl";

/*
 * The header's language pill and the settings sheet it opens (redesign S5, D4): a native <dialog> with the six languages, "Screen colors"
 * and (in the worker app) "Change crew". It replaced the six always-visible chips and the "Sun mode: on" button; what they did, it still
 * does: a language choice is a link to the same page in that language that loads as a new document and keeps the query and the hash, and
 * a colour choice is the { theme, until next local midnight } override the inline script reads before paint.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/worker/alerts",
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));
vi.mock("@/lib/sun/route-theme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sun/route-theme")>();
  return { ...original, applyRouteTheme: vi.fn(() => Promise.resolve("sun" as const)) };
});

const assign = vi.fn<(url: string) => void>();

function localTime(hours: number, minutes = 0): Date {
  return new Date(2026, 10, 14, hours, minutes, 0, 0);
}

beforeAll(installDialogPolyfill);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(localTime(14, 30));
  vi.stubGlobal("location", { assign, search: "?demo=live", hash: "#top", pathname: "/en/worker/alerts" });
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = THEME_COLORS.night;
  document.head.append(meta);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  assign.mockReset();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
  document.head.querySelectorAll("meta[name=theme-color]").forEach((m) => {
    m.remove();
  });
});

function stored(): unknown {
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

const midnight = new Date(2026, 10, 15, 0, 0, 0, 0).getTime();

async function openSheet(user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })) {
  await user.click(screen.getByRole("button", { name: /Settings/ }));
  const sheet = await screen.findByRole("dialog", { name: "Settings" });
  // The rows, the colours and Change crew are a module loaded on the first opening (SettingsSheetBody.tsx): wait for it.
  await within(sheet).findByRole("group", { name: "Screen colors" });
  return { user, sheet };
}

describe("the pill", () => {
  it("shows the current language in its own name and script, with a name that says it opens settings", () => {
    renderWithIntl(<SettingsSheet />);
    const pill = screen.getByRole("button", { name: "English, Settings" });
    expect(pill).toHaveTextContent("English");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("is 44 px by construction (min-height from --target, never a fixed height) and the sheet is not in the page until opened", () => {
    renderWithIntl(<SettingsSheet />);
    expect(screen.getByRole("button", { name: /Settings/ })).toHaveClass("min-h-(--target)");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "English" })).not.toBeInTheDocument();
  });

  it("says the language in the active language (Arabic: its endonym, the page's right-to-left)", () => {
    renderWithIntl(<SettingsSheet />, { locale: "ar", messages: arMessages });
    const pill = screen.getByRole("button", { name: new RegExp(`^${arMessages.shell.locales.ar}`) });
    expect(pill).toHaveTextContent(arMessages.shell.locales.ar);
    expect(within(pill).getByText(arMessages.shell.locales.ar)).toHaveAttribute("lang", "ar");
  });
});

describe("the sheet", () => {
  it("opens from the pill with the title, Close, six languages, Screen colors; no Change crew unless the shell gives one", async () => {
    renderWithIntl(<SettingsSheet />);
    const { sheet } = await openSheet();
    expect(sheet).toHaveAttribute("open");
    expect(within(sheet).getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(sheet).getByRole("group", { name: "Screen colors" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: "Change crew" })).not.toBeInTheDocument();
  });

  it("closes with the Close button and hands focus back to the pill", async () => {
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(sheet).not.toHaveAttribute("open");
    expect(screen.queryByRole("link", { name: "English" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Settings/ })).toHaveFocus();
  });

  it("closes with Escape and hands focus back to the pill", async () => {
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.keyboard("{Escape}");
    expect(sheet).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /Settings/ })).toHaveFocus();
  });

  it("closes on a tap on the backdrop (the dialog element itself), not on a tap inside it", async () => {
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("heading", { name: "Settings" }));
    expect(sheet).toHaveAttribute("open");
    await user.click(sheet);
    expect(sheet).not.toHaveAttribute("open");
  });

  it("can be opened again after it was closed", async () => {
    renderWithIntl(<SettingsSheet />);
    const first = await openSheet();
    await first.user.keyboard("{Escape}");
    const second = await openSheet(first.user);
    expect(second.sheet).toHaveAttribute("open");
    expect(within(second.sheet).getAllByRole("link")).toHaveLength(6);
  });
});

describe("language", () => {
  it("is six rows, each an endonym in its own script and language, never translated", async () => {
    renderWithIntl(<SettingsSheet />);
    const { sheet } = await openSheet();
    const links = within(within(sheet).getByRole("navigation", { name: "Language" })).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["English", "العربية", "اردو", "हिन्दी", "বাংলা", "नेपाली"]);
    expect(links.map((link) => link.getAttribute("lang"))).toEqual([...routing.locales]);
    expect(links.map((link) => link.getAttribute("hreflang"))).toEqual([...routing.locales]);
  });

  it("marks only the active language with aria-current, and the rows are 56 px by construction", async () => {
    renderWithIntl(<SettingsSheet />, { locale: "ur" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button"));
    const sheet = await screen.findByRole("dialog");
    const links = within(sheet).getAllByRole("link");
    expect(links.filter((link) => link.getAttribute("aria-current") === "true").map((link) => link.getAttribute("lang"))).toEqual(["ur"]);
    for (const link of links) expect(link).toHaveClass("min-h-(--target-stop)");
  });

  it("links to the same page in each language", async () => {
    renderWithIntl(<SettingsSheet />);
    const { sheet } = await openSheet();
    expect(within(sheet).getByRole("link", { name: "हिन्दी" })).toHaveAttribute("href", "/hi/worker/alerts");
  });

  it("a plain tap loads the page as a new document in that language and keeps the query and hash (the language persists as the chips did)", async () => {
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("link", { name: "العربية" }));
    expect(assign).toHaveBeenCalledExactlyOnceWith("/ar/worker/alerts?demo=live#top");
  });

  it("a modified click is left to the browser (new tab)", async () => {
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.keyboard("{Control>}");
    await user.click(within(sheet).getByRole("link", { name: "العربية" }));
    await user.keyboard("{/Control}");
    expect(assign).not.toHaveBeenCalled();
  });

  it("in Arabic the sheet and its controls are the Arabic catalogue's", async () => {
    renderWithIntl(<SettingsSheet />, { locale: "ar", messages: arMessages });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: new RegExp(arMessages.shell.settings.title) }));
    const sheet = await screen.findByRole("dialog", { name: arMessages.shell.settings.title });
    expect(within(sheet).getByRole("group", { name: arMessages.shell.settings.colors.label })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: arMessages.shell.close })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "العربية" })).toHaveAttribute("aria-current", "true");
  });
});

describe("Screen colors", () => {
  it("starts on Automatic when there is no override, and says which one is chosen by aria-pressed", async () => {
    renderWithIntl(<SettingsSheet />);
    const { sheet } = await openSheet();
    expect(within(sheet).getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByRole("button", { name: "Bright" })).toHaveAttribute("aria-pressed", "false");
    expect(within(sheet).getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the override the phone already holds (an unexpired Bright)", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: "sun", until: midnight }));
    renderWithIntl(<SettingsSheet />);
    const { sheet } = await openSheet();
    expect(within(sheet).getByRole("button", { name: "Bright" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an expired override reads as Automatic", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: "night", until: localTime(9).getTime() }));
    renderWithIntl(<SettingsSheet />);
    const { sheet } = await openSheet();
    expect(within(sheet).getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Bright applies the sun theme and stores { sun, until next local midnight }", async () => {
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Bright" }));
    expect(document.documentElement.dataset["theme"]).toBe("sun");
    expect(document.head.querySelector<HTMLMetaElement>("meta[name=theme-color]")?.content).toBe(THEME_COLORS.sun);
    expect(stored()).toEqual({ theme: "sun", until: midnight });
    expect(within(sheet).getByRole("button", { name: "Bright" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Night applies night and stores { night, until next local midnight }; a tap at 23:59 lasts one minute", async () => {
    document.documentElement.dataset["theme"] = "sun";
    vi.setSystemTime(localTime(23, 59));
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Night" }));
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(stored()).toEqual({ theme: "night", until: midnight });
  });

  it("the choice persists: a sheet opened later (another visit) shows it", async () => {
    const first = renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Night" }));
    first.unmount();
    renderWithIntl(<SettingsSheet />);
    const again = await openSheet();
    expect(within(again.sheet).getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Automatic removes the override and hands the decision back to the sun on the route the phone is on", async () => {
    const { applyRouteTheme } = await import("@/lib/sun/route-theme");
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: "night", until: midnight }));
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Automatic" }));
    expect(stored()).toBeNull();
    expect(applyRouteTheme).toHaveBeenCalledExactlyOnceWith("/en/worker/alerts");
    expect(within(sheet).getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
  });

  it("still switches for this visit when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    renderWithIntl(<SettingsSheet />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Bright" }));
    expect(document.documentElement.dataset["theme"]).toBe("sun");
  });

  it("every option is 44 px by construction", async () => {
    renderWithIntl(<SettingsSheet />);
    const { sheet } = await openSheet();
    for (const name of ["Automatic", "Bright", "Night"]) expect(within(sheet).getByRole("button", { name })).toHaveClass("min-h-(--target)");
  });
});

describe("Change crew", () => {
  it("is a link to the chooser when the shell gives one, and a plain tap lets go of the old choice first, then follows the link", async () => {
    const onActivate = vi.fn(() => Promise.resolve());
    renderWithIntl(<SettingsSheet changeCrew={{ href: "/en/worker", onActivate }} />);
    const { user, sheet } = await openSheet();
    const link = within(sheet).getByRole("link", { name: "Change crew" });
    expect(link).toHaveAttribute("href", "/en/worker");
    await user.click(link);
    expect(onActivate).toHaveBeenCalledOnce();
    await act(async () => {
      await Promise.resolve();
    });
    expect(assign).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/en\/worker$/));
  });

  it("follows the link even when the callback fails: never a dead link", async () => {
    renderWithIntl(<SettingsSheet changeCrew={{ href: "/en/worker", onActivate: () => Promise.reject(new Error("stale chunk")) }} />);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("link", { name: "Change crew" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(assign).toHaveBeenCalledOnce();
  });
});
