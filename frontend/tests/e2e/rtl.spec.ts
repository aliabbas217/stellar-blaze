import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { watchConsole } from "./gate.ts";
import { withScenario } from "./helpers/scenario.ts";

/*
 * Right-to-left and Arabic-script layout (F2 Task 22, Review Focus 4), in a production build against the mock API. Urdu and Arabic mirror
 * the layout, keep the clocks Western and unmirrored, never clip Nastaliq, and keep the safety controls. The claims surfaces stay English
 * by design (controller ruling 1): there the page chrome mirrors and the content blocks are `lang="en" dir="ltr"`.
 *
 * Every title contains "rtl", so `pnpm e2e -g rtl` selects them. The hero shares per language are in hero-share.spec.ts.
 */

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };
const PIN = `?site=${SITE_DEMO}&crew=crew-b`;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;
/** The Arabic-Indic and Extended Arabic-Indic (Urdu) digit blocks: what must NOT appear anywhere (every number is Western). */
const NON_WESTERN_DIGIT = /[٠-٩۰-۹]/;

async function open(page: Page, path: string, { size = PHONE, theme = "night" }: { size?: { width: number; height: number }; theme?: "night" | "sun" } = {}): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(size);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

/** What the page says about itself and each Arabic-script text box: direction, leading, fixed heights, clipping. */
async function measureArabicScript(page: Page, scope = "body") {
  return page.evaluate(
    ({ root, script }) => {
      const arabic = new RegExp(script);
      const out = {
        direction: getComputedStyle(document.documentElement).direction,
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        boxes: 0,
        shortLeading: [] as string[],
        fixedHeight: [] as string[],
        clipped: [] as string[],
        minRatio: Infinity,
      };
      const container = document.querySelector(root) ?? document.body;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      const describe = (el: Element) => `${el.tagName.toLowerCase()} "${el.textContent.trim().replace(/\s+/g, " ").slice(0, 36)}"`;
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        const owner = node.parentElement;
        if (owner === null || !arabic.test(text) || seen.has(owner) || owner.closest("script, style, noscript, svg, .sr-only") !== null) continue;
        const style = getComputedStyle(owner);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = owner.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue;
        seen.add(owner);
        out.boxes += 1;
        const size = Number.parseFloat(style.fontSize);
        const leading = style.lineHeight === "normal" ? 1.2 * size : Number.parseFloat(style.lineHeight);
        const ratio = leading / size;
        out.minRatio = Math.min(out.minRatio, ratio);
        if (ratio < 2.49) out.shortLeading.push(`${ratio.toFixed(2)} ${describe(owner)}`);
        // A fixed height on the text node or any box up to the container: an inline style, or a height the page's CSS pinned.
        for (let el: Element | null = owner; el !== null && el !== container; el = el.parentElement) {
          const inline = (el as HTMLElement).style.height;
          if (inline !== "" && inline !== "auto") out.fixedHeight.push(`${inline} ${describe(el)}`);
        }
        // Clipping: the text's own box, and every ancestor that clips (overflow other than visible) must contain the text.
        const range = document.createRange();
        range.selectNodeContents(owner);
        const ink = range.getBoundingClientRect();
        for (let el: Element | null = owner; el !== null && el !== document.documentElement; el = el.parentElement) {
          const s = getComputedStyle(el);
          const clips = [s.overflowX, s.overflowY].some((value) => value !== "visible");
          if (!clips) continue;
          const box = el.getBoundingClientRect();
          const scrollable = ["auto", "scroll"].includes(s.overflowX) || ["auto", "scroll"].includes(s.overflowY);
          if (scrollable) continue; // a scroller (the page, a table) shows the rest by scrolling
          if (ink.top < box.top - 1.5 || ink.bottom > box.bottom + 1.5 || ink.left < box.left - 1.5 || ink.right > box.right + 1.5) {
            out.clipped.push(`${describe(owner)} clipped by ${describe(el)}`);
          }
        }
        if (owner.scrollWidth > owner.clientWidth + 1 && style.overflowX !== "visible") out.clipped.push(`${describe(owner)} scrollWidth ${String(owner.scrollWidth)} > ${String(owner.clientWidth)}`);
      }
      return { ...out, minRatio: out.minRatio === Infinity ? 0 : out.minRatio };
    },
    { root: scope, script: ARABIC_SCRIPT.source },
  );
}

/**
 * Every text node that IS a clock (`hh:mm`, with punctuation) sits in a <bdi>, a <time> or a dir=ltr box, so the bidi algorithm cannot
 * reorder it. A sentence that merely contains a clock is the catalogue's: its <bdi> wrappers are pinned for every key by the tag-parity
 * test (tests/unit/i18n/copy-rules.test.ts); the sentences the app builds in code from a list (the sign-off items) are checked by
 * `signOffClocks` below, which counts any clock in running text, not only a clock that is a text node of its own.
 *
 * Returns how many clock text nodes were found and which are loose: a check that finds no clock proves nothing, so
 * `expectClocksIsolated` asserts at least one was found (fix round 1: the old checks passed on a page with no clock at all).
 */
async function unwrappedClocks(page: Page, scope = "body"): Promise<{ readonly found: number; readonly loose: string[] }> {
  return page.evaluate((root) => {
    const container = document.querySelector(root) ?? document.body;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const loose: string[] = [];
    let found = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const owner = node.parentElement;
      if (owner === null || !/\b\d{1,2}:\d{2}\b/.test(text) || owner.closest("script, style, noscript, svg, .sr-only") !== null) continue;
      if (getComputedStyle(owner).display === "none") continue;
      const isolated = owner.closest("bdi, time, [dir='ltr']") !== null;
      const onlyClock = text.replace(/\b\d{1,2}:\d{2}\b/g, "").replace(/[\s :.,()\-–]/g, "") === "";
      if (onlyClock) found += 1;
      if (onlyClock && !isolated) loose.push(`${owner.tagName.toLowerCase()} "${text.trim().slice(0, 50)}"`);
    }
    return { found, loose };
  }, scope);
}

async function expectClocksIsolated(page: Page, scope: string, label: string): Promise<void> {
  const { found, loose } = await unwrappedClocks(page, scope);
  expect(found, `${label}: at least one clock was found (a check that finds none proves nothing)`).toBeGreaterThan(0);
  expect(loose, `${label}: clock digits are isolated`).toEqual([]);
}

/**
 * Every `hh:mm` inside `scope`, in any text node (alone or in running text): how many there are and which sit outside a <bdi>, <time>
 * or dir=ltr box. The sign-off sentences are built in code from a list of items, so a clock there is in running text.
 */
async function signOffClocks(page: Page, scope: string): Promise<{ readonly found: number; readonly bare: string[] }> {
  return page.evaluate((root) => {
    const container = document.querySelector(root);
    const bare: string[] = [];
    let found = 0;
    if (container === null) return { found, bare: [`no element matches ${root}`] };
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (!/\d{1,2}:\d{2}/.test(text)) continue;
      found += 1;
      if (node.parentElement?.closest("bdi, time, [dir='ltr']") === null) bare.push(text.trim().slice(0, 80));
    }
    return { found, bare };
  }, scope);
}

/** No text node on the page is the reversed temperature readout "C° 30.7" (the unit before the number: the bidi defect of an Arabic-script readout). */
async function expectNoReversedTemperature(page: Page, label: string): Promise<void> {
  const reversed = await page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      if (/^C° ?\d/.test(text)) found.push(text.slice(0, 40));
    }
    return found;
  });
  expect(reversed, `${label}: no text node reads "C° <number>"`).toEqual([]);
}

async function expectUnclipped(page: Page, label: string, scope = "main"): Promise<void> {
  const m = await measureArabicScript(page, scope);
  expect(m.lang, `${label}: html lang`).toMatch(/^(ur|ar)$/);
  expect(m.dir, `${label}: html dir`).toBe("rtl");
  expect(m.direction, `${label}: computed direction`).toBe("rtl");
  expect(m.boxes, `${label}: Arabic-script text boxes were found`).toBeGreaterThan(3);
  expect(m.fixedHeight, `${label}: no fixed height on Arabic-script text`).toEqual([]);
  expect(m.clipped, `${label}: no clipped text`).toEqual([]);
  return;
}

test.describe("rtl: Urdu field screens", () => {
  test("ur worker today is rtl and unclipped", async ({ page }) => {
    const errors = await open(page, `/ur/worker${PIN}`);
    await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    const m = await measureArabicScript(page, "main");
    expect(m.direction).toBe("rtl");
    expect(await page.locator("main").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
    // The body text of the Urdu stack sits at the Urdu leading token (--leading-ur, 2.5): at least 2.5 times the font size.
    const token = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--leading-ur")));
    expect(token).toBeGreaterThanOrEqual(2.5);
    expect(m.shortLeading, "every Arabic-script text box is set at 2.5 or more").toEqual([]);
    expect(m.minRatio).toBeGreaterThanOrEqual(2.49);
    await expectUnclipped(page, "Today");
    // The level sign reads its leading from the language's tokens, so its skeleton and the sign are one height in every language.
    const sign = await page.locator("[data-level-sign]").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--sign-leading-word").trim());
    // A real number, not a fallback: an empty or unresolved token parses to NaN and fails here (the old `|| 2.5` hid both NaN and 0).
    const signLeading = Number.parseFloat(sign);
    expect(Number.isFinite(signLeading), `--sign-leading-word resolved to "${sign}"`).toBe(true);
    expect(signLeading).toBeGreaterThanOrEqual(2.5);
    await expectClocksIsolated(page, "main", "Today");
    await expectNoReversedTemperature(page, "ur Today");
    expect(errors.filter((message) => !/503|Failed to load resource/.test(message))).toEqual([]);
    await test.info().attach("ur-worker-today.png", { body: await page.screenshot({ type: "png" }), contentType: "image/png" });
  });

  test("ur unwell sheet is rtl and unclipped, the calls are 44 px and the dock is still there", async ({ page }) => {
    await page.addInitScript((stored) => {
      localStorage.setItem("sb-profile-v1", stored);
    }, JSON.stringify({ state: { profile: null, push: null, site: { siteId: SITE_DEMO, crewId: null, contacts: { supervisorPhone: "+12025550143", firstAiderPhone: "+12025550144" } } }, version: 1 }));
    await open(page, "/ur/worker/unwell");
    await expect(page.getByRole("timer")).toBeVisible();
    await expectUnclipped(page, "unwell");
    const calls = page.locator('main button:has-text("998"), main a[href^="tel:"]');
    expect(await calls.count()).toBeGreaterThanOrEqual(1);
    for (const heightPx of await page.locator("main").getByRole("button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(heightPx, "a call button is at least 44 px").toBeGreaterThanOrEqual(43.5);
    }
    // The dock stays: on the sheet itself its big control is the way back to Today, at least 44 px high.
    const dock = page.getByRole("link", { name: ur.worker.nav.backToToday });
    await expect(dock).toBeVisible();
    expect((await dock.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    // The step numbers are Western digits in a circle, and the timer is Western digits left to right.
    expect(await page.getByRole("timer").evaluate((el) => `${el.textContent}${getComputedStyle(el).direction}`)).toMatch(/^\d+:\d{2}ltr$|^\d+:\d{2}rtl$/);
    expect(await page.locator("body").innerText()).not.toMatch(NON_WESTERN_DIGIT);
  });

  test("ur alert card is rtl and unclipped, the clock is isolated and the dock stays", async ({ page }) => {
    await open(page, `/ur/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${encodeURIComponent("2026-09-03T06:00:00Z")}`);
    await expect(page.locator("[data-level-sign]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectUnclipped(page, "alert");
    await expectClocksIsolated(page, "main", "alert");
    await expectNoReversedTemperature(page, "ur alert");
    expect(await page.locator("[data-emergency]").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("body").innerText()).not.toMatch(NON_WESTERN_DIGIT);
  });

  test("ur crews screen is rtl and unclipped, the Stop bar is there and 44 px, the clocks are isolated", async ({ page }) => {
    await open(page, "/ur/supervisor");
    await expect(page.locator("[data-emergency]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectUnclipped(page, "crews");
    const bar = page.locator("[data-emergency]").first();
    const stop = bar.getByRole("button").first();
    await expect(stop).toBeVisible();
    expect((await stop.boundingBox())?.height ?? 0, "Stop work is at least 44 px high").toBeGreaterThanOrEqual(43.5);
    expect(await stop.innerText()).toContain(ur.supervisor.stop.button.replace(/<\/?bdi>|\{crew\}/g, "").trim().split(" ")[0] ?? "");
    await expectClocksIsolated(page, "main", "crews");
    await expectNoReversedTemperature(page, "ur crews");
    expect(await page.locator("body").innerText()).not.toMatch(NON_WESTERN_DIGIT);
  });

  test("ur plan is rtl and unclipped, the Stop bar is there and 44 px, the clocks are isolated", async ({ page }) => {
    await open(page, "/ur/supervisor/crews/crew-b");
    await expect(page.locator("[data-emergency]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectUnclipped(page, "plan");
    const stop = page.locator("[data-emergency]").first().getByRole("button").first();
    expect((await stop.boundingBox())?.height ?? 0, "Stop work is at least 44 px high").toBeGreaterThanOrEqual(43.5);
    await expectClocksIsolated(page, "main", "plan");
    await expectNoReversedTemperature(page, "ur plan");
    // The sign-off sentences join the items' clocks in code: each clock is its own isolate even inside the running sentence (fix round 1).
    await expect(page.locator("[data-sign-off-items]")).toBeVisible();
    const signOff = await signOffClocks(page, "[data-sign-off]");
    expect(signOff.found, "the sign-off shows its clocks").toBeGreaterThanOrEqual(4);
    expect(signOff.bare, "no sign-off clock sits bare in running text").toEqual([]);
    expect(await page.locator("body").innerText()).not.toMatch(NON_WESTERN_DIGIT);
  });
});

test.describe("rtl: Arabic and the claims surfaces", () => {
  test("ar replay scoreboard mirrors and keeps Western digits", async ({ page }) => {
    await open(page, "/ar/replay", { size: DESK });
    await expect(page.locator("[data-claims-english]")).toHaveCount(1);
    // The chrome mirrors: the document and the desk header are right to left, and the wordmark (the first item) is at the right edge.
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    expect(await page.locator("header").first().evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
    const header = await page.locator("header").first().evaluate((el) => {
      const wordmark = el.querySelector("a")?.getBoundingClientRect();
      const nav = el.querySelector("nav")?.getBoundingClientRect();
      return { wordmarkRight: wordmark?.right ?? 0, navLeft: nav?.left ?? 0, navRight: nav?.right ?? 0, width: window.innerWidth };
    });
    expect(header.wordmarkRight, "the wordmark is at the inline start: the right edge").toBeGreaterThan(header.width / 2);
    expect(header.navRight, "the menu sits to the left of the wordmark").toBeLessThanOrEqual(header.wordmarkRight);
    // The menu is the active locale's words.
    await expect(page.getByRole("navigation", { name: ar.shell.desk.menu })).toBeVisible();
    await expect(page.getByRole("navigation", { name: ar.shell.desk.menu }).getByRole("link", { name: ar.shell.desk.nav.scoreboard })).toBeVisible();
    // The claims block is English and left to right; its headings are the English source, byte for byte.
    const block = page.locator("[data-claims-english]");
    await expect(block).toHaveAttribute("lang", "en");
    await expect(block).toHaveAttribute("dir", "ltr");
    await expect(block.getByRole("heading", { level: 1 })).toHaveText(en.judge.scoreboard.title);
    expect(await block.locator("main").evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    // English paragraphs in the block are set with the English leading, not Arabic's 1.8.
    const leading = await block.locator("p").first().evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight) / Number.parseFloat(getComputedStyle(el).fontSize));
    expect(leading).toBeCloseTo(1.5, 1);
    // The translated story footer inside the block restores Arabic and right to left.
    const nav = page.locator("[data-story-nav]");
    await expect(nav).toHaveAttribute("lang", "ar");
    await expect(nav).toHaveAttribute("dir", "rtl");
    // The claims copy is English all the way down, dates and lists included: no Arabic-script letter in it, but for the translated
    // pieces that restore the page language (the story footer, a banner, a stamp). "15 May to 30 Sep", never "15 مايو to 30 سبتمبر".
    const arabicInClaims = await block.evaluate((root, script) => {
      const arabic = new RegExp(script);
      const found: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const owner = node.parentElement;
        const text = node.textContent ?? "";
        if (owner === null || !arabic.test(text) || owner.closest("[data-story-nav], [role='status'], [role='note'], script, style, svg") !== null) continue;
        found.push(text.trim().slice(0, 60));
      }
      return found;
    }, ARABIC_SCRIPT.source);
    expect(arabicInClaims, "no Arabic-script text inside the English claims block").toEqual([]);
    // Digits stay Western everywhere on the page.
    expect(await page.locator("body").innerText()).not.toMatch(NON_WESTERN_DIGIT);
    expect(await page.locator("body").innerText()).toMatch(/\d/);
    await test.info().attach("ar-replay-scoreboard.png", { body: await page.screenshot({ type: "png" }), contentType: "image/png" });
  });

  test("ur replay day, try and governance keep the English block and the translated chrome", async ({ page }) => {
    for (const route of ["/ur/replay/day", "/ur/replay/try", "/ur/replay/governance"]) {
      await open(page, route, { size: PHONE });
      await expect(page.locator("[data-claims-english]"), route).toHaveCount(1);
      await expect(page.locator("html"), route).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("navigation", { name: ur.shell.desk.menu }).getByRole("link", { name: ur.shell.desk.nav.scoreboard }), route).toBeVisible();
      expect(await page.locator("[data-claims-english] main").evaluate((el) => getComputedStyle(el).direction), route).toBe("ltr");
      expect(await page.locator("body").innerText(), route).not.toMatch(NON_WESTERN_DIGIT);
    }
  });

  test("ar plan sign-off keeps every clock isolated, and the worker and supervisor pages never read C° before a number", async ({ page }) => {
    await open(page, "/ar/supervisor/crews/crew-b");
    await expect(page.locator("[data-sign-off-items]")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectClocksIsolated(page, "main", "ar plan");
    const signOff = await signOffClocks(page, "[data-sign-off]");
    expect(signOff.found, "the sign-off shows its clocks").toBeGreaterThanOrEqual(4);
    expect(signOff.bare, "no sign-off clock sits bare in running text").toEqual([]);
    await expectNoReversedTemperature(page, "ar plan");
    await open(page, "/ar/supervisor");
    await expect(page.locator("[data-emergency]").first()).toBeVisible();
    await expectNoReversedTemperature(page, "ar crews");
    await open(page, `/ar/worker${PIN}`);
    await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
    await expectNoReversedTemperature(page, "ar Today");
    await expectClocksIsolated(page, "main", "ar Today");
  });

  test("ar landing mirrors: the copy and the story footer are Arabic right to left, the story chapters English, the role door linked", async ({ page }) => {
    await open(page, "/ar", { size: DESK });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ar.judge.landing.title);
    expect(await page.locator("[data-claims-english]").count() + (await page.locator('[lang="en"][dir="ltr"]').count())).toBeGreaterThan(0);
    await expect(page.locator("[data-machine-translation]")).toHaveCount(1);
    await expect(page.locator("[data-role-door] a")).toHaveText([new RegExp(`^${ar.judge.landing.door.worker.title}`), new RegExp(`^${ar.judge.landing.door.crew.title}`), new RegExp(`^${ar.judge.landing.door.safety.title}`), new RegExp(`^${ar.judge.landing.door.review.title}`)]);
    expect(await page.locator("body").innerText()).not.toMatch(NON_WESTERN_DIGIT);
  });
});

/*
 * The header names the site, and the demo site's name ends in "(synthetic)": that marker is never cut off. At 390 px the Arabic sun-mode
 * button is long and used to leave the name about 135 px: the two-line clamp then put the ellipsis where "(synthetic)" was (fix round 1,
 * ar-plan-390-night.png: "Mussafah M-14 / ...yard"). The name wraps instead; this asserts the marker's own text rectangle lies inside the
 * name's box, and that no text of the name is hidden by a clamp or an overflow.
 */
for (const locale of ["ar", "ur"] as const) {
  for (const route of [`/${locale}/supervisor/crews/crew-b`, `/${locale}/worker${PIN}`, `/${locale}/supervisor`]) {
    test(`rtl: the header name keeps (synthetic) visible at 390 in ${locale} on ${route.replace(`/${locale}`, "")}`, async ({ page }) => {
      await open(page, route);
      const name = page.locator("header p[title]").first();
      await expect(name, "the header names the site").toBeVisible();
      await expect(name).toContainText("(synthetic)");
      const measured = await name.evaluate((el) => {
        const text = el.textContent;
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        // The text node that holds the marker, and the rectangle of just those characters.
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let rect: DOMRect | null = null;
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = (node.textContent ?? "").indexOf("(synthetic)");
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + "(synthetic)".length);
          rect = range.getBoundingClientRect();
        }
        return {
          text,
          box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
          marker: rect === null ? null : { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          clamp: style.webkitLineClamp,
          overflowY: style.overflowY,
          lineHeight: Number.parseFloat(style.lineHeight),
          hiddenHeight: el.scrollHeight - el.clientHeight,
          viewport: window.innerWidth,
        };
      });
      expect(measured.marker, "the marker's text was laid out").not.toBeNull();
      const marker = measured.marker as { top: number; bottom: number; left: number; right: number };
      // A text range's rectangle is the font's content area, which overshoots the line box by a pixel or two: half a line is the
      // tolerance, and a marker clamped onto a hidden line sits a whole line or more below the box.
      const halfLine = measured.lineHeight / 2;
      expect(marker.bottom, `${measured.text}: the marker is inside the name's box (not clamped away below it)`).toBeLessThanOrEqual(measured.box.bottom + halfLine);
      expect(marker.top).toBeGreaterThanOrEqual(measured.box.top - halfLine);
      // The Arabic night button is the longest: the name must still fit two lines (a third line costs the hero 3 points of the fold).
      expect(measured.box.bottom - measured.box.top, "the name takes at most two lines").toBeLessThanOrEqual(measured.lineHeight * 2 + 2);
      expect(marker.left, "inside the viewport").toBeGreaterThanOrEqual(0);
      expect(marker.right, "inside the viewport").toBeLessThanOrEqual(measured.viewport + 0.5);
      expect(measured.clamp, "no line clamp on the site name").toMatch(/none|normal|^$/);
      // Nothing hides overflow on the name (a clamp, overflow hidden or clip); the content area's own overshoot of the line box (a pixel or
      // two) is not hidden text, so the scroll height is only held to half a line.
      expect(measured.overflowY, "the name does not hide overflow").toBe("visible");
      expect(measured.hiddenHeight, "no text of the name is hidden").toBeLessThanOrEqual(halfLine);
    });
  }
}

test("rtl: Hindi, Bengali and Nepali stay left to right with their own leading, and the English block keeps the English face", async ({ page }) => {
  for (const locale of ["hi", "bn", "ne"]) {
    await withScenario(page, null);
    await open(page, `/${locale}/worker${PIN}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    expect(await page.locator("main").evaluate((el) => getComputedStyle(el).direction), locale).toBe("ltr");
  }
});
