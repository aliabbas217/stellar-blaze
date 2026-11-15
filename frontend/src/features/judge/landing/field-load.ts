import { boxOf, clipCoast, parseCoast, parseField, type FieldGrid, type Polyline } from "./field-data";

/*
 * The browser's read of the two recorded files the hero draws (same-origin static files under `public/data/static`, ADR 0037:
 * 196 KB raw together). One shared promise, so the gate and anything else that asks never fetch twice; a failure clears it so
 * the next ask tries again. The files are checked by hand (`parseField`, `parseCoast`): a malformed file is an error state,
 * never a half-drawn field.
 */

export const FIELD_URL = "/data/static/uae_ifs025_d1_wbgt_2026-09-03.json";
export const COAST_URL = "/data/static/coast.json";

export interface LoadedField {
  readonly grid: FieldGrid;
  readonly coast: readonly Polyline[];
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  return (await response.json()) as unknown;
}

let pending: Promise<LoadedField> | null = null;

export function loadFieldFiles(): Promise<LoadedField> {
  pending ??= Promise.all([getJson(FIELD_URL), getJson(COAST_URL)])
    .then(([field, coast]): LoadedField => {
      const grid = parseField(field);
      // Only the coast inside the field's box is ever drawn: clip once, here, not on every frame.
      return { grid, coast: clipCoast(parseCoast(coast), boxOf(grid)) };
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
