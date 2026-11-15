import { banStateFrom, type BanState } from "@/components/spine/ban-state";
import type { SeasonBan } from "./facts";

/**
 * The midday break the season ribbon cuts below the ground, as the API's `ban_window` states it (frozen B3 v1 contract:
 * season as MM-DD both ends inclusive, start and end as site-local HH:MM with the end exclusive).
 *
 * WHY A RECORDED VALUE: the scoreboard is a static page that reads no API (it must render with the API stopped, journeys
 * D3), so it cannot read `ban_window` from a response, and none of the three exporter files carries one. This is the
 * ruleset's value (ADR 0011: 12:30 to 15:00, 15 Jun to 15 Sep, local dates), written once here with the contract's field
 * names. tests/unit/features/judge/ban.test.ts fails the moment it differs from the `BanWindow` example in
 * frontend/openapi/stellar-blaze.openapi.json (the contract, parsed; not a second hand-typed copy), and the contract gap is
 * reported: the exporter's PolicyScoreboard should carry `ban_window` so this constant can go.
 */
export const SEASON_BAN: SeasonBan = {
  season_start: "06-15",
  season_end: "09-15",
  start: "12:30",
  end: "15:00",
};

/** The replay site's time zone (`Site.timezone` of the demo site, ADR 0011): the recorded hours and the break are site-local. */
export const SITE_TZ = "Asia/Dubai";

const OFFSET = "+04:00";

/**
 * The break as a `BanState` for one site-local `date`, from the recorded `SEASON_BAN` through the same `banStateFrom` the
 * live screens use (the one place that decides in-force or not), so a static page and an API page can never disagree about a
 * date. The window's instants are made from the recorded clock times on that date in the site's fixed UTC+4 offset (Dubai has
 * no daylight saving); outside the season `banStateFrom` returns the dashed outline and the date the break resumes.
 */
export function banStateFor(ban: SeasonBan, date: string, locale: string): BanState {
  return banStateFrom(
    {
      starts_at: `${date}T${ban.start}:00${OFFSET}`,
      ends_at: `${date}T${ban.end}:00${OFFSET}`,
      season_start: ban.season_start,
      season_end: ban.season_end,
      start: ban.start,
      end: ban.end,
      timezone: SITE_TZ,
    },
    SITE_TZ,
    date,
    locale,
  );
}
