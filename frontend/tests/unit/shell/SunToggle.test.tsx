import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SunToggle } from "@/components/shell/SunToggle";
import { THEME_STORAGE_KEY } from "@/components/shell/theme-script";
import { THEME_COLORS } from "@/lib/sun/theme-colors";
import arMessages from "../../../messages/ar.json";
import { renderWithIntl } from "../../utils/intl";

/*
 * The one tap that overrides sun mode until the next local midnight (DESIGN.md section 6). The toggle owns the
 * { theme, until } value in localStorage["sb-theme"]; the inline script (theme-script.ts) reads it before paint.
 */

function stored(): unknown {
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

/** 2026-11-14 at the given local time, as a Date in the test machine's zone. */
function localTime(hours: number, minutes = 0): Date {
  return new Date(2026, 10, 14, hours, minutes, 0, 0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(localTime(14, 30));
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = THEME_COLORS.night;
  document.head.append(meta);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
  document.head.querySelectorAll("meta[name=theme-color]").forEach((m) => {
    m.remove();
  });
});

describe("SunToggle", () => {
  it("starts on night and says so", () => {
    renderWithIntl(<SunToggle />);
    expect(screen.getByRole("button", { name: "Sun mode: off" })).toBeInTheDocument();
  });

  it("shows the sun the inline script already applied", () => {
    document.documentElement.dataset["theme"] = "sun";
    renderWithIntl(<SunToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("Sun mode: on");
  });

  it("one tap from night turns sun on and stores { theme: sun, until: next local midnight }", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithIntl(<SunToggle />);

    await user.click(screen.getByRole("button"));

    expect(document.documentElement.dataset["theme"]).toBe("sun");
    expect(screen.getByRole("button")).toHaveTextContent("Sun mode: on");
    expect(stored()).toEqual({ theme: "sun", until: new Date(2026, 10, 15, 0, 0, 0, 0).getTime() });
  });

  it("one tap from sun turns night on and stores { theme: night, until: next local midnight }", async () => {
    document.documentElement.dataset["theme"] = "sun";
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithIntl(<SunToggle />);

    await user.click(screen.getByRole("button"));

    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(screen.getByRole("button")).toHaveTextContent("Sun mode: off");
    expect(stored()).toEqual({ theme: "night", until: new Date(2026, 10, 15, 0, 0, 0, 0).getTime() });
  });

  it("expires at midnight, not 24 hours later: a tap at 23:59 lasts one minute", async () => {
    vi.setSystemTime(localTime(23, 59));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithIntl(<SunToggle />);

    await user.click(screen.getByRole("button"));

    expect(stored()).toEqual({ theme: "sun", until: new Date(2026, 10, 15, 0, 0, 0, 0).getTime() });
  });

  it("moves the browser chrome colour with the theme", async () => {
    const themeColor = () => document.head.querySelector<HTMLMetaElement>("meta[name=theme-color]")?.content;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithIntl(<SunToggle />);

    await user.click(screen.getByRole("button"));
    expect(themeColor()).toBe(THEME_COLORS.sun);

    await user.click(screen.getByRole("button"));
    expect(themeColor()).toBe(THEME_COLORS.night);
  });

  it("still switches for this visit when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithIntl(<SunToggle />);

    await user.click(screen.getByRole("button"));

    expect(document.documentElement.dataset["theme"]).toBe("sun");
    expect(screen.getByRole("button")).toHaveTextContent("Sun mode: on");
  });

  it("names the state in the active language", () => {
    renderWithIntl(<SunToggle />, { locale: "ar", messages: arMessages });
    const { current, off } = arMessages.shell.sun;
    expect(screen.getByRole("button")).toHaveTextContent(current.replace("{state}", off));
  });

  it("is at least 44 px tall by construction (min-h from --target, never a fixed height)", () => {
    renderWithIntl(<SunToggle />);
    expect(screen.getByRole("button")).toHaveClass("min-h-(--target)");
  });
});
