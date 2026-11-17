import { rel } from "@/features/risk/niosh";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";

/*
 * The one place a judge file meets a worker file (eslint.config.mjs forbids the import everywhere else): the judge
 * screens draw the NIOSH heavy-work limit as a constant, and this test keeps it equal to what the worker app computes.
 */
describe("heavy-work limit", () => {
  it("test_limit_equals_f1_rel_415", () => {
    expect(HEAVY_WORK_LIMIT_WBGT_C).toBe(Number(rel(415).toFixed(1)));
  });
});
