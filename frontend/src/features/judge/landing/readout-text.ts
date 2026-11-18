import { hourLabel, LIMIT_C, type FieldReading } from "./field-data";

/*
 * The strings of one reading of the field (the hour, the hottest grid cell, the station), as the hour scrubber's value text and its live
 * words state them. The hero no longer prints a readout card (redesign S2, D7: the phone leads and the field is an illustration with a caption),
 * but a reader who moves the slider still hears the reading, and these are its words: one decimal for temperatures, two for coordinates,
 * Western digits in every language.
 */

export interface ReadoutText {
  readonly hour: string;
  readonly hottest: string;
  readonly lat: string;
  readonly lon: string;
  readonly station: string;
  readonly limit: string;
  readonly cells: string;
  readonly cellsTotal: string;
}

export function readoutText(reading: FieldReading): ReadoutText {
  return {
    hour: hourLabel(reading.hour),
    hottest: reading.hottest.value.toFixed(1),
    lat: reading.hottest.lat.toFixed(2),
    lon: reading.hottest.lon.toFixed(2),
    station: reading.station.toFixed(1),
    limit: LIMIT_C.toFixed(1),
    cells: String(reading.cellsAbove),
    cellsTotal: String(reading.cells),
  };
}
