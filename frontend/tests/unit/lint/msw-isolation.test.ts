import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/*
 * MSW is the backend of the e2e run and of development, never of a production build (Part G3 M9). It reaches the browser or the
 * server bundle only if a module the app imports pulls in `msw` or `src/mocks`; the mock API runs as its own process
 * (`scripts/mock-api.ts`, `@msw/serve` on port 4010) and the unit tests import it directly. So the rule is structural: nothing under
 * `src/` outside `src/mocks/` may import `msw`, `@msw/*` or `@/mocks`/a relative path into it.
 */

const SRC = resolve(import.meta.dirname, "../../../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx|mjs)$/.test(name) ? [full] : [];
  });
}

const OFFENDING = /(?:from\s+|import\(\s*|import\s+)["'](?:msw(?:\/[^"']*)?|@msw\/[^"']+|@\/mocks(?:\/[^"']*)?|(?:\.\.?\/)+mocks(?:\/[^"']*)?)["']/;

describe("MSW stays out of the app bundle", () => {
  const app = files(SRC).filter((file) => !relative(SRC, file).replaceAll("\\", "/").startsWith("mocks/"));

  it("scans the app (the scan is not vacuous)", () => {
    expect(app.length).toBeGreaterThan(100);
  });

  it("no module outside src/mocks imports msw or src/mocks", () => {
    const offenders = app.filter((file) => OFFENDING.test(readFileSync(file, "utf8"))).map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("the pattern catches what it guards against", () => {
    expect(OFFENDING.test('import { http } from "msw";')).toBe(true);
    expect(OFFENDING.test('import { server } from "@/mocks/node";')).toBe(true);
    expect(OFFENDING.test('const m = await import("../mocks/handlers");')).toBe(true);
    expect(OFFENDING.test('import { x } from "@/api/queries";')).toBe(false);
  });
});
