import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { routing } from "@/i18n/routing";
import { renderWithIntl } from "../../utils/intl";

// The locale-aware navigation helpers need the Next.js app router; only their contract matters here.
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/worker",
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));

const assign = vi.fn<(url: string) => void>();

beforeEach(() => {
  // A language change is a full page load (see LocaleSwitcher), so it is observed on location.assign.
  vi.stubGlobal("location", { assign, search: "", hash: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("LocaleSwitcher", () => {
  it("offers every locale under its own name, each in its own script", () => {
    renderWithIntl(<LocaleSwitcher />);
    const select = screen.getByRole("combobox", { name: "Language" });
    const options = within(select).getAllByRole("option");

    expect(options.map((o) => o.getAttribute("value"))).toEqual([...routing.locales]);
    expect(options.map((o) => o.getAttribute("lang"))).toEqual([...routing.locales]);
    expect(options.map((o) => o.textContent)).toEqual([
      "English",
      "العربية",
      "اردو",
      "हिन्दी",
      "বাংলা",
      "नेपाली",
    ]);
  });

  it("selects the active locale", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "ur" });
    expect(screen.getByRole("combobox")).toHaveValue("ur");
  });

  it("loads the same page in the chosen locale as a new document", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LocaleSwitcher />);

    await user.selectOptions(screen.getByRole("combobox"), "ar");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/ar/worker");
  });

  it("keeps the query string and the hash", async () => {
    vi.stubGlobal("location", { assign, search: "?site=site-demo-mussafah", hash: "#band" });
    const user = userEvent.setup();
    renderWithIntl(<LocaleSwitcher />);

    await user.selectOptions(screen.getByRole("combobox"), "ur");

    expect(assign).toHaveBeenCalledWith("/ur/worker?site=site-demo-mussafah#band");
  });

  it("is at least 44 px tall by construction (min-h-12, never a fixed height)", () => {
    renderWithIntl(<LocaleSwitcher />);
    expect(screen.getByRole("combobox")).toHaveClass("min-h-12");
  });
});
