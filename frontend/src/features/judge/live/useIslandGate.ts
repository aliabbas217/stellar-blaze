import { useCallback, useEffect, useRef, useState, type ComponentType, type SyntheticEvent } from "react";

/*
 * The lazy interactive island of a judge page that calls the API (`/replay/governance`, `/replay/try`).
 *
 * Why: TanStack Query (about 18.7 KB gzip) and the demo context put any page over the 174,080 B route budget, and these two
 * pages show a complete answer at first paint without them (a recorded run, a form with templates). So the first paint is
 * SERVER-RENDERED with plain controls, and the island (query client, demo context, mutations, live rows) is a separate chunk
 * that is fetched on the FIRST INTERACTION with a control: pointerdown, focus, click or submit on an element marked
 * `data-island-action="<id>"`. A click or submit also records the action, which the island performs ONCE after it has loaded
 * (so the first tap is never lost). Focus and pointerdown only warm the chunk. Nothing here ever starts a send: no timer, no
 * idle callback, no visibility trigger.
 *
 * The chunk is loaded with a plain dynamic `import()` held in an event handler rather than `next/dynamic`: both split the
 * same chunk, but `next/dynamic` swaps in its own loading state at once and the static controls would vanish between a
 * pointerdown and its click. Here the static DOM stays until the island is ready and then is replaced by it in one commit.
 */

export interface IslandProps {
  /** The `data-island-action` id of the tap that loaded the island, to perform once (null: only focus or pointerdown). */
  readonly initialAction: string | null;
  /** A selector for the control (an action button or a field) that held keyboard focus when the island replaced the static page, to focus again. */
  readonly restoreFocus: string | null;
  /**
   * What the visitor had typed or ticked in the static page's fields (`data-island-field="<name>"`: a checkbox is "true" or
   * "false") when the island replaced it, so the swap never loses input. Empty when the page has no fields.
   */
  readonly fields: Readonly<Record<string, string>>;
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
  const [handoff, setHandoff] = useState<IslandProps>({ initialAction: null, restoreFocus: null, fields: {} });
  const action = useRef<string | null>(null);
  const loading = useRef(false);

  const start = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    load().then(
      (module) => {
        setHandoff({ initialAction: action.current, restoreFocus: focusedSelector(), fields: readFields() });
        setIsland(() => module.default);
      },
      () => {
        // The chunk did not arrive (offline, a stale deploy): the static page stays and the next interaction tries again.
        loading.current = false;
      },
    );
  }, [load]);

  const warm = useCallback(
    (event: SyntheticEvent) => {
      if (event.target instanceof Element && event.target.closest(WARM) !== null) start();
    },
    [start],
  );

  const tap = useCallback(
    (event: SyntheticEvent) => {
      const id = actionIdOf(event.target);
      if (id === null) return;
      action.current = id;
      start();
    },
    [start],
  );

  const submit = useCallback(
    (event: SyntheticEvent) => {
      // Before the island is there a form must not navigate: the island performs this one submit after it loads.
      event.preventDefault();
      const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
      action.current = actionIdOf(submitter) ?? "submit";
      start();
    },
    [start],
  );

  return { Island, handoff, handlers: { onPointerDown: warm, onFocus: warm, onClick: tap, onSubmit: submit } };
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
