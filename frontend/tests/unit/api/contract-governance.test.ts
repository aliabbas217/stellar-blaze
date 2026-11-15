// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Governance guards on the API contract (ADR 0004, plan section 8.8): the worker profile and personal risk stay on
 * the device, the push subscription carries site and crew ids only, and supervisor-facing schemas hold crew
 * aggregates and nothing about a person. These run against B3's v1 contract (backend/openapi/v1.json, copied unedited
 * into openapi/stellar-blaze.openapi.json); a newer copy must keep passing them.
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
  "forecast_status",
  // ba912f3: whether the day was computed against the live clock or the fixed replay snapshot; a property of the run, not of a person.
  "mode",
]);
const PERSONAL_NAME = /worker|member_id|name_of|employee|heart|symptom/i;
/**
 * `crew_name` is a group label, not a person. `worker_ref` is the free-text reference of an employer data request
 * (ADR 0054): write-only, validated and discarded by the API, never stored, logged or echoed.
 */
const PERSONAL_NAME_EXCEPTIONS = new Set(["crew_name", "worker_ref"]);
/**
 * B3 uses a wider pattern in its own contract test (worker|member|employee|heart|symptom|acclimat|juvenile) and
 * allow-lists four names. They are the ones this contract carries (counts or policy numbers, none a member value);
 * pinned here so a fifth cannot slip in.
 */
const B3_WIDE_PATTERN = /worker|member|employee|heart|symptom|acclimat|juvenile/i;
const B3_WIDE_PATTERN_KNOWN = ["acclimatisation_days_required", "acclimatised", "member_count", "worker_ref"];
/** The problem family is open on purpose (RFC 9457 allows extension members); every other object forbids extras. */
const PROBLEM_FAMILY = [
  "Problem",
  "ValidationProblem",
  "ReviewRequiredProblem",
  "RosterInvalidProblem",
  "ShiftNotLegalProblem",
  // ba912f3 (ADR 0067): the 422 of create_push_subscription for a push-service host that is not on the allow-list.
  "EndpointHostNotAllowedProblem",
];
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
  "health_live",
  "health_ready",
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
    ["DayPlan", "restricted_headcount", "null when suppressed", /null when `suppressed`/],
  ];
  return required
    .filter(([schemaName, property, , pattern]) => !pattern.test(propertyDescription(doc, schemaName, property)))
    .map(([schemaName, property, statement]) => `${schemaName}.${property} does not say: ${statement}`);
}

/** Object schemas (inline ones too) that do not set `additionalProperties: false`, the problem family aside. */
function objectsOpenToExtraProperties(doc: JsonObject): JsonObject[] {
  const copy = JSON.parse(JSON.stringify(doc)) as JsonObject;
  const components = copy.components;
  const all = isObject(components) && isObject(components.schemas) ? components.schemas : {};
  for (const name of PROBLEM_FAMILY) Reflect.deleteProperty(all, name);
  return [...walk(copy)].filter((node) => node.type === "object" && node.additionalProperties !== false);
}

/** Every operation of the document. */
function operationsOf(doc: JsonObject): JsonObject[] {
  const paths = doc.paths;
  if (!isObject(paths)) throw new Error("spec has no paths");
  return Object.values(paths).flatMap((item) => (isObject(item) ? Object.values(item).filter(isObject) : []));
}

/** The schema names a response body refers to, directly, in an array, or in a oneOf. */
function referencedSchemas(schema: Json | undefined): string[] {
  if (!isObject(schema)) return [];
  if (typeof schema.$ref === "string") return [schema.$ref.split("/").pop() ?? ""];
  const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : [];
  return alternatives.flatMap((alternative) => referencedSchemas(alternative));
}

describe("contract governance", () => {
  it("declares the components the F2 screens and the static artefacts are typed from", () => {
    expect(Object.keys(schemas(spec))).toEqual(
      expect.arrayContaining([
        "AlertLevel",
        "BanWindow",
        "Site",
        "Crew",
        "CrewTimeline",
        "DayPlan",
        "AckItem",
        "PlanSignOff",
        "PlanSignOffRequest",
        "PlanValidateRequest",
        "PlanValidateResponse",
        "TransparencyLog",
        "DemoReset",
        "Provenance",
        "PolicyScoreboard",
        "PlanScoreboard",
        "DemoDay",
        "ThetaDecision",
        ...PROBLEM_FAMILY,
      ]),
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

  it("has exactly the 15 operations of B3's v1 (ADR 0051, its sign-off amendment, reset_demo_site) and the two health routes", () => {
    expect(operationsOf(spec).map((operation) => operation.operationId).sort()).toEqual(OPERATION_IDS);
  });

  it("asks for the employer token on the employer operations and on no other", () => {
    const secured = operationsOf(spec)
      .filter((operation) => Array.isArray(operation.security) && operation.security.length > 0)
      .map((operation) => operation.operationId)
      .sort();

    expect(secured).toEqual(EMPLOYER_OPERATIONS);
  });

  it("lists a rate limit on every employer operation, and a Retry-After on its 429", () => {
    for (const operation of operationsOf(spec).filter((candidate) => EMPLOYER_OPERATIONS.includes(describeOperation(candidate)))) {
      const id = describeOperation(operation);
      expect(Array.isArray(operation["x-rate-limit"]) && operation["x-rate-limit"].length > 0, `${id} has x-rate-limit`).toBe(true);
      const responses = operation.responses;
      const tooMany = isObject(responses) ? responses["429"] : undefined;
      const headers = isObject(tooMany) && isObject(tooMany.headers) ? Object.keys(tooMany.headers) : [];
      expect(headers, `${id} 429 headers`).toContain("Retry-After");
    }
  });

  it("carries no x-sb-requested marker: the gaps R1, R2, R3, G1 and G2 were delivered by B3", () => {
    const marked = [...walk(spec)].filter((node) => "x-sb-requested" in node);

    expect(marked).toEqual([]);
  });

  it("delivers the fields the F2 screens asked for", () => {
    expect(propertyNames(spec, "SiteForecastToday")).toEqual(expect.arrayContaining(["ban_window", "forecast_status", "model_id", "mode"]));
    expect(propertyNames(spec, "CrewTimeline")).toEqual(expect.arrayContaining(["ban_window", "shift", "signoff_state"]));
    expect(propertyNames(spec, "Crew")).toEqual(expect.arrayContaining(["task_label", "workload", "shift", "signoff_state", "plan_status", "stopped", "active_stop_id", "stopped_at"]));
    expect(propertyNames(spec, "DayPlan")).toEqual(expect.arrayContaining(["ack_items", "signoff_state", "signoff_label_code", "signed_at", "signed_by_role"]));
    expect(propertyNames(spec, "Site")).toEqual(expect.arrayContaining(["supervisor_phone", "first_aider_phone", "epoch_id"]));
    expect(propertyNames(spec, "DemoReset").sort()).toEqual(["epoch_id", "previous_epoch_id", "reset_at", "site_id"]);
  });

  it("answers shift-not-legal (a ShiftNotLegalProblem next to the framework 422) on the day plan and the sign-off, and has no 501 left", () => {
    const byId = new Map(operationsOf(spec).map((operation) => [describeOperation(operation), operation]));
    for (const id of ["get_crew_day_plan", "sign_off_day_plan"]) {
      const responses = byId.get(id)?.responses;
      const unprocessable = isObject(responses) ? responses["422"] : undefined;
      const content = isObject(unprocessable) && isObject(unprocessable.content) ? unprocessable.content["application/problem+json"] : undefined;
      const names = isObject(content) ? referencedSchemas(content.schema).sort() : [];
      expect(names, `422 of ${id}`).toEqual(["ShiftNotLegalProblem", "ValidationProblem"]);
    }
    const with501 = operationsOf(spec)
      .filter((operation) => isObject(operation.responses) && "501" in operation.responses)
      .map(describeOperation);
    expect(with501).toEqual([]);
  });

  it("answers endpoint-host-not-allowed (an EndpointHostNotAllowedProblem next to the framework 422) on create_push_subscription (ADR 0067)", () => {
    const operation = operationsOf(spec).find((candidate) => describeOperation(candidate) === "create_push_subscription");
    const responses = operation?.responses;
    const unprocessable = isObject(responses) ? responses["422"] : undefined;
    const content = isObject(unprocessable) && isObject(unprocessable.content) ? unprocessable.content["application/problem+json"] : undefined;
    expect(isObject(content) ? referencedSchemas(content.schema).sort() : [], "422 of create_push_subscription").toEqual(["EndpointHostNotAllowedProblem", "ValidationProblem"]);
    const type = (schemas(spec).EndpointHostNotAllowedProblem?.properties as JsonObject | undefined)?.type;
    expect(isObject(type) ? type.const : null).toBe("urn:stellar-blaze:problem:endpoint-host-not-allowed");
  });

  it("lists create_crew_stop in its own rate-limit bucket, apart from every other employer operation", () => {
    const bucketsOf = (id: string): Json[] => {
      const operation = operationsOf(spec).find((candidate) => describeOperation(candidate) === id);
      const limits = operation?.["x-rate-limit"];
      return Array.isArray(limits) ? limits.map((entry) => (isObject(entry) ? (entry.bucket ?? null) : null)) : [];
    };

    expect(bucketsOf("create_crew_stop")).toEqual(["stop"]);
    for (const id of EMPLOYER_OPERATIONS.filter((candidate) => candidate !== "create_crew_stop")) expect(bucketsOf(id), id).not.toContain("stop");
  });

  it("makes a push subscription carry exactly the browser subscription, a site id and an optional crew id", () => {
    expect(propertyNames(spec, "PushSubscriptionCreate").sort()).toEqual(["crew_id", "site_id", "subscription"]);
  });

  it("forbids extra properties on every object schema, inline ones included, the open problem family aside", () => {
    expect(objectsOpenToExtraProperties(spec)).toEqual([]);
  });

  it("keeps the problem family open and gives each member instance and request_id", () => {
    for (const name of PROBLEM_FAMILY) {
      const schema = schemas(spec)[name];
      expect(schema?.additionalProperties, `${name} is open`).toBe(true);
      expect(schema?.required, `${name} requires`).toEqual(expect.arrayContaining(["type", "title", "status", "instance", "request_id"]));
    }
  });

  it("states in the contract where crew aggregates come from and what a suppressed crew withholds", () => {
    expect(crewDerivationRuleGaps(spec)).toEqual([]);
  });

  it("answers every error with application/problem+json that references the problem family, and has a default", () => {
    for (const operation of operationsOf(spec)) {
      const id = describeOperation(operation);
      const responses = operation.responses;
      if (!isObject(responses)) throw new Error(`${id} has no responses`);
      expect(Object.keys(responses), `${id} has a default`).toContain("default");
      for (const [status, response] of Object.entries(responses)) {
        if (/^2\d\d$/.test(status) || !isObject(response)) continue;
        const content = isObject(response.content) ? response.content : {};
        expect(Object.keys(content), `${status} of ${id}`).toEqual(["application/problem+json"]);
        const media = content["application/problem+json"];
        const names = isObject(media) ? referencedSchemas(media.schema) : [];
        expect(names.length > 0 && names.every((name) => PROBLEM_FAMILY.includes(name)), `${status} of ${id} refers to ${names.join(", ")}`).toBe(true);
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

  it("flags an object that allows extra properties, and does not flag the open problem family", () => {
    const open = doctored((copy) => {
      delete (schemas(copy).WbgtQuantiles as JsonObject).additionalProperties;
    });

    expect(objectsOpenToExtraProperties(open)).toHaveLength(1);
    expect(objectsOpenToExtraProperties(spec)).toHaveLength(0);
  });

  it("flags an error response that is not problem+json", () => {
    const plain = doctored((copy) => {
      const operation = ((copy.paths as JsonObject)["/api/v1/sites"] as JsonObject).get as JsonObject;
      const responses = operation.responses as JsonObject;
      responses["501"] = { description: "x", content: { "application/json": { schema: { type: "string" } } } };
    });

    const failing = operationsOf(plain)
      .filter((operation) => operation.operationId === "list_sites")
      .flatMap((operation) => Object.entries(operation.responses as JsonObject))
      .filter(([status, response]) => status === "501" && isObject(response) && !("application/problem+json" in (response.content as JsonObject)));
    expect(failing).toHaveLength(1);
  });
});
