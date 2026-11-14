import type { SeasonBan } from "./facts";

/**
 * The midday break the season ribbon cuts below the ground, as the API's `ban_window` states it (frozen B3 v1 contract:
 * season as MM-DD both ends inclusive, start and end as site-local HH:MM with the end exclusive).
 *
 * WHY A RECORDED VALUE: the scoreboard is a static page that reads no API (it must render with the API stopped, journeys
 * D3), so it cannot read `ban_window` from a response, and none of the three exporter files carries one. This is the
 * ruleset's value (ADR 0011: 12:30 to 15:00, 15 Jun to 15 Sep, local dates), written once here with the contract's field
 * names. tests/unit/features/judge/ban.test.ts fails the moment it differs from the window the mock API serves, and the
 * contract gap is reported: the exporter's PolicyScoreboard should carry `ban_window` so this constant can go.
 */
export const SEASON_BAN: SeasonBan = {
  season_start: "06-15",
  season_end: "09-15",
  start: "12:30",
  end: "15:00",
};
