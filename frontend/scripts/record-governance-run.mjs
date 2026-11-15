// Records one run of the governance refusal for the judge screen (`/replay/governance`): the employer's data request, the
// 403 problem the service answers with, and the transparency-log row it wrote. The page draws this file at first paint
// (src/features/judge/governance/load-recorded.ts), so it exists before any visitor presses the button and the page reads
// the same with the API stopped.
//
//   node scripts/record-governance-run.mjs --with-mock           # against the mock API (MSW handlers), source "msw-mock"
//   node scripts/record-governance-run.mjs --api http://127.0.0.1:8000 --token <employer token>
//                                                                # against the real service, source "api"
//
// Options: --api <origin> (default $API_ORIGIN, then http://127.0.0.1:4010), --token <bearer> (default $SB_RECORD_TOKEN, then a
// test value that only the mock API accepts), --out <file> (default data/recorded/governance-run.json), --with-mock (starts the
// mock API for the duration of the run and stops it, even on failure).
//
// It refuses to write anything that is not a refusal: anything but a 403 `individual-data-refused` problem and a log row is an
// error, and the existing file is left untouched. The recorded `worker_ref` is the made-up example the page sends; the service
// discards it, so no personal data is in the file. Run it again when the real API runs, and commit the new file.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REFUSED_TYPE = "urn:stellar-blaze:problem:individual-data-refused";
// Keep in step with SYNTHETIC_WORKER_REF in src/features/judge/governance/answer.ts (a unit test pins both).
const WORKER_REF = "synthetic-example-worker";
const MOCK_PORT = 4010;

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const withMock = process.argv.includes("--with-mock");
const origin = withMock ? `http://127.0.0.1:${String(MOCK_PORT)}` : (arg("api") ?? process.env.API_ORIGIN ?? `http://127.0.0.1:${String(MOCK_PORT)}`);
const token = arg("token") ?? process.env.SB_RECORD_TOKEN ?? "record-governance-run-test-token";
const out = path.resolve(root, arg("out") ?? "data/recorded/governance-run.json");

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

  const requestPath = `/api/v1/sites/${site.id}/data-requests`;
  const body = { subject: "worker", data_class: "health", worker_ref: WORKER_REF };
  const sentAt = new Date().toISOString();
  const response = await fetch(`${origin}${requestPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const answeredAt = new Date().toISOString();
  const problem = await response.json();
  if (response.status !== 403 || problem.type !== REFUSED_TYPE) {
    throw new Error(`not a refusal: ${String(response.status)} ${JSON.stringify(problem)}`);
  }

  const log = await (await fetch(`${origin}/api/v1/sites/${site.id}/transparency-log`)).json();
  const newest = log.entries[0];
  if (newest === undefined || newest.kind !== "data_request.refused") throw new Error("the refusal wrote no audit row");

  return {
    recorded_at: answeredAt,
    source: withMock ? "msw-mock" : (arg("source") ?? "api"),
    site_id: site.id,
    request: { method: "POST", path: requestPath, sent_at: sentAt, body },
    response: { status: 403, content_type: response.headers.get("content-type") ?? "application/problem+json", answered_at: answeredAt, body: problem },
    // A recorded run is one request and the one row it caused: the newest row, not the site's whole history.
    log: { site_id: log.site_id, entries: [newest] },
  };
}

let mock;
try {
  if (withMock) {
    mock = spawn(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/mock-api.ts"],
      { cwd: root, stdio: "ignore" },
    );
    await waitFor(`${origin}/api/v1/sites`);
  }
  const run = await record();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`recorded ${path.relative(root, out)} (${run.source}, request ${run.response.body.request_id ?? "without id"})`);
} catch (error) {
  console.error(`record-governance-run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  mock?.kill();
}
