import { hourLabel, LIMIT_C, readingAt, type FieldGrid, type FieldReading } from "./field-data";

/*
 * The words and numbers of the pinned forecast scene's three captions, as plain data: ONE function builds them, and both the captions drawn over the
 * map (ForecastStage.tsx, from the grid the browser fetched) and the always-present text summary for screen readers (SceneSummary.tsx, from the grid
 * the server read) take them from here, so the two cannot say different things. The numbers come from the recorded forecast grid (field-data.ts); the
 * sentences are message templates (judge.landing.scene.*) filled with locale-neutral digits, never string concatenation.
 */

export type CaptionKey = "cells" | "hottest" | "station";

/** One caption: its small line, the one giant number (with its unit when it has one), the sentence under it and an optional second line. */
export interface Caption {
  readonly eyebrow: string;
  readonly value: string;
  readonly unit: string;
  readonly sentence: string;
  readonly detail: string;
}

export type Captions = Readonly<Record<CaptionKey, Caption>>;

/** The messages (under `judge.landing`) the captions are made of. */
export type CaptionMessage = "scene.eyebrow" | "scene.cells" | "scene.allAbove" | "scene.hottest" | "scene.where" | "scene.station" | "field.stations.OMAA";

/** A message lookup: next-intl's `t` for `judge.landing`. */
export type Say = (key: CaptionMessage, values?: Record<string, string | number>) => string;

/** The hour at which each caption is at rest in the pinned scene (the scene holds 09:00 for the first and 14:00 for the other two; see landing-camera.ts). */
export const CAPTION_HOURS: Readonly<Record<CaptionKey, number>> = { cells: 9, hottest: 14, station: 14 };

/** Digits are Western in every language on this page (the clock is too). */
const NUMBER = new Intl.NumberFormat("en-US", { useGrouping: false });

const BLANK: Caption = { eyebrow: "", value: "", unit: "", sentence: "", detail: "" };

/** The first and last hour of the day at which every cell is above the limit (null when there is none). */
export function allAboveRange(grid: FieldGrid): readonly [number, number] | null {
  const cells = grid.lat.length * grid.lon.length;
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) if (readingAt(grid, [], h).cellsAbove === cells) hours.push(h);
  const first = hours[0];
  const last = hours[hours.length - 1];
  return first === undefined || last === undefined ? null : [first, last];
}

export interface CaptionInput {
  /** What the grid and the station say at `hour`; null while the grid has not arrived (the eyebrows still show, the rest is empty). */
  readonly reading: FieldReading | null;
  readonly hour: number;
  readonly dateLabel: string;
  readonly allAbove: readonly [number, number] | null;
  readonly say: Say;
}

export function captionsAt({ reading, hour, dateLabel, allAbove, say }: CaptionInput): Captions {
  const eyebrow = say("scene.eyebrow", { hour: hourLabel(hour), date: dateLabel });
  const at = hourLabel(hour);
  if (reading === null) return { cells: { ...BLANK, eyebrow }, hottest: { ...BLANK, eyebrow, unit: "°C" }, station: { ...BLANK, eyebrow, unit: "°C" } };
  return {
    cells: {
      eyebrow,
      value: NUMBER.format(reading.cellsAbove),
      unit: "",
      sentence: say("scene.cells", { total: NUMBER.format(reading.cells), limit: LIMIT_C.toFixed(1) }),
      detail: allAbove !== null && reading.cellsAbove === reading.cells ? say("scene.allAbove", { from: hourLabel(allAbove[0]), to: hourLabel(allAbove[1]) }) : "",
    },
    hottest: {
      eyebrow,
      value: reading.hottest.value.toFixed(1),
      unit: "°C",
      sentence: say("scene.hottest", { hour: at }),
      detail: say("scene.where", { lat: reading.hottest.lat.toFixed(2), lon: reading.hottest.lon.toFixed(2) }),
    },
    station: {
      eyebrow,
      value: reading.station.toFixed(1),
      unit: "°C",
      sentence: say("scene.station", { station: say("field.stations.OMAA"), hour: at }),
      detail: "",
    },
  };
}

/** The three captions as they stand at rest (09:00, 14:00, 14:00), in the order the scene shows them: what the text summary says. */
export function restCaptions(grid: FieldGrid, omaa: readonly number[], dateLabel: string, say: Say): readonly Caption[] {
  const allAbove = allAboveRange(grid);
  return (["cells", "hottest", "station"] as const).map((key) => {
    const hour = CAPTION_HOURS[key];
    return captionsAt({ reading: readingAt(grid, omaa, hour), hour, dateLabel, allAbove, say })[key];
  });
}

/** What a caption says under its small line, read in order: the giant number with its unit, the sentence, the second line (words joined by a space). */
export function captionBody(caption: Caption): string {
  return [caption.value, caption.unit, caption.sentence, caption.detail].filter((part) => part !== "").join(" ");
}
