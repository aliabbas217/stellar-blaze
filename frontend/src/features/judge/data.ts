import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { components } from "@/api/schema";
import type { EvaluationInfo } from "@/components/provenance/proof";
import { checkEvalShape, checkEvaluationRecord, EVAL_FILES, EVAL_KINDS, sha256Hex, type EvalKind, type EvaluationSet } from "./eval-shape.mjs";
import { parseRosterFrontier, type RosterFrontier } from "./roster-frontier";

/*
 * The judge screens' data, read on the server only (the page is a React Server Component; nothing here reaches the
 * browser). Three exporter files (ADR 0034 section 4) and one static analysis file.
 *
 * Where a scored file comes from, in order, the first tier that has ANY of the three files winning for the whole page:
 *   1. data/eval/2026/<name>.json                     the held-out 2026 run: the only tier in production.
 *   2. data/eval/dev/<name>.2025.json                 the 2025 out-of-fold development run. Not production.
 *   3. tests/fixtures/eval/<name>.synthetic.json      made-up shapes for tests and gate screenshots. Not production,
 *                                                     and only with SB_SHAPE_FIXTURES=1.
 *   4. nothing: every table renders its pending state ("###" under one banner).
 * One tier per page, never a mixture: a 2026 table beside a dev one would read as a single result. A file missing from
 * the winning tier stays null (pending), it is not filled from a lower tier. A file in the wrong place (a dev export in
 * the 2026 directory) throws: it is a deployment error and must neither be shown nor quietly hidden.
 *
 * Production (NODE_ENV=production) opens no path of tier 2 or 3. tests/unit/features/judge/data.test.ts pins that with
 * unreadable files in both places.
 */

type Schemas = components["schemas"];

export type EvalSource = "2026" | "dev-2025" | "synthetic-shape" | "none";

/**
 * What the held-out run was locked to (`data/eval/2026/evaluation_record.json`, written by scripts/sync-eval-data.mjs from the run's
 * own artifacts). Only the 2026 tier has one.
 */
export interface EvaluationRecord {
  readonly evaluation_set: "scored_2026";
  /** The pre-registration lock the run was started under (from the go-ahead marker, tied to the run by `go_sha256`). */
  readonly lock_sha256: string;
  readonly go_sha256: string;
  readonly protocol_path: string;
  readonly protocol_commit: string;
  readonly protocol_sha256: string;
  readonly model_id: string;
  readonly files: Readonly<Record<string, { readonly commit: string; readonly sha256: string }>>;
  /** The 2025 development run: its primary hypothesis (H4) outcome, the "prior run". */
  readonly prior_run: { readonly evaluation_set: "dev_2025"; readonly h4_outcome: string; readonly commit: string };
  /** The amendments the run lists and the freeze addendum, each with the commit that wrote it and its SHA-256. */
  readonly amendments: readonly { readonly path: string; readonly commit: string; readonly sha256: string }[];
  readonly freeze: { readonly path: string; readonly commit: string; readonly sha256: string };
}

/** A file the page drew: its path relative to `data/` (what the proof drawer shows) and the SHA-256 of its bytes. */
export interface EvalFileInfo {
  readonly path: string;
  readonly sha256: string;
  /** The lock and protocol commit of the held-out run, on a 2026 file; the proof drawer shows them. */
  readonly evaluation?: EvaluationInfo;
}

export interface EvalData {
  readonly policy: Schemas["PolicyScoreboard"] | null;
  readonly plans: Schemas["PlanScoreboard"] | null;
  readonly day: Schemas["DemoDay"] | null;
  /** The roster frontier is recorded climatology, not a scored export: it is read whatever the tier. */
  readonly frontier: RosterFrontier | null;
  readonly source: EvalSource;
  /** The held-out run's lock and prior run (2026 tier only), or null. */
  readonly record: EvaluationRecord | null;
  /** Path and fingerprint of every file that was read, for `proofFromProvenance`. */
  readonly files: {
    readonly policy: EvalFileInfo | null;
    readonly plans: EvalFileInfo | null;
    readonly day: EvalFileInfo | null;
    readonly frontier: EvalFileInfo | null;
  };
}

export interface LoadEvalOptions {
  /** The `data/` directory. Default: `<cwd>/data`. */
  readonly dataRoot?: string;
  /** The synthetic fixtures directory. Default: `<cwd>/tests/fixtures/eval`. */
  readonly fixturesRoot?: string;
  /** Default: NODE_ENV is "production". */
  readonly production?: boolean;
  /** Default: SB_SHAPE_FIXTURES is "1". */
  readonly shapeFixtures?: boolean;
}

/** A file exists but is not what its location promises. The message names the file and what is wrong. */
export class EvalDataError extends Error {
  constructor(file: string, problem: string) {
    super(`${file}: ${problem}`);
    this.name = "EvalDataError";
  }
}

interface Tier {
  readonly source: Exclude<EvalSource, "none">;
  readonly set: EvaluationSet;
  /** Directory the files are read from, and the prefix of the path shown in the proof drawer. */
  readonly dir: string;
  readonly shown: string;
  readonly suffix: string;
}

/**
 * The `data/` directory. Development only: SB_EVAL_DATA_ROOT points the loader at another directory (the design gate uses it to
 * photograph the "file could not be read" states with a deliberately broken copy). Production never reads it: a build has exactly one
 * data root, `<cwd>/data`.
 */
function defaultDataRoot(production: boolean): string {
  const override = process.env.SB_EVAL_DATA_ROOT;
  return !production && override !== undefined && override !== "" ? override : path.join(process.cwd(), "data");
}

function tiersFor(options: LoadEvalOptions): readonly Tier[] {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const shapeFixtures = options.shapeFixtures ?? process.env.SB_SHAPE_FIXTURES === "1";
  const dataRoot = options.dataRoot ?? defaultDataRoot(production);
  const fixturesRoot = options.fixturesRoot ?? path.join(process.cwd(), "tests", "fixtures", "eval");
  const tiers: Tier[] = [
    { source: "2026", set: "scored_2026", dir: path.join(dataRoot, "eval", "2026"), shown: "eval/2026", suffix: ".json" },
  ];
  if (!production) {
    tiers.push({
      source: "dev-2025",
      set: "dev_2025",
      dir: path.join(dataRoot, "eval", "dev"),
      shown: "eval/dev",
      suffix: ".2025.json",
    });
    if (shapeFixtures) {
      tiers.push({
        source: "synthetic-shape",
        set: "dev_2025",
        dir: fixturesRoot,
        shown: "tests/fixtures/eval",
        suffix: ".synthetic.json",
      });
    }
  }
  return tiers;
}

/** The bytes of a file, or null when it does not exist. Any other failure (permissions, a directory) is real. */
async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function parseJson(bytes: Buffer, shown: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new EvalDataError(shown, `not valid JSON (${error instanceof Error ? error.message : "unreadable"})`);
  }
}

interface Read<T> {
  readonly value: T;
  readonly info: EvalFileInfo;
}

async function readTier(tier: Tier, kind: EvalKind): Promise<Read<unknown> | null> {
  const name = `${EVAL_FILES[kind].name}${tier.suffix}`;
  const bytes = await readIfPresent(path.join(tier.dir, name));
  if (bytes === null) return null;
  const shown = `${tier.shown}/${name}`;
  const value = parseJson(bytes, shown);
  const problem = checkEvalShape(kind, value, tier.set);
  if (problem !== null) throw new EvalDataError(shown, problem);
  return { value, info: { path: shown, sha256: sha256Hex(bytes) } };
}

/**
 * The roster frontier is a COMMITTED static file (data/static, copied into the build), so its absence is a failure like the
 * hourly forecast file's, never "not scored yet": the screens render their read-failure state, not an empty one.
 */
async function readFrontier(dataRoot: string): Promise<Read<RosterFrontier>> {
  const shown = "static/roster_frontier.json";
  const bytes = await readIfPresent(path.join(dataRoot, shown));
  if (bytes === null) throw new EvalDataError(shown, "the committed file is missing");
  try {
    return { value: parseRosterFrontier(parseJson(bytes, shown)), info: { path: shown, sha256: sha256Hex(bytes) } };
  } catch (error) {
    if (error instanceof EvalDataError) throw error;
    throw new EvalDataError(shown, `not the roster frontier shape (${error instanceof Error ? error.message : "unreadable"})`);
  }
}

/** The roster frontier on its own: its own failure domain, so a bad frontier file never hides a scored table and the reverse. */
export interface FrontierData {
  readonly frontier: RosterFrontier | null;
  readonly file: EvalFileInfo | null;
}

export async function loadFrontier(options: LoadEvalOptions = {}): Promise<FrontierData> {
  const read = await readFrontier(options.dataRoot ?? defaultDataRoot(options.production ?? process.env.NODE_ENV === "production"));
  return { frontier: read.value, file: read.info };
}

/** The three scored exporter files (no frontier), from the first tier that has any (see the file comment). */
export type ScoredData = Omit<EvalData, "frontier" | "files"> & { readonly files: Omit<EvalData["files"], "frontier"> };

/** The evaluation record of the 2026 tier, or null when the tier has none. A record that is not valid is a deployment error. */
async function readRecord(tier: Tier): Promise<EvaluationRecord | null> {
  if (tier.source !== "2026") return null;
  const bytes = await readIfPresent(path.join(tier.dir, "evaluation_record.json"));
  if (bytes === null) return null;
  const shown = `${tier.shown}/evaluation_record.json`;
  const value = parseJson(bytes, shown);
  const problem = checkEvaluationRecord(value);
  if (problem !== null) throw new EvalDataError(shown, problem);
  return value as EvaluationRecord;
}

export async function loadScored(options: LoadEvalOptions = {}): Promise<ScoredData> {
  let source: EvalSource = "none";
  let record: EvaluationRecord | null = null;
  let reads: Record<EvalKind, Read<unknown> | null> = { policy: null, plans: null, day: null };
  for (const tier of tiersFor(options)) {
    const found = await Promise.all(EVAL_KINDS.map((kind) => readTier(tier, kind)));
    if (found.some((read) => read !== null)) {
      source = tier.source;
      record = await readRecord(tier);
      reads = { policy: found[0] ?? null, plans: found[1] ?? null, day: found[2] ?? null };
      break;
    }
  }
  // The held-out files carry the lock they were scored under, so every proof of a 2026 number can show it.
  const withLock = (read: Read<unknown> | null): EvalFileInfo | null =>
    read === null ? null : record === null ? read.info : { ...read.info, evaluation: { lockSha256: record.lock_sha256, protocolCommit: record.protocol_commit, amendments: record.amendments, freeze: record.freeze } };

  return {
    // The shape was checked against the contract's required keys in readTier; the generated type is the contract.
    policy: (reads.policy?.value as Schemas["PolicyScoreboard"] | undefined) ?? null,
    plans: (reads.plans?.value as Schemas["PlanScoreboard"] | undefined) ?? null,
    day: (reads.day?.value as Schemas["DemoDay"] | undefined) ?? null,
    source,
    record,
    files: { policy: withLock(reads.policy), plans: withLock(reads.plans), day: withLock(reads.day) },
  };
}

/** The scored files and the frontier for the judge screens. Throws when either cannot be read; callers that can say which use the two loaders above. */
export async function loadEval(options: LoadEvalOptions = {}): Promise<EvalData> {
  const frontier = await loadFrontier(options);
  const scored = await loadScored(options);
  return { ...scored, frontier: frontier.frontier, files: { ...scored.files, frontier: frontier.file } };
}
