// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Governance guards on the API contract proposal (ADR 0004, plan section 8.8): the worker profile and personal
 * risk stay on the device, the push subscription carries site and crew ids only, and supervisor-facing schemas
 * hold crew aggregates and nothing about a person. These run against the v1 contract file, hand-written from the B3
 * plan until backend/openapi/v1.json replaces it (F2 Task 24); the real spec must keep passing them.
 *
 * The finders are plain functions, and the last block feeds them a doctored copy of the spec, so a guard that
 * has gone blind (a changed regex, a walker that stops at "items") fails here instead of passing over a leak.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const SPEC_PATH = path.resolve(import.meta.dirname, "../../../openapi/stellar-blaze.openapi.json");
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as JsonObject;

const CREW_ALLOWED = new Set([
  "crew_id",
  "crew_name",
  "site_id",
  "date",
  "suppressed",
  "k",
  "hours",
  "starts_at",
  "crew_level",
  "ban_active",
  "ban_window",
  "shift",
  "signoff_state",
]);
const PERSONAL_NAME = /worker|member_id|name_of|employee|heart|symptom/i;
/**
 * `crew_name` is a group label, not a person. `worker_ref` is the free-text reference of an employer data request
 * (ADR 0054): write-only, validated and discarded by the API, never stored, logged or echoed.
 */
const PERSONAL_NAME_EXCEPTIONS = new Set(["crew_name", "worker_ref"]);
/**
 * B3 uses a wider pattern in its own contract test (worker|member|employee|heart|symptom|acclimat|juvenile). The v1
 * contract carries these names that it would match besides worker_ref, all counts or policy numbers and none a member
 * value; pinned here so a new one cannot slip in, and reported to the architect as a contradiction in the B3 plan.
 */
const B3_WIDE_PATTERN = /worker|member|employee|heart|symptom|acclimat|juvenile/i;
const B3_WIDE_PATTERN_KNOWN = ["acclimatisation_days_required", "acclimatised", "member_count", "worker_ref"];
const OPERATION_IDS = [
  "create_crew_stop",
  "create_data_request",
  "create_push_subscription",
  "delete_crew_stop",
  "delete_push_subscription",
  "get_crew_day_plan",
  "get_crew_timeline",
  "get_risk_policy",
  "get_site_forecast_today",
  "get_site_transparency_log",
  "list_site_crews",
  "list_sites",
  "reset_demo_site",
  "sign_off_day_plan",
  "validate_plan",
];
const EMPLOYER_OPERATIONS = ["create_crew_stop", "create_data_request", "delete_crew_stop", "get_crew_day_plan", "reset_demo_site", "sign_off_day_plan"];

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every node of the document, depth first. */
function* walk(node: Json): Generator<JsonObject> {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item);
  } else if (isObject(node)) {
    yield node;
    for (const value of Object.values(node)) yield* walk(value);
  }
}

/** Names of every property (any `properties` map) and every parameter, wherever they sit in the document. */
function allPropertyNames(doc: Json): string[] {
  const names: string[] = [];
  for (const node of walk(doc)) {
    if (isObject(node.properties)) names.push(...Object.keys(node.properties));
    if (typeof node.name === "string" && typeof node.in === "string") names.push(node.name);
  }
  return names;
}

function describeOperation(operation: JsonObject): string {
  return typeof operation.operationId === "string" ? operation.operationId : "an operation without operationId";
}

function forbiddenNames(doc: Json): string[] {
  return allPropertyNames(doc).filter((name) => PERSONAL_NAME.test(name) && !PERSONAL_NAME_EXCEPTIONS.has(name));
}

function schemas(doc: JsonObject): Record<string, JsonObject> {
  const components = doc.components;
  const found = isObject(components) ? components.schemas : undefined;
  if (!isObject(found)) throw new Error("spec has no components.schemas");
  return Object.fromEntries(Object.entries(found).filter((entry): entry is [string, JsonObject] => isObject(entry[1])));
}

function propertyNames(doc: JsonObject, schemaName: string): string[] {
  const properties = schemas(doc)[schemaName]?.properties;
  if (!isObject(properties)) throw new Error(`${schemaName} has no properties`);
  return Object.keys(properties);
}

function propertyDescription(doc: JsonObject, schemaName: string, property: string): string {
  const properties = schemas(doc)[schemaName]?.properties;
  const schema = isObject(properties) ? properties[property] : undefined;
  return isObject(schema) && typeof schema.description === "string" ? schema.description : "";
}

/**
 * The k-suppression derivation rule must be written into the contract itself, because B3 adopts the contract and not
 * a report: crew aggregates come only from server-held crew inputs, never from a device's personal risk (ADR 0004),
 * and a suppressed crew exposes nothing derived from its members. Returns what the descriptions fail to say.
 */
function crewDerivationRuleGaps(doc: JsonObject): string[] {
  const required: [string, string, string, RegExp][] = [
    ["CrewHour", "crew_level", "server-held inputs", /server-held/],
    ["CrewHour", "crew_level", "never from a device's personal risk", /never from personal risk reported by a device/],
    ["CrewHour", "crew_level", "no member-derived information", /no member-derived information/],
    ["CrewTimeline", "suppressed", "withholds member-derived fields only", /withholds member-derived fields only/],
    ["CrewTimeline", "suppressed", "no member-derived information", /no member-derived information/],
    ["DayPlan", "restricted_headcount", "null when suppressed", /Null when suppressed/],
  ];
  return required
    .filter(([schemaName, property, , pattern]) => !pattern.test(propertyDescription(doc, schemaName, property)))
    .map(([schemaName, property, statement]) => `${schemaName}.${property} does not say: ${statement}`);
}

/** Object schemas (inline ones too) that do not set `additionalProperties: false`. */
function objectsOpenToExtraProperties(doc: Json): JsonObject[] {
  return [...walk(doc)].filter((node) => node.type === "object" && node.additionalProperties !== false);
}

/** Every operation of the document. */
function operationsOf(doc: JsonObject): JsonObject[] {
  const paths = doc.paths;
  if (!isObject(paths)) throw new Error("spec has no paths");
  return Object.values(paths).flatMap((item) => (isObject(item) ? Object.values(item).filter(isObject) : []));
}

describe("contract governance", () => {
  it("declares the proposed component schemas, and no others", () => {
    expect(Object.keys(schemas(spec)).sort()).toEqual(
      [
        "AckItem",
        "Crew",
        "CrewHour",
        "CrewStop",
        "CrewStopCreate",
        "CrewTimeline",
        "DataRequestCreate",
        "DayPlan",
        "DaySignoff",
        "DemoReset",
        "HourForecast",
        "Level",
        "PlanSegment",
        "PlanValidateRequest",
        "PlanValidateResponse",
        "Problem",
        "PushSubscriptionCreate",
        "PushSubscriptionCreated",
        "ReviewRequiredProblem",
        "RiskPolicy",
        "RosterInvalidProblem",
        "SignOffRequest",
        "Site",
        "SiteForecastToday",
        "TimeRange",
        "TransparencyLog",
        "ValidatorResult",
        "Violation",
        "Zone",
        "ZoneHour",
      ].sort(),
    );
  });

  it("limits CrewTimeline and CrewHour to crew aggregates", () => {
    for (const name of ["CrewTimeline", "CrewHour"]) {
      const extra = propertyNames(spec, name).filter((property) => !CREW_ALLOWED.has(property));
      expect(extra, `${name} has properties outside the aggregate allow-list`).toEqual([]);
    }
  });

  it("has no property or parameter that names a worker, a member, an employee or a health reading (worker_ref aside)", () => {
    expect(forbiddenNames(spec)).toEqual([]);
  });

  it("allows worker_ref only in DataRequestCreate, the write-only request body", () => {
    const holders = Object.entries(schemas(spec))
      .filter(([, schema]) => isObject(schema.properties) && "worker_ref" in schema.properties)
      .map(([name]) => name);

    expect(holders).toEqual(["DataRequestCreate"]);
  });

  it("matches the wider member-like pattern of B3 only on the pinned names", () => {
    expect([...new Set(allPropertyNames(spec).filter((name) => B3_WIDE_PATTERN.test(name)))].sort()).toEqual(B3_WIDE_PATTERN_KNOWN);
  });

  it("has no share_above_amber anywhere (ADR 0050)", () => {
    expect(JSON.stringify(spec)).not.toContain("share_above_amber");
  });

  it("has exactly the 14 operations of ADR 0051 and its amendment, plus the candidate reset_demo_site", () => {
    expect(operationsOf(spec).map((operation) => operation.operationId).sort()).toEqual(OPERATION_IDS);
  });

  it("asks for the employer token on the employer operations and on no other", () => {
    const secured = operationsOf(spec)
      .filter((operation) => Array.isArray(operation.security) && operation.security.length > 0)
      .map((operation) => operation.operationId)
      .sort();

    expect(secured).toEqual(EMPLOYER_OPERATIONS);
  });

  it("marks the requested gaps with x-sb-requested R1, R2, R3, G1 and G2, so Task 24 can find them", () => {
    const marks = new Set<string>();
    for (const node of walk(spec)) {
      const mark = node["x-sb-requested"];
      if (typeof mark === "string") marks.add(mark);
    }
    expect([...marks].sort()).toEqual(["G1", "G2", "R1", "R2", "R3"]);

    const marked = (schemaName: string, group: string) =>
      Object.entries((schemas(spec)[schemaName]?.properties ?? {}) as JsonObject)
        .filter(([, value]) => isObject(value) && value["x-sb-requested"] === group)
        .map(([name]) => name)
        .sort();
    expect(marked("SiteForecastToday", "R1")).toEqual(["ban_window"]);
    expect(marked("CrewTimeline", "R1")).toEqual(["ban_window"]);
    expect(marked("Crew", "R2")).toEqual(["task_label", "workload"]);
    expect(marked("CrewTimeline", "R2")).toEqual(["shift", "signoff_state"]);
    expect(marked("DayPlan", "R3")).toEqual(["ack_items", "signoff"]);
    expect(marked("Site", "G2")).toEqual(["first_aider_phone", "supervisor_phone"]);
    expect(schemas(spec).SignOffRequest?.["x-sb-requested"]).toBe("R3");
    expect(schemas(spec).DemoReset?.["x-sb-requested"]).toBe("G1");
    const byId = (id: string) => operationsOf(spec).find((operation) => operation.operationId === id);
    expect(byId("sign_off_day_plan")?.["x-sb-requested"]).toBe("R3");
    expect(byId("reset_demo_site")?.["x-sb-requested"]).toBe("G1");
  });

  it("makes a push subscription carry exactly the browser subscription, a site id and an optional crew id", () => {
    expect(propertyNames(spec, "PushSubscriptionCreate").sort()).toEqual(["crew_id", "site_id", "subscription"]);
  });

  it("forbids extra properties on every object schema, inline ones included", () => {
    expect(objectsOpenToExtraProperties(spec)).toEqual([]);
  });

  it("states in the contract where crew aggregates come from and what a suppressed crew withholds", () => {
    expect(crewDerivationRuleGaps(spec)).toEqual([]);
  });

  it("answers every error with application/problem+json that references Problem", () => {
    const paths = spec.paths;
    if (!isObject(paths)) throw new Error("spec has no paths");
    const operations = Object.values(paths).flatMap((item) => (isObject(item) ? Object.values(item) : []));
    const components = spec.components;
    const responses = isObject(components) && isObject(components.responses) ? components.responses : {};

    expect(operations.length).toBe(OPERATION_IDS.length);
    for (const operation of operations) {
      if (!isObject(operation) || !isObject(operation.responses)) continue;
      expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(["502", "default"]));
      for (const [status, response] of Object.entries(operation.responses)) {
        if (/^2\d\d$/.test(status)) continue;
        const target = isObject(response) && typeof response.$ref === "string" ? response.$ref.split("/").pop() : undefined;
        const resolved = target === undefined ? undefined : responses[target];
        const content = isObject(resolved) && isObject(resolved.content) ? resolved.content : {};
        expect(Object.keys(content), `${status} of ${describeOperation(operation)}`).toEqual(["application/problem+json"]);
      }
    }
  });
});

describe("the guards themselves", () => {
  function doctored(mutate: (copy: JsonObject) => void): JsonObject {
    const copy = JSON.parse(JSON.stringify(spec)) as JsonObject;
    mutate(copy);
    return copy;
  }

  it("flags a worker-identifying property nested in an array item", () => {
    const leaky = doctored((copy) => {
      const hour = schemas(copy).CrewHour;
      if (!isObject(hour) || !isObject(hour.properties)) throw new Error("fixture spec changed");
      hour.properties.worker_id = { type: "string" };
    });

    expect(forbiddenNames(leaky)).toEqual(["worker_id"]);
    expect(propertyNames(leaky, "CrewHour").filter((name) => !CREW_ALLOWED.has(name))).toEqual(["worker_id"]);
  });

  it.each(["member_id", "name_of_worker", "employee_no", "heart_rate", "symptoms", "Worker"])(
    "flags %s anywhere in the document",
    (name) => {
      const leaky = doctored((copy) => {
        const created = schemas(copy).PushSubscriptionCreated;
        if (!isObject(created) || !isObject(created.properties)) throw new Error("fixture spec changed");
        created.properties[name] = { type: "string" };
      });

      expect(forbiddenNames(leaky)).toEqual([name]);
    },
  );

  it("flags a personal query parameter", () => {
    const leaky = doctored((copy) => {
      const timeline = (copy.paths as JsonObject)["/api/v1/crews/{crew_id}/timeline"] as JsonObject;
      const parameters = (timeline.get as JsonObject).parameters as Json[];
      parameters.push({ name: "worker_id", in: "query", schema: { type: "string" } });
    });

    expect(forbiddenNames(leaky)).toEqual(["worker_id"]);
  });

  it("flags a contract whose crew descriptions drop the derivation and suppression rule", () => {
    const silent = doctored((copy) => {
      const properties = schemas(copy).CrewHour?.properties as JsonObject;
      delete (properties.crew_level as JsonObject).description;
      const timeline = schemas(copy).CrewTimeline?.properties as JsonObject;
      (timeline.suppressed as JsonObject).description = "True when the crew has fewer than k members.";
      const plan = schemas(copy).DayPlan?.properties as JsonObject;
      (plan.restricted_headcount as JsonObject).description = "Members limited by a rule.";
    });

    expect(crewDerivationRuleGaps(silent)).toHaveLength(6);
  });

  it("flags a share_above_amber that creeps back into CrewHour", () => {
    const leaky = doctored((copy) => {
      const hour = schemas(copy).CrewHour;
      if (!isObject(hour) || !isObject(hour.properties)) throw new Error("fixture spec changed");
      hour.properties.share_above_amber = { type: "number" };
    });

    expect(propertyNames(leaky, "CrewHour").filter((name) => !CREW_ALLOWED.has(name))).toEqual(["share_above_amber"]);
  });

  it("flags an inline object that allows extra properties", () => {
    const open = doctored((copy) => {
      const wbgt = (schemas(copy).HourForecast?.properties as JsonObject).wbgt_c as JsonObject;
      delete wbgt.additionalProperties;
    });

    expect(objectsOpenToExtraProperties(open)).toHaveLength(1);
  });
});
