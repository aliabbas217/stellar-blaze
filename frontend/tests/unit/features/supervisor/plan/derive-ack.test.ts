import type { components } from "@/api/schema";
import { ackItemsOf, cycleOfCode, deriveAckItems } from "@/features/supervisor/plan/derive-ack";
import { createStop, crewDayPlan, resetDemoStateHard, REPLAY_DATE } from "@/mocks/fixtures";

type PlanSegment = components["schemas"]["PlanSegment"];
type PlanZone = components["schemas"]["PlanZone"];

const ZONE = "Asia/Dubai";

/** One hour of work at `zone` starting at local `hour` (the site is UTC+4). */
function hourly(hour: number, zone: PlanZone | null): PlanSegment {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 3, h - 4)).toISOString();
  return { starts_at: at(hour), ends_at: at(hour + 1), state: "work", zone, rule_id: "P-H7.cap60", clause: "" };
}

describe("deriveAckItems", () => {
  it("test_derive_ack_items_one_per_run: Low, Medium, Medium, High, High, Medium give three items; Low gives none", () => {
    const zones: PlanZone[] = ["low", "medium", "medium", "high", "high", "medium"];
    const segments = zones.map((zone, index) => hourly(6 + index, zone));

    const items = deriveAckItems(segments, [], ZONE);

    expect(items.map((item) => [item.zone, item.id])).toEqual([
      ["medium", "medium-0700"],
      ["high", "high-0900"],
      ["medium", "medium-1100"],
    ]);
    // consecutive hours at one zone merge into one run: 07:00 to 09:00 is one Medium item
    expect(items[0]).toMatchObject({ startsAt: "2026-09-03T03:00:00.000Z", endsAt: "2026-09-03T05:00:00.000Z" });
    expect(deriveAckItems([hourly(6, "low"), hourly(7, "low")], [], ZONE)).toEqual([]);
  });

  it("the id is the API's `<zone>-<HHMM>` in the SITE's zone, zero padded", () => {
    expect(deriveAckItems([hourly(6, "high")], [], "Asia/Dubai")[0]?.id).toBe("high-0600");
    // the same instant in another zone is another local time: the zone is an input, nothing is assumed
    expect(deriveAckItems([hourly(6, "high")], [], "UTC")[0]?.id).toBe("high-0200");
  });

  it("a run is broken by anything that is not work, rest or a stop at that zone: a ban or a gap does not merge across", () => {
    const ban: PlanSegment = { ...hourly(12, null), state: "ban", rule_id: "P-H1" };
    const segments = [hourly(10, "high"), hourly(11, "high"), ban, hourly(15, "high")];
    expect(deriveAckItems(segments, [], ZONE).map((item) => item.id)).toEqual(["high-1000", "high-1500"]);
  });

  it("a segment with no zone of its own takes the zone of the hour it starts in (zone_hours)", () => {
    const zoneHours = [{ starts_at: hourly(9, null).starts_at, zone: "high" as const, level: "orange" as const }];
    expect(deriveAckItems([hourly(9, null)], zoneHours, ZONE).map((item) => item.id)).toEqual(["high-0900"]);
    expect(deriveAckItems([hourly(9, null)], [], ZONE)).toEqual([]);
  });

  it("a stop run is an item (its zone is red), as the API lists it", () => {
    const stopped: PlanSegment = { ...hourly(10, "red"), state: "stopped", rule_id: "STOP.red" };
    expect(deriveAckItems([hourly(9, "high"), stopped], [], ZONE).map((item) => item.id)).toEqual(["high-0900", "red-1000"]);
  });
});

describe("test_derive_ack_equals_server_ack_items: the contract test (the fixture is the oracle, as Task 24 specified)", () => {
  beforeEach(() => {
    resetDemoStateHard();
  });

  const crews = ["crew-a", "crew-b", "crew-c", "crew-d"];
  const asComparable = (items: readonly { id: string; zone: string; starts_at?: string; ends_at?: string; startsAt?: string; endsAt?: string }[]) =>
    items.map((item) => ({ id: item.id, zone: item.zone, startsAt: item.startsAt ?? item.starts_at, endsAt: item.endsAt ?? item.ends_at }));

  it.each(crews)("%s, a rule plan: derived items equal the server's", (crewId) => {
    const plan = crewDayPlan(crewId, REPLAY_DATE);
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    expect(plan.ack_items.length).toBeGreaterThan(0);
    expect(asComparable(deriveAckItems(plan.segments, plan.zone_hours, plan.ban_window.timezone))).toEqual(asComparable(plan.ack_items));
  });

  it.each(crews)("%s, the protective fallback plan: derived items equal the server's", (crewId) => {
    const plan = crewDayPlan(crewId, REPLAY_DATE, { forecastStatus: "fallback" });
    if (plan === undefined) throw new Error("no plan");
    expect(plan.ack_items.length).toBeGreaterThan(0);
    expect(asComparable(deriveAckItems(plan.segments, plan.zone_hours, plan.ban_window.timezone))).toEqual(asComparable(plan.ack_items));
  });

  it("a plan with a stop in it (a red run): derived items equal the server's, ids shift the same way", () => {
    const before = crewDayPlan("crew-b", REPLAY_DATE);
    createStop("crew-b");
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    if (plan === undefined || before === undefined) throw new Error("no plan");
    expect(plan.ack_items.some((item) => item.zone === "red")).toBe(true);
    expect(plan.ack_items.map((item) => item.id)).not.toEqual(before.ack_items.map((item) => item.id));
    expect(asComparable(deriveAckItems(plan.segments, plan.zone_hours, plan.ban_window.timezone))).toEqual(asComparable(plan.ack_items));
  });

  it("the screen uses the server's list when the plan has one (even an empty one), and the derived list only when it is absent", () => {
    const plan = crewDayPlan("crew-b", REPLAY_DATE);
    if (plan === undefined) throw new Error("no plan");
    expect(ackItemsOf(plan, ZONE).map((item) => item.id)).toEqual(plan.ack_items.map((item) => item.id));
    expect(ackItemsOf(plan, ZONE)[0]?.textCode).toBe(plan.ack_items[0]?.text_code);
    expect(ackItemsOf({ ...plan, ack_items: [] }, ZONE)).toEqual([]);
    const absent = { ...plan } as Partial<typeof plan>;
    delete absent.ack_items;
    const derived = ackItemsOf(absent as typeof plan, ZONE);
    expect(derived.map((item) => item.id)).toEqual(plan.ack_items.map((item) => item.id));
    expect(derived.every((item) => item.textCode === null)).toBe(true);
  });
});

describe("cycleOfCode", () => {
  it("reads minutes only from a cycle code that is one hour, and nothing from any other", () => {
    expect(cycleOfCode("cycle.high.heavy.20-40")).toEqual({ work: 20, rest: 40 });
    expect(cycleOfCode("cycle.medium.heavy.45-15")).toEqual({ work: 45, rest: 15 });
    expect(cycleOfCode("stop-work")).toBeNull();
    expect(cycleOfCode("cycle.high.heavy.20-30")).toBeNull();
    expect(cycleOfCode(null)).toBeNull();
  });
});
