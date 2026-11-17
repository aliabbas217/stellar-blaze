import type { Page } from "@playwright/test";
import { STOP_OUTBOX_DB } from "../../../src/features/supervisor/stop-outbox.ts";

/*
 * Seeds the Stop outbox the way an earlier visit would have left it. The database and store names are stop-outbox.ts's
 * (`STOP_OUTBOX_DB`, store `stops`, auto-increment `key`); a row is the crew id, the crew's name as the Stop button showed it, and
 * the phone's time; the rows REPLACE what the store held. The page must be on the app's origin (any route). The same helper is written inline in offline-f2.spec.ts,
 * which this change does not touch.
 */
export interface SeededStop {
  readonly crewId: string;
  readonly crewName: string;
  readonly clientTime: string;
}

export async function seedOutbox(page: Page, rows: readonly SeededStop[]): Promise<void> {
  await page.evaluate(
    ({ name, seeded }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("stops", { keyPath: "key", autoIncrement: true });
        };
        open.onerror = () => {
          reject(open.error ?? new Error("open failed"));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction("stops", "readwrite");
          // The store is REPLACED, so a state a test left (a queued row) never leaks into the next opening.
          transaction.objectStore("stops").clear();
          for (const row of seeded) transaction.objectStore("stops").add(row);
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
          transaction.onerror = () => {
            reject(transaction.error ?? new Error("write failed"));
          };
        };
      }),
    { name: STOP_OUTBOX_DB, seeded: rows },
  );
}

export const minutesAgoIso = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
