import { act, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BAR_CLEARANCE, BAR_HEIGHT_VAR, StopWorkBar } from "@/features/supervisor/StopWorkBar";
import type { StopNotices, StopWorkOf } from "@/features/supervisor/useStopWork";
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
    { crewId: "crew-a", crewName: "Crew A", kind: "lapsed" },
    { crewId: "crew-c", crewName: "Crew C", kind: "lapsed" },
    { crewId: "crew-d", crewName: "Crew D", kind: "clock" },
  ],
  dismissExpired: () => undefined,
};
const one: StopNotices = { expired: [{ crewId: "crew-a", crewName: "Crew A", kind: "lapsed" }], dismissExpired: () => undefined };

const idleWork: StopWorkOf = {
  crewId: "crew-a",
  state: "idle",
  stopId: null,
  undoSecondsLeft: 0,
  at: null,
  failure: null,
  undoFailed: false,
  resumeFailed: false,
  noActiveStop: false,
  busy: false,
  stop: () => undefined,
  undo: () => undefined,
  resume: () => undefined,
  expired: [],
  dismissExpired: () => undefined,
};
/** The bar's one action button: the last button of the bar that is not a notice's Close. */
const screenStop = (container: HTMLElement): Element | undefined =>
  [...container.querySelectorAll("[data-emergency] button")].filter((button) => button.closest("[data-expired-stop]") === null).at(-1);

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
  it("several notices scroll inside a cap and the region is a focusable scroll container", () => {
    const { container } = render(wrap(<StopWorkBar crewName={null} work={null} notices={three} noCrew="none" />));
    const region = container.querySelector("[data-expired-stops]");
    expect(region).not.toBeNull();
    expect(region?.className).toContain("max-h-[40dvh]");
    expect(region?.className).toContain("overflow-y-auto");
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(region?.getAttribute("role")).toBe("status");
  });

  it("ONE notice has no cap of its own (it shows whole whenever the screen has room) and no tab stop; it only gives way when the bar would not fit", () => {
    const { container } = render(wrap(<StopWorkBar crewName={null} work={null} notices={one} noCrew="none" />));
    const region = container.querySelector("[data-expired-stops]");
    expect(region?.textContent).toContain("Stop for Crew A was not sent.");
    expect(region?.className).not.toContain("max-h-");
    expect(region?.hasAttribute("tabindex")).toBe(false);
  });

  it("the bar never outgrows the screen: it is capped at the viewport, and the notices region is the part that gives way (and scrolls)", () => {
    for (const notices of [one, three]) {
      const { container, unmount } = render(wrap(<StopWorkBar crewName="Crew A" work={idleWork} notices={notices} noCrew="none" />));
      const bar = container.querySelector("[data-emergency]");
      const inner = bar?.firstElementChild;
      const region = container.querySelector("[data-expired-stops]");
      expect(inner?.className).toContain("max-h-dvh");
      expect(inner?.className).toContain("flex-col");
      expect(region?.className).toContain("min-h-0");
      expect(region?.className).toContain("overflow-y-auto");
      // The region gives way long before the state line does, and the Stop button never does.
      expect(region?.className).toContain("shrink-[1000]");
      expect(screenStop(container)?.className).toContain("shrink-0");
      unmount();
    }
  });

  it("the state line (Not sent) shrinks only after the notices are gone: it is a scroll container too, the Stop button is not", () => {
    const { container } = render(wrap(<StopWorkBar crewName="Crew A" work={{ ...idleWork, state: "queued", at: "2026-09-03T07:10:00Z" }} notices={none} noCrew="none" />));
    const state = container.querySelector('[role="alert"]');
    expect(state?.className).toContain("min-h-0");
    expect(state?.className).toContain("overflow-y-auto");
    expect(state?.className).not.toContain("shrink-0");
  });

  it("each Close is a full row UNDER its notice text (not a column beside it), at least 44 px high, and still described by its own sentence", () => {
    const { container } = render(wrap(<StopWorkBar crewName={null} work={null} notices={three} noCrew="none" />));
    const notices = [...container.querySelectorAll("[data-expired-stop]")];
    expect(notices).toHaveLength(3);
    for (const notice of notices) {
      const [text, close] = [...notice.children];
      expect(text?.tagName).toBe("P");
      expect(close?.tagName).toBe("BUTTON");
      expect(notice.className).toContain("flex-col");
      expect(notice.className).not.toContain("justify-between");
      expect(close?.className).toContain("w-full");
      expect(close?.className).toContain("min-h-(--target)");
      expect(close?.getAttribute("aria-describedby")).toBe(text?.id);
    }
  });

  it("the second reason has its own sentence: the clock notice never says the stop waited 60 minutes", () => {
    const { container } = render(wrap(<StopWorkBar crewName={null} work={null} notices={three} noCrew="none" />));
    const clock = container.querySelector('[data-expired-kind="clock"]');
    const lapsed = container.querySelector('[data-expired-kind="lapsed"]');
    expect(clock?.textContent).toContain("looked wrong");
    expect(clock?.textContent).not.toContain("60 minutes");
    expect(lapsed?.textContent).toContain("waited 60 minutes");
  });

  it("is the same empty live region, with no tab stop and no cap, when there is nothing to say", () => {
    const { container } = render(wrap(<StopWorkBar crewName={null} work={null} notices={none} noCrew="none" />));
    const region = container.querySelector("[data-expired-stops]");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.hasAttribute("tabindex")).toBe(false);
    expect(region?.className ?? "").not.toContain("overflow-y-auto");
  });
});

describe("focus when a notice vanishes by itself (round 3, item 5)", () => {
  /** A bar whose notices the test can remove from outside, as the hook does when a stop is recorded or the crews list shows the crew stopped. */
  async function setup(): Promise<{ remove: (crewId: string) => void; stop: HTMLElement }> {
    const { useState } = await import("react");
    const { screen } = await import("@testing-library/react");
    let remove: (crewId: string) => void = () => undefined;
    function Harness() {
      const [expired, setExpired] = useState<StopNotices["expired"]>(three.expired);
      remove = (crewId) => {
        setExpired((known) => known.filter((notice) => notice.crewId !== crewId));
      };
      return (
        <StopWorkBar
          crewName="Crew A"
          work={{ crewId: "crew-a", state: "idle", stopId: null, undoSecondsLeft: 0, at: null, failure: null, undoFailed: false, resumeFailed: false, noActiveStop: false, busy: false, stop: () => undefined, undo: () => undefined, resume: () => undefined, expired: [], dismissExpired: () => undefined }}
          notices={{ expired, dismissExpired: () => undefined }}
          noCrew="none"
        />
      );
    }
    render(wrap(<Harness />));
    return { remove: (crewId) => { act(() => { remove(crewId); }); }, stop: screen.getByRole("button", { name: /^Stop work/ }) };
  }
  const closeOf = (crewId: string): HTMLElement =>
    within(document.querySelector<HTMLElement>(`[data-expired-stop="${crewId}"]`) as HTMLElement).getByRole("button", { name: "Close" });

  it("a notice that disappears while its Close has focus hands focus to the bar's Stop button, never <body>", async () => {
    const { remove, stop } = await setup();
    const user = userEvent.setup();
    // Tab from the top of the page to Crew C's Close, as a keyboard user would.
    for (let presses = 0; presses < 8 && document.activeElement !== closeOf("crew-c"); presses += 1) await user.tab();
    expect(document.activeElement).toBe(closeOf("crew-c"));

    remove("crew-c");

    expect(document.querySelector('[data-expired-stop="crew-c"]')).toBeNull();
    expect(document.activeElement).toBe(stop);
  });

  it("a notice that disappears while focus is elsewhere leaves focus where it is", async () => {
    const { remove, stop } = await setup();
    closeOf("crew-a").focus();

    remove("crew-c");

    expect(document.activeElement).toBe(closeOf("crew-a"));
    expect(document.activeElement).not.toBe(stop);
  });
});

describe("a held Enter never presses Stop after the last Close hands it focus (round 3, item 6)", () => {
  async function setup() {
    const { useState } = await import("react");
    const { screen } = await import("@testing-library/react");
    const stop = vi.fn();
    function Harness() {
      const [expired, setExpired] = useState<StopNotices["expired"]>(one.expired);
      return (
        <StopWorkBar
          crewName="Crew A"
          work={{ crewId: "crew-a", state: "idle", stopId: null, undoSecondsLeft: 0, at: null, failure: null, undoFailed: false, resumeFailed: false, noActiveStop: false, busy: false, stop, undo: () => undefined, resume: () => undefined, expired: [], dismissExpired: () => undefined }}
          notices={{ expired, dismissExpired: () => { setExpired([]); } }}
          noCrew="none"
        />
      );
    }
    render(wrap(<Harness />));
    return { stop, button: screen.getByRole("button", { name: /^Stop work/ }), close: screen.getByRole("button", { name: "Close" }) };
  }

  it("one held Enter on Close closes the notice, moves focus to Stop, and the repeats do NOT press Stop", async () => {
    const { stop, button, close } = await setup();
    const user = userEvent.setup();
    close.focus();

    await user.keyboard("{Enter>4}");
    expect(document.activeElement).toBe(button);
    expect(stop).not.toHaveBeenCalled();

    // The key is still down: releasing it does not press Stop either, and a FRESH press does.
    await user.keyboard("{/Enter}");
    expect(stop).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("one held Enter on Stop itself presses it at most once (the repeats are ignored)", async () => {
    const { stop, button, close } = await setup();
    const user = userEvent.setup();
    await user.click(close);
    button.focus();

    await user.keyboard("{Enter>4}");
    await user.keyboard("{/Enter}");

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("Space is untouched: it presses Stop on key up, once", async () => {
    const { stop, button } = await setup();
    const user = userEvent.setup();
    button.focus();

    await user.keyboard(" ");

    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("focus after the last notice closes, with no crew to stop", () => {
  it("goes to the bar's own line (a programmatic focus target), not to <body>", async () => {
    const { useState } = await import("react");
    const { default: userEvent } = await import("@testing-library/user-event");
    const { screen } = await import("@testing-library/react");
    function Harness() {
      const [expired, setExpired] = useState<StopNotices["expired"]>(one.expired);
      return (
        <StopWorkBar
          crewName={null}
          work={null}
          notices={{ expired, dismissExpired: () => { setExpired([]); } }}
          noCrew="none"
        />
      );
    }
    render(wrap(<Harness />));

    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));

    expect(document.activeElement).toBe(screen.getByText(enMessages.supervisor.stop.noCrews));
  });
});
