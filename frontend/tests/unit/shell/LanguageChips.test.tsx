import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageChips } from "@/components/shell/LanguageChips";
import { routing } from "@/i18n/routing";
import { renderWithIntl } from "../../utils/intl";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/worker/alerts",
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));

const assign = vi.fn<(url: string) => void>();

beforeEach(() => {
  vi.stubGlobal("location", { assign, search: "?demo=live", hash: "#top" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("LanguageChips", () => {
  it("is one link per locale, each an endonym in its own script and language", () => {
    renderWithIntl(<LanguageChips />);
    const nav = screen.getByRole("navigation", { name: "Language" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["English", "العربية", "اردو", "हिन्दी", "বাংলা", "नेपाली"]);
    expect(links.map((link) => link.getAttribute("lang"))).toEqual([...routing.locales]);
    expect(links.map((link) => link.getAttribute("hreflang"))).toEqual([...routing.locales]);
  });

  it("marks only the active language with aria-current", () => {
    renderWithIntl(<LanguageChips />, { locale: "ur" });
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "true");
    expect(current.map((link) => link.getAttribute("lang"))).toEqual(["ur"]);
  });

  it("links to the same page in each language", () => {
    renderWithIntl(<LanguageChips />);
    expect(screen.getByRole("link", { name: "हिन्दी" })).toHaveAttribute("href", "/hi/worker/alerts");
  });

  it("a plain tap loads the page as a new document and keeps the query and hash (html is owned by the locale layout)", async () => {
    renderWithIntl(<LanguageChips />);
    await userEvent.setup().click(screen.getByRole("link", { name: "العربية" }));
    expect(assign).toHaveBeenCalledExactlyOnceWith("/ar/worker/alerts?demo=live#top");
  });

  it("a modified click is left to the browser (new tab)", async () => {
    renderWithIntl(<LanguageChips />);
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link", { name: "العربية" }));
    await user.keyboard("{/Control}");
    expect(assign).not.toHaveBeenCalled();
  });

  it("every chip is at least 44 px by construction", () => {
    renderWithIntl(<LanguageChips />);
    for (const link of screen.getAllByRole("link")) expect(link).toHaveClass("min-h-(--target)", "min-w-(--target)");
  });
});
