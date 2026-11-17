import { act, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../../../messages/en.json";
import { StationLabels } from "@/features/judge/landing/StationLabels";

/*
 * Fix round 3, minor 3: the station names are re-checked against the obstacles when the layout moves under them. The stage and the
 * hero were observed; the readout card was not, though it is what grows (a card that wraps to another line at 1100 px and wider
 * pushes up over the east names). The card is observed too.
 */

const rect = (x: number, y: number, w: number, h: number): DOMRect => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) });

interface FakeObserver {
  readonly targets: Element[];
  fire: () => void;
}
const observers: FakeObserver[] = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly targets: Element[] = [];
      constructor(readonly callback: () => void) {
        observers.push(this);
      }
      observe(el: Element): void {
        this.targets.push(el);
      }
      disconnect(): void {
        this.targets.length = 0;
      }
      fire(): void {
        this.callback();
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StationLabels watches the stage and the hero", () => {
  it("test_control_growing_refreshes_avoidance: the stage and the hero are observed, and when a control marked data-avoid grows over a name the name is hidden", () => {
    document.body.innerHTML = `<section data-landing-hero><div data-field-stage></div><div data-avoid></div></section>`;
    const stage = document.querySelector("[data-field-stage]") as HTMLElement;
    const card = document.querySelector("[data-avoid]") as HTMLElement;
    let cardBox = rect(700, 500, 300, 100); // a card of two lines: at the foot of the stage, clear of the name
    stage.getBoundingClientRect = () => rect(0, 0, 1000, 600);
    card.getBoundingClientRect = () => cardBox;
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Dubai">
        <StationLabels labels={[{ code: "OMAA", x: 800, y: 420 }]} />
      </NextIntlClientProvider>,
      { container: stage },
    );
    const name = stage.querySelector("[data-station-label]") as HTMLElement;
    expect(name.style.visibility).toBe("");
    expect(observers.flatMap((o) => o.targets)).toContain(stage);
    expect(observers.flatMap((o) => o.targets)).toContain(document.querySelector("[data-landing-hero]"));
    cardBox = rect(700, 380, 300, 220); // the card wrapped to more lines and grew upward over the name
    act(() => {
      for (const o of observers) o.fire();
    });
    expect(name.style.visibility).toBe("hidden");
    cardBox = rect(700, 500, 300, 100);
    act(() => {
      for (const o of observers) o.fire();
    });
    expect(name.style.visibility).toBe("");
  });
});
