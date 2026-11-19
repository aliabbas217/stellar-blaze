import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import bn from "../../messages/bn.json";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import ne from "../../messages/ne.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";

/*
 * The draft-translation notice (F2 Task 22, architect ruling 2026-11-15): no banner and no badge on the main screens. Every non-English
 * locale shows ONE quiet line, "Machine translation, not yet reviewed by a native speaker", in the language of the page, on three
 * surfaces: the worker's Alerts page (the privacy area: it holds "Remove my data"), the foot of the supervisor screens, and the foot of
 * the landing page (since redesign S10 the landing's line sits in the chapter rail, the landing's own navigation, not at its foot: the rail is one fixed
 * column on a wide screen and a strip at the top of a phone). English shows it nowhere. The main screens (Today, the alert card, the unwell sheet) never show it.
 * Every title contains "machine translation", so `pnpm e2e -g "machine translation"` selects them.
 */

const CATALOGUE = { ar, bn, hi, ne, ur } as const;
const LOCALES = ["ar", "ur", "hi", "bn", "ne"] as const;
// The Alerts page is short: its line is the last thing in the page's content (below it) and may sit inside the first fold. The supervisor
// screens and the landing page are taller than the fold: there the line must be below it.
const PLACED = [
  { surface: "/worker/alerts", lastInMain: true },
  { surface: "/supervisor", lastInMain: false },
  { surface: "/supervisor/crews/crew-b", lastInMain: false },
  { surface: "", lastInMain: false, inRail: true },
] as const;
const MAIN_SCREENS = [`/worker?site=${SITE_DEMO}&crew=crew-b`, `/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${encodeURIComponent("2026-09-03T06:00:00Z")}`, "/worker/unwell", "/replay", "/replay/day"] as const;

async function lines(page: Page, path: string): Promise<{ count: number; text: string | null; lang: string | null; dir: string | null; belowFold: boolean | null; lastInMain: boolean | null; inRail: boolean | null }> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  return page.evaluate(() => {
    const found = document.querySelectorAll("[data-machine-translation]");
    const first = found[0];
    const rect = first?.getBoundingClientRect();
    return {
      count: found.length,
      text: first?.textContent ?? null,
      lang: first?.getAttribute("lang") ?? null,
      dir: first?.getAttribute("dir") ?? null,
      belowFold: rect === undefined ? null : rect.top + window.scrollY > window.innerHeight,
      lastInMain: first === undefined ? null : first.closest("main")?.lastElementChild === first,
      inRail: first === undefined ? null : first.closest("nav.rail") !== null,
    };
  });
}

test.describe("machine translation line", () => {
  for (const locale of LOCALES) {
    test(`machine translation: ${locale} shows the line once on each placed surface, below the fold, in its own language`, async ({ page }) => {
      for (const placed of PLACED) {
        const { surface, lastInMain } = placed;
        const found = await lines(page, `/${locale}${surface}`);
        expect(found.count, `${locale}${surface}`).toBe(1);
        expect(found.text, `${locale}${surface}`).toBe(CATALOGUE[locale].shell.machineTranslation);
        expect(found.lang, `${locale}${surface}`).toBe(locale);
        expect(found.dir, `${locale}${surface}`).toBe(locale === "ar" || locale === "ur" ? "rtl" : "ltr");
        if ("inRail" in placed) expect(found.inRail, `${locale}${surface}: in the landing's chapter rail`).toBe(true);
        else if (lastInMain) expect(found.lastInMain, `${locale}${surface}: the last thing in the page content`).toBe(true);
        else expect(found.belowFold, `${locale}${surface}: never above the fold`).toBe(true);
      }
    });

    test(`machine translation: ${locale} the Alerts line scrolls clear of the worker dock (fix round 1: it used to be reachable only by guesswork)`, async ({ page }) => {
      await lines(page, `/${locale}/worker/alerts`);
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      const placement = await page.evaluate(() => {
        const line = document.querySelector("[data-machine-translation]")?.getBoundingClientRect();
        const dock = document.querySelector("[data-emergency]")?.getBoundingClientRect();
        return { lineBottom: line?.bottom ?? null, lineTop: line?.top ?? null, dockTop: dock?.top ?? null, viewport: window.innerHeight };
      });
      expect(placement.dockTop, `${locale}: the worker dock is on the page`).not.toBeNull();
      expect(placement.lineBottom, `${locale}: the line is on the page`).not.toBeNull();
      expect(placement.lineTop ?? -1, `${locale}: the line is inside the viewport at the end of the page`).toBeGreaterThanOrEqual(0);
      expect(placement.lineBottom ?? Infinity, `${locale}: the line ends above the dock (not hidden under it)`).toBeLessThanOrEqual((placement.dockTop ?? 0) + 0.5);
    });

    test(`machine translation: ${locale} never shows it on the main screens`, async ({ page }) => {
      for (const screen of MAIN_SCREENS) {
        const found = await lines(page, `/${locale}${screen}`);
        expect(found.count, `${locale}${screen}`).toBe(0);
      }
    });
  }

  test("machine translation: English shows nothing anywhere", async ({ page }) => {
    for (const surface of [...PLACED.map((placed) => placed.surface), ...MAIN_SCREENS]) {
      const found = await lines(page, `/en${surface}`);
      expect(found.count, `en${surface}`).toBe(0);
    }
    expect(en.shell.machineTranslation).toBe("Machine translation, not yet reviewed by a native speaker");
  });
});
