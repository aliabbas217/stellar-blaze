import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderSyntheticFiles } from "../../../fixtures/eval/synthetic";

// `import "server-only"` throws outside a React Server Component bundle (that is its job); the module is under test, not it.
vi.mock("server-only", () => ({}));

const { EvalDataError, loadEval } = await import("@/features/judge/data");

const REPO_DATA = path.join(process.cwd(), "data");
const SYNTHETIC = renderSyntheticFiles();
const NAMES = ["policy_scoreboard", "plan_scoreboard", "demo_day"] as const;

let root: string;
let fixtures: string;

/** A scored (2026) copy of the synthetic file: same shape, evaluation_set flipped, so only the location differs. */
function scored(name: string): string {
  const parsed = JSON.parse(SYNTHETIC[name] ?? "") as Record<string, unknown>;
  return `${JSON.stringify({ ...parsed, evaluation_set: "scored_2026" }, null, 2)}\n`;
}

function put(relative: string, text: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function putDev(name: string): void {
  put(`eval/dev/${name}.2025.json`, SYNTHETIC[name] ?? "");
}

function putFixture(name: string): void {
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(path.join(fixtures, `${name}.synthetic.json`), SYNTHETIC[name] ?? "");
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sb-eval-"));
  fixtures = path.join(root, "fixtures");
  // The four static files are always present in the repo; the loader reads them from the same root.
  mkdirSync(path.join(root, "static"), { recursive: true });
  writeFileSync(
    path.join(root, "static", "roster_frontier.json"),
    readFileSync(path.join(REPO_DATA, "static", "roster_frontier.json")),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("loadEval", () => {
  it("returns nulls and source none when no file exists", async () => {
    const result = await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: false, shapeFixtures: true });
    expect(result).toMatchObject({ policy: null, plans: null, day: null, source: "none" });
    expect(result.frontier?.frontier_absolute_gate.length).toBeGreaterThan(0);
  });

  it("test_load_eval_prefers_2026_and_never_returns_dev_in_production: 2026 wins over dev and over the fixtures", async () => {
    for (const name of NAMES) {
      put(`eval/2026/${name}.json`, scored(name));
      putDev(name);
      putFixture(name);
    }
    const result = await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: false, shapeFixtures: true });
    expect(result.source).toBe("2026");
    expect(result.policy?.evaluation_set).toBe("scored_2026");
    expect(result.plans?.evaluation_set).toBe("scored_2026");
    expect(result.day?.evaluation_set).toBe("scored_2026");
    expect(result.files.policy?.path).toBe("eval/2026/policy_scoreboard.json");
  });

  it("keeps one source per page: a missing 2026 file stays pending and is never filled from the dev set", async () => {
    put("eval/2026/policy_scoreboard.json", scored("policy_scoreboard"));
    for (const name of NAMES) putDev(name);
    const result = await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: false, shapeFixtures: false });
    expect(result.source).toBe("2026");
    expect(result.policy).not.toBeNull();
    expect(result.plans).toBeNull();
    expect(result.day).toBeNull();
  });

  it("falls back to the dev 2025 files outside production and names them", async () => {
    for (const name of NAMES) putDev(name);
    const result = await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: false, shapeFixtures: false });
    expect(result.source).toBe("dev-2025");
    expect(result.policy?.evaluation_set).toBe("dev_2025");
    expect(result.files.day?.path).toBe("eval/dev/demo_day.2025.json");
  });

  it("reads the synthetic shape fixtures only with the flag, and says so in `source`", async () => {
    for (const name of NAMES) putFixture(name);
    const without = await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: false, shapeFixtures: false });
    expect(without.source).toBe("none");
    const withFlag = await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: false, shapeFixtures: true });
    expect(withFlag.source).toBe("synthetic-shape");
    expect(withFlag.policy?.provenance.label).toBe("SIMULATED");
  });

  it("never reads a dev or synthetic file in production: they are not even opened", async () => {
    // Garbage in every non-2026 location: a loader that opened one would throw on the JSON, not return nulls.
    for (const name of NAMES) {
      put(`eval/dev/${name}.2025.json`, "not json");
      mkdirSync(fixtures, { recursive: true });
      writeFileSync(path.join(fixtures, `${name}.synthetic.json`), "not json");
    }
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SB_SHAPE_FIXTURES", "1");
    const result = await loadEval({ dataRoot: root, fixturesRoot: fixtures });
    expect(result).toMatchObject({ policy: null, plans: null, day: null, source: "none" });
  });

  it("serves the 2026 files in production", async () => {
    for (const name of NAMES) put(`eval/2026/${name}.json`, scored(name));
    vi.stubEnv("NODE_ENV", "production");
    const result = await loadEval({ dataRoot: root, fixturesRoot: fixtures });
    expect(result.source).toBe("2026");
    expect(result.plans?.identical_by_construction).toEqual(["naive", "ban_only"]);
  });

  it("refuses a development file in the held-out 2026 location instead of showing or hiding it", async () => {
    put("eval/2026/policy_scoreboard.json", SYNTHETIC["policy_scoreboard"] ?? "");
    await expect(loadEval({ dataRoot: root, fixturesRoot: fixtures, production: true })).rejects.toThrow(EvalDataError);
    await expect(loadEval({ dataRoot: root, fixturesRoot: fixtures, production: true })).rejects.toThrow(
      /eval\/2026\/policy_scoreboard\.json.*dev_2025|scored_2026/,
    );
  });

  it("refuses a file that lacks a required key, naming it", async () => {
    const broken = JSON.parse(scored("demo_day")) as Record<string, unknown>;
    delete broken["hours"];
    put("eval/2026/demo_day.json", JSON.stringify(broken));
    await expect(loadEval({ dataRoot: root, fixturesRoot: fixtures, production: true })).rejects.toThrow(/hours/);
  });

  it("refuses a file that is not JSON, naming the path", async () => {
    put("eval/2026/plan_scoreboard.json", "{");
    await expect(loadEval({ dataRoot: root, fixturesRoot: fixtures, production: true })).rejects.toThrow(
      /eval\/2026\/plan_scoreboard\.json/,
    );
  });

  it("returns the file fingerprint of exactly the bytes it read", async () => {
    const text = scored("demo_day");
    put("eval/2026/demo_day.json", text);
    const { createHash } = await import("node:crypto");
    const result = await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: true });
    expect(result.files.day?.sha256).toBe(createHash("sha256").update(text).digest("hex"));
  });
});

describe("roster frontier reader", () => {
  it("reads the committed static file with the shape Task 8 draws", async () => {
    const result = await loadEval({ dataRoot: REPO_DATA, fixturesRoot: fixtures, production: true });
    const frontier = result.frontier;
    expect(frontier?.baselines.B1_legal_default).toBe("06:00-11:00 + 15:00-18:00");
    expect(frontier?.frontier_absolute_gate).toHaveLength(6);
    expect(frontier?.pareto_e30_vs_sleep[0]?.pareto.length).toBeGreaterThan(0);
    expect(result.files.frontier?.path).toBe("static/roster_frontier.json");
  });

  it("is null, not a throw, when the file is absent, and throws on a file of the wrong shape", async () => {
    rmSync(path.join(root, "static", "roster_frontier.json"));
    expect((await loadEval({ dataRoot: root, fixturesRoot: fixtures, production: true })).frontier).toBeNull();
    writeFileSync(path.join(root, "static", "roster_frontier.json"), JSON.stringify({ label: "x" }));
    await expect(loadEval({ dataRoot: root, fixturesRoot: fixtures, production: true })).rejects.toThrow(
      /roster_frontier/,
    );
  });
});
