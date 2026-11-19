"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hourLabel, LIMIT_C, readingAt, type FieldGrid } from "./field-data";
import { loadFieldGrid } from "./field-load";
import { cameraAt, FIRST_HOUR, hourOf, LAST_HOUR, PANEL_SHARE, progressOf, RELIEF, stepOf, type Step } from "./landing-camera";
import { isPinnedLayout, media, NARROW_QUERY, REDUCED_QUERY, subscribeScroll } from "./landing-scroll";
import type { Scene } from "./landing-scene";

/*
 * Chapter 01, "Forecast": the hero and the one pinned scene share ONE stage. The server markup is complete and readable on its own (the promise,
 * its lede, the two links, the legend, the source line and the attribution, all passed in as slots); this component adds what needs the browser:
 *   - the hour, the camera and which caption shows, from the scroll position of the pinned section (the page's one passive scroll listener,
 *     landing-scroll.ts; native scroll is never touched);
 *   - the WebGL scene, imported lazily after first paint when the page is idle (landing-scene.ts, the three files of data under /data/);
 *   - the captions: the numbers are read from the recorded forecast grid by the same functions as the rest of the app (field-data.ts) and the
 *     sentences are message templates with locale-neutral digits (judge.landing.scene.*), never string concatenation.
 * Where the scene cannot or should not run (no WebGL or it fails, reduced motion, the browser asks to save data) the stage is a plain column with
 * a still image of the hero state at 06:00 (`data-scene="poster"`); narrow screens are a plain column too, with the live scene in a box. The
 * layout choice is CSS (landing.css); this file only reports which of the three states the stage is in.
 */

export interface ForecastStageProps {
  readonly region: string;
  readonly when: string;
  readonly dateLabel: string;
  readonly omaa: readonly number[];
  readonly rtl: boolean;
  readonly sourceLine: string;
  readonly hero: ReactNode;
  readonly legend: ReactNode;
  readonly attribution: ReactNode;
  readonly stations: readonly { readonly code: string; readonly name: string; readonly lat: number; readonly lon: number; readonly leader: number; readonly end?: boolean }[];
}

type Mode = "loading" | "live" | "poster";

interface SaveDataConnection {
  readonly saveData?: boolean;
}

const POSTER_SRC = "/data/uae-poster.webp";
const DATA = { geo: "/data/uae-geo.json", dem: "/data/uae-dem.bin", image: "/data/uae-sat-gray.webp" } as const;

const pad2 = (n: number): string => (n < 10 ? "0" : "") + String(n);
const clockText = (hour: number): string => {
  const minutes = Math.round(hour * 60);
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
};

function idle(run: () => void): () => void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(run, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, 300);
  return () => {
    window.clearTimeout(id);
  };
}

async function loadAssets(): Promise<{ geo: unknown; dem: Int16Array; image: HTMLImageElement }> {
  const image = new Image();
  image.src = DATA.image;
  const [geo, dem] = await Promise.all([
    fetch(DATA.geo).then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error(DATA.geo)))),
    fetch(DATA.dem).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(DATA.dem)))),
    image.decode(),
  ]);
  return { geo, dem: new Int16Array(dem), image };
}

export function ForecastStage({ region, when, dateLabel, omaa, rtl, sourceLine, hero, legend, attribution, stations }: ForecastStageProps) {
  const t = useTranslations("judge.landing");
  const [mode, setMode] = useState<Mode>("loading");
  const [step, setStep] = useState<Step>(0);
  const [hour, setHour] = useState<number>(FIRST_HOUR);
  const [grid, setGrid] = useState<FieldGrid | null>(null);
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const rule = useRef<HTMLElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const coast = useRef<readonly [number, number, number]>([0, 0, 0]);
  const last = useRef("");

  // ---- the scene: after first paint, when idle; never with reduced motion or save-data; any failure keeps the poster
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: SaveDataConnection }).connection?.saveData === true;
    if (typeof window.matchMedia !== "function") return undefined;
    let alive = true;
    if (media(REDUCED_QUERY)?.matches === true || saveData) {
      // the still image takes the stage; set from a microtask, not from the effect body itself
      queueMicrotask(() => {
        if (alive) setMode("poster");
      });
      return () => {
        alive = false;
      };
    }
    const cancel = idle(() => {
      void Promise.all([import("./landing-scene"), loadAssets(), loadFieldGrid()]).then(
        ([{ createScene }, assets, field]) => {
          const g = assets.geo as Parameters<typeof createScene>[0]["geo"];
          const cv = canvas.current;
          const root = labels.current;
          if (!alive || cv === null || root === null) return;
          const scene = createScene({
            canvas: cv,
            labelRoot: root,
            geo: g,
            dem: assets.dem,
            image: assets.image,
            grid: { rows: field.lat.length, cols: field.lon.length, get: (h, i, j) => field.values[h * field.lat.length * field.lon.length + i * field.lon.length + j] ?? 0 },
            labels: stations.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon, leader: s.leader, ...(s.end === true ? { end: true } : {}) })),
          });
          if (scene === null) {
            setMode("poster");
            return;
          }
          const a = scene.ll(54.5, 24.5);
          coast.current = [a.x, 0, a.z];
          sceneRef.current = scene;
          setGrid(field);
          setMode("live");
        },
        () => {
          if (alive) setMode("poster");
        },
      );
    });
    return () => {
      alive = false;
      cancel();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [stations]);

  // ---- the scroll: ONE subscription writes the hour, the caption step and the camera
  useEffect(() => {
    const frame = (): void => {
      const sec = section.current;
      if (sec === null) return;
      const pinned = mode !== "poster" && isPinnedLayout();
      const rect = sec.getBoundingClientRect();
      const p = pinned ? progressOf(rect.top, rect.height, window.innerHeight) : null;
      const h = p === null ? LAST_HOUR : hourOf(p);
      setStep(p === null ? 0 : stepOf(p));
      setHour(Math.floor(h));
      if (clock.current !== null) clock.current.textContent = clockText(h);
      if (rule.current !== null) rule.current.style.width = `${String(Math.min(1, Math.max(0, (h - FIRST_HOUR) / (LAST_HOUR - FIRST_HOUR))) * 100)}%`;
      const scene = sceneRef.current;
      const cv = canvas.current;
      if (scene !== null && cv !== null) {
        const aspect = cv.clientWidth / Math.max(1, cv.clientHeight);
        const sx = pinned ? (rtl ? -PANEL_SHARE : PANEL_SHARE) : 0;
        const cam = cameraAt(p ?? 0, aspect, coast.current, sx);
        const key = [Math.round(h * 60), cam.az, cam.dist, cam.t[0], cam.sx, cv.clientWidth, cv.clientHeight].join();
        if (key !== last.current) {
          last.current = key;
          scene.set(h, cam);
        }
      }
    };
    frame();
    const off = subscribeScroll(frame);
    const queries = [media(NARROW_QUERY), media(REDUCED_QUERY)].filter((q): q is MediaQueryList => q !== null);
    const reset = (): void => {
      last.current = "";
      frame();
    };
    for (const q of queries) q.addEventListener("change", reset);
    return () => {
      off();
      for (const q of queries) q.removeEventListener("change", reset);
    };
  }, [mode, rtl]);

  const reading = grid === null || step === 0 ? null : readingAt(grid, omaa, hour);
  const num = new Intl.NumberFormat("en-US", { useGrouping: false });
  const eyebrow = t("scene.eyebrow", { hour: hourLabel(hour), date: dateLabel });
  const above = reading === null ? "" : num.format(reading.cellsAbove);
  const allAbove = useMemo(() => (grid === null ? null : allAboveRange(grid)), [grid]);

  return (
    <section ref={section} id="forecast" className="ch ch1" data-ch="1" data-scene={mode} aria-labelledby="h1">
      <div className="stage" data-step={step}>
        <figure className="inst" aria-label={region}>
          <figcaption className="ih">
            <p className="chi">{`01 / ${t("rail.forecast")}`}</p>
            <div className="ihr">
              <p className="src">
                <span>{t("scene.measure")}</span>
                <span>{sourceLine}</span>
              </p>
              <p className="clock">
                <span ref={clock}>{clockText(FIRST_HOUR)}</span>
                <small>{when}</small>
              </p>
            </div>
          </figcaption>
          <div className="body">
            {/* The text and the map are siblings, not parent and child: on a narrow screen the map is a box in a column under the text, and a
                text block inside the positioned map box would be painted over by the canvas or the still image (the hero went missing there). */}
            <div className="txt">
              <div className="s s0">{hero}</div>
              <div className="s s1">
                <p className="eb">{eyebrow}</p>
                <p className="big">
                  <b className="n">{above}</b>
                </p>
                <p className="sen">{reading === null ? "" : t("scene.cells", { total: num.format(reading.cells), limit: LIMIT_C.toFixed(1) })}</p>
                <p className="sen2">{reading !== null && allAbove !== null && reading.cellsAbove === reading.cells ? t("scene.allAbove", { from: hourLabel(allAbove[0]), to: hourLabel(allAbove[1]) }) : ""}</p>
              </div>
              <div className="s s2">
                <p className="eb">{eyebrow}</p>
                <p className="big">
                  <b className="n">{reading === null ? "" : reading.hottest.value.toFixed(1)}</b>
                  <span className="un">°C</span>
                </p>
                <p className="sen">{reading === null ? "" : t("scene.hottest", { hour: hourLabel(hour) })}</p>
                <p className="sen2">{reading === null ? "" : t("scene.where", { lat: reading.hottest.lat.toFixed(2), lon: reading.hottest.lon.toFixed(2) })}</p>
              </div>
              <div className="s s3">
                <p className="eb">{eyebrow}</p>
                <p className="big">
                  <b className="n">{reading === null ? "" : reading.station.toFixed(1)}</b>
                  <span className="un">°C</span>
                </p>
                <p className="sen">{reading === null ? "" : t("scene.station", { station: t("field.stations.OMAA"), hour: hourLabel(hour) })}</p>
                <p className="sen2" />
              </div>
            </div>
            <div className="mapwrap">
              <canvas ref={canvas} aria-hidden="true" />
              <div ref={labels} className="labels" aria-hidden="true" />
              {/* eslint-disable-next-line @next/next/no-img-element -- a decorative still of a fixed size from /public, shown only where the scene does not run; the optimizer adds nothing */}
              {mode === "poster" ? <img className="poster" src={POSTER_SRC} alt="" width={1000} height={751} /> : null}
              <p role="status" className="sr-only">
                {mode === "loading" ? t("field.loading") : ""}
              </p>
            </div>
          </div>
          <div className="ik">
            <div className="dayrule" aria-hidden="true">
              <div className="rl">
                <i ref={rule} />
              </div>
              <div className="tl">
                {[6, 8, 10, 12, 14].map((h) => (
                  <span key={h}>{pad2(h)}</span>
                ))}
              </div>
            </div>
            <div className="ikr">
              {legend}
              <div className="how">
                <p className="cap">{t("field.caption")}</p>
                <p className="k">{mode === "live" ? t("scene.how", { exag: String(RELIEF) }) : mode === "poster" ? t("scene.howPoster") : ""}</p>
              </div>
            </div>
            <p className="attr">{attribution}</p>
          </div>
        </figure>
      </div>
    </section>
  );
}

/** The first and last hour of the day at which every cell is above the limit (null when there is none). */
function allAboveRange(grid: FieldGrid): readonly [number, number] | null {
  const cells = grid.lat.length * grid.lon.length;
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) if (readingAt(grid, [], h).cellsAbove === cells) hours.push(h);
  const first = hours[0];
  const lastHour = hours[hours.length - 1];
  return first === undefined || lastHour === undefined ? null : [first, lastHour];
}
