import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ORBIT_MAX_RAD } from "../../src/features/judge/landing/webgl-support.ts";
import { failures, measureHeroContrast } from "./helpers/contrast.ts";

/*
 * The landing hero's text contrast, measured on painted pixels (helpers/contrast.ts). Since the redesign (S2) the copy no longer lies over the
 * map: the hero is the promise, the role door, the phone sign and the field in a box of its own with its caption. What is still measured is what
 * can still go wrong: every line of marked copy 4.5:1 (the h1, large text, by its rendered size 3:1) on the page's ground in the night theme, every
 * station name 4.5:1 over the map (the names are DOM text with a halo, over a scene that moves), at 900, 1100, 1280 and 1440 px, in English and
 * Urdu, on the WebGL path and the 2D path, at three hours, and on WebGL at three orbit azimuths (`?orbit=`, reduced motion: the pose is the test's).
 * The layout tests of the old overlay (no name under the readout card, a line of copy or the hook's chip; the ink bands; the scrim and the copy
 * width guards) are gone with the overlay. A host without WebGL skips with an annotation, and SB_E2E_REQUIRE_WEBGL=1 makes that a failure.
 * Run in the desktop project only: the viewport is set here, so a second project adds time and no information.
 */

const WIDTHS = [900, 1100, 1280, 1440] as const;
const HEIGHT = 800;
const HOURS = [14, 9, 20] as const;
/**
 * Orbit azimuths (radians) the WebGL scene is put at: five points spread over everything one pass of the day turns it (16 s x
 * 0.025 rad/s = 0.4 rad, ORBIT_MAX_RAD), so the map really is at a different place under the copy each time. `?orbit=` sets it.
 */
const ORBITS = [0, 0.2, 0.4] as const;
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
  const stage = page.locator("[data-field-stage][data-field-path]");
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
  // a focus ring on the slider would be painted over the map: take the focus away
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
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
      test(`landing contrast: ${locale} ${path} at ${String(width)} px, copy 4.5:1 (large text 3:1 by rendered size), station names 4.5:1, ${path === "webgl" ? "3 orbit azimuths x " : ""}3 hours`, async ({ page }) => {
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
            for (const wanted of ["kicker", "h1", "lede", "field-caption"]) expect(names, `${when}: no "${wanted}" measured`).toContain(wanted);
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
