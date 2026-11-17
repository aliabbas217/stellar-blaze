import { act, renderHook } from "@testing-library/react";
import { HOURS_PER_SECOND, useFieldClock } from "@/features/judge/landing/useFieldClock";

/*
 * The landing's clock against a hand-driven requestAnimationFrame: a full pass plays ONCE and stops (the only autoplay of the
 * product), a replay needs a press, reduced motion never starts it, and a hidden tab does not use up the day.
 */

const PEAK = 14;

interface Frames {
  readonly pending: () => number;
  /** Advance the page clock by `ms` and run the queued animation frames once, with that timestamp. */
  readonly tick: (ms: number) => void;
  readonly now: () => number;
}

function stubFrames(): Frames {
  let clock = 1000;
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("performance", { now: () => clock });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = next++;
    queue.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue.delete(id);
  });
  return {
    pending: () => queue.size,
    now: () => clock,
    tick: (ms) => {
      clock += ms;
      const due = [...queue.entries()];
      queue.clear();
      act(() => {
        for (const [, callback] of due) callback(clock);
      });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs 16 ms frames until `seconds` of page time have passed. */
function run(frames: Frames, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 16) frames.tick(16);
}

describe("useFieldClock", () => {
  it("test_clock_plays_once_then_stops: a full pass round the day ends on the peak, with playing false and no frame left queued", () => {
    const frames = stubFrames();
    const onFrame = vi.fn();
    const { result } = renderHook(() => useFieldClock(PEAK, true, onFrame));
    expect(result.current.playing).toBe(true);
    run(frames, 17); // the day takes 24 / 1.5 = 16 s
    expect(HOURS_PER_SECOND).toBe(1.5);
    expect(result.current.playing).toBe(false);
    expect(result.current.hour).toBe(PEAK);
    expect(frames.pending()).toBe(0);
    const frameCount = onFrame.mock.calls.length;
    expect(frameCount).toBeGreaterThan(900);
    // the last frame of the pass is the peak again, flagged as playing; the day then says it stopped (a frame that is NOT playing,
    // so the canvas stops metering and its stale "playing" flag is cleared: test_stop_emits_a_non_playing_frame)
    const calls = onFrame.mock.calls;
    expect(calls.at(-1)?.[1]).toBe(false);
    expect(calls.at(-1)?.[0]).toBeCloseTo(PEAK, 5);
    expect(calls.slice(0, -1).every(([, playing]) => playing === true)).toBe(true);
    // it does not start again by itself
    run(frames, 20);
    expect(onFrame.mock.calls.length).toBe(frameCount);
    expect(result.current.playing).toBe(false);
    expect(frames.pending()).toBe(0);
  });

  it("a replay needs a press, and plays one more full pass", () => {
    const frames = stubFrames();
    const onFrame = vi.fn();
    const { result } = renderHook(() => useFieldClock(PEAK, true, onFrame));
    run(frames, 17);
    expect(result.current.playing).toBe(false);
    const before = onFrame.mock.calls.length;
    act(() => {
      result.current.play();
    });
    expect(result.current.playing).toBe(true);
    run(frames, 8);
    expect(onFrame.mock.calls.length).toBeGreaterThan(before + 300);
    expect(result.current.playing).toBe(true);
    run(frames, 9);
    expect(result.current.playing).toBe(false);
    expect(frames.pending()).toBe(0);
    expect(result.current.hour).toBe(PEAK);
  });

  it("test_reduced_motion_never_starts: without autoplay no frame is requested and nothing is drawn until a press", () => {
    const frames = stubFrames();
    const onFrame = vi.fn();
    const { result } = renderHook(() => useFieldClock(PEAK, false, onFrame));
    expect(result.current.playing).toBe(false);
    expect(frames.pending()).toBe(0);
    run(frames, 5);
    expect(onFrame).not.toHaveBeenCalled();
    expect(result.current.hour).toBe(PEAK);
  });

  it("seeking stops the day where the reader put it, and the next Play continues from there", () => {
    const frames = stubFrames();
    const onFrame = vi.fn();
    const { result } = renderHook(() => useFieldClock(PEAK, true, onFrame));
    run(frames, 2);
    act(() => {
      result.current.seek(20);
    });
    expect(result.current.playing).toBe(false);
    expect(result.current.hour).toBe(20);
    expect(onFrame).toHaveBeenLastCalledWith(20, false);
    expect(frames.pending()).toBe(0);
  });

  it("test_stop_emits_a_non_playing_frame: Pause tells the canvas the day is no longer playing, at the hour it stopped on", () => {
    const frames = stubFrames();
    const onFrame = vi.fn();
    const { result } = renderHook(() => useFieldClock(PEAK, true, onFrame));
    run(frames, 2);
    const playingHour = onFrame.mock.calls.at(-1)?.[0] as number;
    expect(onFrame.mock.calls.at(-1)?.[1]).toBe(true);
    act(() => {
      result.current.pause();
    });
    expect(result.current.playing).toBe(false);
    const last = onFrame.mock.calls.at(-1);
    expect(last?.[1]).toBe(false);
    expect(last?.[0]).toBeCloseTo(playingHour, 9);
    // a second Pause (already stopped) says nothing more
    const count = onFrame.mock.calls.length;
    act(() => {
      result.current.pause();
    });
    expect(onFrame.mock.calls.length).toBe(count);
  });

  it("test_clock_clamps_dt: a hidden tab (one frame a minute later) does not use up the once-only day", () => {
    const frames = stubFrames();
    const onFrame = vi.fn();
    const { result } = renderHook(() => useFieldClock(PEAK, true, onFrame));
    run(frames, 1);
    const before = onFrame.mock.calls.at(-1)?.[0] as number;
    frames.tick(60_000); // the tab was hidden for a minute: the first frame back sees a 60 s gap
    expect(result.current.playing).toBe(true);
    const after = onFrame.mock.calls.at(-1)?.[0] as number;
    // at most 50 ms of day passed (0.075 h), not 90 hours
    expect(((after - before + 24) % 24)).toBeLessThanOrEqual((50 / 1000) * HOURS_PER_SECOND + 1e-9);
    // and the day is still playing: it takes (almost) its whole 16 s from here
    run(frames, 10);
    expect(result.current.playing).toBe(true);
  });
});
