import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
const LOCK = "d9b9130a824c1861a9a28831b687a0b4a9208762c39afcc7ef946f45a6d09b92";

/** The evaluation record a release build needs, naming exactly the three files staged under data/eval/2026, and the published copies. */
function stageRecord(overrides: Record<string, unknown> = {}): void {
  const dir = path.join(root, "data", "eval", "2026");
  const files = Object.fromEntries(NAMES.map((name) => [`${name}.json`, { commit: "a".repeat(40), sha256: sha(readFileSync(path.join(dir, `${name}.json`))) }]));
  write(
    path.join(dir, "evaluation_record.json"),
    `${JSON.stringify({ evaluation_set: "scored_2026", lock_sha256: LOCK, go_sha256: "b".repeat(64), protocol_path: "p.md", protocol_commit: "c".repeat(40), protocol_sha256: "d".repeat(64), model_id: "m", files, prior_run: { evaluation_set: "dev_2025", h4_outcome: "negative", commit: "e".repeat(40) }, amendments: [{ path: "docs/a1.md", commit: "1".repeat(40), sha256: "2".repeat(64) }], freeze: { path: "docs/freeze.md", commit: "3".repeat(40), sha256: "4".repeat(64) }, ...overrides }, null, 2)}\n`,
  );
  for (const name of [...NAMES.map((n) => `${n}.json`), "evaluation_record.json"]) {
    mkdirSync(path.join(root, "public", "data", "eval", "2026"), { recursive: true });
    cpSync(path.join(dir, name), path.join(root, "public", "data", "eval", "2026", name));
  }
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
    stageRecord();
    expect(run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" }).status).toBe(0);

    write(path.join(root, "data", "eval", "2026", "demo_day.json"), SYNTHETIC["demo_day"] ?? "");
    const failing = run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toMatch(/demo_day\.json.*dev_2025/);
  });
});

describe("build-data-manifest.mjs: the evaluation record (the lock the run started under)", () => {
  function stage(): void {
    for (const name of NAMES) write(path.join(root, "data", "eval", "2026", `${name}.json`), scored(name));
  }

  it("test_build_requires_the_evaluation_record: three files and no record fail a release build, naming the record", () => {
    stage();
    const failing = run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain("evaluation_record.json is missing");
    // without the flag the screens simply show no lock
    expect(run("build-data-manifest.mjs", []).status).toBe(0);
  });

  it("fails when the record names other bytes than the files that ship (a stale record never passes for the run's)", () => {
    stage();
    stageRecord();
    writeFileSync(path.join(root, "data", "eval", "2026", "plan_scoreboard.json"), `${scored("plan_scoreboard")} `);
    const failing = run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain("plan_scoreboard.json is not the file the evaluation record names");
  });

  it("fails when a published copy differs from the file (the browser would recount other bytes), and when the lock is not a SHA-256", () => {
    stage();
    stageRecord();
    writeFileSync(path.join(root, "public", "data", "eval", "2026", "demo_day.json"), "{}\n");
    const copy = run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" });
    expect(copy.status).toBe(1);
    expect(copy.stderr).toContain("public/data/eval/2026/demo_day.json is missing or differs");
    stageRecord({ lock_sha256: "not a hash" });
    const lock = run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" });
    expect(lock.status).toBe(1);
    expect(lock.stderr).toContain("lock_sha256 is not a SHA-256");
  });
});

describe("sync-eval-data.mjs --git: the run's own objects", () => {
  const git = (repo: string, args: readonly string[]) =>
    spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });

  function repoWith(goText: string, runMeta: Record<string, unknown>): string {
    const repo = path.join(root, "b3");
    mkdirSync(repo, { recursive: true });
    git(repo, ["init", "-q"]);
    for (const name of NAMES) write(path.join(repo, "artifacts", "eval", "2026", `${name}.json`), scored(name));
    write(
      path.join(repo, "artifacts", "eval", "2026", "run_meta.json"),
      `${JSON.stringify({ protocol_path: "p.md", protocol_commit: "c".repeat(40), protocol_sha256: "d".repeat(64), model_id: "m", amendments: [{ commit: "1".repeat(40), path: "docs/a1.md", sha256: "2".repeat(64) }], ...runMeta })}\n`,
    );
    write(path.join(repo, "artifacts", "eval", "dev", "policy_scoreboard.2025.json"), `${JSON.stringify({ verdicts: [{ id: "H4", outcome: "negative" }] })}\n`);
    write(path.join(repo, "backend", "training", "2026-go.toml"), goText);
    write(path.join(repo, "docs", "research", "2026-11-15-preregistration-freeze.md"), "freeze addendum\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "run"]);
    return repo;
  }

  const GO = `lock_sha256 = "${LOCK}"\napproved_by = "x"\n`;

  it("copies the three files byte for byte and writes the record: the lock from the go-ahead marker, the commit of each file, the prior run", () => {
    const repo = repoWith(GO, { go_sha256: sha(GO) });
    const sync = run("sync-eval-data.mjs", ["--git", repo, "--rev", "HEAD", "--go-rev", "HEAD"]);
    expect(sync.stderr).toBe("");
    expect(sync.status).toBe(0);
    for (const name of NAMES) {
      expect(readFileSync(path.join(root, "data", "eval", "2026", `${name}.json`)).equals(Buffer.from(scored(name)))).toBe(true);
      expect(readFileSync(path.join(root, "public", "data", "eval", "2026", `${name}.json`)).equals(Buffer.from(scored(name)))).toBe(true);
    }
    const record = JSON.parse(readFileSync(path.join(root, "data", "eval", "2026", "evaluation_record.json"), "utf8")) as {
      lock_sha256: string;
      files: Record<string, { commit: string; sha256: string }>;
      prior_run: { h4_outcome: string };
    };
    expect(record.lock_sha256).toBe(LOCK);
    expect(record.files["demo_day.json"]?.sha256).toBe(sha(scored("demo_day")));
    expect(record.files["demo_day.json"]?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record.prior_run.h4_outcome).toBe("negative");
    // and the tree builds as a release
    expect(run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" }).status).toBe(0);
  });

  it("refuses a go-ahead marker the run did not hash (its lock is not the run's), and copies nothing", () => {
    const repo = repoWith(GO, { go_sha256: "f".repeat(64) });
    const sync = run("sync-eval-data.mjs", ["--git", repo, "--rev", "HEAD", "--go-rev", "HEAD"]);
    expect(sync.status).toBe(1);
    expect(sync.stderr).toContain("not the marker the run used");
    expect(existsSync(path.join(root, "data", "eval", "2026"))).toBe(false);
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

  it("then lets SB_REQUIRE_SCORED=1 build once the evaluation record is there (directory mode cannot write one: it has no go-ahead marker)", () => {
    stage2026();
    run("sync-eval-data.mjs", [artifacts]);
    expect(run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" }).stderr).toContain("evaluation_record.json is missing");
    stageRecord();
    expect(run("build-data-manifest.mjs", [], { SB_REQUIRE_SCORED: "1" }).status).toBe(0);
  });
});
