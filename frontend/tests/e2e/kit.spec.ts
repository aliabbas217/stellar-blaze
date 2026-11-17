import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "./axe.ts";

/*
 * The component kit page (/<locale>/dev/kit): every shared component in every state, checked in both themes and in the
 * three line-height families (en solid, ar 1.8, ur 2.5). The page is a dev page that a production build serves only with
 * SB_SPECIMEN=1, which playwright.config.ts sets for the web server.
 * The pixel baselines are Task 26's (the pinned Linux container); this file asserts what a browser can prove on any
 * host: axe, no overflow, no console error, and that a skeleton reserves the height of the element it stands in for.
 * Every test title contains "kit", so `pnpm e2e -g kit` selects all of them.
 */

const THEMES = ["night", "sun"] as const;
type Theme = (typeof THEMES)[number];

// The other catalogues carry the English kit copy for now (Task 22 translates), so the heading is the same in each.
const LOCALES = ["en", "ar", "ur"] as const;
type Locale = (typeof LOCALES)[number];

async function openKit(page: Page, theme: Theme, locale: Locale = "en"): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/${locale}/dev/kit`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Component kit");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  // The same attribute SunToggle sets; tokens.css re-declares every color under it.
  await page.evaluate((name) => {
    if (name === "sun") document.documentElement.dataset["theme"] = "sun";
    else delete document.documentElement.dataset["theme"];
  }, theme);
  // Fonts change line boxes: measure only after they are in.
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

for (const theme of THEMES) {
  test.describe(`kit, ${theme}`, () => {
    for (const locale of LOCALES) {
      test(`kit states have no axe violation (${theme}, ${locale})`, async ({ page }) => {
        const errors = await openKit(page, theme, locale);
        expect(await axeViolations(page)).toEqual([]);
        expect(errors).toEqual([]);
      });

      test(`kit has no horizontal overflow (${theme}, ${locale})`, async ({ page }) => {
        await openKit(page, theme, locale);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });

      // The gate for the skeleton: equal rendered boxes, so swapping the skeleton for the sign shifts nothing.
      test(`kit level sign skeleton is as tall as the sign (${theme}, ${locale})`, async ({ page }) => {
        await openKit(page, theme, locale);
        for (const size of ["hero", "mini"] as const) {
          const sign = await page.locator(`[data-testid="sign-${size}"] [data-level-sign]`).boundingBox();
          const skeleton = await page.locator(`[data-testid="skeleton-${size}"] [data-skeleton]`).boundingBox();
          expect(sign, `${size} sign`).not.toBeNull();
          expect(skeleton, `${size} skeleton`).not.toBeNull();
          // Equal to within a sub-pixel: any difference is layout shift.
          expect(Math.abs((sign?.height ?? 0) - (skeleton?.height ?? 0)), `${size} height in ${locale}`).toBeLessThan(1);
        }
      });
    }
  });
}

test("kit stale level is dashed and a live one is solid in the browser, in both themes", async ({ page }) => {
  for (const theme of THEMES) {
    await openKit(page, theme);
    const styles = await page.evaluate(() => {
      const bar = (selector: string) => {
        const el = document.querySelector<HTMLElement>(`${selector} [data-current] [data-bar]`);
        if (el === null) return null;
        const style = getComputedStyle(el);
        return { borderStyle: style.borderTopStyle, borderWidth: style.borderTopWidth, backgroundImage: style.backgroundImage };
      };
      return {
        stale: bar('[data-level-sign][data-kind="stale"][data-size="hero"]'),
        live: bar('[data-level-sign][data-kind="live"][data-size="hero"]'),
      };
    });
    expect(styles.stale, theme).toEqual({ borderStyle: "dashed", borderWidth: "2px", backgroundImage: "none" });
    // Preflight gives every element `border-style: solid` at width 0, so a live marker has no border, not no border style.
    expect(styles.live?.borderWidth, theme).toBe("0px");
    expect(styles.live?.backgroundImage, theme).toBe("none");
  }
});
