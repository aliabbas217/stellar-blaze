import type { components } from "@/api/schema";
import type { Level } from "@/components/level/level";
import { buildCrewModels, cycleOf } from "@/features/supervisor/crew-model";
import { crewDayPlan, crewTimeline, listCrews, REPLAY_DATE, SITE_DEMO } from "@/mocks/fixtures";

/*
 * The crews screen's model (F2 Task 19), on the mock API's fixture day: 3 Sep 2026, every crew on the roster L1 (06:00 to 11:00
 * and 15:00 to 18:00 local). Each test sets the crew levels it needs on top of the fixture, so the ranking is pinned by the
 * rule and not by the day's weather.
 */

type Crew = components["schemas"]["Crew"];
type Timeline = components["schemas"]["CrewTimeline"];

const ZONE = "Asia/Dubai";
const at = (hhmm: string): Date => new Date(`${REPLAY_DATE}T${hhmm}:00+04:00`);

function crews(): Crew[] {
  const list = listCrews(SITE_DEMO);
  if (list === undefined) throw new Error("the fixture site has crews");
  return list;
}

function crew(id: string): Crew {
  const found = crews().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no fixture crew ${id}`);
  return found;
}

/** The fixture timeline of a crew with the crew level of some local hours replaced. */
function timelineOf(crewId: string, levels: Readonly<Record<number, Level | null>> = {}): Timeline {
  const base = crewTimeline(crewId, REPLAY_DATE);
  if (base === undefined) throw new Error(`no fixture crew ${crewId}`);
  return {
    ...base,
    hours: base.hours.map((hour) => {
      const local = Number(hour.starts_at.slice(11, 13)) + 4;
      const level = levels[local];
      return level === undefined && !(local in levels) ? hour : { ...hour, crew_level: level ?? null };
    }),
  };
}

const MORNING = [6, 7, 8, 9, 10] as const;
const allAt = (level: Level | null, hours: readonly number[] = MORNING): Record<number, Level | null> =>
  Object.fromEntries(hours.map((hour) => [hour, level]));

/** Every crew at `level` for every hour of the day, with some crews' own timelines laid over. */
function timelines(level: Level, own: Readonly<Record<string, Timeline>> = {}): Record<string, Timeline> {
  const all: Record<string, Timeline> = {};
  for (const { id } of crews()) {
    const base = crewTimeline(id, REPLAY_DATE);
    if (base === undefined) throw new Error("fixture");
    all[id] = { ...base, hours: base.hours.map((hour) => ({ ...hour, crew_level: level })) };
  }
  return { ...all, ...own };
}

describe("buildCrewModels: ranking", () => {
  it("test_crews_ranked_worst_first: rank is the level index times ten, plus one while working", () => {
    const all = timelines("amber", {
      "crew-a": timelineOf("crew-a", allAt("orange")),
      "crew-c": timelineOf("crew-c", allAt("red")),
    });
    const models = buildCrewModels(crews(), all, undefined, at("09:30"), ZONE);

    expect(models.map((model) => [model.crew.id, model.level, model.rank])).toEqual([
      ["crew-c", "red", 41],
      ["crew-a", "orange", 31],
      ["crew-b", "amber", 21],
      ["crew-d", "amber", 21],
    ]);
  });

  it("a working crew outranks an equal level that is off shift, and equal ranks keep the API's order", () => {
    const all = timelines("orange");
    // 11:30: every crew is off shift (the shift ends at 11:00); crew B is given a block that covers 11:30.
    const shifted: Timeline = { ...(all["crew-b"] as Timeline), shift: [{ starts_at: "2026-09-03T06:00:00Z", ends_at: "2026-09-03T08:00:00Z" }] };
    const models = buildCrewModels(crews(), { ...all, "crew-b": shifted }, undefined, at("11:30"), ZONE);

    expect(models.map((model) => [model.crew.id, model.working, model.rank])).toEqual([
      ["crew-b", true, 31],
      ["crew-a", false, 30],
      ["crew-c", false, 30],
      ["crew-d", false, 30],
    ]);
  });

  it("a crew with no level ranks last", () => {
    const all = timelines("orange", { "crew-d": timelineOf("crew-d", allAt(null, [6, 7, 8, 9, 10, 15, 16, 17])) });
    const models = buildCrewModels(crews(), all, undefined, at("09:30"), ZONE);

    expect(models.at(-1)).toMatchObject({ level: null, rank: 1 });
    expect(models.at(-1)?.crew.id).toBe("crew-d");
  });

  it("a crew with no timeline yet still has a model: no level, no cells, its shift from the list", () => {
    const models = buildCrewModels([crew("crew-b")], {}, undefined, at("09:30"), ZONE);

    expect(models[0]).toMatchObject({ level: null, working: true, cells: [], suppressed: false });
  });
});

describe("buildCrewModels: working, until, starts at", () => {
  it("working crew: the level holds until the end of the run of equal hours, held inside the shift block", () => {
    const all = timelines("amber", { "crew-b": timelineOf("crew-b", allAt("orange", [9, 10, 11])) });
    const [crewB] = buildCrewModels([crew("crew-b")], all, undefined, at("09:10"), ZONE);

    expect(crewB).toMatchObject({ working: true, level: "orange", startsAt: null });
    // Orange from 09:00 to 12:00 on the timeline, but the shift block ends at 11:00.
    expect(crewB?.until).toBe(at("11:00").toISOString());
  });

  it("off shift: the level is the first shift hour's, startsAt is the next block", () => {
    const all = timelines("amber", { "crew-b": timelineOf("crew-b", allAt("orange", [15, 16, 17])) });
    const [crewB] = buildCrewModels([crew("crew-b")], all, undefined, at("11:10"), ZONE);

    expect(crewB).toMatchObject({ working: false, level: "orange", until: null });
    expect(crewB?.startsAt).toBe(at("15:00").toISOString());
  });

  it("a stopped crew is not working, keeps the level of the hour (red from the API) and names its stop time", () => {
    const stoppedCrew: Crew = { ...crew("crew-b"), stopped: true, active_stop_id: "stop-0001", stopped_at: at("09:40").toISOString() };
    const [crewB] = buildCrewModels([stoppedCrew], timelines("red"), undefined, at("09:45"), ZONE);

    expect(crewB).toMatchObject({ working: false, stopped: true, level: "red", stoppedAt: at("09:40").toISOString(), rank: 40 });
  });

  it("only shift hours are on shift in the strip", () => {
    const [crewB] = buildCrewModels([crew("crew-b")], timelines("orange"), undefined, at("09:30"), ZONE);

    expect(crewB?.cells.filter((cell) => cell.onShift).map((cell) => cell.hour)).toEqual([6, 7, 8, 9, 10, 15, 16, 17]);
  });

  it("maps the sign-off state to the plan state", () => {
    const states = buildCrewModels(crews(), timelines("amber"), undefined, at("09:30"), ZONE).map((model) => [model.crew.id, model.planState]);

    expect(Object.fromEntries(states)).toEqual({ "crew-a": "signed", "crew-b": "unsigned", "crew-c": "changed", "crew-d": "signed" });
  });
});

describe("buildCrewModels: suppression", () => {
  it("test_suppressed_crew_keeps_level_and_hides_detail: crew D (4 people, k 5) keeps its level and strip, flagged suppressed, nothing member-derived", () => {
    const models = buildCrewModels(crews(), timelines("orange"), undefined, at("09:30"), ZONE);
    const crewD = models.find((model) => model.crew.id === "crew-d");

    expect(crewD).toMatchObject({ suppressed: true, level: "orange" });
    expect(crewD?.cells.some((cell) => cell.level === "orange")).toBe(true);
    // The model reads no restrictions and no restricted head count of any crew: nothing of the kind is in it.
    expect(JSON.stringify(models)).not.toMatch(/restrict/i);
    expect(models.filter((model) => model.suppressed).map((model) => model.crew.id)).toEqual(["crew-d"]);
  });
});

describe("cycleOf", () => {
  function plan(crewId: string): components["schemas"]["DayPlan"] {
    const result = crewDayPlan(crewId, REPLAY_DATE);
    if (result === undefined) throw new Error("fixture plan");
    return result;
  }

  it("reads the next work and rest minutes from the plan's own segments: crew B at 15:10 is 20 work, 40 rest", () => {
    expect(cycleOf(plan("crew-b"), at("15:10").getTime())).toEqual({ workMinutes: 20, restMinutes: 40 });
  });

  it("off shift at 11:10 the next cycle is the 15:00 one", () => {
    expect(cycleOf(plan("crew-b"), at("11:10").getTime())).toEqual({ workMinutes: 20, restMinutes: 40 });
  });

  it("a Medium cycle reads 45 work and 15 rest, and the light crew's High cycle 45 and 15", () => {
    expect(cycleOf(plan("crew-b"), at("08:20").getTime())).toEqual({ workMinutes: 45, restMinutes: 15 });
    expect(cycleOf(plan("crew-d"), at("10:10").getTime())).toEqual({ workMinutes: 45, restMinutes: 15 });
  });

  it("a rest run that falls in the next zone is not part of the cycle: at 09:30 (Medium work, then High rest) the Medium cycle is 45 and 15", () => {
    expect(cycleOf(plan("crew-b"), at("09:30").getTime())).toEqual({ workMinutes: 45, restMinutes: 15 });
  });

  it("in the middle of a rest run the cycle is the same: crew B at 15:30 is 20 work, 40 rest", () => {
    expect(cycleOf(plan("crew-b"), at("15:30").getTime())).toEqual({ workMinutes: 20, restMinutes: 40 });
  });

  it("a Low-zone work run has no cycle (self-paced work is not a cycle the plan states)", () => {
    expect(cycleOf(plan("crew-b"), at("06:30").getTime())).toBeNull();
  });

  it("no work run left in the plan is no cycle", () => {
    expect(cycleOf(plan("crew-b"), at("23:00").getTime())).toBeNull();
  });

  it("buildCrewModels puts the cycle on the crew whose plan it was given", () => {
    const models = buildCrewModels(crews(), timelines("orange"), { "crew-b": plan("crew-b") }, at("15:10"), ZONE);

    expect(models.find((model) => model.crew.id === "crew-b")?.cycle).toEqual({ workMinutes: 20, restMinutes: 40 });
    expect(models.find((model) => model.crew.id === "crew-a")?.cycle).toBeNull();
  });
});
