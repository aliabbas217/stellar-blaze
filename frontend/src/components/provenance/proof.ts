import type { components } from "@/api/schema";
import { buildStory, type ProofStory } from "./proof-story";

type Provenance = components["schemas"]["Provenance"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

/**
 * What a proof can be labelled. The first three are the generated `ProvenanceLabel` (REAL, REAL weather + assumed crew,
 * SIMULATED: the exporter's own labels). The generated type has neither of the other two, so they are mapped client-side:
 * "DEV 2025" for a file whose `evaluation_set` is `dev_2025` (or the synthetic shape fixtures), and "RECORDED" for the
 * static forecast and map files the landing and the scoreboard draw (data/static/MANIFEST.json). The caller says which,
 * through `options.label`; this module never guesses from the data.
 */
export type ProofLabel = "REAL" | "REAL weather + assumed crew" | "SIMULATED" | "DEV 2025" | "RECORDED";

/** The message key (under `states.proof.labels`) of each label: the drawer shows the contract's own wording. */
export const PROOF_LABELS = {
  REAL: "real",
  "REAL weather + assumed crew": "realAssumedCrew",
  SIMULATED: "simulated",
  "DEV 2025": "dev2025",
  RECORDED: "recorded",
} as const satisfies Record<ProofLabel, string>;

/** Everything the proof drawer shows for one number. Identifiers and hashes are data; the row names are messages. */
/**
 * What the held-out run was locked to, shown beside a number from a 2026 file: the lock, the protocol commit, and the amendments
 * and the freeze addendum the run lists (each with its commit and SHA-256), all from `evaluation_record.json`.
 */
export interface EvaluationInfo {
  readonly lockSha256: string;
  readonly protocolCommit: string;
  readonly amendments: readonly { readonly path: string; readonly commit: string; readonly sha256: string }[];
  readonly freeze: { readonly path: string; readonly commit: string; readonly sha256: string };
}

/**
 * What only an auditor needs and the story never says: the policy's code and threshold (a policy cell), and the verdict sentences
 * exactly as the scoring run wrote them (a verdict proof). Shown only in "For auditors"; a field with no value is not shown.
 */
export interface ProofAudit {
  readonly policy?: { readonly code: string; readonly threshold?: string };
  readonly verdicts?: readonly string[];
}

export interface Proof {
  /** The number in words, already localized by the caller ("Alerts per shift, P3 protect"). */
  readonly what: string;
  /**
   * The plain "Where this number comes from" story: built from the record's structured fields by `buildStory`, never from the
   * technical strings below. Every proof has one: a number shown outside "For auditors" is explained there first.
   */
  readonly story: ProofStory;
  /** The pre-registration line the metric is defined in: `<repo path>#<anchor>`, or the ruleset and configuration. Auditor layer only. */
  readonly protocol: string;
  /** Where that line can be read, when a public URL for the protocol exists. */
  readonly protocolHref: string | null;
  /** The script and function that produced it, `module:function @ commit`; null when no script wrote it (a live forecast). Auditor layer only. */
  readonly script: string | null;
  /** Policy code, threshold and the verdict sentences verbatim, when the proof has them. Auditor layer only. */
  readonly audit?: ProofAudit;
  /** The result file this page drew, relative to `data/` (`eval/2026/policy_scoreboard.json`), or an API response id. */
  readonly file: string;
  /** SHA-256 of the bytes of that file as this page drew them. */
  readonly fileSha256: string | null;
  /** SHA-256 of the input data the exporter read (`provenance.data_sha256`). */
  readonly sourceSha256: string | null;
  readonly label: ProofLabel;
  readonly modelId: string | null;
  /** UTC instant the file or forecast was written, ISO 8601. */
  readonly generatedAt: string | null;
  /**
   * The stable id of the number's proof sheet (`/replay/proof/<claim>`, for example `policy.p3.missed_danger_hours`), when
   * it has one. The drawer then offers a link to the sheet.
   */
  readonly claim?: string;
  /**
   * The held-out run's pre-registration lock (SHA-256 of the lock the run started under) and the commit of the protocol, on a
   * number from a 2026 result file. The drawer shows them: the label alone ("REAL") does not say the run was locked first.
   */
  readonly evaluation?: EvaluationInfo;
}

/**
 * Where the protocol can be read online. The pre-registration lives in the repository and there is no public URL for it
 * yet (parked, see the Task 6 report), so a protocol line is text, not a link. When one exists, this is the only place
 * to set it: `<base>/<protocol_path>#<anchor>`.
 */
export const PROTOCOL_BASE_URL: string | null = null;

const KNOWN_LABELS: ReadonlySet<string> = new Set<Provenance["label"]>(["REAL", "REAL weather + assumed crew", "SIMULATED"]);

// A number read from a development or synthetic file is never a result, whatever its provenance block says (a dev export
// can carry label REAL): the file's location decides, so no caller has to remember. Held-out files live under eval/2026/.
function isDevPath(file: string): boolean {
  return file.startsWith("eval/dev/") || file.startsWith("tests/fixtures/");
}

function filled(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The proof for a number from an exporter file. `null` when the provenance block is missing or incomplete (any of
 * protocol path, protocol anchor, script, function, commit, input hash, label, time): the caller then shows
 * `MissingProvenance` and never the number (ADR 0034 section 4).
 *
 * `anchor` is the metric's own heading slug (`Metric.anchor`); the block's `protocol_anchor` is the fallback.
 * `file` says which file the page drew and its SHA-256 (a script computes it; see `data.ts`). The brief's signature had
 * only the hash: a proof also needs the file's name, which the block does not carry.
 */
export function proofFromProvenance(
  provenance: Partial<Provenance> | null | undefined,
  anchor: string,
  what: string,
  file: { readonly path: string; readonly sha256: string | null; readonly evaluation?: EvaluationInfo },
  options: { readonly story: ProofStory; readonly label?: ProofLabel; readonly claim?: string; readonly audit?: ProofAudit },
): Proof | null {
  if (provenance === null || provenance === undefined) return null;
  const { protocol_path, protocol_anchor, script, function: fn, git_sha, data_sha256, label, generated_at } = provenance;
  if (!filled(protocol_path) || !filled(script) || !filled(fn) || !filled(git_sha) || !filled(data_sha256)) return null;
  if (!filled(label) || !KNOWN_LABELS.has(label) || !filled(generated_at)) return null;
  const slug = filled(anchor) ? anchor : protocol_anchor;
  if (!filled(slug)) return null;
  const fragment = slug.startsWith("#") ? slug : `#${slug}`;
  return {
    what,
    story: options.story,
    protocol: `${protocol_path}${fragment}`,
    protocolHref: PROTOCOL_BASE_URL === null ? null : `${PROTOCOL_BASE_URL}/${protocol_path}${fragment}`,
    script: `${script}:${fn} @ ${git_sha.slice(0, 12)}`,
    file: file.path,
    fileSha256: file.sha256,
    sourceSha256: data_sha256,
    label: isDevPath(file.path) ? "DEV 2025" : (options.label ?? label),
    modelId: provenance.model_id ?? null,
    generatedAt: generated_at,
    ...(options.claim === undefined ? {} : { claim: options.claim }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    // A development or synthetic file is not the held-out run: it never shows a lock.
    ...(file.evaluation === undefined || isDevPath(file.path) ? {} : { evaluation: file.evaluation }),
  };
}

/**
 * The proof for a number counted from a recorded static file (the forecast file, the roster analysis): there is no exporter
 * provenance block, so the caller says in words what the file is (`protocol`) and which function counted (`script`). The
 * label is the manifest's (RECORDED, or REAL weather + assumed crew); it is never a scored-result label.
 */
export function proofFromStaticFile(
  file: { readonly path: string; readonly sha256: string },
  what: string,
  source: { readonly story: ProofStory; readonly protocol: string; readonly script: string; readonly label: ProofLabel; readonly claim?: string },
): Proof {
  return {
    what,
    story: source.story,
    protocol: source.protocol,
    protocolHref: null,
    script: source.script,
    file: file.path,
    fileSha256: file.sha256,
    sourceSha256: null,
    label: source.label,
    modelId: null,
    generatedAt: null,
    ...(source.claim === undefined ? {} : { claim: source.claim }),
  };
}

/**
 * The proof for a number computed from the live (or replayed) forecast: which ruleset, configuration and corrector model
 * drew the level. `synthetic` is `Site.synthetic`: the forecast response does not say whether its site is the demo one,
 * so the caller passes it (the brief's signature had no site).
 */
export function proofFromForecast(
  forecast: SiteForecastToday,
  what: string,
  site: { readonly synthetic: boolean },
): Proof {
  return {
    what,
    // The plain story says what the level is; the ruleset and configuration that drew it are technical record, shown only under
    // "For auditors" (they used to print as `policy=... config=...` in the worker's drawer). No script wrote a live forecast.
    story: buildStory("level", {}),
    protocol: `Ruleset ${forecast.policy_version}, configuration ${String(forecast.config_version)}`,
    protocolHref: null,
    script: null,
    file: `${forecast.site_id}/forecast/today/${forecast.date}`,
    fileSha256: null,
    sourceSha256: null,
    label: site.synthetic ? "SIMULATED" : "REAL",
    modelId: forecast.model_id,
    generatedAt: forecast.generated_at,
  };
}

/**
 * Whether the record is missing details an exporter-backed number should have (a fingerprint of the file the page drew). A
 * recorded file or a live forecast has no exporter block, so its empty fields are expected and not "incomplete". The sheet says
 * so once, in one sentence, and prints no placeholder for the empty fields.
 */
export function isIncomplete(proof: Proof): boolean {
  return proof.sourceSha256 !== null && proof.fileSha256 === null;
}

// Files the browser may fetch back and hash: the committed static data and the held-out 2026 exports (both are copied
// under public/data/ by scripts/build-data-manifest.mjs and scripts/sync-eval-data.mjs). Development and synthetic files
// are never published, so they are never offered here.
const PUBLISHED = /^(static|eval\/2026)\/[A-Za-z0-9_.-]+\.json$/;

/** The same-origin URL of the file behind a proof, or null when it is not published (so there is nothing to recount). */
export function recountUrl(proof: Proof): string | null {
  if (proof.fileSha256 === null) return null;
  if (proof.file.includes("..") || !PUBLISHED.test(proof.file)) return null;
  return `/data/${proof.file}`;
}

export type RecountResult = "match" | "mismatch" | "unavailable";

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetches the file the proof names, hashes the bytes in this browser and compares with the fingerprint the page was
 * built with. Resolves "unavailable" when there is nothing to fetch; rejects when the file cannot be read (so the drawer
 * never reports a match it did not check).
 */
export async function recountSha256(proof: Proof): Promise<RecountResult> {
  const url = recountUrl(proof);
  if (url === null || proof.fileSha256 === null) return "unavailable";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  const actual = await sha256Hex(await response.arrayBuffer());
  return actual === proof.fileSha256.toLowerCase() ? "match" : "mismatch";
}
