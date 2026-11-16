import { act, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { http, HttpResponse } from "msw/http";
import type { ReactNode } from "react";
import en from "../../../../messages/en.json";
import { enqueueStop, expiredStops, OUTBOX_ROW_TTL_MS, pendingStops } from "@/features/supervisor/stop-outbox";
import { createStop, crewStops } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { addRawRow, holdingOpen, refusingDelete } from "./outbox-faults";
import { renderCrews, stopBar, textOf, installSupervisorTestEnvironment } from "./support";

/*
 * The Stop outbox, round 3 (re-review a7a0c941223afe8e8 of round 2): the window where an expired row was neither sent nor told, a failed
 * delete after a successful POST, a refused row that removed a true notice, the literal "never beside Work stopped" rule, focus when a
 * notice vanishes on its own, and a held Enter on the Stop button after the last Close. Every clock here is a fake `Date` and every race is
 * parked at a known point (`holdingOpen`), so nothing depends on how loaded the machine is.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const STOP_ROUTE = "*/api/v1/crews/:crew_id/stops";
const SLOW = { timeout: 5_000 } as const;
const press = () => screen.findByRole("button", { name: "Stop work, Crew A" }, SLOW);
const barText = (): string => textOf(stopBar());
/** The crews list is on screen (the focal crew is not always Crew A: a stopped crew ranks differently). */
const crewsOnScreen = (): Promise<void> =>
  waitFor(() => {
    expect(document.querySelector("[data-crew]")).not.toBeNull();
  }, SLOW);
const lapsedFor = (crew: string): string => en.supervisor.stop.expired.replace("<bdi>{crew}</bdi>", crew);
const noticeEl = (crewId: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-expired-stop="${crewId}"]`);

async function barSays(text: string): Promise<void> {
  await waitFor(() => {
    expect(barText()).toContain(text);
  }, SLOW);
}

/** A POST that the server answers only after the crews list has loaded (otherwise the list's first read already shows the stop). */
function recordsAfterList(): { readonly listLoaded: () => void } {
  let listLoaded: () => void = () => undefined;
  const afterList = new Promise<void>((resolve) => {
    listLoaded = resolve;
  });
  server.use(
    http.post(STOP_ROUTE, async ({ params }) => {
      await afterList;
      return HttpResponse.json(createStop(String(params["crew_id"])), { status: 201 });
    }),
  );
  return { listLoaded };
}

describe("item 2: a row that cannot be removed after its stop was recorded still reads 'Work stopped'", () => {
  it("the POST answered 2xx and the delete failed: the bar reads the recorded stop and the crews are refetched", async () => {
    const real = new IDBFactory();
    await enqueueStop("crew-a", new Date(Date.now() - 5 * 60 * 1000), { factory: real });
    vi.stubGlobal("indexedDB", refusingDelete(real, () => true));
    const { listLoaded } = recordsAfterList();
    renderCrews();
    await press();
    listLoaded();

    await barSays("Work stopped 11:10");
    expect(crewStops("crew-a")).toHaveLength(1);
  }, 20_000);
});

/** The client's own request timeout, fired by the test (`AbortSignal.timeout` runs on a timer that fake timers cannot advance). */
function controlledTimeouts(): { fire: () => void } {
  const controllers: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  return {
    fire: () => {
      for (const controller of controllers) controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
    },
  };
}

/** A request the test holds open: `reached` says the server has it, `answer` lets it go. */
function held(): { readonly reached: Promise<void>; readonly answer: () => void; readonly wait: () => Promise<void>; readonly arrive: () => void } {
  let arrive: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  return { reached, answer, wait: () => answered, arrive };
}

describe("item 3: only a RECORDED stop takes its notice back", () => {
  it("a row in flight as the TTL passes, then refused for good (422): the notice stays, the row is gone, and the bar never reads 'Work stopped'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const real = new IDBFactory();
    vi.stubGlobal("indexedDB", real);
    const written = Date.now() - OUTBOX_ROW_TTL_MS + 1_000;
    await addRawRow(real, { crewId: "crew-a", clientTime: new Date(written).toISOString() });
    const post = held();
    server.use(
      http.post(STOP_ROUTE, async () => {
        post.arrive();
        await post.wait();
        return HttpResponse.json(
          { type: "urn:stellar-blaze:problem:unprocessable", title: "Unprocessable", status: 422, request_id: "req-422" },
          { status: 422, headers: { "content-type": "application/problem+json" } },
        );
      }),
    );
    renderCrews();
    await press();
    await post.reached;

    // The TTL passes while the request is unanswered: the timer tells it from memory.
    vi.setSystemTime(written + OUTBOX_ROW_TTL_MS + 1);
    await barSays(lapsedFor("Crew A"));

    post.answer();
    // The row is refused for good, so the drain removes it: that is the end of the drain's work.
    await waitFor(async () => {
      expect(await pendingStops(real)).toEqual([]);
    }, SLOW);
    await act(async () => {
      await Promise.resolve();
    });

    expect(barText()).toContain(lapsedFor("Crew A"));
    expect(barText()).not.toContain("Work stopped");
    expect(crewStops("crew-a")).toHaveLength(0);
  }, 20_000);
});

describe("item 4: 'was not sent' never stands beside a crew that IS stopped (a stop at or after the row's time)", () => {
  // The mock records every stop at the replay clock, 2026-09-03 07:10 UTC: the phone's clock is set around it so the order is the test's.
  const at = (iso: string): number => Date.parse(iso);
  const crewRow = (crewId: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-crew="${crewId}"]`);

  it("an unanswered POST after the TTL that actually landed: the crews refetch shows the stop and the older notice and its tombstone go", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-09-03T06:00:00Z"));
    const real = new IDBFactory();
    vi.stubGlobal("indexedDB", real);
    const written = Date.now() - OUTBOX_ROW_TTL_MS + 1_000;
    await addRawRow(real, { crewId: "crew-a", clientTime: new Date(written).toISOString() });
    const timeouts = controlledTimeouts();
    const post = held();
    server.use(
      http.post(STOP_ROUTE, async ({ params }) => {
        post.arrive();
        await post.wait();
        createStop(String(params["crew_id"]));
        return new Promise<never>(() => undefined);
      }),
    );
    renderCrews();
    await press();
    await post.reached;
    vi.setSystemTime(written + OUTBOX_ROW_TTL_MS + 1);
    await barSays(lapsedFor("Crew A"));

    // The server records the stop; the client's request gives up (no answer). The refetch brings the truth.
    post.answer();
    await waitFor(() => {
      expect(crewStops("crew-a")).toHaveLength(1);
    }, SLOW);
    timeouts.fire();

    await barSays("Work stopped 11:10");
    await waitFor(() => {
      expect(barText()).not.toContain("was not sent");
    }, SLOW);
    await waitFor(async () => {
      expect(await expiredStops(real)).toEqual([]);
    }, SLOW);
  }, 20_000);

  it("a stop recorded by another device, after the row was written, ends the older notice of that crew (and no tombstone is left)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-09-03T06:00:00Z"));
    const real = new IDBFactory();
    vi.stubGlobal("indexedDB", real);
    await enqueueStop("crew-c", new Date(Date.now() - 2 * 60 * 60 * 1000), { factory: real, crewName: "Crew C" });
    await enqueueStop("crew-d", new Date(Date.now() - 2 * 60 * 60 * 1000), { factory: real, crewName: "Crew D" });
    createStop("crew-c");
    renderCrews();
    await crewsOnScreen();

    await barSays(lapsedFor("Crew D"));
    await waitFor(() => {
      expect(textOf(crewRow("crew-c"))).toContain("Work stopped");
    }, SLOW);
    expect(noticeEl("crew-c")).toBeNull();
    await waitFor(async () => {
      expect((await expiredStops(real)).map((row) => row.crewId)).toEqual(["crew-d"]);
    }, SLOW);
  }, 20_000);

  it("a stop that started BEFORE the row's time does not end the notice", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-09-03T12:00:00Z"));
    const real = new IDBFactory();
    vi.stubGlobal("indexedDB", real);
    await enqueueStop("crew-c", new Date(Date.now() - 2 * 60 * 60 * 1000), { factory: real, crewName: "Crew C" });
    createStop("crew-c");
    renderCrews();
    await crewsOnScreen();

    await barSays(lapsedFor("Crew C"));
    await waitFor(() => {
      expect(textOf(crewRow("crew-c"))).toContain("Work stopped");
    }, SLOW);
    expect(noticeEl("crew-c")).not.toBeNull();
    expect((await expiredStops(real)).map((row) => row.crewId)).toEqual(["crew-c"]);
  }, 20_000);
});

describe("item 1: a row that expires between the discard and the pending read is told, not dropped", () => {
  it("offline, a row 100 ms short of the TTL at the discard that is past it at the pending read gets its notice at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const real = new IDBFactory();
    const held = holdingOpen(real);
    vi.stubGlobal("indexedDB", held.factory);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const written = Date.now() - OUTBOX_ROW_TTL_MS + 100;
    await addRawRow(real, { crewId: "crew-d", clientTime: new Date(written).toISOString() });

    // Mount reads the store three times: the discard, the tombstones, the waiting rows. Park the third.
    const { release, reached } = held.hold(3);
    renderCrews();
    await press();
    await reached;
    expect(barText()).not.toContain("was not sent");
    vi.setSystemTime(written + OUTBOX_ROW_TTL_MS + 1);
    release();

    await barSays(lapsedFor("Crew D"));
    expect(crewStops("crew-d")).toHaveLength(0);
  }, 20_000);
});
