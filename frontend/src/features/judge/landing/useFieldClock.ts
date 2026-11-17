"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * The landing's clock over one day of the field. It starts on the peak hour (the first frame is the hottest one), plays the day
 * ONCE round the clock back to the peak (the only autoplay in the product), and never plays on its own when the reader asked
 * for reduced motion. A reader can take it over at any time: seeking or pausing stops it where it is.
 *
 * The float hour lives in a ref and goes to `onFrame` (the canvas), so a playing day does not re-render the React tree sixty
 * times a second; React state carries only the WHOLE hour, which is what the text shows.
 */

/** Hours of the day per second of playing: the 24 hours take 16 s. */
export const HOURS_PER_SECOND = 1.5;
const HOURS = 24;
const MAX_STEP_MS = 50;

export interface FieldClock {
  /** The whole hour the text shows. */
  readonly hour: number;
  readonly playing: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  /** Jump to a whole hour and stop. */
  readonly seek: (hour: number) => void;
}

/** `autoplay` is read once, at mount: the day plays once on its own, and never starts again by itself (a later change does not restart it). */
export function useFieldClock(peakHour: number, autoplay: boolean, onFrame: (hour: number, playing: boolean) => void): FieldClock {
  const autoplayAtMount = useRef(autoplay);
  const [hour, setHour] = useState(peakHour);
  // Autoplay starts playing from the first render: the loop itself starts in the effect below (no state set there).
  const [playing, setPlaying] = useState(autoplay);
  const position = useRef(peakHour);
  // Hours travelled since the start of the current pass: the pass ends at one full day, back on the peak.
  const travelled = useRef(0);
  const frame = useRef(0);
  const frameCallback = useRef(onFrame);
  useEffect(() => {
    frameCallback.current = onFrame;
  }, [onFrame]);

  /** A frame loop is running (so the canvas has been told the day plays). */
  const running = useRef(false);

  /** Stops the loop without telling the canvas (a seek draws its own frame). */
  const halt = useCallback(() => {
    cancelAnimationFrame(frame.current);
    running.current = false;
    setPlaying(false);
  }, []);

  /** The day stops playing (Pause, or the end of the pass): the canvas is told with a frame that is NOT playing, so it stops metering. */
  const stop = useCallback(() => {
    const wasRunning = running.current;
    halt();
    if (wasRunning) frameCallback.current(position.current, false);
  }, [halt]);

  const loop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    running.current = true;
    let last = performance.now();
    const step = (now: number): void => {
      // A frame never advances the day by more than 50 ms: a tab that was hidden for a minute must not use up the once-only day.
      travelled.current = Math.min(HOURS, travelled.current + (Math.min(MAX_STEP_MS, Math.max(0, now - last)) / 1000) * HOURS_PER_SECOND);
      last = Math.max(last, now);
      position.current = (peakHour + travelled.current) % HOURS;
      frameCallback.current(position.current, true);
      setHour(Math.floor(position.current));
      if (travelled.current < HOURS) frame.current = requestAnimationFrame(step);
      else stop();
    };
    frame.current = requestAnimationFrame(step);
  }, [peakHour, stop]);

  const play = useCallback(() => {
    // A finished pass starts over from the peak; a paused one continues.
    if (travelled.current >= HOURS) travelled.current = 0;
    setPlaying(true);
    loop();
  }, [loop]);

  const seek = useCallback(
    (to: number) => {
      halt();
      const whole = ((Math.round(to) % HOURS) + HOURS) % HOURS;
      position.current = whole;
      // The next Play continues the day from here: the pass is measured from the peak.
      travelled.current = (whole - peakHour + HOURS) % HOURS;
      frameCallback.current(whole, false);
      setHour(whole);
    },
    [peakHour, halt],
  );

  useEffect(() => {
    if (autoplayAtMount.current) loop();
    return () => {
      cancelAnimationFrame(frame.current);
      running.current = false;
    };
  }, [loop]);

  return { hour, playing, play, pause: stop, seek };
}
