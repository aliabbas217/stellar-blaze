import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The landing page (/en) in a production build (redesign S2): the skip link first, the h1 as the largest paint, the role door in the first fold,
 * the phone sign and the field beside it with its states (ideal, loading, error, reduced motion), the keyboard slider, the story chapters with
 * the four bars read from the scored file, the story navigation. No API is involved: the page is static and its field files are static files,
 * so MSW and the mock API are never called.
 * Every title contains "landing", so `pnpm e2e -g landing` selects them. Screenshots are written only when SB_GATE_SHOTS names a
 * directory (the design gate run), never in a normal e2e run.
 *
 * The design gate's 35 % hero share is not asserted on the landing (`hero: false`): the first fold of a phone is the promise and the role door,
 * and the field is a picture beside the phone, not the backdrop of the page (decision D7). The tests below assert what replaces it: the door is in
 * the first fold, and the field sits after the phone with its caption.
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
  console.log(`GATE ${label}: overflow ${String(report.overflowPx)}px minText ${String(report.minTextPx)}px minTarget ${String(report.minTargetPx)}px axe ${String(report.axeViolations.length)} failures ${String(report.failures.length)}`);
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
  await page.getByRole("link", { name: /^I am reviewing this/ }).click();
  await expect(page).toHaveURL(/\/en\/replay$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How four ways of warning a crew would have done last summer");
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

for (const [name, viewport] of [
  ["1440", WIDE],
  ["390", PHONE],
] as const) {
  test(`landing hero at ${name}: the promise, then the role door in the first fold, and no statistic before a person`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = await open(page, viewport);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan tomorrow's heat tonight.");
    const door = page.getByRole("navigation", { name: "Who is this for?" }).getByRole("link");
    await expect(door).toHaveText([/^I work on a site/, /^I run a crew/, /^I look after safety/, /^I am reviewing this/]);
    await expect(door).toHaveAttribute("href", /\/en\/(worker|supervisor|hse|replay)$/);
    // the first tile is in the first fold on both screens, and every tile is at least 44 px tall
    const first = await door.first().boundingBox();
    expect((first?.y ?? 0) + (first?.height ?? 0), "the first door tile is inside the first fold").toBeLessThanOrEqual(viewport.height);
    for (const height of await door.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);
    // the hero's copy and the door carry no digit: the first number on the page is not a statistic
    const copy = await page.locator("[data-contrast-name=kicker], #landing-title, [data-contrast-name=lede], [data-role-door]").allInnerTexts();
    expect(copy.join(" ")).not.toMatch(/\d/);
    await expect(page.locator("[data-hook], [data-field-readout]")).toHaveCount(0);
    await shot(page, "hero", viewport);
    await shotAs(page, `full-${name}-night.png`, true);
    const report = await gateReport(page, { consoleErrors: errors, hero: false });
    note(`landing hero ${name}`, report);
    expect(report.failures).toEqual([]);
  });
}

test("landing hero field: ideal state at rest, the caption names what it is, the slider equals text, gate numbers", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  const path2d = await drawn(page);
  expect(["2d", "webgl"]).toContain(path2d);
  console.log(`landing hero path: ${path2d}`);
  const slider = page.getByRole("slider");
  await expect(slider).toHaveAttribute("aria-valuenow", String(PEAK_HOUR));
  await expect(slider).toHaveAttribute("aria-valuetext", /^14:00: hottest grid cell \d\d\.\d degrees, Abu Dhabi airport \d\d\.\d$/);
  await expect(page.locator("[data-field-caption]")).toContainText("An illustration, not the day we scored.");
  await expect(page.getByRole("button", { name: /Play the day|Pause the day/ })).toHaveCount(0);
  // the field sits beside the phone, in the same hero column
  const phone = await page.locator("[data-hero-phone]").boundingBox();
  const stage = await page.locator("[data-field-stage]").boundingBox();
  expect((stage?.x ?? 0) - ((phone?.x ?? 0) + (phone?.width ?? 0)), "the field starts after the phone").toBeGreaterThanOrEqual(0);
  await shot(page, "ideal", WIDE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true, hero: false });
  note("landing ideal 1440", report);
  expect(report.failures).toEqual([]);
});

test("landing hero field: the phone layout stacks the phone and then the field, with no overflow", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page, PHONE);
  await drawn(page);
  const phone = await page.locator("[data-hero-phone]").boundingBox();
  const stage = await page.locator("[data-field-stage]").boundingBox();
  expect(stage?.y ?? 0, "the field is under the phone").toBeGreaterThanOrEqual((phone?.y ?? 0) + (phone?.height ?? 0) - 1);
  await shot(page, "ideal", PHONE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true, hero: false });
  note("landing ideal 390", report);
  expect(report.failures).toEqual([]);
});

test("landing hero slider: arrow keys, Home and End change the hour and its text", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await drawn(page);
  const slider = page.getByRole("slider");
  await slider.focus();
  const at = async (): Promise<string> => (await slider.getAttribute("aria-valuetext")) ?? "";
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
  await shot(page, "playing", WIDE);
  await page.getByRole("button", { name: "Pause the day" }).click();
  const held = await slider.getAttribute("aria-valuenow");
  await page.waitForTimeout(700);
  await expect(slider).toHaveAttribute("aria-valuenow", held ?? "");
  await expect(page.getByRole("button", { name: "Play the day" })).toBeVisible();
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
  const before = await page.locator("[data-field-column]").boundingBox();
  await shot(page, "loading", WIDE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true, hero: false });
  note("landing loading 1440", report);
  expect(report.failures).toEqual([]);
  release();
  await drawn(page);
  const after = await page.locator("[data-field-column]").boundingBox();
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
  // the role door and the chapters do not depend on the field files
  await expect(page.locator("[data-role-door]")).toBeVisible();
  await expect(page.locator("#evidence")).toBeAttached();
  await link.click();
  await expect(page).toHaveURL(/\/en\/replay$/);
});

test("landing chapters: the story in order, the four bars equal the scored file, three Where from chips, then the story footer", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  await drawn(page);
  expect(await page.locator("[data-landing-chapters] > section").evaluateAll((els) => els.map((el) => el.id))).toEqual(["morning", "plan", "boundary", "evidence", "limits"]);
  // the evidence chapter: four bars, longest first, their numbers read from the scored file by this test (never typed here)
  const policy = JSON.parse(readFileSync(path.resolve("data/eval/2026/policy_scoreboard.json"), "utf8")) as {
    leads: { lead_days: number; rows: { policy: string; missed_danger_hours: { value: number }; false_alarm_hours: { value: number } }[] }[];
  };
  const rows = policy.leads.find((lead) => lead.lead_days === 1)?.rows ?? [];
  const bars = page.locator("[data-evidence-bars] > li");
  await expect(bars).toHaveCount(4);
  const order = await bars.evaluateAll((els) => els.map((el) => el.getAttribute("data-policy")));
  expect(order).toEqual(["P0", "P2", "P3_protect", "P1"]);
  for (const [i, id] of order.entries()) {
    const row = rows.find((r) => r.policy === id);
    await expect(bars.nth(i).locator("[data-bar-missed]")).toHaveText((row?.missed_danger_hours.value ?? NaN).toFixed(1));
    await expect(bars.nth(i).locator("[data-bar-false-alarms]")).toHaveText(`False-alarm hours: ${(row?.false_alarm_hours.value ?? NaN).toFixed(1)}`);
  }
  await expect(page.locator("#evidence [data-warnings-tradeoff]")).toContainText("raise fewer false alarms than Stellar Blaze");
  await expect(page.locator("#evidence")).not.toContainText(/1,624|\b279\b|370 of 374/);
  // three chips on the whole page (the field, the bars, the checks); a chip opens its plain story, and the audit record is under For auditors
  await expect(page.getByRole("button", { name: /^Where from/ })).toHaveCount(3);
  await page.locator("#evidence").getByRole("button", { name: /^Where from/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Made by");
  expect(await dialog.innerText()).not.toMatch(/[A-Za-z0-9_-]+\.json|[0-9a-f]{40,}|src\//);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // the plain verdicts, with the one that was not met beside the one that was
  await expect(page.locator('[data-verdict-id="H5"]')).toContainText("This check was not met.");
  await expect(page.locator('[data-verdict-id="H4"]')).toContainText("it was met");
  // the limits, and the auditors' door
  await expect(page.locator("#limits")).toContainText("hosted in France Central");
  await expect(page.locator("#limits").getByRole("link", { name: "For auditors" })).toHaveAttribute("href", /\/en\/replay\/proof\/policy\.[a-z0-9_.]+#audit$/);
  const report = await gateReport(page, { consoleErrors: errors, hero: false });
  expect(report.failures).toEqual([]);
});

test("landing story nav keyboard next and previous", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const next = page.locator("[data-story-nav] [data-story-next]");
  await next.scrollIntoViewIfNeeded();
  await next.focus();
  await expect(next).toContainText("Next: The evidence");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/en\/replay$/);
  const back = page.locator("[data-story-nav] a[rel=prev]");
  await back.scrollIntoViewIfNeeded();
  await back.focus();
  await expect(back).toContainText("Back: The problem");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/en$/);
});

test("landing story: the boundary is the last step with Back and no Next, and the proof step is gone", async ({ page }) => {
  await page.goto("/en/replay/governance");
  const nav = page.locator("[data-story-nav]");
  await expect(nav).toBeVisible();
  await expect(nav.locator("a[rel=prev]")).toContainText("Back: One day");
  await expect(nav.locator("a[rel=next]")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Proof" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "The product" })).toHaveAttribute("href", "/en/worker");
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
  const stage = page.locator("[data-field-stage][data-field-path]");
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
    // the slider is the same text as on the 2D path
    await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", String(PEAK_HOUR));
    await page.waitForTimeout(500);
    await shot(page, "webgl", WIDE);
    const report = await gateReport(page, { consoleErrors: errors, spine: true, hero: false });
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
    const report = await gateReport(page, { consoleErrors: errors, spine: true, hero: false });
    note("landing webgl 390", report);
    expect(report.failures).toEqual([]);
  }
});

test("landing falls back with ?static: the 2D field is the page and the scene is never started", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  const errors = await open(page, WIDE, "/en?static");
  await drawn(page);
  await page.waitForTimeout(2500);
  await expect(page.locator("[data-field-stage][data-field-path]")).toHaveAttribute("data-field-path", "2d");
  await expect(page.locator('[data-field-canvas="webgl"]')).toHaveCount(0);
  expect(workers).toEqual([]);
  await shot(page, "static", WIDE);
  const report = await gateReport(page, { consoleErrors: errors, spine: true, hero: false });
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
    await expect(page.locator("[data-field-stage][data-field-path]"), label).toHaveAttribute("data-field-path", "2d");
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

/** Where the Abu Dhabi label sits across the page, as a fraction of the page width (a station name is DOM text on either path; the hidden 2D layer under the scene has one too). */
async function airportAt(page: Page, width: number): Promise<number> {
  const box = await page.locator('[data-field-stage] [data-station-label="OMAA"]').filter({ visible: true }).first().boundingBox();
  if (box === null) throw new Error("the Abu Dhabi label is not on the map");
  return (box.x + box.width / 2) / width;
}

test("landing in Urdu: the hero is right to left, the phone and the field sit on the end side (the left), and the copy is on the right", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page, WIDE, "/ur");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const ran = await settledPath(page);
  if (REQUIRE_WEBGL) expect(ran, "SB_E2E_REQUIRE_WEBGL=1: the Urdu page must run the WebGL scene").toBe("webgl");
  await page.waitForTimeout(500);
  // the copy is on the right in right-to-left; the field (and the airport on it) is on the left half
  expect(await airportAt(page, WIDE.width), `path ${ran}`).toBeLessThan(0.5);
  const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect((h1?.x ?? 0) + (h1?.width ?? 0) / 2).toBeGreaterThan(WIDE.width / 2);
  await shotAs(page, `ur-${ran}-1440-night.png`);
  const report = await gateReport(page, { consoleErrors: errors, spine: true, hero: false, locale: "ur" });
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
  await expect(page.locator("[data-field-stage][data-field-path]")).toHaveAttribute("data-field-path", "2d");
  expect(await airportAt(page, WIDE.width)).toBeLessThan(0.5);
  await shotAs(page, "ur-2d-1440-night.png");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(500);
  expect(await airportAt(page, 1024)).toBeLessThan(0.5);
  await shotAs(page, "ur-2d-1024-night.png");
});

/**
 * The hero grows with its copy: nothing the reader needs is clipped or covered where the copy runs taller than the screen (a laptop
 * 768 px high, a tablet, Arabic-script line heights of 2.5). A clipped or covered link is still focusable, so this is measured with the
 * element under the pointer, not with the DOM: all four role-door tiles and the slider are reachable.
 */
for (const [url, width, height] of [
  ["/en", 900, 800],
  ["/en", 1024, 768],
  ["/en", 1366, 768],
  ["/ur", 1024, 768],
  ["/ur", 1440, 900],
] as const) {
  test(`landing hero keeps the role door and the slider reachable at ${url} ${String(width)}x${String(height)}`, async ({ page }) => {
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
        // Strict: the element itself, or something inside it (the text of a link belongs to the same control). NOT `top.contains(el)`:
        // an ancestor under the pointer is what a cover looks like, so it must not count as reachable.
        return top !== null && (el === top || el.contains(top)) ? "reachable" : `covered by ${top?.tagName ?? "nothing"} ${top?.className.toString().slice(0, 40) ?? ""}`;
      };
      const door = [...document.querySelectorAll("[data-role-door] a")].map((a) => covered(a));
      return { door, scrubber: covered(document.querySelector("[data-hour-slider]")) };
    });
    expect(result).toEqual({ door: ["reachable", "reachable", "reachable", "reachable"], scrubber: "reachable" });
  });
}

test("landing spine shows the ticks 00:00, 06:00, 12:00, 18:00, 00:00 and no others at every width (the field is a narrow column beside the phone)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, PHONE, "/en?static");
  await drawn(page);
  const shown = (): Promise<(string | null)[]> =>
    page.evaluate(() => [...document.querySelectorAll("[data-spine-track] [data-tick]")].filter((el) => getComputedStyle(el).display !== "none").map((el) => el.textContent));
  expect(await shown()).toEqual(["00:00", "06:00", "12:00", "18:00", "00:00"]);
  await page.setViewportSize(WIDE);
  expect(await shown()).toEqual(["00:00", "06:00", "12:00", "18:00", "00:00"]);
});

/**
 * The hero in the right-to-left languages never overflows sideways, and every control keeps its 44 px target, at the three widths the
 * gate holds (320, 390 and 768 px): the Nastaliq line height (2.5) grows the tiles and the headline, it never clips or pushes the page wide.
 */
for (const locale of ["ur", "ar"] as const) {
  for (const width of [320, 390, 768] as const) {
    test(`landing overflow in ${locale} at ${String(width)}: nothing runs off the screen, the role door tiles grow and stay 44 px or more`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, { width, height: 800 }, `/${locale}?static`);
      await drawn(page);
      const result = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tiles: [...document.querySelectorAll("[data-role-door] a")].map((a) => a.getBoundingClientRect()).map((r) => ({ h: r.height, left: r.left, right: r.right })),
        h1: document.querySelector("#landing-title")?.getBoundingClientRect().height ?? 0,
      }));
      expect(result.overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
      expect(result.tiles).toHaveLength(4);
      for (const tile of result.tiles) {
        expect(tile.h).toBeGreaterThanOrEqual(44);
        expect(tile.left).toBeGreaterThanOrEqual(-0.5);
        expect(tile.right).toBeLessThanOrEqual(width + 0.5);
      }
      expect(result.h1).toBeGreaterThan(0);
    });
  }
}
