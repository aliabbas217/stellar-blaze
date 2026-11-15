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
 *   - the day plays under 30 frames per second for 2 seconds (ADR 0037 section 4).
 * One frame at a time is in flight: a newer hour waits for the answer to the last one and only the latest is drawn.
 */

export interface FieldCanvasGLProps {
  readonly grid: FieldGrid;
  readonly coast: readonly Polyline[];
  readonly initialHour: number;
  readonly handleRef: Ref<FieldCanvasHandle>;
  /** The first frame is on screen: the 2D field can step aside. */
  readonly onReady: () => void;
  /** The scene gave itself up: show the 2D field. Called at most once. */
  readonly onFail: (why: string) => void;
}

/** Orbit speed of the desktop scene while the day plays, radians per second. */
const ORBIT = 0.025;

export function FieldCanvasGL({ grid, coast, initialHour, handleRef, onReady, onFail }: FieldCanvasGLProps) {
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
    let started: Worker;
    try {
      const offscreen = el.transferControlToOffscreen();
      started = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
      worker.current = started;
      started.onmessage = (event: MessageEvent<WorkerOut>) => {
        const message = event.data;
        if (message.type === "fail") {
          giveUp(message.why);
        } else if (message.type === "ready") {
          ready.current = true;
          send();
        } else {
          busy.current = false;
          setLabels(message.labels.map(([x, y], i) => ({ code: codes[i] ?? "OMAA", x, y })));
          if (first) {
            first = false;
            setShown(true);
            callbacks.current.onReady();
          }
          if (dirty.current) send();
        }
      };
      started.onerror = () => {
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
        stations: codes.map((code) => STATIONS[code]),
      };
      started.postMessage(init, [offscreen]);
    } catch (error) {
      queueMicrotask(() => {
        giveUp(String(error));
      });
      return;
    }

    const observer = new ResizeObserver(() => {
      force.current = true;
      send();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      started.terminate();
      worker.current = null;
    };
  }, [grid, coast]);

  useImperativeHandle(
    handleRef,
    () => ({
      draw: (value: number, playing = false) => {
        const now = performance.now();
        if (playing && ready.current) {
          const last = lastPlaying.current;
          if (last !== null && window.innerWidth >= PHONE_MAX_WIDTH) azimuth.current += (Math.min(now - last, 50) / 1000) * ORBIT;
          lastPlaying.current = now;
          // ADR 0037 section 4: the scene is given up for the 2D field when the day cannot be drawn at 30 frames per second.
          if (monitor.current.tick(now)) {
            if (!given.current) {
              given.current = true;
              worker.current?.terminate();
              worker.current = null;
              callbacks.current.onFail("under 30 frames per second for 2 seconds");
            }
            return;
          }
        } else if (!playing) {
          lastPlaying.current = null;
          monitor.current.reset();
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
