import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "./eval-shape.mjs";
import { DATA_MANIFEST } from "./manifest.generated";
import { parseHourlySeries, type HourlySeries } from "./facts";

/** Where the recorded hourly forecast sits, relative to `data/` (what the proof drawer shows), and what it is. */
export const HOURLY_FILE = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;

export interface HourlyData {
  readonly series: HourlySeries;
  readonly file: { readonly path: string; readonly sha256: string };
  /** The manifest's description of the file (source and fetch date), for the proof drawer. */
  readonly source: string;
}

/**
 * The day-1 forecast of the season at the demo station, read on the server. A committed file: if it is missing or its
 * shape is wrong the build must fail, not draw an empty chart, so this throws instead of returning null.
 */
export async function loadHourly(dataRoot: string = path.join(process.cwd(), "data")): Promise<HourlyData> {
  const bytes = await readFile(path.join(dataRoot, HOURLY_FILE));
  return {
    series: parseHourlySeries(JSON.parse(bytes.toString("utf8")) as unknown),
    file: { path: HOURLY_FILE, sha256: sha256Hex(bytes) },
    source: DATA_MANIFEST[HOURLY_FILE].source,
  };
}
