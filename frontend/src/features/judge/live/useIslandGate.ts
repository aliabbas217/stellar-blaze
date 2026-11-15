import { useCallback, useEffect, useRef, useState, type ComponentType, type SyntheticEvent } from "react";

/*
 * The lazy interactive island of a judge page that calls the API (`/replay/governance`, `/replay/try`).
 *
 * Why: TanStack Query (about 18.7 KB gzip) and the demo context put any page over the 174,080 B route budget, and these two
 * pages show a complete answer at first paint without them (a recorded run, a form with templates). So the first paint is
 * SERVER-RENDERED with plain controls, and the island (query client, demo context, mutations, live rows) is a separate chunk.
 *
 * Two steps, and the order is the point:
 *   1. WARMING preloads the chunk. Focus or pointerdown on a control (`data-island-action`) or a field (`data-island-field`)
 *      starts the `import()` and keeps its result; nothing on screen changes. The static DOM must survive the whole of a
 *      press: a pointerdown that swapped the page would detach the pressed button before pointerup and the browser would
 *      never dispatch `click` (the tap would be lost), and a swap on focus would destroy the focused field (and, on iOS, the
 *      soft keyboard).
 *   2. An ACTION swaps the island in: a click or a submit on a `data-island-action` element records the action and, once the
 *      chunk is there, replaces the static page with the island in one commit. The click has finished by then (it is the swap's
 *      trigger), so no node is torn down under a press. What was typed carries over (`readFields`).
 * Actions tapped while the chunk is still loading are kept in the order tapped (Reset, then Send: both run, dispatched in that
 * order), and the island performs each ONCE. Nothing here ever starts a send by itself: no timer, no idle callback, no
 * visibility trigger, and warming never performs an action.
 *
 * If the chunk does not arrive (offline, a stale deploy) the queue is dropped (a later load must never replay a stale tap), the
 * static page stays, `failed` is true so the page says so (`IslandStatus`), and the next CLICK retries the load. Warming on
 * focus may retry the load too, but only preloads it.
 *
 * The chunk is loaded with a plain dynamic `import()` in an event handler rather than `next/dynamic`: both split the same
 * chunk, but `next/dynamic` swaps in its own loading state at once.
 */

export interface IslandProps {
  /** The `data-island-action` ids tapped while the island loaded, in the order tapped, to perform once each (empty: nothing was tapped). */
  readonly initialActions: readonly string[];
  /** A selector for the control (an action button or a field) that held keyboard focus when the island replaced the static page, to focus again. */
  readonly restoreFocus: string | null;
  /**
   * What the visitor had typed or ticked in the static page's fields (`data-island-field="<name>"`: a checkbox is "true" or
   * "false") when the island replaced it, so the swap never loses input. Empty when the page has no fields.
   */
  readonly fields: Readonly<Record<string, string>>;
}

/** No taps: a stable empty list for a default prop. */
export const NO_ACTIONS: readonly string[] = [];

/** The mode of the last Live or Replay tap in the queue (the last one tapped wins), or null. */
export function lastModeTap(actions: readonly string[]): "live" | "replay" | null {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    if (actions[i] === "demo-live") return "live";
    if (actions[i] === "demo-replay") return "replay";
  }
  return null;
}

const SELECTOR = "[data-island-action]";
/** Anything that warms the island on focus or pointerdown: the action controls and the fields. */
const WARM = "[data-island-action], [data-island-field]";

function actionIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest(SELECTOR)?.getAttribute("data-island-action") ?? null;
}

function readFields(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const element of document.querySelectorAll<HTMLInputElement>("[data-island-field]")) {
    const name = element.getAttribute("data-island-field");
    if (name !== null) out[name] = element.type === "checkbox" ? String(element.checked) : element.value;
  }
  return out;
}

/** A selector for the control that holds focus (an action button or a field), to give focus back after the swap. */
function focusedSelector(): string | null {
  const active = document.activeElement;
  if (!(active instanceof Element)) return null;
  const action = active.closest(SELECTOR)?.getAttribute("data-island-action");
  if (action !== null && action !== undefined) return `[data-island-action="${action}"]`;
  const field = active.getAttribute("data-island-field");
  return field === null ? null : `[data-island-field="${field}"]`;
}

export interface IslandGate<P extends IslandProps> {
  /** The loaded island, or null while the static page is shown. */
  readonly Island: ComponentType<P> | null;
  readonly handoff: IslandProps;
  /** True after a tap whose chunk could not be loaded; the page says so (`IslandStatus`) and the next click retries. */
  readonly failed: boolean;
  /** Spread on the element that wraps the static page. */
  readonly handlers: {
    readonly onPointerDown: (event: SyntheticEvent) => void;
    readonly onFocus: (event: SyntheticEvent) => void;
    readonly onClick: (event: SyntheticEvent) => void;
    readonly onSubmit: (event: SyntheticEvent) => void;
  };
}

export function useIslandGate<P extends IslandProps>(load: () => Promise<{ default: ComponentType<P> }>): IslandGate<P> {
  const [Island, setIsland] = useState<ComponentType<P> | null>(null);
  const [handoff, setHandoff] = useState<IslandProps>({ initialActions: [], restoreFocus: null, fields: {} });
  const [failed, setFailed] = useState(false);
  const preloaded = useRef<Promise<ComponentType<P>> | null>(null);
  const queue = useRef<string[]>([]);
  const swapping = useRef(false);

  /** Starts the import once and keeps its result; a failed attempt is forgotten so the next one loads again. */
  const preload = useCallback((): Promise<ComponentType<P>> => {
    if (preloaded.current === null) {
      const attempt = load().then((module) => module.default);
      preloaded.current = attempt;
      attempt.catch(() => {
        if (preloaded.current === attempt) preloaded.current = null;
      });
    }
    return preloaded.current;
  }, [load]);

  /** Swaps the island in as soon as its chunk is there. Called only after an action has been recorded. */
  const swap = useCallback(() => {
    if (swapping.current) return;
    swapping.current = true;
    setFailed(false);
    preload().then(
      (Component) => {
        setHandoff({ initialActions: [...queue.current], restoreFocus: focusedSelector(), fields: readFields() });
        setIsland(() => Component);
      },
      () => {
        swapping.current = false;
        queue.current = [];
        setFailed(true);
      },
    );
  }, [preload]);

  const warm = useCallback(
    (event: SyntheticEvent) => {
      if (event.target instanceof Element && event.target.closest(WARM) !== null) preload().catch(() => undefined);
    },
    [preload],
  );

  const record = useCallback(
    (id: string) => {
      // The same control twice in a row (a click and the submit it caused) is one action.
      if (queue.current.at(-1) !== id) queue.current.push(id);
      swap();
    },
    [swap],
  );

  const tap = useCallback(
    (event: SyntheticEvent) => {
      const id = actionIdOf(event.target);
      if (id !== null) record(id);
    },
    [record],
  );

  const submit = useCallback(
    (event: SyntheticEvent) => {
      // Before the island is there a form must not navigate: the island performs this one submit after it loads.
      event.preventDefault();
      const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
      record(actionIdOf(submitter) ?? "submit");
    },
    [record],
  );

  return { Island, handoff, failed, handlers: { onPointerDown: warm, onFocus: warm, onClick: tap, onSubmit: submit } };
}

/** Gives keyboard focus back to the control that had it when the island replaced the static page. */
export function useRestoreFocus(selector: string | null): void {
  useEffect(() => {
    if (selector === null) return;
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) return;
    element.focus();
    // A text field gets its caret back at the end of what was typed before the swap.
    if (element instanceof HTMLInputElement && element.type === "text") element.setSelectionRange(element.value.length, element.value.length);
  }, [selector]);
}
