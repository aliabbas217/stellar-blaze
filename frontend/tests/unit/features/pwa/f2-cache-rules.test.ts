// @vitest-environment node
import { defaultCache as productionDefaults } from "@serwist/turbopack/worker";
import { NetworkFirst, NetworkOnly, Serwist, type RuntimeCaching } from "serwist";
import contract from "../../../../openapi/stellar-blaze.openapi.json";
import { API_CACHE_NAME, OFFLINE_API_ALLOW_LIST, isCachedApiPath } from "@/features/pwa/api-cache";
import { runtimeCachingWith } from "@/features/pwa/runtime-caching";

/*
 * F2 Task 23, `test_every_f2_operation_has_a_cache_rule`: every operation of the API contract has a cache rule that is written down here,
 * and the worker's real router (Serwist's own, over the production `defaultCache`) does exactly what the rule says. The list of operations
 * is READ FROM THE CONTRACT, not typed here, so an operation added to `openapi/stellar-blaze.openapi.json` without a rule below fails
 * this test until someone decides, in an ADR, whether it may ever touch Cache Storage (ADR 0004, ADR 0059, ADR 0060).
 *
 * The rule is one of two things:
 *  - "cached":       NetworkFirst into the `sb-api` cache. Exactly the two non-personal reads the allow-list names (D2: no new entry).
 *  - "network-only": never stored. Every other GET goes through the worker's `/api/` NetworkOnly rule; every non-GET has no route at all,
 *                    so the browser sends it straight to the network.
 *
 * A guard derived from the contract (not from the table) states the invariant itself: an operation that needs the employer token, or
 * that writes, can never be "cached", whatever the table says.
 */

const ORIGIN = "https://worker.example";

vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("self", { addEventListener: vi.fn(), skipWaiting: vi.fn() });
  vi.stubGlobal("location", new URL("https://worker.example/serwist/sw.js"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Rule = "cached" | "network-only";

/** The decision for every operation of the contract (F2 plus the push and health operations that share the same API). */
const RULES: Readonly<Record<string, Rule>> = {
  // The two allow-listed, non-personal reads.
  get_site_forecast_today: "cached",
  get_risk_policy: "cached",
  // Employer-scoped and token routes (ADR 0050, 0054): never stored. These carry the demo employer token through the BFF.
  get_crew_day_plan: "network-only",
  sign_off_day_plan: "network-only",
  create_crew_stop: "network-only",
  delete_crew_stop: "network-only",
  create_data_request: "network-only",
  reset_demo_site: "network-only",
  get_site_transparency_log: "network-only",
  // Public but not allow-listed (D2: supervisor views are online-only; no new entry without Task 23's recorded decision and an ADR).
  list_sites: "network-only",
  list_site_crews: "network-only",
  get_crew_timeline: "network-only",
  // Writes the page makes (a push subscription is a write; a plan check is a POST).
  create_push_subscription: "network-only",
  delete_push_subscription: "network-only",
  validate_plan: "network-only",
  // Probes.
  health_live: "network-only",
  health_ready: "network-only",
};

interface Operation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly needsToken: boolean;
}

interface Contract {
  readonly paths: Readonly<Record<string, Readonly<Record<string, { readonly operationId?: string; readonly security?: readonly unknown[] }>>>>;
}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Every operation of a contract, with the path's `{parameters}` filled with a sample value. */
function operationsOf(spec: Contract): Operation[] {
  const found: Operation[] = [];
  for (const [template, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation?.operationId === undefined) continue;
      found.push({
        id: operation.operationId,
        method: method.toUpperCase(),
        path: template.replace(/\{([^}]+)\}/g, (_whole, name: string) => `sample-${name}`),
        needsToken: (operation.security ?? []).length > 0,
      });
    }
  }
  return found;
}

function routerOver(runtimeCaching: RuntimeCaching[]): Serwist {
  return new Serwist({ runtimeCaching });
}

/** The handler Serwist's router picks for a request, or undefined when no route would handle it (the browser goes to the network). */
function handlerFor(serwist: Serwist, target: string, method: string) {
  const url = new URL(target, ORIGIN);
  const request = new Request(url, { method });
  return serwist.findMatchingRoute({ url, sameOrigin: true, request, event: {} as ExtendableEvent }).route?.handler;
}

/** What the router does with one operation: "cached", "network-only" (a NetworkOnly route, or no route for a write), or what it found. */
function behaviourOf(serwist: Serwist, operation: Operation): string {
  const handler = handlerFor(serwist, operation.path, operation.method);
  if (handler === undefined) return operation.method === "GET" ? "unrouted GET (falls to the browser, uncached by us, but not by rule)" : "network-only";
  if (handler instanceof NetworkOnly) return "network-only";
  if (handler instanceof NetworkFirst && handler.cacheName === API_CACHE_NAME) return "cached";
  return `stored by a runtime rule (${handler.constructor.name})`;
}

/**
 * The audit itself: every problem found, as a sentence. Empty means every operation has a written rule, the router does what the rule
 * says, and no token-bearing or writing operation is cached.
 */
function audit(spec: Contract, rules: Readonly<Record<string, Rule>>, router: Serwist): string[] {
  const problems: string[] = [];
  const operations = operationsOf(spec);
  for (const operation of operations) {
    const rule = rules[operation.id];
    if (rule === undefined) {
      problems.push(`${operation.id} (${operation.method} ${operation.path}) has no cache rule: decide it (ADR first) and record it`);
      continue;
    }
    const behaviour = behaviourOf(router, operation);
    if (behaviour !== rule) problems.push(`${operation.id}: rule says ${rule}, the worker does: ${behaviour}`);
    if (rule === "cached" && (operation.method !== "GET" || operation.needsToken)) {
      problems.push(`${operation.id}: a ${operation.needsToken ? "token-bearing" : operation.method} operation must never be cached`);
    }
    if (behaviour !== "network-only" && (operation.method !== "GET" || operation.needsToken)) {
      problems.push(`${operation.id}: the worker would store a ${operation.needsToken ? "token-bearing" : operation.method} operation`);
    }
  }
  const known = new Set(operations.map((operation) => operation.id));
  for (const id of Object.keys(rules)) if (!known.has(id)) problems.push(`${id} has a rule but is not in the contract (a stale row)`);
  return problems;
}

const workerRouter = (): Serwist => routerOver(runtimeCachingWith(productionDefaults));
const contractSpec = contract as unknown as Contract;

describe("test_every_f2_operation_has_a_cache_rule", () => {
  it("reads a real contract (guards the audit against a vacuous pass)", () => {
    const operations = operationsOf(contractSpec);
    expect(operations.length).toBeGreaterThanOrEqual(17);
    // The operations the F2 governance rules name are in it, with the token requirement read from the contract.
    for (const id of ["get_crew_day_plan", "create_data_request", "create_crew_stop", "delete_crew_stop", "sign_off_day_plan", "reset_demo_site"]) {
      const operation = operations.find((candidate) => candidate.id === id);
      expect(operation, id).toBeDefined();
      expect(operation?.needsToken, `${id} needs the employer token`).toBe(true);
    }
    // The contract declares the worker-visible site access log public (ADR 0054: workers read it); it is network-only all the same.
    expect(operations.find((operation) => operation.id === "get_site_transparency_log")?.needsToken).toBe(false);
    expect(RULES["get_site_transparency_log"]).toBe("network-only");
    expect(operations.find((operation) => operation.id === "get_site_forecast_today")?.needsToken).toBe(false);
  });

  it("every operation of the contract has a written rule, the worker does what the rule says, and nothing token-bearing or writing is stored", () => {
    expect(audit(contractSpec, RULES, workerRouter())).toEqual([]);
  });

  it("the rule table is exactly the allow-list for 'cached': two operations, matching OFFLINE_API_ALLOW_LIST one for one", () => {
    const cached = operationsOf(contractSpec).filter((operation) => RULES[operation.id] === "cached");
    expect(cached.map((operation) => operation.id).sort()).toEqual(["get_risk_policy", "get_site_forecast_today"]);
    expect(OFFLINE_API_ALLOW_LIST).toHaveLength(2);
    for (const operation of operationsOf(contractSpec)) {
      expect(isCachedApiPath(operation.path), `${operation.id} on the allow-list`).toBe(RULES[operation.id] === "cached");
    }
  });

  it("a query string or a trailing path never turns a network-only operation into a cached one", () => {
    const router = workerRouter();
    for (const operation of operationsOf(contractSpec).filter((candidate) => RULES[candidate.id] === "network-only" && candidate.method === "GET")) {
      for (const variant of [`${operation.path}?date=2026-09-03`, `${operation.path}/`, `${operation.path}.json`, `${operation.path}?x=/api/v1/risk-policy`]) {
        const handler = handlerFor(router, variant, "GET");
        expect(handler, `${operation.id}: ${variant}`).toBeInstanceOf(NetworkOnly);
      }
    }
  });

  // The audit must be able to fail: each of these is a change a careless commit could make, and each must be reported.
  describe("the audit is not vacuous: it reports", () => {
    const leaky = (matches: (pathname: string) => boolean): RuntimeCaching[] => [
      {
        matcher: ({ sameOrigin, url }) => sameOrigin && matches(url.pathname),
        method: "GET",
        handler: new NetworkFirst({ cacheName: API_CACHE_NAME }),
      },
      ...runtimeCachingWith(productionDefaults),
    ];

    it("a deliberately cached day plan (an employer route put in front of the rules)", () => {
      const problems = audit(contractSpec, RULES, routerOver(leaky((pathname) => pathname.endsWith("/day-plan"))));
      expect(problems.join("\n")).toMatch(/get_crew_day_plan: rule says network-only, the worker does: cached/);
      expect(problems.join("\n")).toMatch(/get_crew_day_plan: the worker would store a token-bearing operation/);
    });

    it("a deliberately cached transparency log, crews list and timeline", () => {
      const problems = audit(contractSpec, RULES, routerOver(leaky((pathname) => /\/(transparency-log|crews|timeline)$/.test(pathname))));
      const text = problems.join("\n");
      expect(text).toMatch(/get_site_transparency_log: rule says network-only, the worker does: cached/);
      expect(text).toMatch(/list_site_crews: rule says network-only, the worker does: cached/);
      expect(text).toMatch(/get_crew_timeline: rule says network-only, the worker does: cached/);
    });

    it("an operation that Serwist's own catch-all would store if our /api/ rules were missing (the production defaultCache alone)", () => {
      const problems = audit(contractSpec, RULES, routerOver(productionDefaults));
      expect(problems.length).toBeGreaterThan(5);
      expect(problems.join("\n")).toMatch(/get_crew_day_plan: rule says network-only, the worker does: stored by a runtime rule/);
    });

    it("a new operation added to the contract without a rule", () => {
      const withNew: Contract = {
        paths: { ...contractSpec.paths, "/api/v1/crews/{crew_id}/notes": { get: { operationId: "get_crew_notes" } } },
      };
      expect(audit(withNew, RULES, workerRouter())).toEqual([
        "get_crew_notes (GET /api/v1/crews/sample-crew_id/notes) has no cache rule: decide it (ADR first) and record it",
      ]);
    });

    it("a rule row left behind for an operation that no longer exists", () => {
      const without: Contract = { paths: Object.fromEntries(Object.entries(contractSpec.paths).filter(([path]) => !path.endsWith("/risk-policy"))) };
      expect(audit(without, RULES, workerRouter())).toEqual(["get_risk_policy has a rule but is not in the contract (a stale row)"]);
    });

    it("a token-bearing operation marked 'cached' in the table, even if the worker agrees with the table", () => {
      const rules = { ...RULES, get_crew_day_plan: "cached" as const };
      const router = routerOver(leaky((pathname) => pathname.endsWith("/day-plan")));
      const problems = audit(contractSpec, rules, router);
      expect(problems.join("\n")).toMatch(/get_crew_day_plan: a token-bearing operation must never be cached/);
    });

    it("a write that the worker would route to a cache", () => {
      const post: RuntimeCaching[] = [
        { matcher: ({ url }) => url.pathname.endsWith("/stops"), method: "POST", handler: new NetworkFirst({ cacheName: "anything" }) },
        ...runtimeCachingWith(productionDefaults),
      ];
      const problems = audit(contractSpec, RULES, routerOver(post));
      expect(problems.join("\n")).toMatch(/create_crew_stop: .*stored by a runtime rule/);
    });
  });
});
