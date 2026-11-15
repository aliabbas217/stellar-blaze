// Records one run of the independent validator on the common roster (B0: 06:00-12:30 and 15:00-17:00) for the judge screen
// `/replay/try`. The page draws this file only when the visitor asks for "Show a recorded result" after a check did not get an
// answer, under a RECORDED stamp: it is what the validator said on the day it was recorded, never a fresh check.
//
//   node scripts/record-validator-run.mjs --with-mock             # against the mock API (MSW handlers), source "msw-mock"
//   node scripts/record-validator-run.mjs --api http://127.0.0.1:8000
//                                                                 # against the real service, source "api"
//
// Options: --api <origin> (default $API_ORIGIN, then http://127.0.0.1:4010), --out <file> (default
// data/recorded/validator-b0.json), --with-mock (starts the mock API for the duration of the run and stops it, even on
// failure). `validate_plan` is a public read-style call: no token. It refuses to write a file that is not a validator answer
// with at least one violation (the recorded result must show violations, or the state it stands in for would be empty).
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PORT = 4010;
// Keep in step with TEMPLATES.common and REPLAY_DATE (src/features/judge/validator/runs.ts, src/features/demo/constants.ts):
// tests/unit/features/judge/validator.test.ts pins both.
const SEGMENTS = [
  { start: "06:00", end: "12:30", state: "work" },
  { start: "15:00", end: "17:00", state: "work" },
];
const DATE = "2026-09-03";
const CREW = { workload: "heavy", headcount: 20, acclimatised: false, days_per_week: 6 };

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const withMock = process.argv.includes("--with-mock");
const origin = withMock ? `http://127.0.0.1:${String(MOCK_PORT)}` : (arg("api") ?? process.env.API_ORIGIN ?? `http://127.0.0.1:${String(MOCK_PORT)}`);
const out = path.resolve(root, arg("out") ?? "data/recorded/validator-b0.json");

async function waitFor(url, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${url} did not answer`);
}

async function record() {
  const sites = await (await fetch(`${origin}/api/v1/sites`)).json();
  const site = sites.find((candidate) => candidate.synthetic === true);
  if (site === undefined) throw new Error("no synthetic site in list_sites: refusing to record against a real one");
  const body = { site_id: site.id, date: DATE, crew: CREW, segments: SEGMENTS };
  const response = await fetch(`${origin}/api/v1/plans/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.status !== 200) throw new Error(`not an answer: ${String(response.status)} ${await response.text()}`);
  const answer = await response.json();
  if (answer.validator?.passed !== false || answer.validator.violations.length === 0) throw new Error("the common roster must have violations to be recorded");
  return {
    recorded_at: new Date().toISOString(),
    source: withMock ? "msw-mock" : (arg("source") ?? "api"),
    request: body,
    response: answer,
  };
}

let mock;
try {
  if (withMock) {
    mock = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/mock-api.ts"], { cwd: root, stdio: "ignore" });
    await waitFor(`${origin}/api/v1/sites`);
  }
  const run = await record();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`recorded ${path.relative(root, out)} (${run.source}, ${String(run.response.validator.violations.length)} violations)`);
} catch (error) {
  console.error(`record-validator-run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  mock?.kill();
}
