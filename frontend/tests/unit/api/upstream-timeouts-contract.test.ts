// @vitest-environment node
import contract from "../../../openapi/stellar-blaze.openapi.json";
import { isSafetyRoute, pathSegmentsOf } from "@/lib/upstream-timeouts";

/*
 * Which requests the BFF holds to the short safety limit (UPSTREAM_TIMEOUT_MS) is DERIVED from the contract, not typed twice:
 * this reads every operation of `openapi/stellar-blaze.openapi.json` and asks `isSafetyRoute` about it. The safety set must be
 * exactly Stop work and its undo or resume, and an operation whose path contains `/stop` or whose id contains "stop" (any case) that is not written down below fails the
 * audit until someone decides whether it is a safety request (the same discipline as the cache-rule audit,
 * tests/unit/features/pwa/f2-cache-rules.test.ts). A stop operation that fell to the long read limit is a Stop that waits.
 */

/** The decision: these two, and only these, are safety requests (Stop work, and the 10 s undo or the end of a stop). */
const SAFETY_OPERATIONS: Readonly<Record<string, { readonly method: string; readonly path: string }>> = {
  create_crew_stop: { method: "POST", path: "/api/v1/crews/{crew_id}/stops" },
  delete_crew_stop: { method: "DELETE", path: "/api/v1/crews/{crew_id}/stops/{stop_id}" },
};

/** Operations that look like a stop (`/stop` in the path, or "stop" in the id, any case) that someone decided are NOT safety requests (none today; an entry needs a reason next to it). */
const NOT_SAFETY_STOP_OPERATIONS: readonly string[] = [];

interface Operation {
  readonly id: string;
  readonly method: string;
  readonly template: string;
  /** The template with `{parameters}` filled in, as a request path. */
  readonly path: string;
}

interface Contract {
  readonly paths: Readonly<Record<string, Readonly<Record<string, { readonly operationId?: string }>>>>;
}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function operationsOf(spec: Contract): Operation[] {
  const found: Operation[] = [];
  for (const [template, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation?.operationId === undefined) continue;
      found.push({
        id: operation.operationId,
        method: method.toUpperCase(),
        template,
        path: template.replace(/\{([^}]+)\}/g, (_whole, name: string) => `sample-${name}`),
      });
    }
  }
  return found;
}

/** Every problem found, as a sentence. Empty means the classifier and the contract agree and nothing is unclassified. */
function audit(spec: Contract, notSafety: readonly string[] = NOT_SAFETY_STOP_OPERATIONS): string[] {
  const problems: string[] = [];
  const operations = operationsOf(spec);

  for (const [id, expected] of Object.entries(SAFETY_OPERATIONS)) {
    const found = operations.find((operation) => operation.id === id);
    if (found?.method !== expected.method || found.template !== expected.path) {
      problems.push(`${id} is no longer ${expected.method} ${expected.path} in the contract: decide what the safety limit covers now`);
    }
  }

  for (const operation of operations) {
    const isSafety = isSafetyRoute(operation.method, pathSegmentsOf(operation.path));
    const shouldBe = operation.id in SAFETY_OPERATIONS;
    if (isSafety && !shouldBe) problems.push(`${operation.id} (${operation.method} ${operation.template}) is held to the safety limit but is not a recorded safety operation`);
    if (!isSafety && shouldBe) problems.push(`${operation.id} (${operation.method} ${operation.template}) is a safety operation but isSafetyRoute does not accept it`);
    // Anything that looks like it is about stopping work: `/stop` in the path (so also /stops, /stop-all) or "stop" in the operation id.
    const looksLikeStop = operation.template.includes("/stop") || operation.id.toLowerCase().includes("stop");
    if (looksLikeStop && !shouldBe && !notSafety.includes(operation.id)) {
      problems.push(`${operation.id} (${operation.method} ${operation.template}) looks like a stop operation (/stop in its path or "stop" in its id) and is unclassified: decide whether it is a safety request and record it here`);
    }
  }
  return problems;
}

/** The contract with one more operation, for the audit's own tests. */
function withOperation(template: string, method: string, operationId: string): Contract {
  const base = contract as unknown as Contract;
  return { paths: { ...base.paths, [template]: { ...(base.paths[template] ?? {}), [method]: { operationId } } } };
}

describe("the safety set, read from the contract", () => {
  it("the contract has the two Stop operations and the classifier accepts exactly them", () => {
    expect(audit(contract as unknown as Contract)).toEqual([]);
    const accepted = operationsOf(contract as unknown as Contract)
      .filter((operation) => isSafetyRoute(operation.method, pathSegmentsOf(operation.path)))
      .map((operation) => operation.id)
      .sort();
    expect(accepted).toEqual(["create_crew_stop", "delete_crew_stop"]);
  });

  it("every other operation, whatever its path, is a read-limit request", () => {
    const others = operationsOf(contract as unknown as Contract).filter((operation) => !(operation.id in SAFETY_OPERATIONS));
    expect(others.length).toBeGreaterThanOrEqual(13);
    for (const operation of others) expect(isSafetyRoute(operation.method, pathSegmentsOf(operation.path)), operation.id).toBe(false);
  });

  // Non-vacuous: the audit must be able to fail.
  it("fails when a new /stops operation appears that nobody classified", () => {
    const problems = audit(withOperation("/api/v1/crews/{crew_id}/stops/{stop_id}/extend", "post", "extend_crew_stop"));
    expect(problems).toEqual([expect.stringContaining("extend_crew_stop")]);
    expect(problems[0]).toContain("unclassified");
  });

  it("fails when a new operation's path has /stop without the s (a singular or a longer word)", () => {
    for (const template of ["/api/v1/crews/{crew_id}/stop", "/api/v1/crews/{crew_id}/stop-all", "/api/v1/sites/{site_id}/stoppage"]) {
      const problems = audit(withOperation(template, "post", "halt_work"));
      expect(problems, template).toEqual([expect.stringContaining("halt_work")]);
      expect(problems[0], template).toContain("unclassified");
    }
  });

  it("fails when a new operation's id says stop (any case), whatever its path", () => {
    for (const id of ["emergency_stop", "StopAllWork", "crew_STOP_now"]) {
      const problems = audit(withOperation("/api/v1/crews/{crew_id}/halt", "post", id));
      expect(problems, id).toEqual([expect.stringContaining(id)]);
      expect(problems[0], id).toContain("unclassified");
    }
  });

  it("does not flag an operation that has neither /stop in its path nor stop in its id", () => {
    expect(audit(withOperation("/api/v1/crews/{crew_id}/halt", "post", "halt_work"))).toEqual([]);
  });

  it("an operation recorded as not a safety request, with its reason, passes the audit", () => {
    const problems = audit(withOperation("/api/v1/crews/{crew_id}/stops/export", "get", "export_crew_stops"), ["export_crew_stops"]);
    expect(problems).toEqual([]);
  });

  it("fails when a new GET on /stops appears (a list of stops would be a read, but someone must say so)", () => {
    const problems = audit(withOperation("/api/v1/crews/{crew_id}/stops", "get", "list_crew_stops"));
    expect(problems.join("\n")).toContain("list_crew_stops");
  });

  it("fails when a Stop operation changes path or method", () => {
    const base = contract as unknown as Contract;
    const moved: Contract = {
      paths: Object.fromEntries(Object.entries(base.paths).map(([path, item]) => [path === "/api/v1/crews/{crew_id}/stops" ? "/api/v1/crews/{crew_id}/halts" : path, item])),
    };
    const problems = audit(moved).join("\n");
    expect(problems).toContain("create_crew_stop is no longer POST /api/v1/crews/{crew_id}/stops");
  });

  it("fails when a Stop operation is removed from the contract", () => {
    const base = contract as unknown as Contract;
    const rest = Object.fromEntries(Object.entries(base.paths).filter(([path]) => path !== "/api/v1/crews/{crew_id}/stops/{stop_id}"));
    expect(audit({ paths: rest }).join("\n")).toContain("delete_crew_stop is no longer");
  });
});
