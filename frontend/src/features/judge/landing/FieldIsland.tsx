"use client";

import { useTranslations } from "next-intl";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { FieldCanvas2D, type FieldCanvasHandle } from "./FieldCanvas2D";
import type { FieldCanvasGLProps } from "./FieldCanvasGL";
import { readingAt } from "./field-data";
import type { LoadedField } from "./field-load";
import { FieldReadout, readoutText } from "./FieldReadout";
import type { FieldPanelProps } from "./FieldPoster";
import { FieldStage } from "./FieldStage";
import { HourScrubber, type NowHandle } from "./HourScrubber";
import { useFieldClock } from "./useFieldClock";
import { useReducedMotion } from "./useReducedMotion";
import { canUpgrade, detectEnv, orbitFromSearch, whenIdle } from "./webgl-support";

/*
 * The live hero: the field drawn from the recorded grid, the readout and the hour scrubber, driven by one clock. Loaded after
 * first paint (FieldGate) and never rendered on the server. The day plays once from the hottest hour, round the clock and back,
 * unless the reader prefers reduced motion; then it rests on the hottest hour and the scrubber is the control.
 *
 * The field is the 2D canvas first. When the page is idle and the browser has what the scene needs (webgl-support.ts), the WebGL
 * scene is imported (this route only, never a data route) and takes over once its first frame is drawn; if it gives itself up
 * (no WebGL, a lost context, under 30 frames per second for 2 seconds) the 2D canvas, which never stopped being correct, is drawn
 * again at the current hour. `data-field-path` on the stage says which one is showing.
 */

type Mode = "2d" | "webgl";

// Memoised: the island re-renders once per whole hour of a playing day, and neither canvas takes anything that changes with it.
const Flat2D = memo(FieldCanvas2D);

export function FieldIsland({ panel, data }: { readonly panel: FieldPanelProps; readonly data: LoadedField }) {
  const t = useTranslations("judge.landing.field");
  const flat = useRef<FieldCanvasHandle>(null);
  const gl = useRef<FieldCanvasHandle>(null);
  const calm = useReducedMotion();
  const nowLine = useRef<NowHandle>(null);
  const [mode, setMode] = useState<Mode>("2d");
  const [sliderFocused, setSliderFocused] = useState(false);
  const modeRef = useRef<Mode>("2d");
  const hourRef = useRef(panel.peakHour);
  const [scene, setScene] = useState<{ readonly Scene: ComponentType<FieldCanvasGLProps>; readonly hour: number; readonly azimuth: number } | null>(null);

  // The day plays on its own only if the reader had not asked for reduced motion when the page opened; asking later stops it.
  const [calmAtMount] = useState(calm);
  const clock = useFieldClock(panel.peakHour, !calmAtMount, (hour, playing) => {
    hourRef.current = hour;
    gl.current?.draw(hour, playing);
    if (modeRef.current === "2d") flat.current?.draw(hour, playing);
    // the now line of the scrubber moves in the DOM, every frame; React state carries only the whole hour (the clock's), so a playing day
    // re-renders the island about 1.5 times a second, not 60 (Part L1 fix round 3, minor 5)
    nowLine.current?.move(hour);
  });
  const pause = clock.pause;
  useEffect(() => {
    if (calm) pause();
  }, [calm, pause]);
  const reading = useMemo(() => readingAt(data.grid, panel.omaa, clock.hour), [data.grid, panel.omaa, clock.hour]);
  const text = readoutText(reading);

  // After the page is idle, and only where the browser can: import the WebGL scene. A browser that cannot never downloads it.
  useEffect(() => {
    if (!canUpgrade(detectEnv())) return;
    let live = true;
    const cancel = whenIdle(() => {
      import("./FieldCanvasGL").then(
        (module) => {
          // The hour the day is at when the scene arrives: it starts there, not at the peak.
          if (live) setScene({ Scene: memo(module.FieldCanvasGL), hour: hourRef.current, azimuth: orbitFromSearch(window.location.search) });
        },
        () => undefined, // the chunk did not load: the 2D field stays, which is the fallback anyway
      );
    });
    return () => {
      live = false;
      cancel();
    };
  }, []);

  const ready = useCallback(() => {
    modeRef.current = "webgl";
    setMode("webgl");
  }, []);
  const gaveUp = useCallback(() => {
    modeRef.current = "2d";
    setMode("2d");
    setScene(null);
    // The 2D canvas stopped drawing while the scene was up: bring it to the hour the day is at now.
    flat.current?.draw(hourRef.current, false);
  }, []);

  return (
    <>
      <FieldStage path={mode}>
        <div className={mode === "webgl" ? "invisible absolute inset-0" : "absolute inset-0"}>
          <Flat2D grid={data.grid} coast={data.coast} initialHour={panel.peakHour} rtl={panel.dir === "rtl"} handleRef={flat} />
        </div>
        {scene === null ? null : <scene.Scene grid={data.grid} coast={data.coast} initialHour={scene.hour} initialAzimuth={scene.azimuth} rtl={panel.dir === "rtl"} handleRef={gl} onReady={ready} onFail={gaveUp} />}
      </FieldStage>
      <FieldReadout
        reading={reading}
        live={!clock.playing && !sliderFocused}
        announce={t("scrubber.valueText", { hour: text.hour, hottest: text.hottest, station: text.station })}
        proof={panel.proof}
        source={t(panel.highestOfSeason ? "sourcePeak" : "sourcePlain", { day: panel.dayLabel })}
      />
      <HourScrubber
        values={panel.omaa}
        ban={panel.ban}
        position={clock.hour}
        nowRef={nowLine}
        hour={clock.hour}
        dir={panel.dir}
        dayLabel={panel.dayLabel}
        valueText={t("scrubber.valueText", { hour: text.hour, hottest: text.hottest, station: text.station })}
        interactive
        playing={clock.playing && !calm}
        calm={calm}
        onSeek={clock.seek}
        onToggle={clock.playing ? clock.pause : clock.play}
        onFocusChange={setSliderFocused}
      />
    </>
  );
}
