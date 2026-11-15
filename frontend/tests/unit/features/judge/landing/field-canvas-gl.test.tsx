import { act, render } from "@testing-library/react";
import { createRef, Profiler, StrictMode } from "react";
import type { FieldCanvasHandle } from "@/features/judge/landing/FieldCanvas2D";
import { FieldCanvasGL, type FieldCanvasGLProps } from "@/features/judge/landing/FieldCanvasGL";
import type { WorkerOut } from "@/features/judge/landing/terrain.worker";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * The WebGL scene component against a fake Worker and a fake OffscreenCanvas (jsdom has neither). What these tests prove is the
 * component's own contract: it gives itself up exactly once for every way the scene can fail, it measures the frame rate of the
 * frames the WORKER finished (not the page's animation frames), it cleans up on unmount, and it does not re-render at the frame
 * rate. They do not prove that a GPU draws (the e2e does, and fails without WebGL when SB_E2E_REQUIRE_WEBGL=1).
 */

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerOut>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: { message: { type: string } & Record<string, unknown>; transfer: unknown }[] = [];
  readonly terminate = vi.fn();
  /** Milliseconds the fake GPU takes per frame; null answers nothing. */
  latency: number | null = null;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(message: { type: string } & Record<string, unknown>, transfer?: unknown): void {
    this.posted.push({ message, transfer });
    if (message.type === "draw" && this.latency !== null) {
      setTimeout(() => {
        this.say({ type: "drawn", labels: [[10, 20], [30, 40], [50, 60]] });
      }, this.latency);
    }
  }
  say(message: WorkerOut): void {
    act(() => {
      this.onmessage?.({ data: message } as MessageEvent<WorkerOut>);
    });
  }
  get draws(): number {
    return this.posted.filter((p) => p.message.type === "draw").length;
  }
}

const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
const offscreen = { fake: "offscreen" };
let transfer: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeWorker.instances = [];
  observers.length = 0;
  // like a browser: a canvas element can hand over its control once, and a second transfer throws
  const transferred = new WeakSet<object>();
  transfer = vi.fn(function (this: HTMLCanvasElement) {
    if (transferred.has(this)) throw new DOMException("Cannot transfer control from a canvas for more than one time.", "InvalidStateError");
    transferred.add(this);
    return offscreen;
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { value: transfer, configurable: true, writable: true });
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly observe = vi.fn();
      readonly disconnect = vi.fn();
      constructor() {
        observers.push(this);
      }
    },
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // @ts-expect-error: removes the fake added in beforeEach (jsdom has no such method)
  delete HTMLCanvasElement.prototype.transferControlToOffscreen;
});

const grid = { lat: [24, 25], lon: [54, 55], values: new Float32Array(2 * 2 * 24), day: "2026-09-03", source: "", physics: "", why: "" };

interface Mounted {
  readonly handle: React.RefObject<FieldCanvasHandle | null>;
  readonly onReady: ReturnType<typeof vi.fn>;
  readonly onFail: ReturnType<typeof vi.fn>;
  readonly worker: () => FakeWorker;
  readonly unmount: () => void;
  readonly renders: () => number;
}

async function mount(options: { strict?: boolean } = {}): Promise<Mounted> {
  const handle = createRef<FieldCanvasHandle>();
  const onReady = vi.fn();
  const onFail = vi.fn();
  let commits = 0;
  const props: FieldCanvasGLProps = { grid, coast: [], initialHour: 14, handleRef: handle, onReady, onFail };
  const tree = (
    <Profiler
      id="gl"
      onRender={() => {
        commits++;
      }}
    >
      <FieldCanvasGL {...props} />
    </Profiler>
  );
  const { unmount } = renderWithIntl(options.strict === true ? <StrictMode>{tree}</StrictMode> : tree);
  // the worker starts in a microtask (so a StrictMode double mount starts one)
  await act(async () => {
    await Promise.resolve();
  });
  return { handle, onReady, onFail, worker: () => FakeWorker.instances.at(-1) as FakeWorker, unmount, renders: () => commits };
}

function ready(m: Mounted): FakeWorker {
  const worker = m.worker();
  worker.say({ type: "ready" });
  return worker;
}

describe("FieldCanvasGL gives itself up exactly once", () => {
  it("test_context_lost_falls_back_once: the worker reports a lost context, twice, and the page is told once", async () => {
    const m = await mount();
    const worker = ready(m);
    worker.say({ type: "fail", why: "context lost" });
    worker.say({ type: "fail", why: "context lost" });
    expect(m.onFail).toHaveBeenCalledTimes(1);
    expect(m.onFail).toHaveBeenCalledWith("context lost");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("test_link_failure_falls_back_once: a program that did not link before the first frame", async () => {
    const m = await mount();
    m.worker().say({ type: "fail", why: "program" });
    expect(m.onFail).toHaveBeenCalledTimes(1);
    expect(m.onReady).not.toHaveBeenCalled();
    expect(m.worker().terminate).toHaveBeenCalledTimes(1);
  });

  it("test_worker_error_event_falls_back_once: an uncaught error in the worker", async () => {
    const m = await mount();
    const worker = ready(m);
    act(() => {
      worker.onerror?.({} as ErrorEvent);
      worker.onerror?.({} as ErrorEvent);
    });
    expect(m.onFail).toHaveBeenCalledTimes(1);
    expect(m.onFail).toHaveBeenCalledWith("worker error");
    // a failure after giving up changes nothing
    worker.say({ type: "fail", why: "context lost" });
    expect(m.onFail).toHaveBeenCalledTimes(1);
  });

  it("falls back when the canvas cannot be transferred or the worker cannot start", async () => {
    transfer.mockImplementation(() => {
      throw new Error("InvalidStateError");
    });
    const m = await mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(m.onFail).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("hands the canvas to a same-origin module worker and sends the first frame when it is ready", async () => {
    const m = await mount();
    const worker = m.worker();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.url.pathname).toMatch(/terrain\.worker\.ts$/);
    expect(worker.posted[0]?.message.type).toBe("init");
    expect(worker.posted[0]?.transfer).toEqual([offscreen]);
    expect(worker.draws).toBe(0);
    ready(m);
    expect(worker.draws).toBe(1);
    worker.say({ type: "drawn", labels: [[1, 2], [3, 4], [5, 6]] });
    expect(m.onReady).toHaveBeenCalledTimes(1);
  });
});

describe("FieldCanvasGL cleans up and is StrictMode safe", () => {
  it("test_unmount_terminates_worker_and_disconnects_observer", async () => {
    const m = await mount();
    const worker = ready(m);
    expect(observers).toHaveLength(1);
    m.unmount();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("an unmount before the worker started starts nothing", async () => {
    const handle = createRef<FieldCanvasHandle>();
    const { unmount } = renderWithIntl(<FieldCanvasGL grid={grid} coast={[]} initialHour={14} handleRef={handle} onReady={vi.fn()} onFail={vi.fn()} />);
    unmount();
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(transfer).not.toHaveBeenCalled();
  });

  it("test_strict_mode_transfers_the_canvas_once: React's dev double mount starts one worker and does not fall back", async () => {
    const m = await mount({ strict: true });
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(m.onFail).not.toHaveBeenCalled();
    ready(m);
    expect(m.worker().draws).toBe(1);
  });
});

/** Drives `draw(hour, true)` like the clock does at 60 Hz for `ms`, in 16 ms steps. */
function play(m: Mounted, ms: number, start = 14): void {
  let hour = start;
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    act(() => {
      hour += (16 / 1000) * 1.5;
      m.handle.current?.draw(hour % 24, true);
      vi.advanceTimersByTime(16);
    });
  }
}

describe("FieldCanvasGL measures the frames the worker finished (ADR 0037 section 4)", () => {
  it("test_slow_worker_gives_up_in_about_2s: a worker answering every 100 ms calls onFail within about 2 s of a playing day", async () => {
    const m = await mount();
    const worker = ready(m);
    worker.latency = 100;
    // the first frame is the seek to the start: it is not a playing frame
    worker.say({ type: "drawn", labels: [[1, 2], [3, 4], [5, 6]] });
    play(m, 1500);
    expect(m.onFail).not.toHaveBeenCalled();
    play(m, 1200);
    expect(m.onFail).toHaveBeenCalledTimes(1);
    expect(String(m.onFail.mock.calls[0]?.[0])).toMatch(/30 frames per second/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("test_fast_worker_does_not_give_up: a worker answering in 16 ms plays a whole day", async () => {
    const m = await mount();
    const worker = ready(m);
    worker.latency = 16;
    worker.say({ type: "drawn", labels: [[1, 2], [3, 4], [5, 6]] });
    play(m, 8000);
    expect(m.onFail).not.toHaveBeenCalled();
    expect(worker.draws).toBeGreaterThan(100);
  });

  it("a frozen scene is not 0 frames per second: nothing is measured while the day is not playing", async () => {
    const m = await mount();
    const worker = ready(m);
    worker.latency = 100;
    worker.say({ type: "drawn", labels: [[1, 2], [3, 4], [5, 6]] });
    // seeks (playing=false) answered slowly, and long idle time between them
    for (let i = 0; i < 40; i++) {
      act(() => {
        m.handle.current?.draw(i % 24, false);
        vi.advanceTimersByTime(300);
      });
    }
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(m.onFail).not.toHaveBeenCalled();
  });

  it("a pause in a playing day (the tab was hidden) does not count as slow frames", async () => {
    const m = await mount();
    const worker = ready(m);
    worker.latency = 16;
    worker.say({ type: "drawn", labels: [[1, 2], [3, 4], [5, 6]] });
    play(m, 800);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    play(m, 800);
    expect(m.onFail).not.toHaveBeenCalled();
  });
});

describe("FieldCanvasGL does not re-render at the frame rate", () => {
  it("test_labels_rerender_only_when_the_hour_changes: a playing day at 60 frames per second commits a few times, not sixty per second", async () => {
    const m = await mount();
    const worker = ready(m);
    worker.latency = 16;
    worker.say({ type: "drawn", labels: [[1, 2], [3, 4], [5, 6]] });
    const before = m.renders();
    play(m, 2000); // 1.5 hours per second: about 3 hour changes in 2 s, 125 frames
    const commits = m.renders() - before;
    expect(worker.draws).toBeGreaterThan(60);
    expect(commits).toBeLessThanOrEqual(8);
    expect(commits).toBeGreaterThanOrEqual(1);
  });

  it("still moves the labels when a reader seeks (the new hour's positions)", async () => {
    const m = await mount();
    const worker = ready(m);
    worker.say({ type: "drawn", labels: [[1, 2], [3, 4], [5, 6]] });
    const { container } = { container: document.body };
    expect(container.querySelector("span[style*='left: 1px']")).not.toBeNull();
    act(() => {
      m.handle.current?.draw(3, false);
    });
    worker.say({ type: "drawn", labels: [[100, 200], [300, 400], [500, 600]] });
    expect(container.querySelector("span[style*='left: 100px']")).not.toBeNull();
  });
});

describe("the harness is not vacuous", () => {
  it("renders through the real component (a Profiler commit and a canvas)", async () => {
    const { container } = render(<div />);
    expect(container).toBeTruthy();
    const m = await mount();
    expect(document.querySelector("canvas[data-field-canvas='webgl']")).not.toBeNull();
    expect(m.renders()).toBeGreaterThan(0);
  });
});
