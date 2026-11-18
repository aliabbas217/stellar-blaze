import { useSyncExternalStore } from "react";

/*
 * The demo role: which of the two staff roles a visitor chose at the front door ("crew lead" or "safety officer"), kept for this
 * browser session so the screens can label it ("Demo: crew lead") and offer "Switch role".
 *
 * It is NAVIGATION STATE and a label, nothing more (redesign S7, ADR 0062): no cookie, no server state, no token, no sign-in. It is
 * read by no request and gates no route; a deep link works with or without it, and the BFF's allow-list stays the only gate. Because
 * it protects nothing, storage that throws (private mode, a blocked profile) is not an error: the role then lives in this page's
 * memory only, and the label still works until the tab is closed or reloaded.
 */

export type DemoRole = "crew-lead" | "officer";

/** sessionStorage key. A session, not localStorage: a new visit starts with no role, like a person arriving at the front door. */
export const DEMO_ROLE_KEY = "sb-demo-role";

/** Fired on `window` when the role changes in this tab (the `storage` event only fires in OTHER tabs). */
const CHANGE_EVENT = "sb-demo-role-change";

/** The role of this page's memory: used only when sessionStorage throws. */
let memory: DemoRole | null = null;

export function isDemoRole(value: unknown): value is DemoRole {
  return value === "crew-lead" || value === "officer";
}

/** The chosen role, or null: nothing stored, an unknown value, no window (server render) or storage that throws. */
export function readDemoRole(): DemoRole | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DEMO_ROLE_KEY);
    if (isDemoRole(raw)) return raw;
  } catch {
    // Blocked storage: fall through to the page's memory.
  }
  return memory;
}

function announce(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setDemoRole(role: DemoRole): void {
  memory = null;
  try {
    window.sessionStorage.setItem(DEMO_ROLE_KEY, role);
  } catch {
    memory = role;
  }
  announce();
}

export function clearDemoRole(): void {
  memory = null;
  try {
    window.sessionStorage.removeItem(DEMO_ROLE_KEY);
  } catch {
    // Nothing stored that could be removed.
  }
  announce();
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The chosen role as a hook: `undefined` until the browser has been asked (the server render and the hydration pass, so the markup
 * matches), then the role or `null`. A caller reserves its height for `undefined` so nothing moves when the answer arrives.
 */
export function useDemoRole(): DemoRole | null | undefined {
  return useSyncExternalStore<DemoRole | null | undefined>(subscribe, readDemoRole, () => undefined);
}
