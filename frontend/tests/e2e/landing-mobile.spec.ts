import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { axeViolations } from "./axe.ts";

/*
 * The landing on a phone (redesign S14, ADR 0090 amendment of 2026-11-20): measured in a real browser at the two phone sizes the owner QA uses
 * (390 x 844 and 360 x 740), in English and in Arabic (right to left). The first screen is the sale, not navigation: a bar of at most 56 px, the
 * headline, the promise, the two actions inside the first viewport, and the map peeking in under them; nothing runs sideways at any point down the
 * page; the chapters open from one menu button that a keyboard and a screen reader can use, with the language picker labelled and reachable; and the
 * fixed bar never covers the top of a chapter the menu or an anchor goes to. Every title contains "landing", so `pnpm e2e -g landing` selects them.
 */

const BAR_BUDGET = 56;
const SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
] as const;
const LOCALES = [
  { code: "en", title: en.judge.landing.title, primary: en.judge.landing.hero.primary, skip: en.judge.landing.hero.skip, language: en.shell.language },
  { code: "ar", title: ar.judge.landing.title, primary: ar.judge.landing.hero.primary, skip: ar.judge.landing.hero.skip, language: ar.shell.language },
] as const;
const SLIDES = ["morning", "plan", "boundary", "evidence", "checks", "ways", "limits"] as const;

async function open(page: Page, width: number, height: number, code: string): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`/${code}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const sideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const { code, title, primary, skip, language } of LOCALES) {
  for (const { width, height } of SIZES) {
    const at = `${code} ${String(width)}x${String(height)}`;

    test(`landing phone first screen ${at}: the headline, the promise and both actions are inside the first viewport, the map peeks in, nothing runs sideways`, async ({ page }) => {
      await open(page, width, height, code);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      const boxes = await page.evaluate(() => {
        const rect = (sel: string): { top: number; bottom: number } => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return { top: r?.top ?? -1, bottom: r?.bottom ?? -1 };
        };
        return { h1: rect("#h1"), lede: rect("#forecast .lede"), primary: rect("#forecast a.btn"), skip: rect("#forecast a.quiet"), map: rect("#forecast .mapwrap"), viewport: window.innerHeight };
      });
      for (const key of ["h1", "lede", "primary", "skip"] as const) expect(boxes[key].bottom, `${key} ends inside the first viewport`).toBeLessThanOrEqual(boxes.viewport);
      expect(boxes.h1.top, "the headline is not pushed down by chrome").toBeLessThan(boxes.viewport * 0.4);
      expect(boxes.map.top, "the map starts inside the first viewport").toBeLessThan(boxes.viewport - 120);
      expect(boxes.map.bottom - boxes.map.top, "the map has a real height").toBeGreaterThan(180);
      await expect(page.getByRole("link", { name: primary })).toBeVisible();
      await expect(page.getByRole("link", { name: skip })).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });

    test(`landing phone header ${at}: one bar of at most ${String(BAR_BUDGET)} px that stays at the top, with the language picker named and 44 px high`, async ({ page }) => {
      await open(page, width, height, code);
      const bar = page.locator("nav.rail .bar");
      const first = await bar.boundingBox();
      expect(first?.height ?? 999).toBeLessThanOrEqual(BAR_BUDGET);
      expect(first?.y ?? 99).toBe(0);
      await page.evaluate(() => {
        window.scrollTo(0, 2000);
      });
      await page.waitForTimeout(300);
      const later = await bar.boundingBox();
      expect(later?.y ?? 99, "the bar is fixed").toBe(0);
      const select = page.locator("nav.rail").getByLabel(language, { exact: true });
      await expect(select).toBeVisible();
      expect((await select.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((await page.locator(".menu").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    });

    test(`landing phone ${at}: no sideways overflow at any chapter`, async ({ page }) => {
      await open(page, width, height, code);
      for (const id of SLIDES) {
        await page.locator(`section#${id}`).scrollIntoViewIfNeeded();
        expect(await sideways(page), `${id} sideways`).toBeLessThanOrEqual(0);
      }
    });
  }
}

test("landing phone menu: a button names the chapter in view, opens the seven chapters, works from the keyboard and lands a chapter below the bar", async ({ page }) => {
  await open(page, 390, 844, "en");
  const menu = page.getByRole("button", { name: /^Chapters/ });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toHaveAccessibleName("Chapters: Forecast");
  await expect(page.locator(".idx a").first()).toBeHidden();

  // keyboard: Enter opens, the first link is next in the tab order, Escape closes and gives the focus back
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const links = page.locator(".idx a");
  await expect(links).toHaveCount(7);
  await expect(links.first()).toBeVisible();
  for (const link of await links.all()) expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();

  // a chosen chapter closes the sheet, scrolls to it, and the fixed bar does not cover its top
  await menu.click();
  await page.getByRole("link", { name: /Boundary/ }).click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/#boundary$/);
  await page.waitForTimeout(600);
  const top = await page.evaluate(() => document.getElementById("boundary")?.getBoundingClientRect().top ?? -1);
  expect(top, "the chapter starts at or below the bar").toBeGreaterThanOrEqual(BAR_BUDGET - 1);
  expect(top, "and not far below it").toBeLessThan(BAR_BUDGET + 40);
  await expect(menu).toHaveAccessibleName("Chapters: Boundary");
});

test("landing phone menu in Arabic is mirrored: the brand on the right, the language picker on the left, the chevrons of the doors point left", async ({ page }) => {
  await open(page, 390, 844, "ar");
  expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
  const mark = await page.locator("nav.rail .mark").boundingBox();
  const select = await page.locator("nav.rail").getByLabel(ar.shell.language, { exact: true }).boundingBox();
  expect(mark?.x ?? 0, "the brand is on the right half").toBeGreaterThan(390 / 2);
  expect(select?.x ?? 999, "the picker is on the left half").toBeLessThan(390 / 2);
  await page.locator("#ways").scrollIntoViewIfNeeded();
  const chevron = await page.locator("#ways .door a").first().evaluate((el) => getComputedStyle(el, "::after").transform);
  // rotate(-45deg) as a matrix: a = cos 45 > 0, b = sin(-45) < 0
  const [a, b] = chevron.replace(/matrix\(|\)/g, "").split(",").map(Number);
  expect(a ?? 0).toBeCloseTo(Math.SQRT1_2, 2);
  expect(b ?? 0).toBeLessThan(0);
});

test("landing phone axe: the bar, the open menu and the first screen have no violations in English and Arabic", async ({ page }) => {
  for (const code of ["en", "ar"] as const) {
    await open(page, 390, 844, code);
    expect(await axeViolations(page), `${code} closed`).toEqual([]);
    await page.locator(".menu").click();
    expect(await axeViolations(page), `${code} open`).toEqual([]);
  }
});
