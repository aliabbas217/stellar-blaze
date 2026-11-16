// The registered-tests check (F2 Task 26, architect's ruling): the e2e suite must not LOSE a test without somebody saying so.
//
// Why: commit 8962cd1 closed a describe block in the wrong place; three tests silently stopped being registered while `tsc` and lint
// stayed green and the rest of the suite passed. A green run says nothing about a test that no longer exists.
//
// How: `playwright test --list --reporter=json` (no browser, no server) names every registered test per project. This compares them
// with a committed manifest (tests/e2e/registered-tests.json): the COUNT per spec file and per project, and the full TITLES. A
// missing, extra or renamed title or a changed count fails with a diff naming the file. The manifest changes only on purpose:
//   pnpm e2e:registered --write
// Usage: node scripts/check-e2e-registered.mjs [--write] [--manifest <path>]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The registered tests of a Playwright JSON listing, as { "<spec file>": { "<project>": ["<describe > test title>", ...sorted] } }.
 * `listing.suites` is a tree: file suites hold describe suites hold specs; every spec has one test per project it runs in.
 */
export function registeredFromListing(listing) {
  const out = {};
  const visit = (suite, titles, file) => {
    const here = suite.title === "" || suite.title === file ? titles : [...titles, suite.title];
    for (const spec of suite.specs ?? []) {
      const title = [...here, spec.title].join(" > ");
      for (const test of spec.tests ?? []) {
        const byProject = (out[file] ??= {});
        (byProject[test.projectName] ??= []).push(title);
      }
    }
    for (const child of suite.suites ?? []) visit(child, here, file);
  };
  for (const fileSuite of listing.suites ?? []) visit(fileSuite, [], fileSuite.file ?? fileSuite.title);
  for (const byProject of Object.values(out)) for (const titles of Object.values(byProject)) titles.sort();
  return out;
}

/** Every difference between the manifest and what is registered now, as one line each (empty when identical). */
export function compareRegistered(actual, expected) {
  const problems = [];
  const files = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const file of files) {
    const want = expected[file];
    const have = actual[file];
    if (want === undefined) {
      problems.push(`${file}: a spec file that is not in the manifest (${count(have)} tests registered)`);
      continue;
    }
    if (have === undefined) {
      problems.push(`${file}: in the manifest (${count(want)} tests) but NOTHING is registered: the file is gone, renamed or no longer matched`);
      continue;
    }
    const projects = [...new Set([...Object.keys(want), ...Object.keys(have)])].sort();
    for (const project of projects) {
      const wantTitles = want[project] ?? [];
      const haveTitles = have[project] ?? [];
      if (wantTitles.length !== haveTitles.length) problems.push(`${file} [${project}]: ${String(wantTitles.length)} registered in the manifest, ${String(haveTitles.length)} now`);
      const remaining = new Map();
      for (const title of haveTitles) remaining.set(title, (remaining.get(title) ?? 0) + 1);
      for (const title of wantTitles) {
        const left = remaining.get(title) ?? 0;
        if (left === 0) problems.push(`${file} [${project}]: MISSING (renamed or dropped): ${title}`);
        else remaining.set(title, left - 1);
      }
      for (const [title, left] of remaining) for (let i = 0; i < left; i++) problems.push(`${file} [${project}]: EXTRA (new or renamed): ${title}`);
    }
  }
  return problems;
}

function count(byProject) {
  return Object.values(byProject).reduce((sum, titles) => sum + titles.length, 0);
}

function listRegistered(cwd) {
  const cli = join(cwd, "node_modules", "@playwright", "test", "cli.js");
  const run = spawnSync(process.execPath, [cli, "test", "--list", "--reporter=json"], {
    cwd,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`playwright test --list failed (${String(run.status)}):\n${run.stderr}`);
  const listing = JSON.parse(run.stdout);
  if ((listing.errors ?? []).length > 0) throw new Error(`playwright reported errors while listing:\n${JSON.stringify(listing.errors, null, 2)}`);
  return registeredFromListing(listing);
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const at = args.indexOf("--manifest");
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const manifestPath = at >= 0 ? (args[at + 1] ?? "") : join(cwd, "tests", "e2e", "registered-tests.json");
  const actual = listRegistered(cwd);
  const total = Object.values(actual).reduce((sum, byProject) => sum + count(byProject), 0);
  if (total === 0) {
    console.error("registered-tests check: Playwright lists NO test: it cannot be trusted (a config or import error), not a pass");
    process.exit(1);
  }
  if (write) {
    writeFileSync(manifestPath, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`registered-tests manifest written: ${String(Object.keys(actual).length)} spec files, ${String(total)} tests (${relative(cwd, manifestPath)})`);
    return;
  }
  const expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  const problems = compareRegistered(actual, expected);
  if (problems.length > 0) {
    console.error(`registered-tests check FAILED (${String(problems.length)} difference${problems.length === 1 ? "" : "s"}):\n${problems.map((p) => `  ${p}`).join("\n")}`);
    console.error("\nA test that is dropped on purpose, renamed or added changes the manifest on purpose: `pnpm e2e:registered --write`, and say so in the commit.");
    process.exit(1);
  }
  console.log(`registered-tests check ok: ${String(Object.keys(actual).length)} spec files, ${String(total)} tests registered, as in the manifest`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
