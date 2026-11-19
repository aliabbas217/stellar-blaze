import { parseField, type FieldGrid } from "./field-data";

/*
 * The browser's read of the recorded forecast grid the hero's captions and scene draw from (a same-origin static file under
 * `public/data/static`, ADR 0037). One shared promise, so nothing asks twice; a failure clears it so the next ask tries again. The file is
 * checked by hand (`parseField`): a malformed file is an error, never a half-drawn field.
 */

export const FIELD_URL = "/data/static/uae_ifs025_d1_wbgt_2026-09-03.json";

let pending: Promise<FieldGrid> | null = null;

export function loadFieldGrid(): Promise<FieldGrid> {
  pending ??= fetch(FIELD_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`${FIELD_URL}: HTTP ${String(response.status)}`);
      return response.json() as Promise<unknown>;
    })
    .then(parseField)
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
