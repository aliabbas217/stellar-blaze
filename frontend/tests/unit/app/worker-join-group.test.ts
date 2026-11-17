import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The join page's route group (redesign S6a). It is a group of its own, beside `(app)` and `(sheet)`, because it needs a third thing: the
 * field shell with the language pill, but NO dock (a worker with no crew has no Today, Alerts or unwell tab to go to)
 * and NO demo context (it would read the site list a second time) and no query client (its two reads are a plain effect). The URL is `/<locale>/worker/join`; a route group is not a segment.
 * tests/e2e/worker-join.spec.ts pins the behaviour on the production build.
 */

const WORKER = join(process.cwd(), "src/app/[locale]/(worker)/worker");
const code = (path: string) =>
  readFileSync(join(WORKER, path), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join("\n");

describe("the worker join route group", () => {
  it("has the join page, and no other page", () => {
    expect(existsSync(join(WORKER, "(join)/join/page.tsx"))).toBe(true);
    expect(existsSync(join(WORKER, "(app)/join"))).toBe(false);
    expect(existsSync(join(WORKER, "(sheet)/join"))).toBe(false);
  });

  it("mounts the field shell, and no query client (TanStack Query alone puts the route over its budget), no dock, no demo context and no clock", () => {
    const layout = code("(join)/layout.tsx");
    expect(layout).toMatch(/FieldShell/);
    expect(layout).not.toMatch(/QueryProvider|dock|WorkerDock|DemoProvider|DemoClock|useDemo/);
  });

  it("reads only the namespaces the page uses", () => {
    expect(code("(join)/layout.tsx")).toMatch(/WORKER_JOIN_NAMESPACES/);
  });

  it("the page is static (the query string is read by the client view) and is kept out of search results", () => {
    const page = code("(join)/join/page.tsx");
    expect(page).not.toMatch(/searchParams|cookies\(|headers\(|PageProps/);
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
  });
});
