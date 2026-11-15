"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { FieldCanvasHandle } from "./FieldCanvas2D";
import type { FieldGrid, Polyline } from "./field-data";
import { labelCodes, PHONE_MAX_WIDTH, STATIONS } from "./field-draw";
import { StationLabels, type StationLabel } from "./StationLabels";
import { FpsMonitor } from "./terrain-math";
import type { InitMessage, WorkerOut } from "./terrain.worker";

/*
 * The WebGL upgrade of the field. A canvas handed to a module worker as an OffscreenCanvas: the worker creates the WebGL
 * context, builds the mesh and draws (terrain.worker.ts), and this component only sends it the hour and shows the answer. It is
 * loaded after the page is idle, on the landing page only (FieldIsland), and it gives itself up, so the page keeps the 2D field of
 * the same data, when
 *   - the worker cannot start, the canvas cannot be transferred, or WebGL is not there (`fail` from the worker),
 *   - the context is lost, or the worker throws,
 *   - the day plays under 30 frames per second for 2 seconds (ADR 0037 section 4). The frames counted are the ones the WORKER
 *     finished (its `drawn` answers) while the day plays: the animation frames of the page say nothing about a slow GPU, and a
 *     scene that is standing still is not at 0 frames per second.
 * One frame at a time is in flight: a newer hour waits for the answer to the last one and only the latest is drawn.
 *
 * The worker starts in a microtask, not in the effect body: React's development StrictMode runs an effect, its cleanup and the
 * effect again, and a canvas can hand over its control only once, so the first (discarded) run must not take it.
 */

export interface FieldCanvasGLProps {
  readonly grid: FieldGrid;
  readonly coast: readonly Polyline[];
  readonly initialHour: number;
  /** Right-to-left page: the scene sits on the left, like the 2D field. */
  readonly rtl?: boolean;
  readonly handleRef: Ref<FieldCanvasHandle>;
  /** The first frame is on screen: the 2D field can step aside. */
  readonly onReady: () => void;
  /** The scene gave itself up: show the 2D field. Called at most once. */
  readonly onFail: (why: string) => void;
}

/** Orbit speed of the desktop scene while the day plays, radians per second. */
const ORBIT = 0.025;

export function FieldCanvasGL({ grid, coast, initialHour, rtl = false, handleRef, onReady, onFail }: FieldCanvasGLProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const ready = useRef(false);
  const busy = useRef(false);
  const dirty = useRef(false);
  const force = useRef(true);
  const given = useRef(false);
  const hour = useRef(initialHour);
  const azimuth = useRef(0);
  const lastPlaying = useRef<number | null>(null);
  /** The latest draw request was a frame of a playing day (a seek is not measured). */
  const playingNow = useRef(false);
  const labelHour = useRef<number | null>(null);
  const labelSize = useRef("");
  const monitor = useRef(new FpsMonitor());
  const sendRef = useRef<() => void>(() => undefined);
  const callbacks = useRef({ onReady, onFail });
  const [labels, setLabels] = useState<readonly StationLabel[]>([]);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    callbacks.current = { onReady, onFail };
  }, [onReady, onFail]);

  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    let cancelled = false;
    let started: Worker | null = null;
    const mobile = window.innerWidth < PHONE_MAX_WIDTH;
    const dpr = Math.min(window.devicePixelRatio, mobile ? 1.5 : 2);
    const codes = labelCodes(window.innerWidth);
    let first = true;

    const giveUp = (why: string): void => {
      if (given.current) return;
      given.current = true;
      worker.current?.terminate();
      worker.current = null;
      callbacks.current.onFail(why);
    };

    const send = (): void => {
      const w = worker.current;
      if (w === null || !ready.current) return;
      if (busy.current) {
        dirty.current = true;
        return;
      }
      busy.current = true;
      dirty.current = false;
      w.postMessage({ type: "draw", hour: hour.current, azimuth: azimuth.current, width: el.clientWidth, height: el.clientHeight, dpr, force: force.current });
      force.current = false;
    };

    sendRef.current = send;

    const start = (): void => {
      if (cancelled) return;
      try {
        const offscreen = el.transferControlToOffscreen();
        const w = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
        started = w;
        worker.current = w;
        w.onmessage = (event: MessageEvent<WorkerOut>) => {
          const message = event.data;
          if (message.type === "fail") {
            giveUp(message.why);
          } else if (message.type === "ready") {
            ready.current = true;
            send();
          } else {
            busy.current = false;
            // ADR 0037 section 4: the frames the worker finished, while the day plays. A seek, or a scene standing still, is not slow.
            if (playingNow.current) {
              if (monitor.current.tick(performance.now())) giveUp("under 30 frames per second for 2 seconds");
            } else {
              monitor.current.reset();
            }
            if (given.current) return;
            // The station names move with the hour (the relief changes under them) and with a resize: not sixty times a second.
            const whole = Math.floor(hour.current);
            const size = `${String(el.clientWidth)}x${String(el.clientHeight)}`;
            if (!playingNow.current || whole !== labelHour.current || size !== labelSize.current || first) {
              labelHour.current = whole;
              labelSize.current = size;
              setLabels(message.labels.map(([x, y], i) => ({ code: codes[i] ?? "OMAA", x, y })));
            }
            if (first) {
              first = false;
              setShown(true);
              callbacks.current.onReady();
            }
            if (dirty.current) send();
          }
        };
        w.onerror = () => {
          giveUp("worker error");
        };
        const init: InitMessage = {
          type: "init",
          canvas: offscreen,
          lat: grid.lat,
          lon: grid.lon,
          values: grid.values,
          coast: coast.map((line) => line.map(([lon, lat]) => [lon, lat] as const)),
          mobile,
          rtl,
          stations: codes.map((code) => STATIONS[code]),
        };
        w.postMessage(init, [offscreen]);
      } catch (error) {
        giveUp(String(error));
      }
    };
    queueMicrotask(start);

    const observer = new ResizeObserver(() => {
      force.current = true;
      send();
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
      started?.terminate();
      worker.current = null;
    };
  }, [grid, coast, rtl]);

  useImperativeHandle(
    handleRef,
    () => ({
      draw: (value: number, playing = false) => {
        const now = performance.now();
        playingNow.current = playing;
        if (playing && ready.current) {
          const last = lastPlaying.current;
          if (last !== null && window.innerWidth >= PHONE_MAX_WIDTH) azimuth.current += (Math.min(now - last, 50) / 1000) * ORBIT;
          lastPlaying.current = now;
        } else if (!playing) {
          lastPlaying.current = null;
        }
        hour.current = value;
        sendRef.current();
      },
    }),
    [],
  );

  return (
    <>
      <canvas
        ref={canvas}
        data-field-canvas="webgl"
        className={`absolute inset-0 size-full transition-opacity ${shown ? "opacity-100" : "opacity-0"}`}
      />
      {shown ? <StationLabels labels={labels} /> : null}
    </>
  );
}
