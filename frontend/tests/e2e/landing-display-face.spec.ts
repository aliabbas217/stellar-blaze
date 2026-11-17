import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";

/*
 * The display-size headings of the Urdu and Arabic pages: which font draws their glyphs (F2 Task 22 fix round 1 found it; architect
 * decision 2026-11-16, option (c): the Arabic script of every `font-display` heading is drawn by the LOCALE BODY FAMILY, Noto Nastaliq
 * Urdu for Urdu and Noto Sans Arabic for Arabic, on every device).
 *
 * CSS text cannot prove which font draws a glyph, so the first block asks the browser: the Chrome DevTools Protocol's
 * `CSS.getPlatformFontsForNode` returns the fonts the glyphs of a node were actually drawn with, per family, with a glyph count. The
 * test is strict by default (the `SB_E2E_DISPLAY_FACE_STRICT` switch of fix round 1 is gone): on every `font-display` element of the
 * landing, the field screens, the supervisor screens and the judge pages' chrome (not the English claim blocks), in ur and ar, every
 * font that drew a glyph is a web font, is Archivo (Latin letters and digits) or the locale family, and an element that holds
 * Arabic-script letters shows the locale family in the report. What this catches: next/font's `Archivo Fallback` is
 * `@font-face { src: local(Arial); size-adjust: 98.7% }` with NO unicode-range, so with the display stack `Archivo, "Archivo Fallback",
 * <body family>` Arial (an operating-system font, absent on Android and most Linux) claimed the Arabic script before the body family.
 *
 * Second block: consecutive lines of the multi-line headings (Urdu h1 is five lines at 390 px) must not touch. Lines are told apart
 * by colour (even lines pure red, odd lines pure blue, on black), the heading is rendered, and the pixels are classified: a pixel with
 * both channels is ink of two lines overlapping; a red pixel next to a blue pixel is two lines touching.
 *
 * Every title contains "landing display", so `pnpm e2e -g "landing display"` selects them.
 */

const WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;
const LOCALES = ["ur", "ar"] as const;
const DISPLAY_HEADINGS = '[class*="--sign-leading-display"]';

async function openLanding(page: Page, locale: string, size: { width: number; height: number }, theme: "night" | "sun" = "night"): Promise<void> {
  await page.setViewportSize(size);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  await page.goto(`/${locale}?static`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

interface PlatformFont {
  readonly familyName: string;
  readonly postScriptName: string;
  readonly isCustomFont: boolean;
  readonly glyphCount: number;
}

const PIN = `?site=${SITE_DEMO}&crew=crew-b`;
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;

/** The routes whose display headings are checked, per locale (a path under /<locale>). The landing is the first and uses `?static`. */
const ROUTES = [
  "?static",
  `/worker${PIN}`,
  `/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${encodeURIComponent("2026-09-03T06:00:00Z")}`,
  "/worker/unwell",
  "/worker/alerts",
  "/supervisor",
  "/supervisor/crews/crew-b",
  "/replay",
  "/replay/day",
  "/replay/try",
  "/replay/governance",
  "/replay/proof/forecast.hours_over_limit",
] as const;

/** The locale body family: the face the architect wants every Arabic-script display glyph drawn by (CDP `familyName`). */
const LOCALE_FAMILY: Readonly<Record<(typeof LOCALES)[number], RegExp>> = {
  ur: /^noto nastaliq urdu/i,
  ar: /^noto sans arabic/i,
};
const ARCHIVO = /^archivo/i;

interface FaceReport {
  readonly route: string;
  readonly tag: string;
  readonly text: string;
  readonly arabicLetters: number;
  readonly fonts: readonly PlatformFont[];
}

/**
 * The display-face elements of the page that hold Urdu or Arabic text of their own (not an English claim block, which is `lang="en"` and
 * has its own face), each with the fonts Chromium drew its glyphs with. "Display face" is read from the computed style, not from a class
 * name: the first family of the element's stack is Archivo, so a heading that gets the face through `@apply`, a component or a future
 * utility is covered too. Elements are tagged by an attribute so the browser's own selector finds the same set the page-side filter chose.
 */
async function faceReports(page: Page, route: string): Promise<FaceReport[]> {
  const total = await page.evaluate((arabic) => {
    const pattern = new RegExp(arabic, "u");
    let count = 0;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      el.removeAttribute("data-face-probe");
      if (el.closest('[lang="en"]:not(html), script, style, svg, .sr-only') !== null) continue;
      const own = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && pattern.test(node.textContent ?? ""));
      if (!own) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.getBoundingClientRect().width <= 1) continue;
      if (!/^["']?Archivo/.test(style.fontFamily)) continue;
      el.setAttribute("data-face-probe", String(count));
      count += 1;
    }
    return count;
  }, ARABIC_SCRIPT.source);
  const session: CDPSession = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument", { depth: 0 });
    const reports: FaceReport[] = [];
    for (let index = 0; index < total; index += 1) {
      const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-face-probe="${String(index)}"]` });
      const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
      const described = await page.locator(`[data-face-probe="${String(index)}"]`).evaluate((el, arabic) => {
        const letters = el.textContent.match(new RegExp(arabic, "gu"));
        return { tag: el.tagName.toLowerCase(), text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 40), arabicLetters: letters === null ? 0 : letters.length };
      }, ARABIC_SCRIPT.source);
      reports.push({ route, ...described, fonts });
    }
    return reports;
  } finally {
    await session.detach();
  }
}

/** In a design gate run (SB_GATE_SHOTS names a folder): a picture of each probed h1 to h3 of a route other than the landing (the landing's are taken by the lines test). */
async function shootProbed(page: Page, locale: string, size: string, route: string, reports: readonly FaceReport[]): Promise<void> {
  const dir = process.env.SB_GATE_SHOTS;
  if (dir === undefined || dir === "" || route.startsWith("?")) return;
  mkdirSync(path.join(dir, "i18n"), { recursive: true });
  const slug = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 28);
  for (const [index, report] of reports.entries()) {
    if (!/^h[1-3]$/.test(report.tag)) continue; // headings only: the paragraphs and spans carrying the display face are in the font report
    await page.locator(`[data-face-probe="${String(index)}"]`).screenshot({ path: path.join(dir, "i18n", `${locale}-face-${slug}-${String(index)}-${size}-night.png`) });
  }
}

const describeFonts = (fonts: readonly PlatformFont[]): string =>
  fonts.map((font) => `${font.familyName} (${font.postScriptName}, ${font.isCustomFont ? "web" : "system"}) x${String(font.glyphCount)}`).join("; ");

for (const locale of LOCALES) {
  for (const size of WIDTHS) {
    test(`landing display face: every Arabic-script display heading of ${locale} at ${size.name} is drawn by the locale family, never an operating-system font`, async ({ page }) => {
      test.setTimeout(180_000);
      const family = LOCALE_FAMILY[locale];
      const violations: string[] = [];
      const perRoute: string[] = [];
      let probed = 0;
      let drawnByLocale = 0;
      for (const route of ROUTES) {
        const where = `/${locale}${route}`;
        await page.setViewportSize(size);
        await page.addInitScript(() => {
          localStorage.setItem("sb-theme", JSON.stringify({ theme: "night", until: Date.now() + 6 * 3_600_000 }));
        });
        await page.goto(where);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        const reports = await faceReports(page, where);
        await shootProbed(page, locale, size.name, route, reports);
        perRoute.push(`${where}: ${String(reports.length)} headings`);
        for (const report of reports) {
          probed += 1;
          console.log(`landing display face ${locale} ${size.name} ${where} <${report.tag}> "${report.text}" (${String(report.arabicLetters)} Arabic letters): ${describeFonts(report.fonts)}`);
          if (report.fonts.length === 0) violations.push(`${where} <${report.tag}> "${report.text}": the browser reported no font`);
          for (const font of report.fonts) {
            const ours = ARCHIVO.test(font.familyName) || family.test(font.familyName);
            if (!font.isCustomFont || !ours) violations.push(`${where} <${report.tag}> "${report.text}": ${font.familyName} (${font.postScriptName}, ${font.isCustomFont ? "web" : "system"}) drew ${String(font.glyphCount)} glyphs`);
          }
          const byLocale = report.fonts.filter((font) => family.test(font.familyName)).reduce((sum, font) => sum + font.glyphCount, 0);
          drawnByLocale += byLocale;
          if (byLocale === 0) violations.push(`${where} <${report.tag}> "${report.text}": ${String(report.arabicLetters)} Arabic letters and the locale family drew none`);
        }
      }
      console.log(`landing display face ${locale} ${size.name}: ${perRoute.join(" | ")}`);
      // Non-vacuous: the landing's h1 is always found (its chapters are English blocks, which this probe skips), and so are display texts on other surfaces (a route with no
      // Arabic-script display text, such as one whose headings are Latin, is listed above with 0 and proves nothing about itself).
      expect(perRoute[0], `${locale} ${size.name}: the landing's display heading (the h1; the chapters are English blocks) was found`).toMatch(/: ([1-9]|\d\d) headings$/);
      expect(probed, `${locale} ${size.name}: display texts on the field, supervisor and judge surfaces were probed too`).toBeGreaterThanOrEqual(8);
      expect(drawnByLocale, `${locale} ${size.name}: the locale family drew Arabic-script glyphs`).toBeGreaterThan(0);
      expect(violations, `${locale} ${size.name}: an Arabic-script display glyph is drawn by something other than the locale family`).toEqual([]);
    });
  }
}

/**
 * Per heading: how many lines it has, and how many pixels of two adjacent lines overlap or touch (red = even lines, blue = odd lines).
 * The headings are measured as shipped: since the architect's option (c) their Arabic script is drawn by the locale body family
 * (Noto Nastaliq Urdu for Urdu, Noto Sans Arabic for Arabic), which the face test above proves.
 */
async function lineCollisions(page: Page, label: string): Promise<{ heading: string; lines: number; overlapping: number; touching: number; crowding: number; nearest: number; ink: number }[]> {
  const headings = page.locator(DISPLAY_HEADINGS);
  const total = await headings.count();
  const results: { heading: string; lines: number; overlapping: number; touching: number; crowding: number; nearest: number; ink: number }[] = [];
  for (let index = 0; index < total; index += 1) {
    const handle = headings.nth(index);
    await handle.scrollIntoViewIfNeeded();
    // Colour the words by line: group the words by the top of their rectangle, even groups red, odd groups blue, on black.
    const lines = await handle.evaluate((el) => {
      const text = el.textContent;
      const words = text.split(/\s+/).filter((word) => word !== "");
      el.textContent = "";
      const spans = words.map((word, index) => {
        const span = document.createElement("span");
        span.textContent = word;
        el.appendChild(span);
        if (index < words.length - 1) el.appendChild(document.createTextNode(" "));
        return span;
      });
      const tops: number[] = [];
      const lineOf = spans.map((span) => {
        const rect = span.getBoundingClientRect();
        const centre = rect.top + rect.height / 2;
        let line = tops.findIndex((top) => Math.abs(top - centre) < rect.height * 0.35);
        if (line < 0) {
          tops.push(centre);
          line = tops.length - 1;
        }
        return line;
      });
      // Lines are numbered top to bottom, whatever order the words were met in.
      const order = [...tops.keys()].sort((a, b) => (tops[a] ?? 0) - (tops[b] ?? 0));
      spans.forEach((span, index) => {
        const rank = order.indexOf(lineOf[index] ?? 0);
        span.style.setProperty("color", rank % 2 === 0 ? "rgb(255,0,0)" : "rgb(0,0,255)", "important");
        span.style.setProperty("background", "none", "important");
        span.style.setProperty("-webkit-text-fill-color", rank % 2 === 0 ? "rgb(255,0,0)" : "rgb(0,0,255)", "important");
      });
      el.style.setProperty("background", "rgb(0,0,0)", "important");
      document.body.style.setProperty("background", "rgb(0,0,0)", "important");
      return tops.length;
    });
    const png = await handle.screenshot({ type: "png" });
    // Colour-coded crops (even lines red, odd lines blue) for looking at the line joins: SB_FACE_SCRATCH names a folder outside the repo.
    const scratch = process.env.SB_FACE_SCRATCH;
    if (scratch !== undefined && scratch !== "") {
      mkdirSync(scratch, { recursive: true });
      writeFileSync(path.join(scratch, `${label}-${String(index)}.png`), png);
    }
    const counted = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
      // 0 none, 1 line-even ink (red), 2 line-odd ink (blue), 3 both channels in one pixel (overlap).
      const kind = new Uint8Array(width * height);
      let ink = 0;
      let overlapping = 0;
      for (let i = 0; i < width * height; i += 1) {
        const red = (data[i * 4] ?? 0) > 96;
        const blue = (data[i * 4 + 2] ?? 0) > 96;
        const value = red && blue ? 3 : red ? 1 : blue ? 2 : 0;
        kind[i] = value;
        if (value !== 0) ink += 1;
        if (value === 3) overlapping += 1;
      }
      // For every even-line (red) pixel the Chebyshev distance to the nearest odd-line (blue) pixel, searched up to RADIUS pixels:
      // distance 1 is touching (the pixels are neighbours), at most CROWD is crowding. `nearest` is the smallest distance found
      // (RADIUS + 1 when no pair is that close).
      const RADIUS = 8;
      const CROWD = 3;
      let touching = 0;
      let crowding = 0;
      let nearest = RADIUS + 1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if ((kind[y * width + x] ?? 0) !== 1) continue;
          let best = RADIUS + 1;
          for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
              const nx = x + dx;
              if (nx < 0 || nx >= width || (kind[ny * width + nx] ?? 0) !== 2) continue;
              best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
            }
          }
          if (best <= 1) touching += 1;
          if (best <= CROWD) crowding += 1;
          nearest = Math.min(nearest, best);
        }
      }
      return { ink, overlapping, touching, crowding, nearest };
    }, png.toString("base64"));
    const heading = await handle.evaluate((el) => el.textContent.trim().replace(/\s+/g, " ").slice(0, 40));
    results.push({ heading, lines, ...counted });
  }
  return results;
}

for (const locale of LOCALES) {
  for (const size of WIDTHS) {
    test(`landing display lines: the ${locale} headings at ${size.name} do not touch from one line to the next`, async ({ page }) => {
      await openLanding(page, locale, size);
      // In a design gate run (SB_GATE_SHOTS names a folder) the real headings are photographed, in their real colours, before the
      // measurement recolours them: one picture per heading, to be looked at (line joins of the multi-line Urdu headings).
      await shootHeadings(page, locale, size.name, "heading", "night");
      if (process.env.SB_GATE_SHOTS !== undefined && process.env.SB_GATE_SHOTS !== "") {
        // The sun theme is the same layout in another colour; one picture of each heading is taken for the gate folder.
        await openLanding(page, locale, size, "sun");
        await shootHeadings(page, locale, size.name, "heading", "sun");
        await openLanding(page, locale, size, "night");
      }
      await expectNoTouching(page, locale, size.name);
    });
  }
}

/** In a design gate run (SB_GATE_SHOTS names a folder): one picture per display heading, in its real colours, to be looked at. */
async function shootHeadings(page: Page, locale: string, size: string, label: string, theme: "night" | "sun"): Promise<void> {
  const dir = process.env.SB_GATE_SHOTS;
  if (dir === undefined || dir === "") return;
  mkdirSync(path.join(dir, "i18n"), { recursive: true });
  const headings = page.locator(DISPLAY_HEADINGS);
  for (let index = 0; index < (await headings.count()); index += 1) {
    const tag = await headings.nth(index).evaluate((el) => el.tagName.toLowerCase());
    await headings.nth(index).screenshot({ path: path.join(dir, "i18n", `${locale}-${label}-${tag}-${String(index)}-${size}-${theme}.png`) });
  }
}

async function expectNoTouching(page: Page, locale: string, size: string): Promise<void> {
  const measured = await lineCollisions(page, `face-colour-${locale}-${size}`);
  expect(measured.length).toBeGreaterThanOrEqual(3);
  for (const { heading, lines, overlapping, touching, crowding, nearest, ink } of measured) {
    console.log(`landing display lines ${locale} ${size} "${heading}": ${String(lines)} lines, ${String(ink)} ink px, ${String(overlapping)} overlapping px, ${String(touching)} touching px, ${String(crowding)} crowding px (within 3), nearest ink of two lines ${String(nearest)} px`);
    // A heading that is one line has nothing to touch; the multi-line ones are the point (the Urdu h1 is four lines at 390).
    expect(ink, `${heading}: the heading drew ink (a blank render proves nothing)`).toBeGreaterThan(0);
    expect(overlapping, `${locale} ${size} "${heading}": no pixel is ink of two lines`).toBe(0);
    expect(touching, `${locale} ${size} "${heading}" (${String(lines)} lines): ink of one line touches ink of the next at ${String(touching)} pixels`).toBe(0);
  }
  expect(measured.some((entry) => entry.lines > 1), `${locale} ${size}: at least one heading has several lines, or this test looked at nothing`).toBe(true);
}
