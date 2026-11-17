import type { Page } from "@playwright/test";

/*
 * Text contrast measured on the pixels the browser really painted, for the landing hero where copy lies over a moving map.
 *
 * Method (WCAG 2.2 relative luminance, no model of the colours behind the text):
 *   1. every element marked `data-contrast` ("body", "large" or "label") gives the line boxes of its text (Range client rects) and its
 *      own text colour;
 *   2. the page is screenshotted twice: as it is (C) and with all text made transparent (A), so A is what lies BEHIND the text:
 *      the map, the scrim, the label halo;
 *   3. for a line of copy ("body", "large") the ratio is the worst one over every pixel of its line box: ink against that pixel;
 *   4. for a station name ("label", which has a halo instead of a box) the pixels behind its GLYPHS are the ones that count, so the
 *      glyph pixels are the ones that differ between C and A (strong coverage only) and the ratio is the worst over those, read in A.
 * The pixels are read in a blank page (no CSP), so the app's own policy is not loosened for a test.
 * Thresholds: 4.5 for body text and station names, 3.0 for large text. Which one a line is held to comes from its RENDERED size and
 * weight (contrast-class.ts: WCAG large text is 24 px, or 18.66 px and bold), not from `data-contrast`: the attribute is only what the
 * page declares, and a declaration that disagrees with the rendered size fails by the element's name.
 */

import { classify, declaredKind, disagreement, thresholdFor, type ContrastKind } from "./contrast-class.ts";

export type { ContrastKind } from "./contrast-class.ts";

export interface ContrastLine {
  readonly name: string;
  readonly kind: ContrastKind;
  readonly text: string;
  readonly ratio: number;
  /** The threshold from the rendered size and weight. */
  readonly threshold: number;
  readonly fontSizePx: number;
  readonly fontWeight: number;
  /** Set when the page's declared kind disagrees with the rendered size (names the element); null when they agree. */
  readonly mismatch: string | null;
  /** Pixels read: line box pixels for copy, glyph pixels for a label (zero means nothing was measured). */
  readonly pixels: number;
}

interface Target {
  readonly name: string;
  readonly kind: ContrastKind;
  readonly text: string;
  readonly ink: readonly [number, number, number];
  readonly fontSizePx: number;
  readonly fontWeight: number;
  readonly rects: readonly { x: number; y: number; w: number; h: number }[];
}

const TRANSPARENT_TEXT =
  "*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; }";

/** The marked text of the hero with its line boxes (relative to the hero's top left) and its colour as sRGB. */
async function collect(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const hero = document.querySelector("[data-landing-hero]");
    if (hero === null) throw new Error("no [data-landing-hero]");
    const origin = hero.getBoundingClientRect();
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const g = scratch.getContext("2d", { willReadFrequently: true });
    if (g === null) throw new Error("no 2d context");
    const srgb = (css: string): [number, number, number] => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = "#000";
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
    };
    const targets: Target[] = [];
    for (const el of hero.querySelectorAll("[data-contrast]")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }));
      if (rects.length === 0) continue;
      targets.push({
        name: el.getAttribute("data-contrast-name") ?? el.tagName.toLowerCase(),
        kind: el.getAttribute("data-contrast") as "body" | "large" | "label",
        text: el.textContent.trim().slice(0, 40),
        ink: srgb(getComputedStyle(el).color),
        fontSizePx: Number.parseFloat(getComputedStyle(el).fontSize),
        fontWeight: Number.parseInt(getComputedStyle(el).fontWeight, 10),
        rects,
      });
    }
    return targets;
  });
}

interface Pair {
  readonly c: string;
  readonly a: string;
}

/** Reads both screenshots in a blank page and returns the worst ratio per target. */
async function ratios(page: Page, pair: Pair, targets: readonly Target[]): Promise<{ ratio: number; pixels: number }[]> {
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(
      async ({ pair: shots, targets: wanted }) => {
        const load = async (b64: string): Promise<ImageData> => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const g = canvas.getContext("2d", { willReadFrequently: true });
          if (g === null) throw new Error("no 2d context");
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, canvas.width, canvas.height);
        };
        const a = await load(shots.a);
        const c = await load(shots.c);
        const lin = (v: number): number => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        const lum = (r: number, g: number, b: number): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const ratio = (l1: number, l2: number): number => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return wanted.map((target) => {
          const inkL = lum(target.ink[0], target.ink[1], target.ink[2]);
          let worst = Infinity;
          let pixels = 0;
          for (const r of target.rects) {
            const x0 = Math.max(0, Math.floor(r.x));
            const x1 = Math.min(a.width, Math.ceil(r.x + r.w));
            const y0 = Math.max(0, Math.floor(r.y));
            const y1 = Math.min(a.height, Math.ceil(r.y + r.h));
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const at = (y * a.width + x) * 4;
                if (target.kind === "label") {
                  // a glyph pixel: it differs strongly between the page as painted (C) and the page without its text (A)
                  const d = Math.abs((c.data[at] ?? 0) - (a.data[at] ?? 0)) + Math.abs((c.data[at + 1] ?? 0) - (a.data[at + 1] ?? 0)) + Math.abs((c.data[at + 2] ?? 0) - (a.data[at + 2] ?? 0));
                  if (d < 150) continue;
                }
                pixels++;
                worst = Math.min(worst, ratio(inkL, lum(a.data[at] ?? 0, a.data[at + 1] ?? 0, a.data[at + 2] ?? 0)));
              }
            }
          }
          return { ratio: pixels === 0 ? 0 : worst, pixels };
        });
      },
      { pair, targets: [...targets] },
    );
  } finally {
    await blank.close();
  }
}

/**
 * Measures every `data-contrast` text of the landing hero as it is painted now. Leaves the page's text as it found it. The caller
 * freezes the scene first (a paused day: the map and the orbit are still).
 */
export async function measureHeroContrast(page: Page): Promise<ContrastLine[]> {
  await page.evaluate(() => document.fonts.ready);
  const hero = page.locator("[data-landing-hero]");
  const targets = await collect(page);
  const shot = async (): Promise<string> => (await hero.screenshot({ scale: "css", animations: "disabled" })).toString("base64");
  const c = await shot();
  const style = await page.addStyleTag({ content: TRANSPARENT_TEXT });
  let a: string;
  try {
    a = await shot();
  } finally {
    await style.evaluate((node) => {
      (node as Element).remove();
    });
  }
  const measured = await ratios(page, { c, a }, targets);
  return targets.map((target, i) => ({
    name: target.name,
    kind: target.kind,
    text: target.text,
    ratio: measured[i]?.ratio ?? 0,
    threshold: thresholdFor(classify(target.fontSizePx, target.fontWeight)),
    fontSizePx: target.fontSizePx,
    fontWeight: target.fontWeight,
    mismatch: disagreement({ name: target.name, declared: target.kind, fontSizePx: target.fontSizePx, fontWeight: target.fontWeight }),
    pixels: measured[i]?.pixels ?? 0,
  }));
}

/** The lines under their threshold, and every declared kind that disagrees with the rendered size, as one readable string (empty when all pass). */
export function failures(lines: readonly ContrastLine[]): string {
  const low = lines
    .filter((line) => line.pixels === 0 || line.ratio < line.threshold)
    .map((line) => `${line.name} "${line.text}": ${line.ratio.toFixed(2)} < ${String(line.threshold)} (${String(line.pixels)} px, ${String(Math.round(line.fontSizePx * 100) / 100)}px/${String(line.fontWeight)} is ${declaredKind(line.kind) === "large" ? "declared large" : "declared body"})`);
  const wrong = lines.flatMap((line) => (line.mismatch === null ? [] : [`kind mismatch ${line.mismatch}`]));
  return [...low, ...wrong].join("; ");
}

/** One line of copy: its font box (what `Range.getClientRects` reports) and the box of the INK really painted in and around it, hero-relative. */
export interface InkBand {
  readonly name: string;
  readonly text: string;
  readonly fontSizePx: number;
  /** The line's font box. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** The painted ink's vertical extent, or null when no ink was found for the line. */
  readonly ink: { readonly top: number; readonly bottom: number } | null;
  /** How far the ink reaches above and below the font box, in pixels (0 when it stays inside). */
  readonly overTop: number;
  readonly overBottom: number;
}

/** Reads both shots in a blank page and finds, per copy line, the rows of ink (pixels that differ between the page with text and without). */
async function bandsOf(page: Page, pair: Pair, targets: readonly Target[]): Promise<Omit<InkBand, "name" | "text" | "fontSizePx">[][]> {
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(
      async ({ pair: shots, targets: wanted }) => {
        const load = async (b64: string): Promise<ImageData> => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const g = canvas.getContext("2d", { willReadFrequently: true });
          if (g === null) throw new Error("no 2d context");
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, canvas.width, canvas.height);
        };
        const a = await load(shots.a);
        const c = await load(shots.c);
        const everyRect = wanted.flatMap((target) => target.rects);
        return wanted.map((target) =>
          target.rects.map((r) => {
            // the rows searched: up to half way (between the centres) to the nearest line above and below that overlaps this one in x,
            // whichever element it belongs to (its ink is its own), else one em beyond the font box
            const centre = r.y + r.h / 2;
            let top = r.y - target.fontSizePx;
            let bottom = r.y + r.h + target.fontSizePx;
            for (const o of everyRect) {
              if (o === r || !(o.x < r.x + r.w && o.x + o.w > r.x)) continue;
              const other = o.y + o.h / 2;
              if (other < centre) top = Math.max(top, (other + centre) / 2);
              else if (other > centre) bottom = Math.min(bottom, (other + centre) / 2);
            }
            const y0 = Math.max(0, Math.floor(top));
            const y1 = Math.min(a.height, Math.ceil(bottom));
            const x0 = Math.max(0, Math.floor(r.x));
            const x1 = Math.min(a.width, Math.ceil(r.x + r.w));
            let inkTop = Infinity;
            let inkBottom = -Infinity;
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const at = (y * a.width + x) * 4;
                const d = Math.abs((c.data[at] ?? 0) - (a.data[at] ?? 0)) + Math.abs((c.data[at + 1] ?? 0) - (a.data[at + 1] ?? 0)) + Math.abs((c.data[at + 2] ?? 0) - (a.data[at + 2] ?? 0));
                if (d >= 120) {
                  if (y < inkTop) inkTop = y;
                  if (y + 1 > inkBottom) inkBottom = y + 1;
                }
              }
            }
            const found = inkBottom > inkTop;
            return {
              box: { x: r.x, y: r.y, w: r.w, h: r.h },
              ink: found ? { top: inkTop, bottom: inkBottom } : null,
              overTop: found ? Math.max(0, r.y - inkTop) : 0,
              overBottom: found ? Math.max(0, inkBottom - (r.y + r.h)) : 0,
            };
          }),
        );
      },
      { pair, targets: [...targets] },
    );
  } finally {
    await blank.close();
  }
}

/**
 * The painted ink of every line of copy (the station names, the buttons, the Proof chip, the readout card and the scrubber are hidden
 * for the two shots, so only the copy's own text is read) against the font box the
 * browser reports for it. Urdu and Arabic marks and ascenders reach past that box: `overTop` and `overBottom` are how far, in pixels.
 */
export async function measureInkBands(page: Page): Promise<InkBand[]> {
  await page.evaluate(() => document.fonts.ready);
  const hero = page.locator("[data-landing-hero]");
  const hide = await page.addStyleTag({ content: "[data-station-label], [data-avoid], [data-field-readout], [data-scrub] { visibility: hidden !important; }" });
  let targets: Target[];
  let c: string;
  let a: string;
  try {
    targets = (await collect(page)).filter((target) => target.kind !== "label");
    const shot = async (): Promise<string> => (await hero.screenshot({ scale: "css", animations: "disabled" })).toString("base64");
    c = await shot();
    const transparent = await page.addStyleTag({ content: TRANSPARENT_TEXT });
    try {
      a = await shot();
    } finally {
      await transparent.evaluate((node) => {
        (node as Element).remove();
      });
    }
  } finally {
    await hide.evaluate((node) => {
      (node as Element).remove();
    });
  }
  const found = await bandsOf(page, { c, a }, targets);
  return targets.flatMap((target, t) => (found[t] ?? []).map((band) => ({ name: target.name, text: target.text, fontSizePx: target.fontSizePx, ...band })));
}

/** The visible station names' boxes, hero-relative (the same frame as `InkBand`). */
export async function stationBoxes(page: Page): Promise<{ code: string; x: number; y: number; w: number; h: number }[]> {
  return page.evaluate(() => {
    const hero = document.querySelector("[data-landing-hero]");
    if (hero === null) throw new Error("no [data-landing-hero]");
    const origin = hero.getBoundingClientRect();
    return [...hero.querySelectorAll("[data-station-label]")]
      .filter((el) => getComputedStyle(el).visibility !== "hidden")
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { code: el.getAttribute("data-station-label") ?? "", x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      })
      .filter((box) => box.w > 0 && box.h > 0);
  });
}
