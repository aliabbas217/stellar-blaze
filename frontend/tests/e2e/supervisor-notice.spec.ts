import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { watchConsole } from "./gate.ts";
import { minutesAgoIso, seedOutbox, type SeededStop } from "./helpers/stop-outbox-seed.ts";

/*
 * Visual and structural gate of the durable "stop expired" notices (W6 fix round): one notice per crew whose Stop was kept on the phone
 * for more than 60 minutes without a signal, stacked in the fixed Stop bar on the crews list and on a crew's plan, each with a Close
 * button. The fixed bar must never push the Stop button off screen, hide a notice or its Close button, or cover the last row of the page.
 *
 * Every number is measured in the page, in a production build against the mock API, with 1 and 3 notices (the other crews of the
 * demo site: A, C, D; Crew B is the bar's crew), in four viewports (390 x 844, the short 390 x 667, 768 x 1024, 1440 x 900), night
 * and sun, and in each state the bar can be in while a notice is up (idle, queued: no signal, failed: refused, stopped).
 *
 *   text         every notice sentence renders at 16 px or more
 *   contrast     the notice text on its background (rendered pixels, both themes) is at least 4.5:1, and agrees with the token ratios
 *                of scripts/contrast.mjs (the bar is ground with ink-2 text, or ink with ground text once the crew is stopped)
 *   targets      each Close button is at least 44 x 44 CSS px, and sits UNDER its notice text, never beside it
 *   one notice   with ONE notice nothing the supervisor must read is hidden behind a scroll: the notices region does not scroll, and the
 *                whole text, the Close button and the Stop button are inside the viewport without scrolling anything (English and Urdu,
 *                390 x 667 included); with several notices the region may scroll but the Stop button stays on screen
 *   first        with TWO OR MORE notices the region opens at scrollTop 0 and notice 1's text and Close are inside the region and the
 *                viewport before anything is scrolled (the PNGs are shot in that state; one extra shot shows the scrolled state)
 *   fit          the bar fits any viewport (320 x 480 to 800 x 360, 200 percent text, 0 to 3 notices): the Stop button is wholly on
 *                screen, the bar's top is never cut off, each Close is reachable by scrolling the region (the last two tests of the file)
 *   reach        scrolled to the end, the page's last text sits above the bar (its centre is not covered), and each Close button, the
 *                Stop button and the notices are on screen and hit-testable (`elementFromPoint`)
 *   primary      the Stop button (Undo or Resume once stopped) is on screen and inside the viewport whatever the notices need
 *   rule         a hairline closes the notices, so the last one does not read as part of the state line under it
 *   urdu         nothing a notice or the bar says is clipped (scroll height equals client height for every text element)
 *
 * With GATE_SHOTS=1 the viewport PNGs go to docs/design/f2/gate/supervisor-notice/ (the controller stages that folder).
 */

type Theme = "night" | "sun";
const SIZES: readonly Size[] = [
  { name: "390x844", width: 390, height: 844 },
  { name: "390x667", width: 390, height: 667 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
];
interface Size {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}
const SHOTS = process.env["GATE_SHOTS"] === "1";
const SHOT_DIR = path.resolve(process.cwd(), "../docs/design/f2/gate/supervisor-notice");
const STOP_BUTTON = new RegExp(`^${en.supervisor.stop.button.split("<bdi>")[0] ?? ""}`);
const EXPIRED_CREWS: readonly SeededStop[] = [
  { crewId: "crew-a", crewName: "Crew A", clientTime: minutesAgoIso(61) },
  { crewId: "crew-c", crewName: "Crew C", clientTime: minutesAgoIso(75) },
  { crewId: "crew-d", crewName: "Crew D", clientTime: minutesAgoIso(120) },
  // Crew B is the plan screen's crew: a stop press there ends its own notice (per crew), so a state test seeds all four and 3 remain.
  { crewId: "crew-b", crewName: "Crew B", clientTime: minutesAgoIso(90) },
];

// The token ratios of the two themes, from the same source the design gate uses (read once).
const TOKEN_RATIOS = JSON.parse(execFileSync("node", ["scripts/contrast.mjs", "--json"], { encoding: "utf8" })) as Record<
  Theme,
  Record<string, { ground: number }>
>;

// The BFF's reserve for Stop and its undo is small, and a reset starts a new epoch: the same rules as supervisor-crews.spec.ts.
const STOP_WINDOW_MS = 62_000;
const STOP_PER_WINDOW = 8;
const stopRequests: number[] = [];
let dirty = false;

async function resetEpoch(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const response = await page.request.post(`/api/v1/sites/${SITE_DEMO}/demo-reset`);
    if (response.ok()) return;
    expect(response.status(), "demo-reset is only ever refused for its limit").toBe(429);
    await page.waitForTimeout(5_000);
  }
  throw new Error("demo-reset kept answering 429");
}

async function awaitStopBudget(page: Page, needed: number): Promise<void> {
  for (;;) {
    const recent = stopRequests.filter((at) => Date.now() - at < STOP_WINDOW_MS).length;
    if (recent + needed <= STOP_PER_WINDOW) return;
    await page.waitForTimeout(2_000);
  }
}

test.afterEach(async ({ page }) => {
  if (dirty) {
    await resetEpoch(page);
    dirty = false;
  }
});

// Online-only screens: a route the test holds or refuses is bypassed by a worker that took the page over (see supervisor-crews.spec.ts).
test.use({ serviceWorkers: "block" });

const bar = (page: Page) => page.locator("[data-emergency]");
/** The bar's Stop button: the crew it names is the one that needs the supervisor first (Crew A on the list, the plan's crew on its plan). */
const stopButton = (page: Page) => bar(page).getByRole("button", { name: STOP_BUTTON });

/**
 * The only console line this spec ignores: with `serviceWorkers: "block"` Serwist's client gets no registration and reads
 * `registration.waiting` of undefined. It is the test's own blocking (no visitor's browser blocks the worker here), the same
 * line supervisor-crews.spec.ts ignores; the console-clean gate runs with the worker on and ignores nothing.
 */
const withoutBlockedWorker = (errors: readonly string[]): string[] => errors.filter((line) => !line.includes("Cannot read properties of undefined (reading 'waiting')"));

/** The BFF admits 20 day-plan reads a client a minute and this gate opens the plan screen dozens of times: the first answer is cached per run. */
const planBodies = new Map<string, string>();
async function cachePlans(page: Page): Promise<void> {
  await page.route("**/api/v1/crews/*/day-plan*", async (route) => {
    const url = route.request().url();
    const held = planBodies.get(url);
    if (held !== undefined) return route.fulfill({ status: 200, contentType: "application/json", body: held });
    const response = await route.fetch();
    if (response.ok()) planBodies.set(url, await response.text());
    return route.fulfill({ response });
  });
}

type Screen = "crews" | "plan";
const PATH: Record<Screen, string> = { crews: "/supervisor", plan: "/supervisor/crews/crew-b?at=09:30" };
type BarState = "idle" | "queued" | "failed" | "stopped";

interface Opening {
  readonly screen: Screen;
  readonly locale?: "en" | "ur";
  readonly theme: Theme;
  readonly size: Size;
  /** How many notices are expected on screen. */
  readonly notices: 0 | 1 | 3 | 4;
  /** How many rows are seeded (the first N of EXPIRED_CREWS); default: `notices`. A press that ends a crew's own notice needs one more. */
  readonly seed?: number;
}

async function open(page: Page, { screen, locale = "en", theme, size, notices, seed = notices }: Opening): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: size.width, height: size.height });
  await cachePlans(page);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  page.on("request", (request) => {
    if ((request.method() === "POST" || request.method() === "DELETE") && /\/api\/v1\/crews\/[^/]+\/stops/.test(request.url())) stopRequests.push(Date.now());
  });
  await page.goto(`/${locale}/replay`);
  await seedOutbox(page, EXPIRED_CREWS.slice(0, seed));
  await page.goto(`/${locale}${PATH[screen]}`);
  await (screen === "crews" ? page.locator("[data-crew]").first() : page.locator("[data-block]").first()).waitFor();
  await expect(page.locator("[data-expired-stop]")).toHaveCount(seed);
  return errors;
}

/** Brings the bar into `state` (the notices stay). */
async function bringTo(page: Page, state: BarState, context: import("@playwright/test").BrowserContext): Promise<void> {
  if (state === "idle") return;
  if (state === "queued") {
    await context.setOffline(true);
    await stopButton(page).click({ timeout: 8_000 });
    await expect(bar(page)).toHaveAttribute("data-stop-state", "queued");
    return;
  }
  if (state === "failed") {
    await page.route("**/api/v1/crews/*/stops", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 429,
            contentType: "application/problem+json",
            body: JSON.stringify({ type: "urn:stellar-blaze:problem:rate-limited", title: "Too many requests", status: 429, request_id: "req-429" }),
          })
        : route.continue(),
    );
    await stopButton(page).click({ timeout: 8_000 });
    await expect(bar(page)).toHaveAttribute("data-stop-state", "failed");
    return;
  }
  await awaitStopBudget(page, 2);
  dirty = true;
  await stopButton(page).click({ timeout: 8_000 });
  await expect(bar(page)).toContainText("Work stopped", { timeout: 20_000 });
}

interface Measured {
  readonly bar: { top: number; bottom: number; height: number };
  readonly viewport: { width: number; height: number };
  readonly primary: { top: number; bottom: number; hit: boolean } | null;
  readonly notices: { fontPx: number; ratio: number; close: { width: number; height: number; hit: boolean; top: number; bottom: number }; textHit: boolean }[];
  readonly lastText: { text: string; bottom: number; hit: boolean } | null;
  readonly clipped: string[];
  readonly overflowX: number;
  /** The hairline under the notices region (0 when there is none). */
  readonly rulePx: number;
  /** The notices region has more content than it shows (it would have to be scrolled to read everything). */
  readonly regionScrolls: boolean;
  /** Where each notice's text and Close sit BEFORE any scrolling (viewport coordinates). */
  readonly unscrolled: { textTop: number; textBottom: number; closeTop: number; closeBottom: number }[];
  /** The notices region as it stood before any scrolling (null with no notices): its box, and how far it was scrolled (0 on a fresh page). */
  readonly region: { top: number; bottom: number; scrollTop: number } | null;
}

async function measure(page: Page): Promise<Measured> {
  // Scrolled to the end: what the page's bottom padding is for.
  // Twice: the bar publishes its height after a state change (a ResizeObserver, one frame later) and the page grows by it.
  for (let pass = 0; pass < 2; pass += 1) {
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(250);
  }
  return page.evaluate((): Measured => {
    const barEl = document.querySelector("[data-emergency]");
    if (barEl === null) throw new Error("no Stop bar");
    const rect = (el: Element) => el.getBoundingClientRect();
    const centreHit = (el: Element): boolean => {
      const r = rect(el);
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const top = document.elementFromPoint(x, y);
      return top !== null && (top === el || el.contains(top) || top.contains(el));
    };
    const toRgb = (colour: string): [number, number, number] => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("no canvas");
      context.fillStyle = "#000";
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
    const luminance = (rgb: [number, number, number]): number => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const background = (el: Element): string => {
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        const value = getComputedStyle(node).backgroundColor;
        // an unset background computes to a transparent black: keep walking up to the first painted one
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(value)) return value;
      }
      return getComputedStyle(document.body).backgroundColor;
    };

    const noticeEls = [...document.querySelectorAll("[data-expired-stop]")];
    const regionEl = document.querySelector("[data-expired-stops]");
    const unscrolled = noticeEls.map((notice) => {
      const text = notice.querySelector("p");
      const close = notice.querySelector("button");
      if (text === null || close === null) throw new Error("notice without text or Close");
      return { textTop: rect(text).top, textBottom: rect(text).bottom, closeTop: rect(close).top, closeBottom: rect(close).bottom };
    });
    const region =
      regionEl === null || noticeEls.length === 0 ? null : { top: rect(regionEl).top, bottom: rect(regionEl).bottom, scrollTop: regionEl.scrollTop };
    const notices = noticeEls.map((notice) => {
      // The notices scroll inside their capped region: a keyboard or touch user reaches the one they want by scrolling it, so each is
      // brought into view before it is measured (what must hold is that it CAN be reached, not that all are visible at once).
      notice.scrollIntoView({ block: "nearest" });
      const text = notice.querySelector("p");
      const close = notice.querySelector("button");
      if (text === null || close === null) throw new Error("notice without text or Close");
      const [a, b] = [luminance(toRgb(getComputedStyle(text).color)), luminance(toRgb(background(text)))];
      const closeRect = rect(close);
      return {
        fontPx: Number.parseFloat(getComputedStyle(text).fontSize),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        close: { width: closeRect.width, height: closeRect.height, hit: centreHit(close), top: closeRect.top, bottom: closeRect.bottom },
        textHit: centreHit(text),
      };
    });
    // Back to the opening state (scrollTop 0): the PNG that follows shows what the supervisor sees first, not the last notice scrolled into view.
    if (regionEl !== null) regionEl.scrollTop = 0;

    // The primary action: the Stop button, or Undo / Resume once the crew is stopped: the last button of the bar that is not a notice's Close.
    const buttons = [...barEl.querySelectorAll("button")].filter((button) => button.closest("[data-expired-stop]") === null);
    const primaryEl = buttons[buttons.length - 1];
    const primary = primaryEl === undefined ? null : { top: rect(primaryEl).top, bottom: rect(primaryEl).bottom, hit: centreHit(primaryEl) };

    // The page's last text: the last element in the document with its own text, outside the bar, that is visible.
    const main = document.querySelector("main");
    let lastText: Measured["lastText"] = null;
    if (main !== null) {
      for (const el of main.querySelectorAll("*")) {
        if (barEl.contains(el)) continue;
        const own = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
        const r = rect(el);
        if (!own || r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
        lastText = { text: el.textContent.trim().slice(0, 40), bottom: r.bottom, hit: centreHit(el) };
      }
    }

    const clipped: string[] = [];
    for (const el of barEl.querySelectorAll("p, span, button, bdi")) {
      if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).display !== "inline") clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`);
    }
    return {
      bar: { top: rect(barEl).top, bottom: rect(barEl).bottom, height: rect(barEl).height },
      // The screen the person sees (the visual viewport), not a layout viewport a wide page may have stretched.
      viewport: { width: Math.round(visualViewport?.width ?? innerWidth), height: Math.round(visualViewport?.height ?? innerHeight) },
      primary,
      notices,
      lastText,
      clipped,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rulePx: Number.parseFloat(getComputedStyle(document.querySelector("[data-expired-stops]") ?? barEl).borderBottomWidth),
      regionScrolls: regionEl !== null && regionEl.scrollHeight > regionEl.clientHeight + 1,
      unscrolled,
      region,
    };
  });
}

function check(m: Measured, theme: Theme, state: BarState, notices: number, label: string): string[] {
  const failures: string[] = [];
  const fail = (message: string) => failures.push(`${label}: ${message}`);
  if (m.notices.length !== notices) fail(`${String(m.notices.length)} notices on screen, expected ${String(notices)}`);
  if (m.bar.top < 0) fail(`the bar is ${String(Math.round(m.bar.height))} px tall in a ${String(m.viewport.height)} px viewport: its top is ${String(Math.round(m.bar.top))} px, off screen`);
  if (m.primary === null) fail("no Stop, Undo or Resume button in the bar");
  else {
    if (m.primary.top < 0 || m.primary.bottom > m.viewport.height + 0.5) fail(`the primary action is off screen (${String(Math.round(m.primary.top))} to ${String(Math.round(m.primary.bottom))})`);
    if (!m.primary.hit) fail("the primary action's centre is covered or off screen");
  }
  for (const [index, notice] of m.notices.entries()) {
    if (notice.fontPx < 16) fail(`notice ${String(index + 1)} text is ${String(notice.fontPx)} px`);
    if (notice.ratio < 4.5) fail(`notice ${String(index + 1)} contrast ${notice.ratio.toFixed(2)}:1`);
    if (notice.close.width < 43.9 || notice.close.height < 43.9) fail(`Close ${String(index + 1)} is ${notice.close.width.toFixed(1)} x ${notice.close.height.toFixed(1)}`);
    if (!notice.close.hit) fail(`Close ${String(index + 1)} is covered, clipped or off screen`);
    if (!notice.textHit) fail(`notice ${String(index + 1)} text is covered, clipped or off screen`);
  }
  for (const [index, box] of m.unscrolled.entries()) {
    if (box.closeTop < box.textBottom - 0.5) fail(`Close ${String(index + 1)} is not under its notice text (text ends ${String(Math.round(box.textBottom))}, Close starts ${String(Math.round(box.closeTop))})`);
  }
  if (notices === 1) {
    const only = m.unscrolled[0];
    if (m.regionScrolls) fail("one notice, and the notices region still scrolls: something is hidden behind a scroll");
    if (only !== undefined) {
      if (only.textTop < 0 || only.closeBottom > m.viewport.height + 0.5) fail(`one notice is not wholly on screen without scrolling (text from ${String(Math.round(only.textTop))}, Close to ${String(Math.round(only.closeBottom))} of ${String(m.viewport.height)})`);
      if (only.textTop < m.bar.top - 0.5) fail("one notice's text starts above the bar");
    }
  }
  if (notices >= 2) {
    // Several notices share a scroll region: the FIRST one, with its Close, must be in view before anything is scrolled (the region opens at
    // the top), whatever the viewport, so the supervisor always reads the oldest notice first and can close it without scrolling.
    const first = m.unscrolled[0];
    if (m.region === null || first === undefined) fail("several notices but no notices region measured");
    else {
      if (m.region.scrollTop !== 0) fail(`the notices region opened scrolled (scrollTop ${String(m.region.scrollTop)})`);
      if (first.textTop < m.region.top - 0.5) fail(`notice 1's text starts above the region at scrollTop 0 (${String(Math.round(first.textTop))} < ${String(Math.round(m.region.top))})`);
      if (first.closeBottom > m.region.bottom + 0.5) fail(`notice 1's Close ends below the region at scrollTop 0 (${String(Math.round(first.closeBottom))} > ${String(Math.round(m.region.bottom))})`);
      if (first.textTop < 0 || first.closeBottom > m.viewport.height + 0.5) fail("notice 1 is not inside the viewport at scrollTop 0");
    }
  }
  const token = TOKEN_RATIOS[theme][state === "stopped" ? "ink" : "ink-2"]?.ground;
  const first = m.notices[0];
  if (token !== undefined && first !== undefined && Math.abs(first.ratio - token) > 0.6) fail(`rendered contrast ${first.ratio.toFixed(2)} disagrees with the token ratio ${token.toFixed(2)}`);
  if (m.lastText === null) fail("no page text found");
  else {
    if (m.lastText.bottom > m.bar.top + 0.5) fail(`the page's last text ("${m.lastText.text}") ends at ${String(Math.round(m.lastText.bottom))} px, under the bar (top ${String(Math.round(m.bar.top))})`);
    if (!m.lastText.hit) fail(`the page's last text ("${m.lastText.text}") is covered by the bar`);
  }
  if (notices > 0 && !(m.rulePx >= 1)) fail("no hairline under the notices: the last one runs into the state line below it");
  if (m.clipped.length > 0) fail(`clipped text: ${m.clipped.join(", ")}`);
  if (m.overflowX > 0) fail(`horizontal overflow ${String(m.overflowX)} px`);
  return failures;
}

/** Phone widths are shot by the phone project and wider ones by the desktop project, so every PNG name is written once. */
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const phone = page.viewportSize()?.width === 390;
  if (phone !== (test.info().project.name === "mobile-chromium")) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

const SCREENS: readonly Screen[] = ["crews", "plan"];
const THEMES: readonly Theme[] = ["night", "sun"];

for (const screen of SCREENS) {
  // Idle: no stop is made, so every viewport, theme and count is cheap.
  test(`supervisor notice gate: ${screen}, idle bar, every viewport, night and sun, 1 and 3 notices`, async ({ page, context }) => {
    test.setTimeout(240_000);
    const failures: string[] = [];
    for (const size of SIZES) {
      for (const theme of THEMES) {
        for (const notices of [1, 3] as const) {
          const errors = await open(page, { screen, theme, size, notices });
          await bringTo(page, "idle", context);
          const label = `${screen} idle ${size.name} ${theme} ${String(notices)}n`;
          failures.push(...check(await measure(page), theme, "idle", notices, label));
          await shot(page, `${screen}-idle-${String(notices)}n-${size.name}-${theme}`);
          if (notices === 3 && size.name === "390x667" && theme === "night") {
            // The one shot of the scrolled state: the region scrolled to its end, the last notice in view.
            await page.locator("[data-expired-stops]").evaluate((region) => {
              region.scrollTop = region.scrollHeight;
            });
            await shot(page, `${screen}-idle-3n-${size.name}-${theme}-scrolled`);
          }
          expect(withoutBlockedWorker(errors), `${label}: console`).toEqual([]);
          await page.unrouteAll();
          page.removeAllListeners("request");
        }
      }
    }
    expect(failures).toEqual([]);
  });

  for (const state of ["queued", "failed", "stopped"] as const) {
    test(`supervisor notice gate: ${screen}, ${state} bar, 3 notices, 390 x 844, 390 x 667, 768, night and sun`, async ({ page, context }) => {
      test.setTimeout(300_000);
      const failures: string[] = [];
      for (const size of SIZES.slice(0, 3)) {
        for (const theme of THEMES) {
          await open(page, { screen, theme, size, notices: 4 });
          await bringTo(page, state, context);
          // The press ended the bar's own crew's notice (per crew): three remain.
          const label = `${screen} ${state} ${size.name} ${theme} 3n`;
          failures.push(...check(await measure(page), theme, state, 3, label));
          await shot(page, `${screen}-${state}-3n-${size.name}-${theme}`);
          // Leave the page BEFORE the signal returns: a queued stop on a page that is still open would be sent and recorded.
          await page.goto("about:blank");
          await context.setOffline(false);
          await page.unrouteAll();
          if (dirty) {
            await resetEpoch(page);
            dirty = false;
          }
          page.removeAllListeners("request");
        }
      }
      expect(failures).toEqual([]);
    });
  }

  test(`supervisor notice gate: ${screen} in Urdu (right to left), 390 x 844 and 390 x 667, 1 and 3 notices`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const failures: string[] = [];
    for (const size of SIZES.slice(0, 2)) {
      for (const notices of [1, 3] as const) {
        await open(page, { screen, locale: "ur", theme: "night", size, notices });
        await bringTo(page, "idle", context);
        const label = `${screen} ur ${size.name} ${String(notices)}n`;
        failures.push(...check(await measure(page), "night", "idle", notices, label));
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        await shot(page, `${screen}-ur-idle-${String(notices)}n-${size.name}-night`);
        page.removeAllListeners("request");
      }
    }
    expect(failures).toEqual([]);
  });
}

/*
 * The Stop bar fits ANY viewport (architect's rule, 2026-11-16): the Stop button is wholly on screen down to 320 x 480 and at 200% text, in
 * portrait and landscape, with the top of the bar never cut off and, whatever the notices need, each Close reachable by scrolling the notices
 * region. Text at 200% is the root font size at 200% (every size in the app is rem: what a phone's "largest text" setting does).
 */
const FIT_SIZES: readonly Size[] = [
  { name: "320x480", width: 320, height: 480 },
  { name: "360x640", width: 360, height: 640 },
  { name: "390x667", width: 390, height: 667 },
  { name: "640x360", width: 640, height: 360 },
  { name: "800x360", width: 800, height: 360 },
];

async function zoomText(page: Page, percent: number): Promise<void> {
  await page.addStyleTag({ content: `html { font-size: ${String(percent)}% !important; }` });
  // The bar publishes its height one frame after it changes.
  await page.waitForTimeout(300);
}

interface Fit {
  readonly bar: { top: number; bottom: number };
  readonly viewport: { width: number; height: number };
  readonly stop: { top: number; bottom: number; left: number; right: number; hit: boolean } | null;
  readonly closes: { height: number; hit: boolean }[];
  readonly state: { clipped: boolean; headlineVisible: boolean } | null;
}

async function fitOf(page: Page): Promise<Fit> {
  return page.evaluate((): Fit => {
    const barEl = document.querySelector("[data-emergency]");
    if (barEl === null) throw new Error("no Stop bar");
    const rect = (el: Element) => el.getBoundingClientRect();
    const hit = (el: Element): boolean => {
      const r = rect(el);
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const top = document.elementFromPoint(x, y);
      return top !== null && (top === el || el.contains(top) || top.contains(el));
    };
    const buttons = [...barEl.querySelectorAll("button")].filter((button) => button.closest("[data-expired-stop]") === null);
    const stopEl = buttons[buttons.length - 1];
    // Each Close, reached the way a user reaches it: by scrolling the notices region (never the page: the bar is fixed).
    const closes = [...document.querySelectorAll("[data-expired-stop] button")].map((close) => {
      close.scrollIntoView({ block: "nearest" });
      return { height: rect(close).height, hit: hit(close) };
    });
    // The state line of the bar: "Not sent" / "Not sent, tell the crew" (alert) or what a stopped bar says (status); not the notices region.
    const stateEl = barEl.querySelector('[role="alert"], [role="status"]:not([data-expired-stops]):not(.sr-only)');
    return {
      bar: { top: rect(barEl).top, bottom: rect(barEl).bottom },
      // The screen the person sees (the visual viewport), not a layout viewport a wide page may have stretched.
      viewport: { width: Math.round(visualViewport?.width ?? innerWidth), height: Math.round(visualViewport?.height ?? innerHeight) },
      stop: stopEl === undefined ? null : { top: rect(stopEl).top, bottom: rect(stopEl).bottom, left: rect(stopEl).left, right: rect(stopEl).right, hit: hit(stopEl) },
      closes,
      state:
        stateEl === null
          ? null
          : {
              clipped: stateEl.scrollHeight > stateEl.clientHeight + 1,
              // The first line ("Not sent." / "Not sent. Tell the crew now.") is on screen, whole, inside the bar.
              headlineVisible: (() => {
                const headline = stateEl.querySelector("p");
                if (headline === null) return false;
                const r = rect(headline);
                return r.top >= rect(barEl).top - 0.5 && r.bottom <= Math.min(rect(barEl).bottom, innerHeight) + 0.5 && r.height > 0;
              })(),
            },
    };
  });
}

/**
 * The parts of the bar give way in a fixed order when the screen is too short (StopWorkBar.tsx): the notices region first, then the state
 * line's detail, never the Stop button. At 200 % text on a screen 480 px high or less, a Stop button (144 px) and the state line cannot
 * leave the older notices any room: they are then not reachable until the state line clears, and the state line is on screen and
 * pressable but its detail may scroll. That is the order the architect chose (Option A) and it is asserted as such, not hidden:
 * the headline of the state line must still be whole on screen, and so must the Stop button.
 */
function fitFailures(fit: Fit, label: string, notices: number, text: number): string[] {
  const failures: string[] = [];
  const stopFirst = text >= 200 && fit.viewport.height <= 480 && fit.state !== null;
  const fail = (message: string) => failures.push(`${label}: ${message}`);
  if (fit.bar.top < -0.5) fail(`the top of the bar is cut off (top ${String(Math.round(fit.bar.top))})`);
  if (fit.bar.bottom > fit.viewport.height + 0.5) fail(`the bar ends below the viewport (${String(Math.round(fit.bar.bottom))} > ${String(fit.viewport.height)})`);
  if (fit.stop === null) fail("no Stop button");
  else {
    if (fit.stop.top < -0.5 || fit.stop.bottom > fit.viewport.height + 0.5) fail(`the Stop button is not wholly on screen (${String(Math.round(fit.stop.top))} to ${String(Math.round(fit.stop.bottom))} of ${String(fit.viewport.height)})`);
    if (fit.stop.left < -0.5 || fit.stop.right > fit.viewport.width + 0.5) fail("the Stop button is wider than the viewport");
    if (!fit.stop.hit) fail("the Stop button's centre is covered or off screen");
  }
  if (fit.closes.length !== notices) fail(`${String(fit.closes.length)} Close buttons, expected ${String(notices)}`);
  for (const [index, close] of fit.closes.entries()) {
    if (close.height < 43.9) fail(`Close ${String(index + 1)} is ${close.height.toFixed(1)} px tall`);
    if (!close.hit && !stopFirst) fail(`Close ${String(index + 1)} cannot be reached by scrolling the notices region`);
  }
  if (fit.state !== null && !fit.state.headlineVisible) fail("the first line of the state line is not whole on screen");
  if (fit.state?.clipped === true && !stopFirst) fail("the state line (\"Not sent\") is clipped");
  return failures;
}

test("supervisor notice gate: the Stop bar fits 320 x 480 to 800 x 360, at 100 and 200 percent text, with 0, 1 and 3 notices, idle and queued", async ({ page, context }) => {
  test.setTimeout(900_000);
  const failures: string[] = [];
  for (const size of FIT_SIZES) {
    for (const percent of [100, 200]) {
      for (const notices of [0, 1, 3] as const) {
        for (const state of ["idle", "queued"] as const) {
          const label = `crews ${state} ${size.name} ${String(percent)}% ${String(notices)}n`;
          try {
            // The press that queues a stop ends its own crew's notice: seed one more so the wanted number remains.
            await open(page, { screen: "crews", theme: "night", size, notices, seed: state === "queued" ? notices + 1 : notices });
            await zoomText(page, percent);
            await bringTo(page, state, context);
            await page.waitForTimeout(300);
            failures.push(...fitFailures(await fitOf(page), label, notices, percent));
          } catch (error) {
            // A Stop button that cannot be pressed (outside the screen, covered) fails THIS case, with the reason, instead of hanging the run.
            failures.push(`${label}: ${error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? "") : String(error)}`);
          }
          await page.goto("about:blank");
          await context.setOffline(false);
          await page.unrouteAll();
          page.removeAllListeners("request");
        }
      }
    }
  }
  expect(failures).toEqual([]);
});

test("supervisor notice gate: the same on the plan screen and with a stopped crew, at the two tightest viewports, 200 percent text, 3 notices", async ({ page, context }, testInfo) => {
  test.setTimeout(600_000);
  const failures: string[] = [];
  for (const size of [FIT_SIZES[0], FIT_SIZES[3]] as readonly Size[]) {
    // KNOWN LIMIT (freeze summary): at 320 px wide and 200 % text the crew plan screen is 441 px wide (its time rows and icons need more), and
    // an emulated phone (mobile-chromium) then lays the page out wider than its 320 px screen, so the fixed bar's right part is off the
    // screen. The desktop project, whose window really is 320 px wide, runs this case and asserts the bar; the phone project skips it.
    if (testInfo.project.name === "mobile-chromium" && size.width < 390) continue;
    for (const [screen, state] of [["plan", "idle"], ["crews", "stopped"], ["plan", "failed"]] as const) {
      await open(page, { screen, theme: "night", size, notices: 3, seed: state === "idle" ? 3 : 4 });
      await zoomText(page, 200);
      await bringTo(page, state, context);
      await page.waitForTimeout(300);
      failures.push(...fitFailures(await fitOf(page), `${screen} ${state} ${size.name} 200% 3n`, 3, 200));
      await page.goto("about:blank");
      await context.setOffline(false);
      await page.unrouteAll();
      if (dirty) {
        await resetEpoch(page);
        dirty = false;
      }
      page.removeAllListeners("request");
    }
  }
  expect(failures).toEqual([]);
});
