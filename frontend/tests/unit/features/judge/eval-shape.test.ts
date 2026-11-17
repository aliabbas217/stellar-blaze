import { readFileSync } from "node:fs";
import path from "node:path";
import { checkEvalShape, EVAL_FILES, EVAL_KINDS } from "@/features/judge/eval-shape.mjs";
import { renderSyntheticFiles } from "../../../fixtures/eval/synthetic";

interface OpenApi {
  readonly components: { readonly schemas: Readonly<Record<string, { readonly required?: readonly string[] }>> };
}

const contract = JSON.parse(
  readFileSync(path.join(process.cwd(), "openapi", "stellar-blaze.openapi.json"), "utf8"),
) as OpenApi;

const COMPONENT = { policy: "PolicyScoreboard", plans: "PlanScoreboard", day: "DemoDay" } as const;
const SYNTHETIC = renderSyntheticFiles();

describe("eval-shape", () => {
  it.each(EVAL_KINDS)("requires exactly the keys the contract requires of %s", (kind) => {
    const required = contract.components.schemas[COMPONENT[kind]]?.required ?? [];
    expect([...EVAL_FILES[kind].required].sort()).toEqual([...required].sort());
  });

  it.each(EVAL_KINDS)("accepts the synthetic %s file as a dev_2025 export and rejects it as a scored_2026 one", (kind) => {
    const value: unknown = JSON.parse(SYNTHETIC[EVAL_FILES[kind].name] ?? "");
    expect(checkEvalShape(kind, value, "dev_2025")).toBeNull();
    expect(checkEvalShape(kind, value, "scored_2026")).toMatch(/dev_2025/);
  });

  it("names what is wrong", () => {
    expect(checkEvalShape("day", [], "scored_2026")).toMatch(/not a JSON object/);
    expect(checkEvalShape("day", { evaluation_set: "scored_2026" }, "scored_2026")).toMatch(/lacks .*provenance/);
    const day = JSON.parse(SYNTHETIC["demo_day"] ?? "") as Record<string, unknown>;
    expect(checkEvalShape("day", { ...day, evaluation_set: "scored_2026", provenance: null }, "scored_2026")).toMatch(
      /provenance is not an object/,
    );
  });
});
