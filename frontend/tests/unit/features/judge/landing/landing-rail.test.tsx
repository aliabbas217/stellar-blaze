import { fireEvent, screen } from "@testing-library/react";
import { CHAPTERS, LandingRail } from "@/features/judge/landing/LandingRail";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * The landing's chapter rail on a phone (redesign S14): one slim bar with a menu button that names the chapter in view and opens the seven
 * entries as a sheet. jsdom has no layout, so this tests the behaviour (the state, the names, the keys); the 56 px height, the first screen and
 * the overflow are measured in a real browser by tests/e2e/landing-mobile.spec.ts.
 */

function setup() {
  // jsdom has no layout: say the page is long and we are at its top, so the rail reads chapter 1 and not "at the foot"
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(6000);
  return renderWithIntl(
    <>
      <section data-ch="1" id="forecast" />
      <LandingRail
        language={
          <div className="lang">
            <label htmlFor="lang">Language</label>
            <select id="lang">
              <option>English</option>
            </select>
          </div>
        }
        notice={<p className="mt">notice</p>}
      />
    </>,
  );
}

const button = (): HTMLElement => screen.getByRole("button", { name: /Chapters/ });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the landing rail: the menu on a phone", () => {
  it("has the seven chapters as links, the language picker and the notice inside the one nav, and a menu button that starts closed", () => {
    const { container } = setup();
    const nav = container.querySelector("nav.rail");
    expect(nav).toHaveAttribute("aria-label", "Chapters");
    expect([...(nav?.querySelectorAll(".idx a") ?? [])]).toHaveLength(CHAPTERS.length);
    expect(nav?.querySelector("select")).not.toBeNull();
    expect(nav?.querySelector(".mt")).toHaveTextContent("notice");
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".idx")).toHaveAttribute("data-open", "false");
  });

  it("names the chapter in view in the button's own name, and shows the count 01/07 as decoration", () => {
    setup();
    expect(button()).toHaveAccessibleName("Chapters: Forecast");
    expect(button()).toHaveTextContent("01/07");
    expect(button().querySelector(".cnt")).toHaveAttribute("aria-hidden", "true");
  });

  it("opens and closes with the button, and the button's aria-controls is the list", () => {
    const { container } = setup();
    fireEvent.click(button());
    expect(button()).toHaveAttribute("aria-expanded", "true");
    const list = container.querySelector(".idx");
    expect(list).toHaveAttribute("data-open", "true");
    expect(list?.id).toBe(button().getAttribute("aria-controls"));
    fireEvent.click(button());
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a chosen chapter, on Escape (and the focus goes back to the button) and on a press outside", () => {
    const { container } = setup();
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("link", { name: /Plan/ }));
    expect(button()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button());
    screen.getByRole("link", { name: /Morning/ }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(button()).toHaveFocus();

    fireEvent.click(button());
    fireEvent.pointerDown(container.ownerDocument.body);
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("marks exactly one chapter as current in the list and in the strip along the bar's foot", () => {
    const { container } = setup();
    expect(container.querySelectorAll('.idx a[aria-current="true"]')).toHaveLength(1);
    const states = [...container.querySelectorAll(".prog i")].map((i) => i.getAttribute("data-state"));
    expect(states).toHaveLength(CHAPTERS.length);
    expect(states.filter((s) => s === "now")).toHaveLength(1);
    expect(container.querySelector(".prog")).toHaveAttribute("aria-hidden", "true");
  });
});
