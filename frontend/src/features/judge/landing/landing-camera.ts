/*
 * The camera and the clock of the pinned forecast scene, as pure functions of the scroll progress (0 to 1 over the pinned stretch). The page
 * has one passive scroll listener (landing-scroll.ts); it turns the scroll position into a progress with `progressOf` and everything below
 * follows from that number: the hour (it holds at 06:00, 09:00 and 14:00, so a caption's number is on screen with its own hour), which caption
 * shows, and the camera (the hero's three-quarter view of the whole country, in toward the Abu Dhabi coast, and back out).
 */

export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** [progress, hour] keys: rest at 06:00, run to 09:00, rest, run to 14:00, rest. */
const HOUR_KEYS: readonly (readonly [number, number])[] = [
  [0, 6],
  [0.1, 6],
  [0.4, 9],
  [0.5, 9],
  [0.68, 14],
  [1, 14],
];

/** The relief of the terrain mesh: heights are drawn five times their size (the legend says so). */
export const RELIEF = 5;

export const FIRST_HOUR = 6;
export const LAST_HOUR = 14;

/** The hour (fractional) at a scroll progress. */
export function hourOf(progress: number): number {
  for (let i = 1; i < HOUR_KEYS.length; i++) {
    const [p1, h1] = HOUR_KEYS[i] ?? [1, LAST_HOUR];
    if (progress <= p1) {
      const [p0, h0] = HOUR_KEYS[i - 1] ?? [0, FIRST_HOUR];
      return lerp(h0, h1, (progress - p0) / (p1 - p0));
    }
  }
  return LAST_HOUR;
}

/** Which caption shows: 0 is the hero's words, then the three captions. */
export type Step = 0 | 1 | 2 | 3;
export function stepOf(progress: number): Step {
  return progress < 0.08 ? 0 : progress < 0.5 ? 1 : progress < 0.78 ? 2 : 3;
}

export interface Camera {
  readonly az: number;
  readonly el: number;
  readonly dist: number;
  readonly t: readonly [number, number, number];
  /** The shift of the picture along the screen's x axis (NDC): the map stands beside the text panel, on the side the text is not. */
  readonly sx: number;
}

/** Share of the map's box the text panel covers on a wide screen (CSS `.txt`), and so how far the picture is pushed aside. */
export const PANEL_SHARE = 0.375;

/** How much closer the camera stands in the plain column (a phone, a tablet, reduced motion): the map box is a short box under the words, not a screen. */
export const COLUMN_ZOOM = 0.74;

/** The hero's view of the whole country; `aspect` is the canvas's width over its height; `zoom` scales the distance (1 on the pinned stage). */
export function wideCamera(aspect: number, sx: number, zoom = 1): Camera {
  return { az: -0.3, el: 0.82, dist: clamp(6.4 / (0.58 * aspect * 0.4986), 8, 18) * zoom, t: [0, -0.1, 0.2], sx };
}

/** The camera at a scroll progress; `coast` is the point it flies in to (the Abu Dhabi coast in world units). */
export function cameraAt(progress: number, aspect: number, coast: readonly [number, number, number], sx: number, zoom = 1): Camera {
  const w = wideCamera(aspect, sx, zoom);
  const k = smoothstep(clamp((progress - 0.12) / 0.63, 0, 1)) * (1 - smoothstep(clamp((progress - 0.88) / 0.12, 0, 1)));
  return {
    az: lerp(w.az, -0.1, k),
    el: lerp(w.el, 0.62, k),
    dist: Math.exp(lerp(Math.log(w.dist), Math.log(3.6), k)),
    t: [lerp(w.t[0], coast[0], k), lerp(w.t[1], coast[1], k), lerp(w.t[2], coast[2], k)],
    sx,
  };
}

/** The progress (0 to 1) of a pinned section from its bounding box and the window height. */
export function progressOf(top: number, height: number, windowHeight: number): number {
  const total = height - windowHeight;
  return total > 0 ? clamp(-top / total, 0, 1) : 0;
}
