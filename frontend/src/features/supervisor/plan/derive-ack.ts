import type { components } from "@/api/schema";

/*
 * The acknowledgement items of a day plan, derived from the plan's own segments. The sign-off screen uses the SERVER's `ack_items`
 * (the API names them, and `acknowledged_items` must carry exactly those ids). This is the fallback for a plan that has no
 * `ack_items` at all, and is pinned against the server's list by tests/unit/features/supervisor/plan/derive-ack.test.ts on every
 * fixture crew (the contract test Task 24 left as a documented todo).
 *
 * The rule is the contract's (schema `AckItem`): one item per run of consecutive work and ADOSH-rest segments at the same zone
 * above Low ("consecutive hours at one zone merge; Low needs none"); a stop run counts too (its zone is red, and the API lists a
 * Red item). The id is `<zone>-<HHMM>`: the zone, then the zero-padded 24-hour start of the run in the SITE's zone. That differs
 * from the brief's `${zone}@${startsAt}`: the id is what the sign-off request sends back, so it must be the API's format, and the
 * API's format needs the site zone (a third argument, from the plan's own `ban_window.timezone`; nothing here knows Asia/Dubai).
 */

type PlanSegment = components["schemas"]["PlanSegment"];
type ZoneHour = components["schemas"]["ZoneHour"];

export type AckZone = "medium" | "high" | "red";

export interface AckItem {
  readonly id: string;
  readonly zone: AckZone;
  readonly startsAt: string;
  readonly endsAt: string;
}

const HOUR_MS = 60 * 60 * 1000;

function isAckZone(zone: string | null | undefined): zone is AckZone {
  return zone === "medium" || zone === "high" || zone === "red";
}

/** "0600" for 06:00 in `timeZone`: the local start of a run, as the API writes it into an id. */
function localHhmm(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("hour")}${get("minute")}`;
}

export function deriveAckItems(segments: readonly PlanSegment[], zoneHours: readonly ZoneHour[], timeZone: string): AckItem[] {
  // A segment with no zone of its own takes the zone of the hour it starts in (`zone_hours`, the zone each hour was planned from).
  const hourZone = (startsAt: string): string | null => {
    const at = Date.parse(startsAt);
    return zoneHours.find((hour) => Date.parse(hour.starts_at) <= at && at < Date.parse(hour.starts_at) + HOUR_MS)?.zone ?? null;
  };

  const items: AckItem[] = [];
  for (const segment of segments) {
    const counted = segment.state === "work" || segment.state === "adosh_rest" || segment.state === "stopped";
    const zone = segment.zone ?? hourZone(segment.starts_at);
    if (!counted || !isAckZone(zone)) continue;
    const last = items.at(-1);
    if (last !== undefined && last.zone === zone && last.endsAt === segment.starts_at) {
      items[items.length - 1] = { ...last, endsAt: segment.ends_at };
      continue;
    }
    items.push({ id: `${zone}-${localHhmm(segment.starts_at, timeZone)}`, zone, startsAt: segment.starts_at, endsAt: segment.ends_at });
  }
  return items;
}

/** The server's items as the screen holds them (the same shape, plus the ruleset's text code). */
export interface PlanAckItem extends AckItem {
  /** The ruleset's action code of the run, for example `cycle.high.heavy.20-40`, or null when the list is derived (it carries none). */
  readonly textCode: string | null;
}

/** The items of `plan`: the server's list when it has one (even an empty one: an all-Low day), else the derived fallback. */
export function ackItemsOf(plan: components["schemas"]["DayPlan"], timeZone: string): PlanAckItem[] {
  const given: components["schemas"]["AckItem"][] | undefined = (plan as { ack_items?: components["schemas"]["AckItem"][] }).ack_items;
  if (Array.isArray(given)) {
    return given.map((item) => ({ id: item.id, zone: item.zone, startsAt: item.starts_at, endsAt: item.ends_at, textCode: item.text_code }));
  }
  return deriveAckItems(plan.segments, plan.zone_hours, timeZone).map((item) => ({ ...item, textCode: null }));
}

/** `cycle.high.heavy.20-40` to its work and rest minutes; null for any other code (a stop code, or one this screen does not know). */
export function cycleOfCode(code: string | null): { readonly work: number; readonly rest: number } | null {
  if (code === null) return null;
  const match = /^cycle\.[a-z]+\.[a-z]+\.(\d{1,2})-(\d{1,2})$/.exec(code);
  if (match === null) return null;
  const work = Number(match[1]);
  const rest = Number(match[2]);
  return work + rest === 60 && rest > 0 ? { work, rest } : null;
}
