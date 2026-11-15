/*
 * The message paths each field route group's client components read (see ClientMessages.tsx). `_meta` is the draft-translation
 * badge's review status. tests/unit/i18n/client-namespaces.test.ts keeps these lists in step with the code.
 */

/** Today, the alert card and Alerts: the app group of the worker routes. `judge.proof` is the proof drawer's copy. */
export const WORKER_APP_NAMESPACES = ["_meta", "common", "shell", "worker", "today", "states", "levels", "alerts", "judge.proof"] as const;

/** The "I feel unwell" sheet: the shell, the dock and the sheet itself, nothing that needs the network. */
export const WORKER_SHEET_NAMESPACES = ["_meta", "common", "shell", "worker", "states", "levels"] as const;

/** The supervisor crews and plan screens. */
export const SUPERVISOR_NAMESPACES = ["_meta", "common", "shell", "supervisor", "states", "levels"] as const;
