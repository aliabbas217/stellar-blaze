import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseRecordedRun, toRecordedView, type RecordedView } from "./recorded";

/**
 * The recorded governance run, read at build time (the page is static) from data/recorded/governance-run.json. A missing or
 * unreadable file yields null and the page shows the "nothing recorded yet" state instead of a run: it never invents one. A
 * release build (SB_REQUIRE_SCORED=1) fails instead, as it does for a missing scored file: the hero must exist at first paint.
 */
export async function loadRecordedRun(root: string = process.cwd()): Promise<RecordedView | null> {
  const file = path.join(root, "data", "recorded", "governance-run.json");
  try {
    return toRecordedView(parseRecordedRun(JSON.parse(await readFile(file, "utf8")) as unknown));
  } catch (error) {
    if (process.env.SB_REQUIRE_SCORED === "1") throw error;
    console.error(`governance: no recorded run (${error instanceof Error ? error.message : "unreadable"})`);
    return null;
  }
}
