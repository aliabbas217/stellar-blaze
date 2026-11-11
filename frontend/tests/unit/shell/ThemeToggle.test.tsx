import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { THEME_STORAGE_KEY } from "@/components/shell/theme-script";
import arMessages from "../../../messages/ar.json";
import { renderWithIntl } from "../../utils/intl";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("ThemeToggle", () => {
  it("starts on the system default and cycles system, light, dark, system", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Theme: System" });

    await user.click(button);
    expect(button).toHaveTextContent("Theme: Light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await user.click(button);
    expect(button).toHaveTextContent("Theme: Dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await user.click(button);
    expect(button).toHaveTextContent("Theme: System");
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("shows the override the inline script already applied", () => {
    document.documentElement.dataset["theme"] = "dark";
    renderWithIntl(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("Theme: Dark");
  });

  it("still switches for this visit when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const user = userEvent.setup();
    renderWithIntl(<ThemeToggle />);

    await user.click(screen.getByRole("button"));

    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(screen.getByRole("button")).toHaveTextContent("Theme: Light");
  });

  it("names the current mode in the active language", () => {
    renderWithIntl(<ThemeToggle />, { locale: "ar", messages: arMessages });
    expect(screen.getByRole("button")).toHaveTextContent("المظهر: النظام");
  });

  it("is at least 44 px tall by construction (min-h-12, never a fixed height)", () => {
    renderWithIntl(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveClass("min-h-12");
  });
});
