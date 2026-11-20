/*
 * The four station names drawn on the map, with the position of the point and the length of the leader line (pixels, positive above the point,
 * negative below). Offsets are fixed pixels chosen so that no two names overlap at the wide view and at the close view; the Abu Dhabi coast is the
 * point the camera flies in to. `narrowEnd`: in the plain column (a phone) the map is small and Abu Dhabi and Al Ain would print over each other,
 * so Abu Dhabi's name grows towards the start instead of the end. The names come from the catalogue (judge.landing.field.stations), the coordinates are the stations' own.
 */
export type StationCode = "OMAA" | "OMDB" | "OMAL" | "OMFJ";
export const STATIONS: readonly { readonly code: StationCode; readonly lat: number; readonly lon: number; readonly leader: number; readonly end?: boolean; readonly narrowEnd?: boolean }[] = [
  { code: "OMAA", lat: 24.433, lon: 54.6511, leader: -36, narrowEnd: true },
  { code: "OMDB", lat: 25.255, lon: 55.3643, leader: 64 },
  { code: "OMAL", lat: 24.2617, lon: 55.6092, leader: -36 },
  { code: "OMFJ", lat: 25.1122, lon: 56.324, leader: 36 },
];
