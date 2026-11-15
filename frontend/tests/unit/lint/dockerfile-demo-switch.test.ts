import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * `NEXT_PUBLIC_SB_DEMO` is inlined by `next build` (src/features/demo/constants.ts), so an image can only be a real, non-demo
 * image if the BUILD stage receives it; a build argument in the runtime stage, or none at all, would make "build with
 * NEXT_PUBLIC_SB_DEMO=0" impossible and every image a demo. The default must be empty: unset or empty is demo mode, the safe side.
 * Reviewed finding I5 of the F-worker feature review.
 */

const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
const stages = dockerfile.split(/^FROM /m).slice(1);
const build = stages.find((stage) => /\bAS build\b/.test(stage.split("\n")[0] ?? ""));
const runtime = stages.find((stage) => /\bAS runtime\b/.test(stage.split("\n")[0] ?? ""));

function indexOfLine(stage: string, pattern: RegExp): number {
  return stage.split("\n").findIndex((line) => pattern.test(line));
}

describe("Dockerfile: the demo switch is a build argument of the stage that builds", () => {
  it("has a build stage and a runtime stage", () => {
    expect(build).toBeDefined();
    expect(runtime).toBeDefined();
  });

  it("declares ARG NEXT_PUBLIC_SB_DEMO with an EMPTY default (empty is demo mode)", () => {
    expect(build).toMatch(/^ARG NEXT_PUBLIC_SB_DEMO=\s*$/m);
  });

  it("passes it into the build environment BEFORE `pnpm build` runs", () => {
    const stage = build ?? "";
    const arg = indexOfLine(stage, /^ARG NEXT_PUBLIC_SB_DEMO=/);
    const env = indexOfLine(stage, /^ENV NEXT_PUBLIC_SB_DEMO=\$\{NEXT_PUBLIC_SB_DEMO\}\s*$/);
    const run = indexOfLine(stage, /^RUN pnpm build\b/);
    expect(arg).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(arg);
    expect(run).toBeGreaterThan(env);
  });

  it("does not set it in the runtime stage (a runtime value cannot change what was inlined, and would only mislead)", () => {
    expect(runtime).not.toMatch(/NEXT_PUBLIC_SB_DEMO/);
  });

  it("keeps APP_VERSION where it was: a runtime-stage ARG", () => {
    expect(runtime).toMatch(/^ARG APP_VERSION=dev$/m);
  });
});
