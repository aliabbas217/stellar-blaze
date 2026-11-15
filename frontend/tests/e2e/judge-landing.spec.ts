import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The landing page (/en) in a production build: the skip link first, the h1 as the largest paint, one click to the scoreboard,
 * the hero field and its states (ideal, loading, error, reduced motion), the keyboard slider, the story navigation. No API is
 * involved: the page is static and its field files are static files, so MSW and the mock API are never called.
 * Every title contains "landing", so `pnpm e2e -g landing` selects them. Screenshots are written only when SB_GATE_SHOTS names a
 * directory (the design gate run), never in a normal e2e run.
 */

const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PEAK_HOUR = 14;

async function open(page: Page, viewport = WIDE, url = "/en"): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(viewport);
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

/** Waits until the island has drawn the field. Returns which path drew it. */
async function drawn(page: Page): Promise<string> {
  const canvas = page.locator("[data-field-canvas]").first();
  await expect(canvas).toBeAttached({ timeout: 15_000 });
  return (await canvas.getAttribute("data-field-canvas")) ?? "";
}

async function shot(page: Page, name: string, viewport: { width: number; height: number }): Promise<void> {
  const dir = process.env.SB_GATE_SHOTS;
  if (dir === undefined || dir === "") return;
  const wide = viewport.width === WIDE.width ? "1440" : "390";
  mkdirSync(path.join(dir, "landing"), { recursive: true });
  await page.screenshot({ path: path.join(dir, "landing", `${name}-${wide}-night.png`) });
}

/** A screenshot with its own file name (the Urdu and tablet shots), only in a design gate run. */
async function shotAs(page: Page, file: string, fullPage = false): Promise<void> {
  const dir = process.env.SB_GATE_SHOTS;
  if (dir === undefined || dir === "") return;
  mkdirSync(path.join(dir, "landing"), { recursive: true });
  await page.screenshot({ path: path.join(dir, "landing", file), fullPage });
}

/**
 * SB_E2E_REQUIRE_WEBGL=1 turns "the 2D field ran" into a failure on the WebGL tests. Without it those tests are tolerant (a browser
 * with no WebGL still has a working page, and the 2D path is tested on its own), which means a host with no GL passes them without
 * running a line of the scene: the locked e2e command in the F2 runs sets it, so a regression that silently falls back is red.
 */
const REQUIRE_WEBGL = process.env.SB_E2E_REQUIRE_WEBGL === "1";

function note(label: string, report: Awaited<ReturnType<typeof gateReport>>): void {
  if (process.env.SB_GATE_SHOTS === undefined || process.env.SB_GATE_SHOTS === "") return;
  const heroPct = report.heroShare === null ? "n/a" : (report.heroShare * 100).toFixed(1);
  console.log(`GATE ${label}: hero ${heroPct}% overflow ${String(report.overflowPx)}px minText ${String(report.minTextPx)}px minTarget ${String(report.minTargetPx)}px axe ${String(report.axeViolations.length)} failures ${String(report.failures.length)}`);
}

test("landing first focusable element is the skip link, and it goes to the scoreboard", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to the scoreboard" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/en\/replay$/);
});

test("landing to scoreboard in one click, in under 10 s", async ({ page }) => {
  await open(page);
  const started = Date.now();
  await page.getByRole("link", { name: "See the scoreboard" }).first().click();
  await expect(page).toHaveURL(/\/en\/replay$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Summer 2026, replayed honestly");
  expect(Date.now() - started).toBeLessThan(10_000);
});

test("landing LCP element is the h1, not the canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const entries: { id: string; tag: string; time: number }[] = [];
    (window as unknown as { __lcp: typeof entries }).__lcp = entries;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const element = (entry as PerformanceEntry & { element?: Element | null }).element;
        entries.push({ id: element?.id ?? "", tag: element?.tagName ?? "", time: entry.startTime });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await open(page);
  await drawn(page);
  await page.waitForTimeout(800);
  const last = await page.evaluate(() => (window as unknown as { __lcp: { id: string; tag: string }[] }).__lcp.at(-1));
  expect(last).toEqual(expect.objectContaining({ id: "landing-title", tag: "H1" }));
});

test("landing hero field: ideal state at rest, readout equals text, gate numbers", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  const path2d = await drawn(page);
  expect(["2d", "webgl"]).toContain(path2d);
  console.log(`landing hero path: ${path2d}`);
  const slider = page.getByRole("slider");
  await expect(slider).toHaveAttribute("aria-valuenow", String(PEAK_HOUR));
  await expect(page.locator("[data-readout-live]")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("[data-readout-hottest]")).toHaveText(/^\d\d\.\d°C$/);
  await expect(page.getByRole("button", { name: /Play the day|Pause the day/ })).toHaveCount(0);
  await shot(page, "ideal", WIDE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true });
  note("landing ideal 1440", report);
  expect(report.failures).toEqual([]);
  expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
});

test("landing hero field: the phone fold keeps the field at 35 percent or more", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page, PHONE);
  await drawn(page);
  await shot(page, "ideal", PHONE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true });
  note("landing ideal 390", report);
  expect(report.failures).toEqual([]);
  expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
});

test("landing hero slider: arrow keys, Home and End change the hour and the readout text", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await drawn(page);
  const slider = page.getByRole("slider");
  await slider.focus();
  const at = async (): Promise<string> => (await page.locator("[data-readout-hottest]").textContent()) ?? "";
  const peak = await at();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", String(PEAK_HOUR + 1));
  await expect(page.locator("[data-when-hour]")).toHaveText("15:00");
  expect(await at()).not.toBe(peak);
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", "23");
  await expect(slider).toHaveAttribute("aria-valuetext", /^23:00: hottest grid cell \d\d\.\d degrees, Abu Dhabi airport \d\d\.\d$/);
  // a slider does not wrap: one more step right stays on 23:00, and Page Down steps three hours
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "23");
  await page.keyboard.press("PageDown");
  await expect(slider).toHaveAttribute("aria-valuenow", "20");
});

test("landing plays the day once on its own, and a reader can stop it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page);
  await drawn(page);
  const slider = page.getByRole("slider");
  await expect.poll(async () => slider.getAttribute("aria-valuenow"), { timeout: 5000 }).not.toBe(String(PEAK_HOUR));
  await expect(page.locator("[data-readout-live]")).toHaveAttribute("aria-live", "off");
  await shot(page, "playing", WIDE);
  await page.getByRole("button", { name: "Pause the day" }).click();
  const held = await slider.getAttribute("aria-valuenow");
  await page.waitForTimeout(700);
  await expect(slider).toHaveAttribute("aria-valuenow", held ?? "");
  await expect(page.locator("[data-readout-live]")).toHaveAttribute("aria-live", "polite");
});

test("landing loading state: the poster is at final size, nothing moves when the field arrives", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let shift = 0;
    (window as unknown as { __cls: () => number }).__cls = () => shift;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!e.hadRecentInput) shift += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/data/static/**", async (route) => {
    await gate;
    await route.continue();
  });
  const errors = await open(page);
  await expect(page.locator("[data-poster-map]")).toBeAttached();
  await expect(page.locator("[data-field-canvas]")).toHaveCount(0);
  const before = await page.locator("[data-hero]").first().boundingBox();
  await shot(page, "loading", WIDE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true });
  note("landing loading 1440", report);
  expect(report.failures).toEqual([]);
  release();
  await drawn(page);
  const after = await page.locator("[data-hero]").first().boundingBox();
  expect(after).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as { __cls: () => number }).__cls())).toBeLessThanOrEqual(0.01);
});

test("landing error state: the files did not load, and the scoreboard is one link away", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/data/static/**", (route) => route.abort());
  await page.setViewportSize(WIDE);
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "The forecast files did not load" })).toBeVisible();
  await shot(page, "error", WIDE);
  await page.setViewportSize(PHONE);
  await shot(page, "error", PHONE);
  await page.setViewportSize(WIDE);
  const link = page.getByRole("alert").getByRole("link", { name: "See the scoreboard" });
  await expect(link).toHaveAttribute("href", "/en/replay");
  // the hook and the chapters do not depend on the field files
  await expect(page.locator("[data-hook]")).toBeVisible();
  await expect(page.locator("#problem")).toBeAttached();
  await link.click();
  await expect(page).toHaveURL(/\/en\/replay$/);
});

test("landing chapters: counts with proofs, the calendar and the scoreboard teaser, then the story footer", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  await drawn(page);
  await page.getByRole("link", { name: "Walk me through it" }).click();
  await expect(page).toHaveURL(/#problem$/);
  const counts = page.locator("[data-problem-counts]");
  await expect(counts).toContainText("1,624");
  await expect(counts).toContainText("279");
  await expect(counts).toContainText("of 1,807 working hours");
  await expect(counts.getByRole("button", { name: /^Proof for/ })).toHaveCount(3);
  // a proof chip opens its drawer with the file's fingerprint
  await counts.getByRole("button", { name: /^Proof for/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("omaa_2026_ifs_d1_wbgt_hourly.json");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // the table alternative
  await page.getByText("Show the counts as a table").click();
  await expect(page.locator("[data-calendar-table] tbody tr")).toHaveCount(5);
  // chapter 2: the mini scoreboard carries the baseline label and both unfavourable and favourable verdicts
  const table = page.locator("#scoreboard table[data-scoreboard]");
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(table).toContainText("Baseline: ban only");
  await expect(page.locator('[data-verdict-id="H5"]')).toContainText("not supported");
  const report = await gateReport(page, { consoleErrors: errors, hero: false });
  expect(report.failures).toEqual([]);
});

test("landing story nav keyboard next and previous", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const next = page.locator("[data-story-nav] [data-story-next]");
  await next.scrollIntoViewIfNeeded();
  await next.focus();
  await expect(next).toContainText("Next: Scoreboard");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/en\/replay$/);
  const back = page.locator("[data-story-nav] a[rel=prev]");
  await back.scrollIntoViewIfNeeded();
  await back.focus();
  await expect(back).toContainText("Back: The problem");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/en$/);
});

test("landing makes no API request", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  await open(page);
  await drawn(page);
  expect(api).toEqual([]);
});

/** Which path drew the field once the page has had time to upgrade it: "webgl" or "2d". Headless Chromium draws WebGL through SwiftShader. */
async function settledPath(page: Page): Promise<string> {
  await drawn(page);
  const stage = page.locator("[data-hero][data-field-path]");
  await expect(stage).toBeAttached();
  try {
    await expect(stage).toHaveAttribute("data-field-path", "webgl", { timeout: 8000 });
  } catch {
    // the upgrade did not happen (no WebGL here, or it gave itself up): the 2D field is the page
  }
  return (await stage.getAttribute("data-field-path")) ?? "";
}

test("landing WebGL path: the scene takes over the 2D field after idle when the browser can, in a same-origin module worker", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  const errors = await open(page);
  const ran = await settledPath(page);
  console.log(`landing path that ran (headless Chromium, SwiftShader): ${ran}`);
  if (REQUIRE_WEBGL) expect(ran, "SB_E2E_REQUIRE_WEBGL=1: the WebGL scene must run, not fall back to 2D").toBe("webgl");
  if (ran === "webgl") {
    expect(workers.some((url) => url.startsWith("http://127.0.0.1:3000/_next/static/") && !url.startsWith("blob:"))).toBe(true);
    await expect(page.locator('[data-field-canvas="webgl"]')).toBeVisible();
    // the readout and slider are the same text as on the 2D path
    await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", String(PEAK_HOUR));
    await page.waitForTimeout(500);
    await shot(page, "webgl", WIDE);
    const report = await gateReport(page, { consoleErrors: errors, spine: true });
    note("landing webgl 1440", report);
    expect(report.failures).toEqual([]);
  }
  expect(["webgl", "2d"]).toContain(ran);
});

test("landing WebGL path on a phone: the small mesh, drawn at the phone's own framing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page, PHONE);
  const ran = await settledPath(page);
  if (REQUIRE_WEBGL) expect(ran, "SB_E2E_REQUIRE_WEBGL=1: the WebGL scene must run on a phone, not fall back to 2D").toBe("webgl");
  if (ran === "webgl") {
    await page.waitForTimeout(500);
    await shot(page, "webgl", PHONE);
    const report = await gateReport(page, { consoleErrors: errors, spine: true });
    note("landing webgl 390", report);
    expect(report.failures).toEqual([]);
    expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
  }
});

test("landing falls back with ?static: the 2D field is the page and the scene is never started", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  const errors = await open(page, WIDE, "/en?static");
  await drawn(page);
  await page.waitForTimeout(2500);
  await expect(page.locator("[data-hero][data-field-path]")).toHaveAttribute("data-field-path", "2d");
  await expect(page.locator('[data-field-canvas="webgl"]')).toHaveCount(0);
  expect(workers).toEqual([]);
  await shot(page, "static", WIDE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true });
  note("landing static 1440", report);
  expect(report.failures).toEqual([]);
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(500);
  await shot(page, "static", PHONE);
});

test("landing falls back to the 2D field when the browser has no OffscreenCanvas, or the worker cannot start", async ({ browser }) => {
  for (const [label, script] of [
    ["no OffscreenCanvas", "delete window.OffscreenCanvas;"],
    ["worker cannot start", "window.Worker = class { constructor() { throw new Error('worker blocked'); } };"],
  ] as const) {
    const context = await browser.newContext({ viewport: WIDE, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.addInitScript(script);
    await page.goto("/en");
    await drawn(page);
    await page.waitForTimeout(2500);
    await expect(page.locator("[data-hero][data-field-path]"), label).toHaveAttribute("data-field-path", "2d");
    await expect(page.locator('[data-field-canvas="2d"]'), label).toBeVisible();
    await expect(page.getByRole("slider"), label).toHaveAttribute("aria-valuenow", String(PEAK_HOUR));
    await context.close();
  }
});

test("landing reduced motion: no autoplay on either path, the field rests on the hottest hour", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await settledPath(page);
  await page.waitForTimeout(1500);
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", String(PEAK_HOUR));
  await expect(page.getByRole("button", { name: /Play the day|Pause the day/ })).toHaveCount(0);
});

/** Where the Abu Dhabi label sits across the hero, as a fraction of the page width (a station name is DOM text on either path; the hidden 2D layer under the scene has one too). */
async function airportAt(page: Page, width: number): Promise<number> {
  const box = await page.locator("[data-hero]").first().getByText("Abu Dhabi", { exact: true }).filter({ visible: true }).boundingBox();
  if (box === null) throw new Error("the Abu Dhabi label is not on the map");
  return (box.x + box.width / 2) / width;
}

test("landing in Urdu: the field sits on the end side (the left), on the WebGL path and the 2D path, and the copy is not under it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page, WIDE, "/ur");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const ran = await settledPath(page);
  if (REQUIRE_WEBGL) expect(ran, "SB_E2E_REQUIRE_WEBGL=1: the Urdu page must run the WebGL scene").toBe("webgl");
  await page.waitForTimeout(500);
  // the copy is on the right in right-to-left; the airport (the map's centre, give or take) is on the left half
  expect(await airportAt(page, WIDE.width), `path ${ran}`).toBeLessThan(0.5);
  const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect((h1?.x ?? 0) + (h1?.width ?? 0) / 2).toBeGreaterThan(WIDE.width / 2);
  await shotAs(page, `ur-${ran}-1440-night.png`);
  const report = await gateReport(page, { consoleErrors: errors, spine: true });
  note(`landing ur ${ran} 1440`, report);
  expect(report.failures).toEqual([]);
  // the English page puts it on the other side (non-vacuous: the assertion above can fail)
  await page.goto("/en");
  await drawn(page);
  await page.waitForTimeout(500);
  expect(await airportAt(page, WIDE.width)).toBeGreaterThan(0.5);
});

test("landing in Urdu on the 2D path (?static) and at tablet width", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, WIDE, "/ur?static");
  await drawn(page);
  await expect(page.locator("[data-hero][data-field-path]")).toHaveAttribute("data-field-path", "2d");
  expect(await airportAt(page, WIDE.width)).toBeLessThan(0.5);
  await shotAs(page, "ur-2d-1440-night.png");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(500);
  expect(await airportAt(page, 1024)).toBeLessThan(0.5);
  await shotAs(page, "ur-2d-1024-night.png");
});

/**
 * The hero grows with its copy (Part L1): nothing the reader needs is clipped or covered where the copy runs taller than the screen
 * (a laptop 768 px high, a tablet, Arabic-script line heights of 2.5). A clipped or covered link is still focusable, so this is
 * measured with the element under the pointer, not with the DOM.
 */
for (const [url, width, height] of [
  ["/en", 900, 800],
  ["/en", 1024, 768],
  ["/en", 1366, 768],
  ["/ur", 1024, 768],
  ["/ur", 1440, 900],
] as const) {
  test(`landing hero keeps its actions and the hook proof reachable at ${url} ${String(width)}x${String(height)}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, { width, height }, `${url}?static`);
    await drawn(page);
    const result = await page.evaluate(() => {
      const hero = document.querySelector("[data-landing-hero]") as HTMLElement;
      const covered = (el: Element | null): string => {
        if (el === null) return "missing";
        const r = el.getBoundingClientRect();
        const heroBox = hero.getBoundingClientRect();
        if (r.bottom > heroBox.bottom + 0.5 || r.top < heroBox.top - 0.5) return "outside the hero";
        // the point under the middle of the element, scrolled into view
        el.scrollIntoView({ block: "center" });
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top !== null && (el === top || el.contains(top) || top.contains(el)) ? "reachable" : `covered by ${top?.tagName ?? "nothing"} ${top?.className.toString().slice(0, 40) ?? ""}`;
      };
      return {
        primary: covered(document.querySelector("[data-primary]")),
        secondary: covered([...document.querySelectorAll("[data-landing-hero] a")].find((a) => a.getAttribute("href") === "#problem") ?? null),
        proof: covered(document.querySelector("[data-hook] button")),
        scrubber: covered(document.querySelector("[data-hour-slider]")),
      };
    });
    expect(result).toEqual({ primary: "reachable", secondary: "reachable", proof: "reachable", scrubber: "reachable" });
  });
}
