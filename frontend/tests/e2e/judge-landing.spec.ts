import { expect, test, type Page } from "@playwright/test";
import ur from "../../messages/ur.json";
import { axeViolations } from "./axe.ts";
import { watchConsole } from "./gate.ts";

/*
 * The landing page (/en) in a production build (redesign S10, "Real Earth"): the skip link first, the pinned forecast scene (hour, captions, camera
 * from the scroll), seven chapters that are one screen each and come to rest, the rail, the plain-column fallbacks (reduced motion, no WebGL, a phone),
 * and the rule that snapping belongs to the landing only. No API is involved: the page is static and its data are static files.
 * Every title contains "landing", so `pnpm e2e -g landing` selects them. The wide tests set their own viewport and need a fine pointer (the desktop
 * project); the phone tests run in both.
 */

const WIDE = { width: 1440, height: 900 };
const SLIDES = ["morning", "plan", "boundary", "evidence", "checks", "ways", "limits"] as const;

async function open(page: Page, viewport = WIDE, url = "/en"): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(viewport);
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

const sceneMode = (page: Page): Promise<string | null> => page.locator("#forecast").getAttribute("data-scene");
const live = async (page: Page): Promise<void> => {
  await expect(page.locator("#forecast")).toHaveAttribute("data-scene", "live", { timeout: 30_000 });
};
const scrollTo = async (page: Page, y: number): Promise<void> => {
  await page.evaluate((top) => {
    window.scrollTo(0, top);
  }, y);
  await page.waitForTimeout(500);
};
const topOf = (page: Page, id: string): Promise<number> => page.evaluate((s) => (document.getElementById(s)?.getBoundingClientRect().top ?? 0) + window.scrollY, id);
const pinnedRange = (page: Page): Promise<number> => page.evaluate(() => (document.querySelector("#forecast")?.getBoundingClientRect().height ?? 0) - window.innerHeight);

test.describe("wide screens", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "needs a fine pointer and a wide screen: the desktop project");
  });

  test("landing first focusable element is the skip link, and it goes to the scoreboard in one click", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    const href = await page.evaluate(() => document.activeElement?.getAttribute("href"));
    expect(href).toMatch(/\/replay$/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/replay$/);
  });

  test("landing scene arrives after first paint: the page is readable first, then the scene goes live with no API request and no console error", async ({ page }) => {
    const api: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
    });
    const errors = await open(page);
    expect(await sceneMode(page)).toBe("loading");
    await live(page);
    await expect(page.locator("#forecast canvas")).toBeVisible();
    expect(api).toEqual([]);
    expect(errors.filter((e) => !/GPU stall|GL Driver|WebGL/i.test(e))).toEqual([]);
  });

  test("landing pinned scene: the scroll moves the hour 06:00, 09:00, 14:00 and steps the three captions, with their numbers from the field", async ({ page }) => {
    await open(page);
    await live(page);
    const range = await pinnedRange(page);
    const clock = page.locator("#forecast .clock span").first();
    const stage = page.locator("#forecast .stage");
    expect(await clock.textContent()).toBe("06:00");
    await scrollTo(page, Math.round(range * 0.45));
    expect(await clock.textContent()).toBe("09:00");
    await expect(stage).toHaveAttribute("data-step", "1");
    expect(await page.locator("#forecast .s1 .n").textContent()).toMatch(/^\d+$/);
    await scrollTo(page, Math.round(range * 0.65));
    await expect(stage).toHaveAttribute("data-step", "2");
    expect(await page.locator("#forecast .s2 .n").textContent()).toMatch(/^\d\d\.\d$/);
    await scrollTo(page, range);
    expect(await clock.textContent()).toBe("14:00");
    await expect(stage).toHaveAttribute("data-step", "3");
    expect(await page.locator("#forecast .s3 .n").textContent()).toMatch(/^\d\d\.\d$/);
  });

  test("landing every slide is exactly one screen, nothing runs sideways, and the rail marks the chapter in view", async ({ page }) => {
    await open(page);
    for (const id of SLIDES) {
      await scrollTo(page, await topOf(page, id));
      const box = await page.evaluate((s) => {
        const el = document.getElementById(s);
        return { h: el?.getBoundingClientRect().height ?? 0, w: document.documentElement.scrollWidth - window.innerWidth, inner: window.innerHeight, overflow: (el?.scrollHeight ?? 0) - (el?.clientHeight ?? 0) };
      }, id);
      expect(Math.round(box.h), id).toBe(box.inner);
      expect(box.w, `${id} sideways`).toBeLessThanOrEqual(0);
      expect(box.overflow, `${id} clipped content`).toBeLessThanOrEqual(1);
    }
    await scrollTo(page, await topOf(page, "plan"));
    await expect(page.locator('.idx a[aria-current="true"]')).toHaveAttribute("href", "#plan");
  });

  test("landing snapping belongs to the landing only: y mandatory here, none on the worker screen", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe("y mandatory");
    await page.goto("/en/worker");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe("none");
  });

  test("landing axe: no violations at the top and at the evidence slides", async ({ page }) => {
    await open(page);
    await live(page);
    expect(await axeViolations(page)).toEqual([]);
    await scrollTo(page, await topOf(page, "checks"));
    expect(await axeViolations(page)).toEqual([]);
  });

  test("landing in Urdu is right to left: the rail on the right edge, the hero translated, the scene text on the start side", async ({ page }) => {
    await open(page, WIDE, "/ur");
    expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ur.judge.landing.title);
    const rail = await page.locator("nav.rail").boundingBox();
    expect(rail?.x ?? 0).toBeGreaterThan(WIDE.width / 2);
    const txt = await page.locator("#forecast .txt").boundingBox();
    expect(txt?.x ?? 0).toBeGreaterThan(WIDE.width / 2 - 100);
    await live(page);
  });

  test("landing falls back to a plain column with the still image when WebGL is missing", async ({ page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    });
    await open(page);
    await expect(page.locator("#forecast")).toHaveAttribute("data-scene", "poster", { timeout: 30_000 });
    expect(await page.locator("#forecast .stage").evaluate((el) => getComputedStyle(el).position)).toBe("static");
    await expect(page.locator("#forecast img.poster")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test("landing in reduced motion is a plain column too: no pin, the still image, no snapping", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await expect(page.locator("#forecast")).toHaveAttribute("data-scene", "poster", { timeout: 30_000 });
    expect(await page.locator("#forecast .stage").evaluate((el) => getComputedStyle(el).position)).toBe("static");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe("none");
  });
});

for (const [width, height] of [
  [320, 700],
  [390, 844],
  [768, 1024],
] as const) {
  test(`landing is a plain column at ${String(width)} px: no sideways overflow, nothing pinned, every chapter reachable`, async ({ page }) => {
    await open(page, { width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await page.locator("#forecast .stage").evaluate((el) => getComputedStyle(el).position)).toBe("static");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe("none");
    for (const id of SLIDES) await expect(page.locator(`section#${id}`)).toBeAttached();
    expect(await page.locator(".idx a").count()).toBe(7);
  });
}
