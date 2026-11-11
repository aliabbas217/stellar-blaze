// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Governance guards on the API contract proposal (ADR 0004, plan section 8.8): the worker profile and personal
 * risk stay on the device, the push subscription carries site and crew ids only, and supervisor-facing schemas
 * hold crew aggregates and nothing about a person. These run against the mock OpenAPI file that B3 Task 0 adopts
 * or replaces; a replacement spec must keep passing them.
 *
 * The finders are plain functions, and the last block feeds them a doctored copy of the spec, so a guard that
 * has gone blind (a changed regex, a walker that stops at "items") fails here instead of passing over a leak.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const SPEC_PATH = path.resolve(import.meta.dirname, "../../../openapi/stellar-blaze.mock.openapi.json");
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
  "share_above_amber",
  "ban_active",
]);
const PERSONAL_NAME = /worker|member_id|name_of|employee|heart|symptom/i;
/** `crew_name` is the one personal-looking name allowed: a crew is a group label, not a person. */
const PERSONAL_NAME_EXCEPTIONS = new Set(["crew_name"]);

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
    ["CrewHour", "share_above_amber", "server-held inputs", /server-held/],
    ["CrewHour", "share_above_amber", "never from a device's personal risk", /never from personal risk reported by a device/],
    ["CrewHour", "share_above_amber", "null when suppressed", /null when the crew is suppressed/i],
    ["CrewTimeline", "suppressed", "share_above_amber is null", /share_above_amber is null on every hour/],
    ["CrewTimeline", "suppressed", "no member-derived information", /no member-derived information/],
  ];
  return required
    .filter(([schemaName, property, , pattern]) => !pattern.test(propertyDescription(doc, schemaName, property)))
    .map(([schemaName, property, statement]) => `${schemaName}.${property} does not say: ${statement}`);
}

/** Object schemas (inline ones too) that do not set `additionalProperties: false`. */
function objectsOpenToExtraProperties(doc: Json): JsonObject[] {
  return [...walk(doc)].filter((node) => node.type === "object" && node.additionalProperties !== false);
}

describe("contract governance", () => {
  it("declares the proposed component schemas, and no others", () => {
    expect(Object.keys(schemas(spec)).sort()).toEqual(
      [
        "Level",
        "Problem",
        "Site",
        "HourForecast",
        "SiteForecastToday",
        "RiskPolicy",
        "Crew",
        "CrewHour",
        "CrewTimeline",
        "PushSubscriptionCreate",
        "PushSubscriptionCreated",
      ].sort(),
    );
  });

  it("limits CrewTimeline and CrewHour to crew aggregates", () => {
    for (const name of ["CrewTimeline", "CrewHour"]) {
      const extra = propertyNames(spec, name).filter((property) => !CREW_ALLOWED.has(property));
      expect(extra, `${name} has properties outside the aggregate allow-list`).toEqual([]);
    }
  });

  it("has no property or parameter that names a worker, a member, an employee or a health reading", () => {
    expect(forbiddenNames(spec)).toEqual([]);
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

    expect(operations.length).toBeGreaterThanOrEqual(7);
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
      (properties.share_above_amber as JsonObject).description = "Share of the crew above amber, 0 to 1.";
      const timeline = schemas(copy).CrewTimeline?.properties as JsonObject;
      (timeline.suppressed as JsonObject).description = "True when the crew has fewer than k members.";
    });

    expect(crewDerivationRuleGaps(silent)).toHaveLength(8);
  });

  it("flags an inline object that allows extra properties", () => {
    const open = doctored((copy) => {
      const wbgt = (schemas(copy).HourForecast?.properties as JsonObject).wbgt_c as JsonObject;
      delete wbgt.additionalProperties;
    });

    expect(objectsOpenToExtraProperties(open)).toHaveLength(1);
  });
});
