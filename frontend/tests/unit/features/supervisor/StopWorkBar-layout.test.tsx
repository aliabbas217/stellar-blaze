import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BAR_CLEARANCE, BAR_HEIGHT_VAR, StopWorkBar } from "@/features/supervisor/StopWorkBar";
import type { StopNotices } from "@/features/supervisor/useStopWork";
import enMessages from "../../../../messages/en.json";

/*
 * The structure the expiry notices need (the visual gate is tests/e2e/supervisor-notice.spec.ts, where the layout is real): the bar
 * publishes its own height on the root so the page can end above it, and the notices scroll inside a capped, focusable region so the
 * Stop button stays on screen however many crews expired. jsdom has no layout, so the height and the observer are stubbed.
 */

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/en/supervisor", useRouter: () => ({ replace: vi.fn() }) }));

let barHeight = 200;
let fire: () => void = () => undefined;
const disconnect = vi.fn();

class FakeObserver {
  constructor(callback: () => void) {
    fire = callback;
  }
  observe = vi.fn();
  disconnect = disconnect;
  unobserve = vi.fn();
}

beforeEach(() => {
  barHeight = 200;
  disconnect.mockClear();
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: this.hasAttribute("data-emergency") ? barHeight : 0, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty(BAR_HEIGHT_VAR);
});

const none: StopNotices = { expired: [], dismissExpired: () => undefined };
const three: StopNotices = {
  expired: [
    { crewId: "crew-a", crewName: "Crew A" },
    { crewId: "crew-c", crewName: "Crew C" },
    { crewId: "crew-d", crewName: "Crew D" },
  ],
  dismissExpired: () => undefined,
};

function wrap(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Dubai">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

const rootHeight = () => document.documentElement.style.getPropertyValue(BAR_HEIGHT_VAR);

describe("the Stop bar's height", () => {
  it("test_bar_publishes_its_height_and_follows_it_and_removes_it_on_unmount", () => {
    const { unmount } = render(wrap(<StopWorkBar crewName={null} work={null} notices={none} noCrew="none" />));
    expect(rootHeight()).toBe("200px");

    barHeight = 496.4; // three notices stacked
    fire();
    expect(rootHeight()).toBe("497px");

    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(rootHeight()).toBe("");
  });

  it("the page clears the bar by the published height, with the old fixed padding as the first-paint fallback", () => {
    expect(BAR_CLEARANCE).toContain(`var(${BAR_HEIGHT_VAR},`);
    expect(BAR_CLEARANCE).toContain("15rem");
  });

  it("without ResizeObserver the first measure still stands and nothing throws", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { unmount } = render(wrap(<StopWorkBar crewName={null} work={null} notices={none} noCrew="none" />));
    expect(rootHeight()).toBe("200px");
    unmount();
    expect(rootHeight()).toBe("");
  });
});

describe("the expiry notices region", () => {
  it("scrolls inside a cap and is a focusable scroll container when there are notices", () => {
    const { container } = render(wrap(<StopWorkBar crewName={null} work={null} notices={three} noCrew="none" />));
    const region = container.querySelector("[data-expired-stops]");
    expect(region).not.toBeNull();
    expect(region?.className).toContain("max-h-[40dvh]");
    expect(region?.className).toContain("overflow-y-auto");
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(region?.getAttribute("role")).toBe("status");
  });

  it("is the same empty live region, with no tab stop and no cap, when there is nothing to say", () => {
    const { container } = render(wrap(<StopWorkBar crewName={null} work={null} notices={none} noCrew="none" />));
    const region = container.querySelector("[data-expired-stops]");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.hasAttribute("tabindex")).toBe(false);
    expect(region?.className ?? "").not.toContain("overflow-y-auto");
  });
});
