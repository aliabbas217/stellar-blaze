import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderSyntheticFiles } from "../../fixtures/eval/synthetic";

const FRONTEND = process.cwd();
const SYNTHETIC = renderSyntheticFiles();
const NAMES = ["policy_scoreboard", "plan_scoreboard", "demo_day"] as const;

let root: string;
let artifacts: string;

function run(script: string, args: readonly string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(FRONTEND, "scripts", script), "--root", root, ...args],
    { encoding: "utf8", env: { ...process.env, SB_REQUIRE_SCORED: "", SB_EVAL_ARTIFACTS: "", ...env } },
  );
}

/** A scored (2026) copy of the synthetic file: same shape, evaluation_set flipped, so only the location differs. */
function scored(name: string): string {
  const parsed = JSON.parse(SYNTHETIC[name] ?? "") as Record<string, unknown>;
  return `${JSON.stringify({ ...parsed, evaluation_set: "scored_2026" }, null, 2)}\n`;
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sb-scripts-"));
  artifacts = path.join(root, "artifacts-eval");
  cpSync(path.join(FRONTEND, "data", "static"), path.join(root, "data", "static"), { recursive: true });
  mkdirSync(path.join(root, "public", "data"), { recursive: true });
  mkdirSync(path.join(root, "src", "features", "judge"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("build-data-manifest.mjs", () => {
  it("writes the manifest, the generated module and the public copies, and --check then agrees", () => {
    const written = run("build-data-manifest.mjs", []);
    expect(written.stderr).toBe("");
    expect(written.status).toBe(0);
    expect(existsSync(path.join(root, "public", "data", "static", "coast.json"))).toBe(true);
    expect(existsSync(path.join(root, "src", "features", "judge", "manifest.generated.ts"))).toBe(true);
    expect(run("build-data-manifest.mjs", ["--check"]).status).toBe(0);
  });

  it("--check fails when a file changed after the manifest was written, and names it", () => {
    run("build-data-manifest.mjs", []);
    writeFileSync(path.join(root, "data", "static", "coast.json"), "{}\n");
    const check = run("build-data-manifest.mjs", ["--check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("coast.json");
  });

  it("--check fails when a public copy differs from its source", () => {
    run("build-data-manifest.mjs", []);
    writeFileSync(path.join(root, "public", "data", "static", "roster_frontier.json"), "{}\n");
    const check = run("build-data-manifest.mjs", ["--check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("roster_frontier.json");
  });

  it("test_build_requires_scored_files: SB_REQUIRE_SCORED=1 fails while a 2026 file is missing, naming each", () => {
    write(path.join(root, "data", "eval", "2026", "policy_scoreboard.json"), scored("policy_scoreboard"));
    const failing = run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain("plan_scoreboard.json");
    expect(failing.stderr).toContain("demo_day.json");
    expect(failing.stderr).not.toContain("policy_scoreboard.json");
    // The same tree builds when the flag is off: the screens render the pending state.
    expect(run("build-data-manifest.mjs", []).status).toBe(0);
  });

  it("SB_REQUIRE_SCORED=1 passes with all three, and fails for a development file in the 2026 location", () => {
    for (const name of NAMES) write(path.join(root, "data", "eval", "2026", `${name}.json`), scored(name));
    expect(run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" }).status).toBe(0);

    write(path.join(root, "data", "eval", "2026", "demo_day.json"), SYNTHETIC["demo_day"] ?? "");
    const failing = run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toMatch(/demo_day\.json.*dev_2025/);
  });
});

describe("sync-eval-data.mjs", () => {
  function stage2026(): void {
    for (const name of NAMES) write(path.join(artifacts, "2026", `${name}.json`), scored(name));
  }

  it("copies the 2026 files into data/eval/2026 and public/data/eval/2026, byte for byte", () => {
    stage2026();
    const sync = run("sync-eval-data.mjs", [artifacts]);
    expect(sync.stderr).toBe("");
    expect(sync.status).toBe(0);
    for (const name of NAMES) {
      const source = readFileSync(path.join(artifacts, "2026", `${name}.json`));
      expect(readFileSync(path.join(root, "data", "eval", "2026", `${name}.json`)).equals(source)).toBe(true);
      expect(readFileSync(path.join(root, "public", "data", "eval", "2026", `${name}.json`)).equals(source)).toBe(true);
    }
  });

  it("takes the artifacts directory from SB_EVAL_ARTIFACTS when no argument is given", () => {
    stage2026();
    expect(run("sync-eval-data.mjs", [], { SB_EVAL_ARTIFACTS: artifacts }).status).toBe(0);
    expect(readdirSync(path.join(root, "data", "eval", "2026")).sort()).toEqual(NAMES.map((n) => `${n}.json`).sort());
  });

  it("copies development files as <name>.2025.json into data/eval/dev only, never into public", () => {
    for (const name of NAMES) write(path.join(artifacts, "dev", `${name}.json`), SYNTHETIC[name] ?? "");
    expect(run("sync-eval-data.mjs", [artifacts]).status).toBe(0);
    expect(readdirSync(path.join(root, "data", "eval", "dev")).sort()).toEqual(NAMES.map((n) => `${n}.2025.json`).sort());
    expect(existsSync(path.join(root, "public", "data", "eval", "dev"))).toBe(false);
  });

  it("validates before it copies: one bad file means nothing is copied and the exit code is 1", () => {
    stage2026();
    write(path.join(artifacts, "2026", "demo_day.json"), SYNTHETIC["demo_day"] ?? "");
    const sync = run("sync-eval-data.mjs", [artifacts]);
    expect(sync.status).toBe(1);
    expect(sync.stderr).toMatch(/demo_day\.json.*dev_2025/);
    expect(existsSync(path.join(root, "data", "eval", "2026"))).toBe(false);
    expect(existsSync(path.join(root, "public", "data", "eval"))).toBe(false);
  });

  it("fails with a usage line when there is no source directory, and when it holds no export at all", () => {
    expect(run("sync-eval-data.mjs", []).status).toBe(1);
    mkdirSync(artifacts, { recursive: true });
    const empty = run("sync-eval-data.mjs", [artifacts]);
    expect(empty.status).toBe(1);
    expect(empty.stderr).toMatch(/no .*file/i);
  });

  it("then lets SB_REQUIRE_SCORED=1 build", () => {
    stage2026();
    run("sync-eval-data.mjs", [artifacts]);
    expect(run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" }).status).toBe(0);
  });
});
