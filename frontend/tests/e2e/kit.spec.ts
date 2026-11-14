import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "./axe.ts";

/*
 * The component kit page (/en/dev/kit): every shared component in every state, checked in both themes. The page is a
 * dev page that a production build serves only with SB_SPECIMEN=1, which playwright.config.ts sets for the web server.
 * The pixel baselines are Task 26's (the pinned Linux container); this file asserts what a browser can prove on any
 * host: axe, no overflow, no console error, and that a skeleton reserves the height of the element it stands in for.
 */

const THEMES = ["night", "sun"] as const;
type Theme = (typeof THEMES)[number];

async function openKit(page: Page, theme: Theme, path = "/en/dev/kit"): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Component kit");
  // The same attribute SunToggle sets; tokens.css re-declares every color under it.
  await page.evaluate((name) => {
    if (name === "sun") document.documentElement.dataset["theme"] = "sun";
    else delete document.documentElement.dataset["theme"];
  }, theme);
  return errors;
}

for (const theme of THEMES) {
  test.describe(`kit, ${theme}`, () => {
    test(`kit states have no axe violation (${theme})`, async ({ page }) => {
      const errors = await openKit(page, theme);
      expect(await axeViolations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`kit has no horizontal overflow (${theme})`, async ({ page }) => {
      await openKit(page, theme);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test(`the level sign skeleton is as tall as the sign (${theme})`, async ({ page }) => {
      await openKit(page, theme);
      for (const size of ["hero", "mini"] as const) {
        const sign = await page.locator(`[data-testid="sign-${size}"] [data-level-sign]`).boundingBox();
        const skeleton = await page.locator(`[data-testid="skeleton-${size}"] [data-skeleton]`).boundingBox();
        expect(sign, `${size} sign`).not.toBeNull();
        expect(skeleton, `${size} skeleton`).not.toBeNull();
        // Equal to within a sub-pixel: the skeleton is what the sign replaces, so any difference is layout shift.
        expect(Math.abs((sign?.height ?? 0) - (skeleton?.height ?? 0)), `${size} height`).toBeLessThan(1);
      }
    });
  });
}

test("a stale level is dashed and a live one is solid in the browser, in both themes", async ({ page }) => {
  for (const theme of THEMES) {
    await openKit(page, theme);
    const styles = await page.evaluate(() => {
      const bar = (selector: string) => {
        const el = document.querySelector<HTMLElement>(`${selector} [data-current] [data-bar]`);
        if (el === null) return null;
        const style = getComputedStyle(el);
        return { borderStyle: style.borderTopStyle, backgroundImage: style.backgroundImage };
      };
      return {
        stale: bar('[data-level-sign][data-kind="stale"][data-size="hero"]'),
        live: bar('[data-level-sign][data-kind="live"][data-size="hero"]'),
      };
    });
    expect(styles.stale, theme).toEqual({ borderStyle: "dashed", backgroundImage: "none" });
    expect(styles.live?.borderStyle, theme).toBe("none");
    expect(styles.live?.backgroundImage, theme).toBe("none");
  }
});
