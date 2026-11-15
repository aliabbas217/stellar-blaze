import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { http, HttpResponse } from "msw/http";
import type { ReactNode } from "react";
import en from "../../../../messages/en.json";
import { enqueueStop, pendingStops } from "@/features/supervisor/stop-outbox";
import { clearStop, createStop, crewStops, resetDemoState } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderCrews, stopBar, textOf, installSupervisorTestEnvironment } from "./support";

/*
 * Stop work on the crews screen (F2 Task 19), through the whole screen: the safety action's behaviour in every state, against
 * MSW. The focal crew is Crew A (all four crews tie at 11:10 and the API's order breaks the tie). The mock records a stop at
 * the replay clock, 11:10, so the words read "stopped 11:10". The 10 second window is driven by a fake Date and interval.
 */

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/en/supervisor",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/supervisor",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

installSupervisorTestEnvironment();
beforeEach(() => {
  search = "";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const STOP_ROUTE = "*/api/v1/crews/:crew_id/stops";
const press = () => screen.findByRole("button", { name: "Stop work, Crew A" });
const problem429 = (): Response =>
  HttpResponse.json(
    { type: "urn:stellar-blaze:problem:rate-limited", title: "Too many requests", status: 429, request_id: "req-429" },
    { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "5" } },
  );

/**
 * The one sentence about when crews hear of a stop (ADR 0058, second entry: the default dispatch cadence, a promise about WHEN and
 * never a delivery claim). Every other sentence is held to the delivery words below.
 */
const NOTIFY_WINDOW = "Crews are notified within about six minutes.";

/** Words the bar must never use: the API records a stop, it alerts nobody itself, and nothing is "immediate" (ADR 0058). */
const DELIVERY_CLAIM = /alerted|alerting|notified|notifying|phones|delivered|informed|reached|immediately|instantly|right away/i;

/** `text` without the one allowed sentence, for the delivery-word checks. */
const withoutWindow = (text: string): string => text.replaceAll(NOTIFY_WINDOW, "");

function barText(): string {
  return textOf(stopBar());
}

/** Waits until the bar says `text` (the bar's sentences are spread over <bdi> elements, so a text query on one element cannot see them). */
async function barSays(text: string): Promise<void> {
  await waitFor(() => {
    expect(barText()).toContain(text);
  });
}

describe("Stop work: structure", () => {
  it("is ink, outside any form, in the emergency slot, and a plain button that is never disabled (idle)", async () => {
    renderCrews();
    const button = await press();

    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("disabled");
    expect(button.closest("form")).toBeNull();
    expect(stopBar().closest("form")).toBeNull();
    expect(stopBar()).toHaveAttribute("data-emergency");
    expect(button.className).toContain("bg-ink");
    // Stop work has no confirm dialog: one press records it.
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("test_stop_never_disabled: sending (the press is in flight), and a second press is ignored without disabling anything", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    server.use(
      http.post(STOP_ROUTE, async () => {
        posts += 1;
        await gate;
        return HttpResponse.json({ id: "stop-9001", crew_id: "crew-a", started_at: "2026-09-03T07:10:00Z", cleared_at: null }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderCrews();
    const button = await press();

    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(button).toBeEnabled();
    expect(within(stopBar()).getByRole("button", { name: "Stop work, Crew A" })).toBe(button);
    await user.click(button);

    release();
    await barSays("Stop recorded");
    expect(posts).toBe(1);
  });

  it("test_stop_never_disabled: with the crews list failed, a day plan that failed its validator, and offline", async () => {
    server.use(http.get("*/api/v1/crews/:crew_id/day-plan", () => HttpResponse.json({ type: "urn:x", title: "Shift not legal", status: 422 }, { status: 422 })));
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal("indexedDB", new IDBFactory());
    renderCrews();
    const button = await press();

    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("disabled");
  });

  it("stops the crew while the day plan failed: a plan that does not validate never gates a stop", async () => {
    server.use(http.get("*/api/v1/crews/:crew_id/day-plan", () => HttpResponse.json({ type: "urn:x", title: "Shift not legal", status: 422 }, { status: 422 })));
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());

    await barSays("Stop recorded");
    expect(crewStops("crew-a")).toHaveLength(1);
  });
});

describe("Stop work: recorded, undo, resume", () => {
  it("records the stop and says so in the words of the ruling: 'Stop recorded.', the six-minute window, 'Tell the crew now.', with a 10 s Undo", async () => {
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());

    await barSays("Crew A stopped 11:10. Stop recorded. Crews are notified within about six minutes. Tell the crew now.");
    expect(screen.getByRole("button", { name: "Undo (10 s)" })).toBeInTheDocument();
    expect(crewStops("crew-a")).toHaveLength(1);
    expect(stopBar()).toHaveAttribute("data-stop-state", "undo");
  });

  it("test_stop_undo_calls_delete_within_10s: Undo clears the stop on the API and the bar is back to Stop work", async () => {
    const user = userEvent.setup();
    renderCrews();
    await user.click(await press());
    await user.click(await screen.findByRole("button", { name: /^Undo/ }));

    expect(await press()).toBeEnabled();
    expect(crewStops("crew-a")[0]?.cleared_at).not.toBeNull();
    expect(barText()).not.toContain("Stop recorded");
  });

  it("after 10 s the bar reads 'Work stopped 11:10' with a secondary 'Resume work', and no Undo", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-03T07:10:00Z"));
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderCrews();
    await user.click(await press());
    expect(await screen.findByRole("button", { name: /^Undo/ })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(barText()).toContain("Work stopped 11:10");
    });
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
    expect(within(stopBar()).getByRole("button", { name: "Resume work" })).toBeInTheDocument();
    expect(stopBar()).toHaveAttribute("data-stop-state", "stopped");
  });

  it("the undo counts down each second", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-03T07:10:00Z"));
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderCrews();
    await user.click(await press());
    expect(await screen.findByRole("button", { name: "Undo (10 s)" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: "Undo (6 s)" })).toBeInTheDocument();
  });

  it("a stop already active on the API (a reload, another phone) reads 'Work stopped' with Resume work and no Undo", async () => {
    createStop("crew-a");
    renderCrews();

    await waitFor(() => {
      expect(barText()).toContain("Work stopped 11:10");
    });
    expect(within(stopBar()).getByRole("button", { name: "Resume work" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("Resume work is behind a confirm dialog whose default is 'Keep work stopped'; confirming clears the stop (DELETE)", async () => {
    createStop("crew-a");
    const user = userEvent.setup();
    renderCrews();
    await user.click(await within(await waitForBar()).findByRole("button", { name: "Resume work" }));

    const dialog = await screen.findByRole("dialog", { name: "Resume work for Crew A?" });
    expect(textOf(dialog)).toContain("This ends the stop recorded at 11:10.");
    expect(within(dialog).getByRole("button", { name: "Keep work stopped" })).toHaveFocus();

    // Cancelling changes nothing on the API.
    await user.click(within(dialog).getByRole("button", { name: "Keep work stopped" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(crewStops("crew-a")[0]?.cleared_at).toBeNull();

    await user.click(within(stopBar()).getByRole("button", { name: "Resume work" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume work" }));

    expect(await press()).toBeEnabled();
    expect(crewStops("crew-a")[0]?.cleared_at).not.toBeNull();
  });

  it("a resume that was not sent says so and the stop still stands", async () => {
    createStop("crew-a");
    server.use(http.delete("*/api/v1/crews/:crew_id/stops/:stop_id", () => HttpResponse.json({ type: "urn:x", title: "Boom", status: 500 }, { status: 500 })));
    const user = userEvent.setup();
    renderCrews();
    await user.click(await within(await waitForBar()).findByRole("button", { name: "Resume work" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume work" }));

    expect(await screen.findByText("Resume was not sent. Try again.")).toBeInTheDocument();
    expect(barText()).toContain("Work stopped 11:10");
  });
});

describe("Stop work: a resume or undo that finds no stop (404)", () => {
  const gone = () =>
    HttpResponse.json(
      { type: "urn:stellar-blaze:problem:not-found", title: "Not found", status: 404, request_id: "req-404" },
      { status: 404, headers: { "content-type": "application/problem+json" } },
    );

  it("test_resume_404_is_neutral_and_refetches: 'No active stop found', never 'Resumed', and the crew list is asked again", async () => {
    createStop("crew-a");
    let crewListRequests = 0;
    server.events.on("request:start", ({ request }) => {
      if (/\/api\/v1\/sites\/[^/]+\/crews$/.test(new URL(request.url).pathname)) crewListRequests += 1;
    });
    const user = userEvent.setup();
    renderCrews();
    await user.click(await within(await waitForBar()).findByRole("button", { name: "Resume work" }));
    const before = crewListRequests;
    // The stop vanished on the server (a demo reset starts a new epoch): the DELETE answers 404 and the list no longer shows it.
    resetDemoState("site-demo-mussafah");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume work" }));

    await barSays("No active stop found for this crew (already resumed, or the demo was reset)");
    // Server truth: the refetched list says nothing is stopped, so the bar is the Stop work button again, with the notice beside it.
    expect(await press()).toBeEnabled();
    expect(crewListRequests).toBeGreaterThan(before);
    expect(screen.queryByRole("button", { name: "Resume work" })).toBeNull();
    expect(barText()).toContain("No active stop found for this crew");
    // The notice is not a failure message and not a success message.
    expect(barText()).not.toContain("Resume was not sent");
    expect(barText()).not.toMatch(/\bResumed\b/);
  });

  it("an undo that finds no stop reads the same neutral line, not 'Undo was not sent'", async () => {
    server.use(http.delete("*/api/v1/crews/:crew_id/stops/:stop_id", gone));
    const user = userEvent.setup();
    renderCrews();
    await user.click(await press());
    await user.click(await screen.findByRole("button", { name: /^Undo/ }));

    await barSays("No active stop found for this crew");
    expect(barText()).not.toContain("Undo was not sent");
  });

  it("the notice is for the stop that is gone: a new Stop press clears it", async () => {
    createStop("crew-a");
    const user = userEvent.setup();
    renderCrews();
    await user.click(await within(await waitForBar()).findByRole("button", { name: "Resume work" }));
    resetDemoState("site-demo-mussafah");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume work" }));
    await barSays("No active stop found for this crew");

    await user.click(await press());

    await barSays("Stop recorded.");
    expect(barText()).not.toContain("No active stop found");
  });
});

async function waitForBar(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(barText()).toContain("Work stopped");
  });
  return stopBar();
}

describe("Stop work: never shown as delivered when it was not", () => {
  it("test_stop_copy_never_claims_delivery: no state of the bar uses a delivery word, and the catalogue has none", async () => {
    const user = userEvent.setup();
    renderCrews();
    const states: string[] = [barText()];
    await user.click(await press());
    await barSays("Stop recorded");
    states.push(barText());
    await user.click(screen.getByRole("button", { name: /^Undo/ }));
    await press();
    server.use(http.post(STOP_ROUTE, () => problem429()));
    await user.click(await press());
    await barSays("Not sent. Tell the crew now.");
    states.push(barText());

    for (const text of states) expect(withoutWindow(text)).not.toMatch(DELIVERY_CLAIM);
    // And the catalogue itself, every string the bar can say.
    for (const [key, value] of Object.entries(en.supervisor.stop)) {
      expect(withoutWindow(value), `supervisor.stop.${key}`).not.toMatch(DELIVERY_CLAIM);
    }
  });

  it("test_stop_copy_names_the_six_minute_window: 'Stop recorded.' then the window then 'Tell the crew now.', in the undo window and after it, never 'immediately'", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-03T07:10:00Z"));
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderCrews();
    await user.click(await press());
    await screen.findByRole("button", { name: /^Undo/ });
    const order = /Stop recorded\. Crews are notified within about six minutes\. Tell the crew now\./;
    expect(barText()).toMatch(order);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(barText()).toContain("Work stopped 11:10");
    });
    expect(barText()).toMatch(order);
    expect(barText()).not.toMatch(/immediately|instantly|alerted|delivered/i);
    // The catalogue: the window is in exactly the two lines that say a stop was recorded, with the same words.
    expect(en.supervisor.stop.recorded).toContain(NOTIFY_WINDOW);
    expect(en.supervisor.stop.stoppedDetail).toContain(NOTIFY_WINDOW);
  });

  it("test_offline_stop_goes_to_outbox_and_reads_not_sent: no request is made, the row is the crew id and time, the words are 'Not sent: no signal'", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    let posts = 0;
    server.use(
      http.post(STOP_ROUTE, () => {
        posts += 1;
        return problem429();
      }),
    );
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());

    await barSays("Not sent: no signal. Tell the crew now.");
    expect(barText()).toContain("The stop for Crew A is kept on this phone and sent when it is back online.");
    expect(barText()).not.toMatch(/Stop recorded|stopped/i);
    expect(withoutWindow(barText())).not.toMatch(DELIVERY_CLAIM);
    // Nothing was recorded, so nothing is promised: the six-minute window belongs to a recorded stop only.
    expect(barText()).not.toContain("six minutes");
    expect(posts).toBe(0);
    const rows = await pendingStops(factory);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["clientTime", "crewId", "key"]);
    expect(rows[0]?.crewId).toBe("crew-a");
    // The button is still there and enabled.
    expect(await press()).toBeEnabled();

    // The signal returns: the row is sent, removed, and only then is the stop recorded.
    server.resetHandlers();
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(barText()).toContain("Work stopped 11:10");
    });
    expect(crewStops("crew-a")).toHaveLength(1);
    expect(await pendingStops(factory)).toEqual([]);
  });

  it("pressed again while its stop is already kept and there is still no signal, it keeps one row, not two", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());
    await barSays("Not sent: no signal. Tell the crew now.");
    await user.click(await press());
    await user.click(await press());

    expect(await pendingStops(factory)).toHaveLength(1);
    expect(await press()).toBeEnabled();
  });

  it("a request that fails with no answer, while the browser still says online, is kept and read as 'Not sent: no signal'", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    server.use(http.post(STOP_ROUTE, () => HttpResponse.error()));
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());

    await barSays("Not sent: no signal. Tell the crew now.");
    expect(await pendingStops(factory)).toHaveLength(1);
  });

  it("a stop waiting in the outbox when the app opens is sent then, and recorded only after the API answered", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    await enqueueStop("crew-a", new Date("2026-09-03T07:05:00Z"), factory);
    renderCrews();

    await waitFor(() => {
      expect(crewStops("crew-a")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(barText()).toContain("Work stopped 11:10");
    });
    expect(await pendingStops(factory)).toEqual([]);
  });

  it("a stop the API keeps refusing (429) stays in the outbox and is not reported sent", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    await enqueueStop("crew-a", new Date("2026-09-03T07:05:00Z"), factory);
    server.use(http.post(STOP_ROUTE, () => problem429()));
    renderCrews();
    await press();

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await pendingStops(factory)).toHaveLength(1);
    expect(barText()).not.toContain("Work stopped");
  });

  it("a 429 on Stop reads 'Not sent. Tell the crew now.', is not queued, and the button stays enabled to try again", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    server.use(http.post(STOP_ROUTE, () => problem429()));
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());

    await barSays("Not sent. Tell the crew now.");
    expect(screen.getByText("Press Stop work to try again.")).toBeInTheDocument();
    expect(await pendingStops(factory)).toEqual([]);
    expect(await press()).toBeEnabled();
    expect(crewStops("crew-a")).toHaveLength(0);

    // Trying again once the limit lifts records it.
    server.resetHandlers();
    await user.click(await press());
    await barSays("Stop recorded");
  });

  it("a stop that cannot even be kept (no IndexedDB) is 'Not sent', never 'queued'", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());

    await barSays("Not sent. Tell the crew now.");
    expect(screen.queryByText(/no signal/)).toBeNull();
  });
});

describe("Stop work: it stays with the crew it was pressed for", () => {
  it("while a stop is under way the bar stays on that crew even when the ranking moves", async () => {
    search = "at=09:30";
    const user: UserEvent = userEvent.setup();
    renderCrews();

    await user.click(await press());

    // The stop turns Crew A red, which keeps it first; the bar is still Crew A's.
    await barSays("Crew A stopped");
    expect(crewStops("crew-a")).toHaveLength(1);
    expect(crewStops("crew-b")).toHaveLength(0);
  });
});

describe("Stop work: a request that hangs never leaves the bar on 'sending' (W5 I1)", () => {
  /**
   * `AbortSignal.timeout` runs on an internal timer that fake timers cannot advance (see proxy.test.ts), so the test hands the
   * client a signal it fires itself: "the timeout elapses" is one call. The requested durations are recorded.
   */
  function controlledTimeouts(): { fire: () => void; asked: number[] } {
    const controllers: AbortController[] = [];
    const asked: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      asked.push(ms);
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    return {
      asked,
      fire: () => {
        for (const controller of controllers) controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
      },
    };
  }
  const hang = (): Promise<never> => new Promise<never>(() => undefined);

  it("a stop whose request never answers reads 'Not sent: no signal' after the timeout, is kept in the outbox, and a second press works", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    const timeouts = controlledTimeouts();
    server.use(http.post(STOP_ROUTE, hang));
    const user = userEvent.setup();
    renderCrews();
    const button = await press();

    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    // The stop request carries a bounded signal: a named, finite duration of a few seconds, never none.
    expect(timeouts.asked).toHaveLength(1);
    expect(timeouts.asked[0]).toBeGreaterThan(0);
    expect(timeouts.asked[0]).toBeLessThanOrEqual(10_000);

    timeouts.fire();

    await barSays("Not sent: no signal. Tell the crew now.");
    expect(button).not.toHaveAttribute("aria-busy", "true");
    expect(await pendingStops(factory)).toHaveLength(1);
    expect(barText()).not.toMatch(/Stop recorded|stopped/i);

    // A second press is not swallowed by the dead request: it goes out, and once the API answers the stop is recorded.
    server.resetHandlers();
    await user.click(await press());
    await barSays("Stop recorded");
    expect(crewStops("crew-a")).toHaveLength(1);
    // The row was for the same stop: it is gone once the stop is recorded, so it cannot start the crew again later.
    await waitFor(async () => {
      expect(await pendingStops(factory)).toEqual([]);
    });
  });

  it("a stop that reached the server before the client gave up is shown from the server's answer, not doubled", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    const timeouts = controlledTimeouts();
    server.use(
      http.post(STOP_ROUTE, () => {
        createStop("crew-a");
        return hang();
      }),
    );
    const user = userEvent.setup();
    renderCrews();

    await user.click(await press());
    await waitFor(() => {
      expect(crewStops("crew-a")).toHaveLength(1);
    });
    timeouts.fire();

    // The refetch after the timeout reads the stop the server did record: the bar reads it as a stop, not as "queued".
    await barSays("Work stopped 11:10");
    expect(crewStops("crew-a")).toHaveLength(1);
  });

  it("an undo or resume whose request hangs is 'not sent' after its own timeout and the stop still stands", async () => {
    createStop("crew-a");
    const timeouts = controlledTimeouts();
    server.use(http.delete("*/api/v1/crews/:crew_id/stops/:stop_id", hang));
    const user = userEvent.setup();
    renderCrews();
    await user.click(await within(await waitForBar()).findByRole("button", { name: "Resume work" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume work" }));
    await waitFor(() => {
      expect(timeouts.asked.length).toBeGreaterThan(0);
    });
    // Longer than the stop's: resume is the opposite risk and may take the slower path, but it is bounded too.
    expect(Math.max(...timeouts.asked)).toBeGreaterThan(8_000);
    expect(Math.max(...timeouts.asked)).toBeLessThanOrEqual(30_000);

    timeouts.fire();

    expect(await screen.findByText("Resume was not sent. Try again.")).toBeInTheDocument();
    expect(barText()).toContain("Work stopped 11:10");
  });
});

describe("Stop work: a stop kept in the outbox is still 'Not sent' after a reload (W5 I2)", () => {
  it("with no signal and a row already waiting, the bar opens on 'Not sent: no signal', and pressing again writes no second row", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    await enqueueStop("crew-a", new Date("2026-09-03T07:05:00Z"), factory);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const user = userEvent.setup();
    renderCrews();

    await press();
    await barSays("Not sent: no signal. Tell the crew now.");
    expect(barText()).toContain("The stop for Crew A is kept on this phone and sent when it is back online.");
    expect(stopBar()).toHaveAttribute("data-stop-state", "queued");

    await user.click(await press());
    await user.click(await press());

    expect(await pendingStops(factory)).toHaveLength(1);
    expect(await press()).toBeEnabled();
    expect(stopBar()).toHaveAttribute("data-stop-state", "queued");
  });

  it("online with the API refusing the waiting row (429), the bar reads 'Not sent' instead of a plain idle button", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    await enqueueStop("crew-a", new Date("2026-09-03T07:05:00Z"), factory);
    server.use(http.post(STOP_ROUTE, () => problem429()));
    renderCrews();

    await barSays("Not sent: no signal. Tell the crew now.");
    expect(await pendingStops(factory)).toHaveLength(1);
  });

  it("enqueueStop keeps one row per crew even when two presses race", async () => {
    const factory = new IDBFactory();
    await Promise.all([
      enqueueStop("crew-a", new Date("2026-09-03T07:05:00Z"), factory),
      enqueueStop("crew-a", new Date("2026-09-03T07:05:01Z"), factory),
      enqueueStop("crew-b", new Date("2026-09-03T07:05:02Z"), factory),
    ]);

    const rows = await pendingStops(factory);
    expect(rows.map((row) => row.crewId).sort()).toEqual(["crew-a", "crew-b"]);
  });

  it("a drain that finishes after the bar moved to the focal crew reconciles on that crew: it refreshes and reads the recorded stop", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    await enqueueStop("crew-a", new Date("2026-09-03T07:05:00Z"), factory);
    // The drain starts while the demo's stand-in crew (crew-b) is the bar's crew; the POST answers only once the crew list has
    // arrived and the focal crew (Crew A) has taken over, so the drain's own effect run is no longer the live one.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(STOP_ROUTE, async ({ params }) => {
        await gate;
        return HttpResponse.json(createStop(String(params["crew_id"])), { status: 201 });
      }),
    );
    renderCrews();
    await press();
    release();

    await barSays("Work stopped 11:10");
    expect(crewStops("crew-a")).toHaveLength(1);
    expect(await pendingStops(factory)).toEqual([]);
  });
});

describe("Stop work: Resume sends the server's stop id when another phone re-stopped (W5 minor)", () => {
  it("after another phone resumed and stopped again, Resume clears the NEW stop, not the stale id this phone remembers", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-03T07:10:00Z"));
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const deletes: string[] = [];
    let listRequests = 0;
    server.events.on("request:start", ({ request }) => {
      if (request.method === "DELETE") deletes.push(new URL(request.url).pathname.split("/").pop() ?? "");
      if (/\/api\/v1\/sites\/[^/]+\/crews$/.test(new URL(request.url).pathname)) listRequests += 1;
    });
    renderCrews();
    await user.click(await press());
    await screen.findByRole("button", { name: /^Undo/ });
    const first = crewStops("crew-a")[0]?.id;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(barText()).toContain("Work stopped 11:10");
    });

    // Another phone resumes and stops again; this phone's list refetches (the data is older than the stale time by now).
    clearStop("crew-a", first ?? "");
    const second = createStop("crew-a").id;
    expect(second).not.toBe(first);
    const before = listRequests;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(listRequests).toBeGreaterThan(before);
    });
    // Let the refetched list land in the screen before Resume is pressed.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await user.click(within(stopBar()).getByRole("button", { name: "Resume work" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume work" }));

    await waitFor(() => {
      expect(deletes).toEqual([second]);
    });
    expect(screen.queryByText(/No active stop found/)).toBeNull();
  });
});

describe("Stop work: copy that holds while it is true, and a target that is always named (W5 minors)", () => {
  const NOTIFY = "Crews are notified within about six minutes.";

  it("the six-minute promise is made in the first six minutes after the stop started, and not an hour later", async () => {
    createStop("crew-a");

    // The replay clock is `?at=`: the mock's stop started at 11:10.
    search = "at=11:14";
    const early = renderCrews();
    await barSays("Work stopped 11:10");
    await waitFor(() => {
      expect(barText()).toContain(NOTIFY);
    });
    expect(barText()).toContain("Crew A. Stop recorded. Crews are notified within about six minutes. Tell the crew now.");
    early.unmount();

    search = "at=12:15";
    renderCrews();
    await barSays("Work stopped 11:10");
    await waitFor(() => {
      expect(barText()).toContain("Crew A. Tell the crew now.");
    });
    expect(barText()).not.toContain("six minutes");
    expect(barText()).not.toMatch(/Stop recorded/);
    // The late line makes no delivery claim either.
    expect(withoutWindow(barText())).not.toMatch(DELIVERY_CLAIM);
  });

  it("the promise ends at six minutes exactly: at 11:15 it still holds, at 11:16 it does not", async () => {
    createStop("crew-a");
    search = "at=11:15";
    const first = renderCrews();
    await waitFor(() => {
      expect(barText()).toContain(NOTIFY);
    });
    first.unmount();

    search = "at=11:16";
    renderCrews();
    await waitFor(() => {
      expect(barText()).toContain("Crew A. Tell the crew now.");
    });
    expect(barText()).not.toContain(NOTIFY);
  });

  it("with no crew name (the list did not load) the button and the confirmation name the crew by its id, never 'the crew'", async () => {
    server.use(http.get("*/api/v1/sites/:site_id/crews", () => HttpResponse.json({ type: "urn:x", title: "Boom", status: 503 }, { status: 503 })));
    const user = userEvent.setup();
    renderCrews();

    const button = await screen.findByRole("button", { name: "Stop work, crew-b" });
    expect(barText()).not.toMatch(/The crew/);
    await user.click(button);

    await barSays("crew-b stopped 11:10. Stop recorded.");
    expect(barText()).not.toMatch(/The crew stopped/);
  });

  it("Resume's dialog is closed for real on Keep work stopped and on Resume work (a native close hands focus back to Resume work)", async () => {
    const closed = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: closed });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    createStop("crew-a");
    const user = userEvent.setup();
    renderCrews();
    await user.click(await within(await waitForBar()).findByRole("button", { name: "Resume work" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep work stopped" }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(within(stopBar()).getByRole("button", { name: "Resume work" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume work" }));
    expect(closed).toHaveBeenCalledTimes(2);
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  });

  it("the Stop bar carries its own emergency framing: the octagon mark and a heavy rule, not the primary action's plain ink button", async () => {
    renderCrews();
    const button = await press();

    expect(button.querySelector("[data-stop-mark]")).not.toBeNull();
    expect(stopBar().innerHTML).toContain("border-t-4");
    expect(button.getAttribute("aria-hidden")).toBeNull();
  });
});
