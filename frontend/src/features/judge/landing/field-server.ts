import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "@/features/judge/eval-shape.mjs";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import type { HourlyData } from "@/features/judge/hourly";
import { parseField, peakHourOf, type FieldGrid } from "./field-data";

/*
 * The field the landing hero draws, read on the server: the recorded IFS forecast grid of the replay day, the station's
 * own series for the same day (from the hourly file the scoreboard draws), and the fingerprints for the proof chip. The
 * browser fetches the same two files itself (`/data/static/...`), after first paint; the server reads them for the first
 * HTML (the readout at the peak hour) and to prove the numbers. A file that is missing or malformed fails the build.
 */

export const FIELD_FILE = "static/uae_ifs025_d1_wbgt_2026-09-03.json" as const;
export const COAST_FILE = "static/coast.json" as const;

export interface FieldHeroData {
  readonly grid: FieldGrid;
  readonly file: { readonly path: string; readonly sha256: string };
  /** The manifest's description of the field file (source and fetch date). */
  readonly source: string;
  /** The station's own 24 hourly values for the field's day, from the recorded hourly file. */
  readonly omaa: readonly number[];
  readonly peakHour: number;
  /** Whether the field's day is the season's highest daily peak in the hourly file (the copy says so only when it is). */
  readonly highestOfSeason: boolean;
}

export async function loadFieldHero(hourly: HourlyData, dataRoot: string = path.join(process.cwd(), "data")): Promise<FieldHeroData> {
  const bytes = await readFile(path.join(dataRoot, FIELD_FILE));
  const grid = parseField(JSON.parse(bytes.toString("utf8")) as unknown);
  const index = hourly.series.days.indexOf(grid.day);
  const row = index < 0 ? undefined : hourly.series.wbgt_c_by_local_hour[index];
  if (row === undefined) throw new RangeError(`the hourly forecast file has no row for the field's day ${grid.day}`);
  const omaa = row.slice(0, 24).map((value, hour) => {
    if (value === null) throw new RangeError(`the hourly forecast file has no value for ${grid.day} hour ${String(hour)}`);
    return value;
  });
  const peaks = hourly.series.wbgt_c_by_local_hour.map((day) => Math.max(...day.filter((value): value is number => value !== null)));
  const seasonPeakDay = hourly.series.days[peaks.indexOf(Math.max(...peaks))];
  return {
    grid,
    file: { path: FIELD_FILE, sha256: sha256Hex(bytes) },
    source: DATA_MANIFEST[FIELD_FILE].source,
    omaa,
    peakHour: peakHourOf(omaa),
    highestOfSeason: seasonPeakDay === grid.day,
  };
}
