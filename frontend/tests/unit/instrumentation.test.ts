// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { register } from "@/instrumentation";

/*
 * Next.js calls `register()` once when the server starts and takes no request until it returns, so a throw there means nothing is
 * served under a bad UPSTREAM_TIMEOUT_MS or UPSTREAM_READ_TIMEOUT_MS. This file pins only what `register` does with each environment.
 * What the standalone server does with that throw is NOT proved here: it stays up, logs the message and answers 500 to every request,
 * `/api/healthz` included. That was measured by hand against the production build (Next 16.4.6) and is written down in
 * `src/instrumentation.ts` and the README ("Runtime configuration"); no automated test covers it.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("register", () => {
  it("accepts a valid or unset environment on the Node.js runtime", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("UPSTREAM_TIMEOUT_MS", "");
    vi.stubEnv("UPSTREAM_READ_TIMEOUT_MS", "45000");

    expect(() => {
      register();
    }).not.toThrow();
  });

  it.each([
    ["UPSTREAM_TIMEOUT_MS", "10s", "15000"],
    ["UPSTREAM_TIMEOUT_MS", "15001", "15000"],
    ["UPSTREAM_READ_TIMEOUT_MS", "120001", "120000"],
    ["UPSTREAM_READ_TIMEOUT_MS", "0", "120000"],
  ])("throws on %s=%s, naming the variable, the value and its range (1 to %s)", (name, value, max) => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv(name, value);

    expect(() => {
      register();
    }).toThrow(new RegExp(`${name}="${value}".*1 to ${max}`));
  });

  it("checks nothing on another runtime (the edge has no BFF)", () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("UPSTREAM_TIMEOUT_MS", "10s");

    expect(() => {
      register();
    }).not.toThrow();
  });
});

describe("who may import the limits", () => {
  /** Whether `source`, the text of the file at `file` (a path under src/, forward slashes), loads the limits module by any form of specifier. */
  function importsLimits(source: string, file: string): boolean {
    // Every module specifier in the file: `from "x"` (import and re-export, any number of lines), `import "x"`, `import("x")`, `require("x")`.
    const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    return specifiers.some((specifier) => {
      // The alias `@/` is src/; a relative specifier is resolved against the importing file's folder; a package name never is the module.
      const target = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? posix.join(posix.dirname(file), specifier) : null;
      return target !== null && /^lib\/upstream-timeouts(\.tsx?)?$/.test(target);
    });
  }

  /** Every source file under src/ that imports the limits module, as a path under src/. */
  function importers(): string[] {
    const found: string[] = [];
    const srcRoot = join(process.cwd(), "src");
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry)) {
          const file = path.slice(srcRoot.length + 1).replaceAll("\\", "/");
          if (importsLimits(readFileSync(path, "utf8"), file)) found.push(file);
        }
      }
    };
    walk(srcRoot);
    return found.sort();
  }

  it("only the BFF route and instrumentation.ts, so no client bundle reads a server variable", () => {
    expect(importers()).toEqual(["app/api/v1/[...path]/route.ts", "instrumentation.ts"]);
  });

  // Non-vacuous: the matcher must catch every way a file can load the module, not only the alias spelling.
  it.each([
    ["the alias", `import { upstreamTimeouts } from "@/lib/upstream-timeouts";`, "components/A.tsx"],
    ["a relative specifier", `import { upstreamTimeouts } from "../lib/upstream-timeouts";`, "components/A.tsx"],
    ["a relative specifier with an extension", `import { x } from "../../lib/upstream-timeouts.ts";`, "features/today/A.tsx"],
    ["a dynamic import", `const m = await import("@/lib/upstream-timeouts");`, "components/A.tsx"],
    ["a dynamic relative import", `const m = await import('../lib/upstream-timeouts');`, "components/A.tsx"],
    ["a require", `const m = require("@/lib/upstream-timeouts");`, "components/A.tsx"],
    ["a re-export", `export { isSafetyRoute } from "@/lib/upstream-timeouts";`, "lib/other.ts"],
    ["a side-effect import", `import "@/lib/upstream-timeouts";`, "components/A.tsx"],
    ["a multi-line import", `import {\n  upstreamTimeouts,\n} from "@/lib/upstream-timeouts";`, "components/A.tsx"],
  ])("detects %s", (_form, source, file) => {
    expect(importsLimits(source, file)).toBe(true);
  });

  it.each([
    ["another module", `import { x } from "@/lib/upstream-timeouts-other";`, "components/A.tsx"],
    ["a sibling with the same name in another folder", `import { x } from "./upstream-timeouts";`, "components/A.tsx"],
    ["a relative path that ends elsewhere", `import { x } from "../lib/timeouts";`, "components/A.tsx"],
    ["no import at all", `const text = "upstream-timeouts";`, "components/A.tsx"],
  ])("does not flag %s", (_form, source, file) => {
    expect(importsLimits(source, file)).toBe(false);
  });

  it("a relative specifier is resolved against the importing file (./upstream-timeouts inside src/lib is the module)", () => {
    expect(importsLimits(`import { x } from "./upstream-timeouts";`, "lib/other.ts")).toBe(true);
  });
});
