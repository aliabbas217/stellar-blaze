/*
 * A station name is never drawn under other text. The readout card covers part of the map's end side on a short screen, and in
 * right-to-left the map's east side (Dubai, Fujairah) faces the copy: a name half under the card, or on top of a heading's line, is
 * worse than no name (the airport is named in the readout, and the map is a picture). So a name whose box meets one of these
 * obstacles is hidden, whole, and shown again when it clears. The rule is geometry on rectangles in the stage's own coordinates; the
 * DOM parts (reading the card and the lines of the copy, hiding a name) are small and live beside it.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The clear space kept around an obstacle: a name that only comes within this of it is hidden too. */
export const MARGIN_PX = 8;

/** A name is centred on its point and stands above it, so its box is `[x - w/2, x + w/2] x [y - h, y]`. `at` is that point and size. */
export function hidesUnder(at: Rect, obstacles: readonly Rect[]): boolean {
  const left = at.x - at.w / 2;
  const right = at.x + at.w / 2;
  const top = at.y - at.h;
  const bottom = at.y;
  return obstacles.some((o) => left < o.x + o.w + MARGIN_PX && right > o.x - MARGIN_PX && top < o.y + o.h + MARGIN_PX && bottom > o.y - MARGIN_PX);
}

interface PageRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Page rectangles in the stage's coordinates; empty ones dropped. */
export function obstaclesOf(stage: { readonly left: number; readonly top: number }, rects: readonly PageRect[]): Rect[] {
  return rects.filter((r) => r.width > 0 && r.height > 0).map((r) => ({ x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height }));
}

/**
 * Vertical ink overshoot of Arabic-script text, as a share of the font size, above and below the box `Range.getClientRects` returns
 * (the font's content box). Urdu and Arabic marks, dots and ascenders can reach beyond it (Part L1 fix round 3, minor 4). MEASURED on
 * the landing's own lines in the shipped faces (tests/e2e/judge-landing-contrast.spec.ts reads the painted ink of every line at 1024,
 * 1100 and 1440 px, ur and ar). The display headings are drawn by the locale face itself (Noto Nastaliq Urdu, Noto Sans Arabic) since
 * they left the operating system's Arial: the Urdu h1 overshoots by up to 0.32 em, the Urdu lede by 0.09 em, Arabic by 0.04 em at most.
 * The allowance is 0.35 em (1.1 times the measured maximum); the e2e fails if a line whose ink is its own ever overshoots it.
 */
export const INK_OVERSHOOT_EM = 0.35;

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u;

/** Pixels to add above and below a line of `text` set at `fontSizePx`: Arabic-script text only (the script, not the page language, decides). */
export function inkAllowance(text: string, fontSizePx: number): number {
  return ARABIC_SCRIPT.test(text) && Number.isFinite(fontSizePx) ? fontSizePx * INK_OVERSHOOT_EM : 0;
}

/**
 * The obstacles of a hero as they are laid out now: every control marked `data-avoid` and every line of the hero's text (text rectangles, not the
 * blocks: a heading's line height is leading, not ink; Arabic-script lines are inflated by the ink allowance). Since the redesign the field is a box
 * beside the copy, so none is usually over it, but the rule holds if a layout ever puts one there. `stage` is the box the names are positioned in.
 */
export function collectObstacles(stage: HTMLElement): Rect[] {
  const hero = stage.closest("[data-landing-hero]");
  if (hero === null) return [];
  const pages: PageRect[] = [];
  for (const el of hero.querySelectorAll("[data-avoid]")) pages.push(el.getBoundingClientRect());
  for (const el of hero.querySelectorAll("[data-contrast]:not([data-station-label])")) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const grow = inkAllowance(el.textContent, Number.parseFloat(getComputedStyle(el).fontSize));
    for (const r of range.getClientRects()) pages.push(grow === 0 ? r : { left: r.left, top: r.top - grow, width: r.width, height: r.height + 2 * grow });
  }
  return obstaclesOf(stage.getBoundingClientRect(), pages);
}

/** The size of a name, measured once per `refreshAvoidance` (a layout read), kept so that a frame reads none. */
type Size = readonly [number, number];

interface Known {
  readonly obstacles: readonly Rect[];
  readonly sizes: WeakMap<HTMLElement, Size>;
}

const known = new WeakMap<HTMLElement, Known>();

/** Hides each name (a child of `container`) that sits under an obstacle, shows the others. Positions are the names' own `left` and `top`. */
function apply(container: HTMLElement, state: Known, measure: boolean): void {
  for (const child of container.children) {
    if (!(child instanceof HTMLElement)) continue;
    const x = Number.parseFloat(child.style.left);
    const y = Number.parseFloat(child.style.top);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    let size = measure ? undefined : state.sizes.get(child);
    if (size === undefined) {
      size = [child.offsetWidth, child.offsetHeight]; // a layout read: only at a refresh, or for a name created since
      state.sizes.set(child, size);
    }
    const hidden = hidesUnder({ x, y, w: size[0], h: size[1] }, state.obstacles);
    const now = child.style.visibility === "hidden";
    if (hidden !== now) child.style.visibility = hidden ? "hidden" : ""; // written only when it changes
  }
}

/** Reads the obstacles of the stage `container` lies in and the names' sizes, keeps them for `reapplyAvoidance`, and applies them. Call when the layout may have changed. */
export function refreshAvoidance(container: HTMLElement): void {
  const stage = container.closest("[data-field-stage]");
  const state: Known = { obstacles: stage instanceof HTMLElement ? collectObstacles(stage) : [], sizes: new WeakMap() };
  known.set(container, state);
  apply(container, state, true);
}

/** Applies what the last `refreshAvoidance` kept (the names moved, nothing else did): no layout is read, and `visibility` is written only when it changes. */
export function reapplyAvoidance(container: HTMLElement): void {
  apply(container, known.get(container) ?? { obstacles: [], sizes: new WeakMap() }, false);
}
