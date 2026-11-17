import { act } from "@testing-library/react";
import { createRef } from "react";
import type { FieldCanvasHandle } from "@/features/judge/landing/FieldCanvas2D";
import { FieldCanvasGL } from "@/features/judge/landing/FieldCanvasGL";
import { ORBIT_MAX_RAD, orbitFromSearch } from "@/features/judge/landing/webgl-support";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * Fix round 3, important 2: the contrast spec must put the WebGL scene at a chosen point of its orbit deterministically (no fixed
 * sleep into an autoplay that a slow GPU gives up). `?orbit=<radians>` starts the scene at that azimuth; with reduced motion the day
 * rests there, so the pose is the test's, not the clock's. One pass of the day turns the scene by 16 s x 0.025 rad/s = 0.4 rad.
 */

describe("orbitFromSearch", () => {
  it("test_orbit_param_parsed_and_clamped: a number in [0, 0.4] radians, anything else is 0 (no orbit offset)", () => {
    expect(orbitFromSearch("")).toBe(0);
    expect(orbitFromSearch("?static")).toBe(0);
    expect(orbitFromSearch("?orbit=0.2")).toBe(0.2);
    expect(orbitFromSearch("?x=1&orbit=0.4")).toBe(0.4);
    expect(orbitFromSearch("?orbit=0")).toBe(0);
    expect(orbitFromSearch("?orbit=9")).toBe(ORBIT_MAX_RAD);
    expect(orbitFromSearch("?orbit=-1")).toBe(0);
    expect(orbitFromSearch("?orbit=abc")).toBe(0);
    expect(orbitFromSearch("?orbit=")).toBe(0);
    expect(orbitFromSearch("?orbit=Infinity")).toBe(0);
    expect(ORBIT_MAX_RAD).toBeCloseTo(16 * 0.025, 10);
  });
});

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: { type: string; azimuth?: number }[] = [];
  readonly terminate = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: { type: string; azimuth?: number }): void {
    this.posted.push(message);
  }
}

describe("FieldCanvasGL starts at the azimuth it is given", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); disconnect = vi.fn(); });
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { value: () => ({}), configurable: true, writable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error: removes the fake added in beforeEach (jsdom has no such method)
    delete HTMLCanvasElement.prototype.transferControlToOffscreen;
  });

  it("test_first_frame_carries_the_start_azimuth: the first draw request has azimuth 0.3, and a default scene starts at 0", async () => {
    const grid = { lat: [24, 25], lon: [54, 55], values: new Float32Array(2 * 2 * 24), day: "2026-09-03", source: "", physics: "", why: "" };
    for (const [given, expected] of [[0.3, 0.3], [undefined, 0]] as const) {
      FakeWorker.last = null;
      const handle = createRef<FieldCanvasHandle>();
      renderWithIntl(<FieldCanvasGL grid={grid} coast={[]} initialHour={14} {...(given === undefined ? {} : { initialAzimuth: given })} handleRef={handle} onReady={vi.fn()} onFail={vi.fn()} />);
      await act(async () => {
        await Promise.resolve();
      });
      const worker = FakeWorker.last as FakeWorker | null;
      expect(worker).not.toBeNull();
      act(() => {
        worker?.onmessage?.({ data: { type: "ready" } } as MessageEvent);
      });
      const draw = worker?.posted.find((p) => p.type === "draw");
      expect(draw?.azimuth, `initialAzimuth ${String(given)}`).toBe(expected);
    }
  });
});
