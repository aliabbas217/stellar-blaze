import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { boxOf, parseField } from "../../src/features/judge/landing/field-data.ts";
import { geometry, project } from "../../src/features/judge/landing/field-draw.ts";
import { INK_OVERSHOOT_EM } from "../../src/features/judge/landing/label-avoid.ts";
import { ORBIT_MAX_RAD } from "../../src/features/judge/landing/webgl-support.ts";
import { failures, measureHeroContrast, measureInkBands, stationBoxes, type ContrastLine } from "./helpers/contrast.ts";

/*
 * The landing hero's text contrast and layout, measured on painted pixels (helpers/contrast.ts), because the copy lies over a map
 * that moves (the hour, and the orbit of the WebGL scene) and a scrim and a copy width are all that keep it legible (Part L1 I5,
 * fix round 2 items 2 and 3).
 *
 *  - every line of copy 4.5:1 (the h1 and the hook figure, large text, 3:1) and every station name 4.5:1,
 *  - at 900, 1024, 1280 and 1440 px, in English and Urdu, on the WebGL path and the 2D path,
 *  - at three hours, and on WebGL at five orbit azimuths spread over a whole pass of the day (`?orbit=`, reduced motion: the pose is
 *    the test's, no sleep into an autoplay, so a slow GPU cannot fail it; a host without WebGL skips with an annotation, and
 *    SB_E2E_REQUIRE_WEBGL=1 makes that a failure),
 *  - which threshold a line is held to comes from its rendered size and weight (helpers/contrast-class.ts), checked against the
 *    page's own declaration,
 *  - no station name is under the readout card, a line of the copy, a button or the hook's chip, and none touches the ink of an
 *    Urdu or Arabic line.
 * It fails when the scrim stops or the copy width regresses (proved by weakening each in turn; see the fix round report).
 * Run in the desktop project only: the viewport is set here, so a second project adds time and no information.
 */

const WIDTHS = [900, 1024, 1280, 1440] as const;
const HEIGHT = 800;
const HOURS = [14, 9, 20] as const;
/**
 * Orbit azimuths (radians) the WebGL scene is put at: five points spread over everything one pass of the day turns it (16 s x
 * 0.025 rad/s = 0.4 rad, ORBIT_MAX_RAD), so the map really is at a different place under the copy each time. `?orbit=` sets it.
 */
const ORBITS = [0, 0.1, 0.2, 0.3, 0.4] as const;
const REQUIRE_WEBGL = process.env.SB_E2E_REQUIRE_WEBGL === "1";
/** How long the WebGL scene may take to start on a slow host before it is "not here" (a bounded wait, never a fixed sleep). */
const GL_START_MS = 25_000;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chromium", "the viewport is set by the test; one project is enough");
});

/**
 * Opens the landing at a width, at rest (reduced motion: no autoplay, no orbit, nothing that depends on how fast this host is). With
 * `wantGl` it waits, bounded, for the WebGL scene to be the one drawn: when it is not here after the wait the test FAILS if
 * SB_E2E_REQUIRE_WEBGL=1 (CI) and is SKIPPED with an annotation otherwise (a host with no GL says so; it does not pass vacuously).
 */
async function open(page: Page, width: number, url: string, wantGl: boolean): Promise<"webgl" | "2d"> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("[data-field-canvas]").first()).toBeAttached({ timeout: 15_000 });
  const stage = page.locator("[data-hero][data-field-path]");
  if (wantGl) {
    try {
      await expect(stage).toHaveAttribute("data-field-path", "webgl", { timeout: GL_START_MS });
    } catch {
      if (REQUIRE_WEBGL) throw new Error(`SB_E2E_REQUIRE_WEBGL=1: the WebGL scene did not start within ${String(GL_START_MS)} ms at ${String(width)} px`);
      test.info().annotations.push({ type: "skipped", description: `WebGL did not start within ${String(GL_START_MS)} ms on this host (SB_E2E_REQUIRE_WEBGL is unset)` });
      test.skip(true, "no WebGL on this host (SB_E2E_REQUIRE_WEBGL unset)");
    }
  }
  await fitViewport(page, width);
  return ((await stage.getAttribute("data-field-path")) ?? "2d") as "webgl" | "2d";
}

/**
 * Makes the viewport tall enough to hold the whole hero. An element screenshot of something taller than the viewport is captured
 * beyond it, and a WebGL canvas drawn by a worker comes out as smeared streaks there (seen in the first Urdu rows and in two gate
 * PNGs), so every pixel the contrast helper reads must be inside the viewport. A hero that is only as tall as its minimum
 * (100svh, capped at 60rem) stops growing at 960 px, so a few rounds settle it.
 */
async function fitViewport(page: Page, width: number): Promise<void> {
  for (let round = 0; round < 4; round++) {
    const need = await page.evaluate(() => {
      const hero = document.querySelector("[data-landing-hero]");
      return hero === null ? 0 : Math.ceil(hero.getBoundingClientRect().bottom + window.scrollY + 24);
    });
    if (need <= (page.viewportSize()?.height ?? 0)) return;
    await page.setViewportSize({ width, height: need });
  }
}

/**
 * Waits until the hero has stopped changing: two screenshots in a row are byte-identical (bounded wait). It replaces the fixed sleeps:
 * a slow GPU needs longer to answer a frame, a fast one does not wait for nothing.
 */
async function settle(page: Page): Promise<void> {
  const hero = page.locator("[data-landing-hero]");
  const shot = async (): Promise<string> => (await hero.screenshot({ scale: "css", animations: "disabled" })).toString("base64");
  await expect
    .poll(
      async () => {
        const a = await shot();
        const b = await shot();
        return a === b;
      },
      { timeout: 15_000, intervals: [100, 200, 400] },
    )
    .toBe(true);
}

/** Moves the day to a whole hour with the slider's own keys and lets the scene draw it. */
async function seek(page: Page, hour: number): Promise<void> {
  const slider = page.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("Home");
  // ArrowUp and PageUp go forward in every direction; ArrowRight goes BACKWARD in right-to-left (Urdu), which looped forever here
  for (let h = 0; h < hour; h += 3) await page.keyboard.press(hour - h >= 3 ? "PageUp" : "ArrowUp");
  for (let guard = 0; Number(await slider.getAttribute("aria-valuenow")) < hour && guard < 30; guard++) await page.keyboard.press("ArrowUp");
  await expect(slider).toHaveAttribute("aria-valuenow", String(hour));
  // the readout's card is not what is measured, but a focus ring on the slider would be painted over the map: take the focus away
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
}

function report(label: string, lines: readonly ContrastLine[]): string {
  const worst = new Map<string, number>();
  for (const line of lines) worst.set(line.name, Math.min(worst.get(line.name) ?? Infinity, line.ratio));
  return `${label}: ${[...worst].map(([name, ratio]) => `${name} ${ratio.toFixed(2)}`).join(", ")}`;
}

/** One line per row (locale, path, width) with the minimum over every pose, appended to $SB_CONTRAST_LOG when it is set (the report's table). */
function logRow(row: string, worst: ReadonlyMap<string, number>, samples: number): void {
  const text = `${row} | ${String(samples)} samples | ${[...worst].map(([name, ratio]) => `${name} ${ratio.toFixed(2)}`).join(", ")}`;
  console.log(`CONTRAST ${text}`);
  const file = process.env.SB_CONTRAST_LOG;
  if (file !== undefined && file !== "") appendFileSync(file, `${text}\n`);
}

for (const locale of ["en", "ur"] as const) {
  for (const path of ["webgl", "2d"] as const) {
    for (const width of WIDTHS) {
      test(`landing contrast: ${locale} ${path} at ${String(width)} px, copy 4.5:1 (large text 3:1 by rendered size), station names 4.5:1, ${path === "webgl" ? "5 orbit azimuths x " : ""}3 hours`, async ({ page }) => {
        test.setTimeout(path === "webgl" ? 360_000 : 120_000);
        const worst = new Map<string, number>();
        const low: string[] = [];
        let samples = 0;
        let stations = 0;
        // 2D: the map does not turn, the hour moves it. WebGL: the orbit is set (`?orbit=`) at five azimuths, and each is read at three hours.
        for (const orbit of path === "webgl" ? ORBITS : [null]) {
          const query = path === "2d" ? "?static" : `?orbit=${String(orbit)}`;
          const ran = await open(page, width, `/${locale}${query}`, path === "webgl");
          expect(ran, `the ${path} scene is the one drawn`).toBe(path);
          for (const hour of HOURS) {
            await seek(page, hour);
            const when = `${locale} ${path} ${String(width)} px, orbit ${String(orbit)}, ${String(hour).padStart(2, "0")}:00`;
            const lines = await measureHeroContrast(page);
            // not vacuous: the hero's copy was really found and read
            const names = new Set(lines.map((line) => line.name));
            for (const wanted of ["kicker", "h1", "hook-figure"]) expect(names, `${when}: no "${wanted}" measured`).toContain(wanted);
            stations += lines.filter((line) => line.name === "station" && line.pixels > 0).length;
            for (const line of lines) worst.set(line.name, Math.min(worst.get(line.name) ?? Infinity, line.ratio));
            samples++;
            // every pose is read before the verdict, so one run reports ALL the rows under their threshold, not the first
            const bad = failures(lines);
            if (bad !== "") {
              low.push(`${when}: ${bad}`);
              // the pixels of a failing pose, to look at (a directory in SB_CONTRAST_SHOTS; nothing is written without it)
              const shots = process.env.SB_CONTRAST_SHOTS;
              if (shots !== undefined && shots !== "") await page.locator("[data-landing-hero]").screenshot({ path: `${shots}/fail-${locale}-${path}-${String(width)}-o${String(orbit)}-h${String(hour)}.png`, animations: "disabled" });
            }
          }
        }
        // a station name can be hidden under the card or the copy at one pose; over all of them some must have been read
        expect(stations, `${locale} ${path} ${String(width)} px: station names measured over all poses`).toBeGreaterThanOrEqual(1);
        logRow(`${locale} ${path} ${String(width)}px`, worst, samples);
        const logFile = process.env.SB_CONTRAST_LOG;
        if (logFile !== undefined && logFile !== "" && low.length > 0) appendFileSync(logFile, low.map((line) => `LOW ${line}\n`).join(""));
        expect(low, `${locale} ${path} ${String(width)} px: rows under their threshold`).toEqual([]);
      });
    }
  }
}

test("landing contrast: the orbit pose really moves the map under the copy (non-vacuity of the orbit rows)", async ({ page }) => {
  test.setTimeout(120_000);
  const heroShot = async (): Promise<string> => (await page.locator("[data-landing-hero]").screenshot({ scale: "css", animations: "disabled" })).toString("base64");
  await open(page, 1280, "/en?orbit=0", true);
  await settle(page);
  const start = await heroShot();
  await open(page, 1280, `/en?orbit=${String(ORBIT_MAX_RAD)}`, true);
  await settle(page);
  expect(await heroShot(), "the scene at the end of an orbit pass is painted differently from its start").not.toBe(start);
});

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Boxes the layout assertions compare: the card, the visible station names, the LINES of the copy (text rects, not the block boxes: a
 * heading's line height is leading, not ink) and the controls a name must stay clear of. The controls are found by what they ARE (the
 * primary action, the link to #problem, the hook's chip), not by the app's own `data-avoid` marks, so a regression of those marks is caught.
 */
async function boxes(page: Page): Promise<{ card: Box | null; labels: { code: string; box: Box }[]; copy: { name: string; box: Box }[]; controls: { name: string; box: Box }[] }> {
  return page.evaluate(() => {
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const box = (r: DOMRect): Box => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    const card = document.querySelector("[data-field-readout]");
    const labels = [...document.querySelectorAll("[data-hero] [data-station-label]")].filter(visible).map((el) => ({ code: el.getAttribute("data-station-label") ?? "", box: box(el.getBoundingClientRect()) }));
    const copy: { name: string; box: Box }[] = [];
    for (const el of document.querySelectorAll("[data-landing-hero] [data-contrast]:not([data-station-label])")) {
      if (!visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) copy.push({ name: el.getAttribute("data-contrast-name") ?? "", box: box(r) });
    }
    const controls: { name: string; box: Box }[] = [];
    const add = (name: string, el: Element | null | undefined): void => {
      if (el !== null && el !== undefined && visible(el)) controls.push({ name, box: box(el.getBoundingClientRect()) });
    };
    add("primary action", document.querySelector("[data-landing-hero] [data-primary]"));
    add("secondary action", [...document.querySelectorAll("[data-landing-hero] a")].find((a) => (a.getAttribute("href") ?? "").endsWith("#problem")));
    add("hook proof chip", document.querySelector("[data-landing-hero] [data-hook] button"));
    return { card: card === null ? null : box(card.getBoundingClientRect()), labels, copy, controls };
  });
}

const hit = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

for (const locale of ["en", "ur"] as const) {
  for (const path of ["2d", "webgl"] as const) {
    test(`landing layout: no station name sits under the readout card, a line of copy or a button/chip (${locale}, ${path})`, async ({ page }) => {
      test.setTimeout(path === "webgl" ? 240_000 : 150_000);
      // WebGL: the names move with the orbit, so the pose is the end of an orbit pass (the farthest from where the first frame left them)
      for (const width of path === "webgl" ? [1100, 1280, 1440] : [390, 900, 1024, 1100, 1280, 1440]) {
        const ran = await open(page, width, path === "2d" ? `/${locale}?static` : `/${locale}?orbit=${String(ORBIT_MAX_RAD)}`, path === "webgl");
        expect(ran).toBe(path);
        await settle(page);
        const { card, labels, copy, controls } = await boxes(page);
        expect(card, `${String(width)} px: the readout card is there`).not.toBeNull();
        expect(controls.map((c) => c.name), `${String(width)} px: the controls were found`).toEqual(expect.arrayContaining(["primary action", "secondary action"]));
        // at 1100 px on a short screen the card covers the airport's neighbourhood too and every name yields (none is better than half of one)
        if (width >= 1280 && path === "2d") expect(labels.length, `${locale} ${String(width)} px: a station name is drawn`).toBeGreaterThanOrEqual(1);
        for (const label of labels) {
          expect(hit(label.box, card as Box), `${locale} ${path} ${String(width)} px: the card covers the "${label.code}" name`).toBe(false);
          for (const piece of copy) expect(hit(label.box, piece.box), `${locale} ${path} ${String(width)} px: "${label.code}" sits under the ${piece.name}`).toBe(false);
          for (const control of controls) expect(hit(label.box, control.box), `${locale} ${path} ${String(width)} px: "${label.code}" sits under the ${control.name}`).toBe(false);
        }
      }
    });
  }
}

/**
 * Urdu and Arabic ink reaches past the box the browser reports for a line (marks, dots, ascenders). The ink of every line of the
 * copy is read from the pixels (the page with text against the page without it, names hidden), the allowance the app uses
 * (INK_OVERSHOOT_EM) must cover what the glyphs really overshoot, and no station name may touch any line's ink band, strictly,
 * with no margin: at 1024 px in Urdu a name sat on the h1's second line touching a mark (fix round 3, minor 4).
 */
for (const locale of ["ur", "ar"] as const) {
  for (const path of ["2d", "webgl"] as const) {
    test(`landing ink: ${locale} ${path}, the ink allowance covers the glyphs and no station name touches a line's ink at 1024, 1100 and 1440 px`, async ({ page }) => {
      test.setTimeout(path === "webgl" ? 240_000 : 150_000);
      for (const width of [1024, 1100, 1440]) {
        const ran = await open(page, width, path === "2d" ? `/${locale}?static` : `/${locale}?orbit=${String(ORBIT_MAX_RAD / 2)}`, path === "webgl");
        expect(ran).toBe(path);
        await settle(page);
        const bands = await measureInkBands(page);
        const names = await stationBoxes(page);
        const over = bands.filter((band) => band.ink !== null).map((band) => `${band.name} ${(Math.max(band.overTop, band.overBottom) / band.fontSizePx).toFixed(2)}em`);
        const row = `INK ${locale} ${path} ${String(width)}px | ${over.join(", ")} | names ${names.map((n) => n.code).join(",") || "none"}`;
        console.log(row);
        const logFile = process.env.SB_CONTRAST_LOG;
        if (logFile !== undefined && logFile !== "") appendFileSync(logFile, `${row}\n`);
        expect(bands.filter((band) => band.ink !== null).length, `${locale} ${String(width)} px: ink was found for the copy`).toBeGreaterThanOrEqual(4);
        for (const band of bands) {
          if (band.ink === null) continue;
          const reach = Math.max(band.overTop, band.overBottom) / band.fontSizePx;
          // A reach of a whole em or more is the search window FULL of ink: the next line's (the Nastaliq h1's marks come within an em of the
          // kicker above and the lede below), not this line's own overshoot, which the allowance is about. Those bands are still held by the
          // "no station name touches any line's ink" assertion below.
          if (reach < 1) expect(reach, `${locale} ${String(width)} px: the ${band.name} line "${band.text}" overshoots its font box by ${reach.toFixed(2)} em, more than INK_OVERSHOOT_EM`).toBeLessThanOrEqual(INK_OVERSHOOT_EM);
          for (const name of names) {
            const touches = name.x < band.box.x + band.box.w && name.x + name.w > band.box.x && name.y < band.ink.bottom && name.y + name.h > band.ink.top;
            expect(touches, `${locale} ${path} ${String(width)} px: the "${name.code}" name touches the ink of the ${band.name} line "${band.text}"`).toBe(false);
          }
        }
      }
    });
  }
}

/** The hook row from 1100 px up wraps by design (the chip takes its own row), in any length of copy: on one row at 1440 px the chip ended 20 px inside the map's edge. */
test("landing layout: the hook's chip keeps 8 px clear of the 2D map's edge from 1100 to 1920 px in English, Urdu, Hindi and Bengali, on its own row", async ({ page }) => {
  test.setTimeout(240_000);
  const grid = parseField(JSON.parse(readFileSync(path.resolve("public/data/static/uae_ifs025_d1_wbgt_2026-09-03.json"), "utf8")) as unknown);
  const box = boxOf(grid);
  for (const locale of ["en", "ur", "hi", "bn"] as const) {
    const rtl = locale === "ur";
    for (const [width, height] of [[1100, 800], [1200, 800], [1280, 800], [1366, 768], [1438, 800], [1440, 900], [1920, 1080]] as const) {
      const ran = await open(page, width, `/${locale}?static`, false);
      expect(ran).toBe("2d");
      await settle(page);
      const { stage, chip, figure } = await page.evaluate(() => {
        const stageBox = document.querySelector("[data-hero]")?.getBoundingClientRect();
        const chipBox = document.querySelector("[data-hook] button")?.getBoundingClientRect();
        const figureBox = document.querySelector("[data-hook] [data-contrast-name='hook-figure']")?.getBoundingClientRect();
        return {
          stage: stageBox === undefined ? null : { x: stageBox.x, y: stageBox.y, w: stageBox.width, h: stageBox.height },
          chip: chipBox === undefined ? null : { left: chipBox.left, right: chipBox.right, top: chipBox.top, bottom: chipBox.bottom },
          figure: figureBox === undefined ? null : { bottom: figureBox.bottom },
        };
      });
      expect(stage, "the stage").not.toBeNull();
      expect(chip, "the hook's chip").not.toBeNull();
      expect(figure, "the hook's figure").not.toBeNull();
      const g = geometry((stage as { w: number }).w, (stage as { h: number }).h, box, rtl);
      const [west, south, east, north] = box;
      const edge = (stage as { x: number }).x + project(g, rtl ? east : west, south)[0]; // the map's edge that faces the copy
      const top = (stage as { y: number }).y + project(g, west, north)[1];
      const bottom = (stage as { y: number }).y + project(g, west, south)[1];
      const c = chip as { left: number; right: number; top: number; bottom: number };
      const label = `${locale} ${String(width)}x${String(height)}`;
      // only a chip on the map's rows can touch its edge
      if (c.bottom > top && c.top < bottom) expect(rtl ? c.left - edge : edge - c.right, `${label}: gap between the chip and the map's edge`).toBeGreaterThanOrEqual(8);
      expect(c.top, `${label}: the chip is on its own row, below the figure`).toBeGreaterThanOrEqual((figure as { bottom: number }).bottom - 2);
    }
  }
});

/**
 * The guard bites (non-vacuity): with the scrim taken away, or the copy column let run to its full 34rem over the map, the same
 * measurement reports lines under their threshold; with the h1 shrunk below 24 px the declared "large" no longer matches what is
 * rendered and the measurement says so by name. Done on the page with injected CSS, at the width and hour where the margin is
 * thinnest, so a refactor that makes the measurement blind (a changed attribute, an empty target list) turns THESE tests red.
 */
test("landing contrast guard bites: without the scrim the copy fails, and the measurement says which lines", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 900, "/en?static", false);
  await settle(page);
  expect(failures(await measureHeroContrast(page)), "as built, the copy passes").toBe("");
  await page.addStyleTag({ content: "[data-hero] > div[aria-hidden='true'].pointer-events-none { background: none !important; }" });
  await settle(page);
  const without = failures(await measureHeroContrast(page));
  console.log(`CONTRAST without the scrim (900 px, 2D): ${without}`);
  expect(without, "no scrim: some line must fall under its threshold").not.toBe("");
});

test("landing contrast guard bites: the copy column at its full 34rem over the map is measured too", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 900, "/en?static", false);
  await settle(page);
  const built = await measureHeroContrast(page);
  await page.addStyleTag({ content: "[data-landing-hero] > div:first-child { max-width: 44rem !important; }" });
  await settle(page);
  const wide = await measureHeroContrast(page);
  console.log(`CONTRAST with a 44rem copy column (900 px, 2D): ${report("wide", wide)}; failing: ${failures(wide) || "none"}`);
  // the lede and the hook run wider, over the map: their worst ratio is lower than as built (the measurement sees the width)
  const worst = (lines: readonly ContrastLine[]): number => Math.min(...lines.filter((line) => line.kind !== "label").map((line) => line.ratio));
  expect(worst(wide), "a wider column puts some line of copy over brighter pixels").toBeLessThan(worst(built));
});

test("landing contrast guard bites: an h1 shrunk to 20 px is no longer large text, and the measurement fails it by name (threshold by rendered size)", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 1280, "/en?static", false);
  await settle(page);
  const built = await measureHeroContrast(page);
  const h1 = built.find((line) => line.name === "h1");
  expect(h1?.threshold, "as built, the h1 is 24 px or more: large text, 3:1").toBe(3);
  expect(failures(built), "as built, nothing fails").toBe("");
  await page.addStyleTag({ content: "[data-contrast-name='h1'] { font-size: 20px !important; }" });
  await settle(page);
  const small = await measureHeroContrast(page);
  const shrunk = small.find((line) => line.name === "h1");
  expect(shrunk?.fontSizePx, "the injected size is what is rendered").toBe(20);
  expect(shrunk?.threshold, "at 20 px and weight 400 the threshold is the body 4.5, not the attribute's 3").toBe(4.5);
  expect(failures(small), "the declared kind no longer matches the rendered size, by element name").toMatch(/kind mismatch h1: declared large but rendered at 20px/);
});
