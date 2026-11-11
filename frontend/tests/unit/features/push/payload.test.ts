import { parsePushPayload } from "@/features/push/payload";

/*
 * The service worker shows a notification for whatever this guard lets through, so it must accept exactly the six
 * keys of the contract (docs/contracts/web-push.md section 2) and nothing else: a worker identifier or free text in a
 * payload is a governance failure, and a value the worker cannot render is a bug. It runs inside the service worker,
 * which is why it is hand-written instead of a zod schema.
 */

const valid = {
  v: 1,
  audience: "site",
  target_id: "site-demo-mussafah",
  level: "amber",
  template_id: "level-change",
  valid_from: "2026-11-11T09:00:00Z",
} as const;

const KEYS = ["v", "audience", "target_id", "level", "template_id", "valid_from"] as const;

describe("parsePushPayload", () => {
  it("accepts the valid six-key payload and returns it", () => {
    expect(parsePushPayload(valid)).toEqual(valid);
  });

  it("accepts a crew payload and every level", () => {
    for (const level of ["green", "amber", "orange", "red"]) {
      expect(parsePushPayload({ ...valid, audience: "crew", target_id: "crew-a", level })).toMatchObject({
        audience: "crew",
        level,
      });
    }
  });

  it.each(["2026-11-11T09:00:00Z", "2026-11-11T09:00:00.250Z", "2026-11-11T13:00:00+04:00"])(
    "accepts the ISO 8601 date-time %s",
    (valid_from) => {
      expect(parsePushPayload({ ...valid, valid_from })).not.toBeNull();
    },
  );

  it("returns a copy, not the object it was given", () => {
    const input = { ...valid };
    expect(parsePushPayload(input)).not.toBe(input);
  });

  describe("returns null", () => {
    it("for any extra key, whatever its name", () => {
      expect(parsePushPayload({ ...valid, worker_id: "x" })).toBeNull();
      expect(parsePushPayload({ ...valid, text: "Stay hydrated" })).toBeNull();
    });

    it("for an own __proto__ key (what JSON.parse produces from a hostile payload)", () => {
      const hostile = `{"v":1,"audience":"site","target_id":"a","level":"red","template_id":"t","valid_from":"2026-11-11T09:00:00Z","__proto__":{"x":1}}`;
      expect(parsePushPayload(JSON.parse(hostile))).toBeNull();
    });

    it.each(KEYS)("when %s is missing", (key) => {
      const rest = Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
      expect(parsePushPayload(rest)).toBeNull();
    });

    it("for an unknown level", () => {
      expect(parsePushPayload({ ...valid, level: "purple" })).toBeNull();
      expect(parsePushPayload({ ...valid, level: "AMBER" })).toBeNull();
    });

    it("for a version it does not know (the contract: such a worker shows nothing)", () => {
      expect(parsePushPayload({ ...valid, v: 2 })).toBeNull();
      expect(parsePushPayload({ ...valid, v: "1" })).toBeNull();
    });

    it("for an unknown audience", () => {
      expect(parsePushPayload({ ...valid, audience: "worker" })).toBeNull();
    });

    it.each(["", 42, null])("for the target_id %j", (target_id) => {
      expect(parsePushPayload({ ...valid, target_id })).toBeNull();
    });

    it.each(["", 7, null])("for the template_id %j", (template_id) => {
      expect(parsePushPayload({ ...valid, template_id })).toBeNull();
    });

    it.each(["yesterday", "2026-11-11", "2026-11-11 09:00:00", "2026-13-45T09:00:00Z", "", 1762851600000])(
      "for the valid_from %j, which is not an ISO 8601 date-time",
      (valid_from) => {
        expect(parsePushPayload({ ...valid, valid_from })).toBeNull();
      },
    );

    it.each([null, undefined, "amber", 7, true, [], [valid]])("for the non-object %j", (data) => {
      expect(parsePushPayload(data)).toBeNull();
    });
  });
});
