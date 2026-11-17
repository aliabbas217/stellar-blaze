import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * F2 W1, I4: the "I feel unwell" sheet is SILENT. The worker layout used to mount TanStack Query and the demo context for every
 * worker page, and the demo context fetches the site list on mount: opening the sheet then made a request, which tells the server
 * (and its logs, with the Referer) that this phone opened the emergency sheet. The fix is structural: the sheet sits in its own route
 * group, outside the group that holds the providers. The URL does not change (a route group is not a segment). These tests pin the
 * structure; tests/e2e/worker-unwell.spec.ts pins the behaviour on the production build (no request at all).
 */

const WORKER = join(process.cwd(), "src/app/[locale]/(worker)/worker");
const read = (path: string) => readFileSync(join(WORKER, path), "utf8");
const code = (path: string) =>
  read(path)
    .split("\n")
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join("\n");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]));
}

describe("the worker route groups", () => {
  it("the sheet is in its own group, and it is the only page there", () => {
    expect(existsSync(join(WORKER, "(sheet)/unwell/page.tsx"))).toBe(true);
    expect(existsSync(join(WORKER, "(app)/unwell"))).toBe(false);
    const pages = filesUnder(join(WORKER, "(sheet)")).filter((file) => /page\.tsx$/.test(file));
    expect(pages).toHaveLength(1);
  });

  it("the sheet's group mounts no query provider, no demo context and no clock that reads them", () => {
    for (const file of filesUnder(join(WORKER, "(sheet)")).filter((path) => /\.tsx?$/.test(path))) {
      const source = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
        .join("\n");
      expect(source, file).not.toMatch(/QueryProvider|DemoProvider|useDemo|DemoClock|useQuery|QueryClient|useClock|apiClient|features\/demo/);
    }
  });

  it("the app group is where the providers are, so Today, the alert and Alerts keep them", () => {
    const layout = code("(app)/layout.tsx");
    expect(layout).toMatch(/QueryProvider/);
    expect(layout).toMatch(/DemoProvider/);
    for (const page of ["page.tsx", "alert/page.tsx", "alerts/page.tsx"]) expect(existsSync(join(WORKER, "(app)", page)), page).toBe(true);
  });

  it("there is no layout above the two groups that would bring the providers back to the sheet", () => {
    expect(existsSync(join(WORKER, "layout.tsx"))).toBe(false);
  });

  it("the alert page is static: it takes no request data, so it can be precached", () => {
    const page = code("(app)/alert/page.tsx");
    expect(page).not.toMatch(/searchParams|cookies\(|headers\(|PageProps/);
  });
});
