import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { THEME_COLORS } from "../../src/lib/sun/theme-colors.ts";

/*
 * The shells and the locale root (F2 Task 3), against a production build (see playwright.config.ts).
 */

/**
 * Every `<meta name="theme-color">` says `content`. There are two in a production document (the layout's own, and the copy React
 * hoists into <head>), so the count is not asserted as 1: what matters is that no meta disagrees, because the browser chrome
 * follows whichever one it reads (route-theme.ts moves all of them), and that there is at least one.
 */
async function expectThemeColor(page: Page, content: string): Promise<void> {
  const metas = page.locator('meta[name="theme-color"]');
  await expect.poll(() => metas.count()).toBeGreaterThan(0);
  await expect
    .poll(() => metas.evaluateAll((nodes, expected) => nodes.every((node) => node.getAttribute("content") === expected), content), {
      message: `every theme-color meta says ${content}`,
    })
    .toBe(true);
}

test("root redirects to /en without Accept-Language, and with one", async ({ request }) => {
  // `localeDetection: false`: the URL prefix alone picks the language, so `/` is the same 307 for every visitor.
  for (const headers of [{}, { "accept-language": "ar" }, { "accept-language": "ur-PK,ur;q=0.9" }]) {
    const response = await request.get("/", { maxRedirects: 0, headers });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers()["location"] ?? "", "http://x").pathname).toBe("/en");
  }
});

test.describe("the field shell on /en/worker", () => {
  test("shows the header with one language pill, the unwell link and the tabs, in sun mode", async ({ page }) => {
    await page.goto("/en/worker");

    const header = page.getByRole("banner");
    await expect(header.getByRole("button", { name: /Settings/ })).toContainText("English");
    await expect(header.getByRole("button", { name: /Sun mode/ })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: en.shell.language })).toHaveCount(0);
    await expect(page.getByRole("link", { name: new RegExp(en.worker.nav.unwell) })).toHaveAttribute("href", "/en/worker/unwell");
    await expect(page.locator("[data-emergency]")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: en.worker.nav.label }).getByRole("link", { name: en.worker.nav.today })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Replay is the default mode, and replay is daytime by construction: sun mode, and the browser chrome follows it.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sun");
    await expectThemeColor(page, THEME_COLORS.sun);
  });

  test("Screen colors in the settings sheet starts on Automatic (the theme the inline script set) and Night is one tap", async ({ page }) => {
    await page.goto("/en/worker");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sun");
    await page.getByRole("banner").getByRole("button", { name: /Settings/ }).click();
    const sheet = page.getByRole("dialog", { name: en.shell.settings.title });
    await expect(sheet.getByRole("button", { name: en.shell.settings.colors.auto })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: en.shell.settings.colors.night }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "sun");
    await expectThemeColor(page, THEME_COLORS.night);
  });

  test("the unwell link is on every worker page", async ({ page }) => {
    for (const path of ["/en/worker", "/en/worker/alerts"]) {
      await page.goto(path);
      await expect(page.locator("[data-emergency]")).toBeVisible();
    }
  });

  test("a client navigation from the landing page applies sun mode, and the way back removes it", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "sun");

    await page.getByRole("link", { name: en.shell.roleChooser.worker.title }).click();
    await expect(page).toHaveURL(/\/en\/worker$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sun");
    await expectThemeColor(page, THEME_COLORS.sun);

    await page.goBack();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "sun");
    await expectThemeColor(page, THEME_COLORS.night);
  });

  test("the settings sheet switches language as a new document and keeps the query string", async ({ page }) => {
    await page.goto("/en/worker?demo=replay");
    await page.getByRole("banner").getByRole("button", { name: /Settings/ }).click();
    await page.getByRole("dialog", { name: en.shell.settings.title }).getByRole("link", { name: "العربية" }).click();
    await expect(page).toHaveURL(/\/ar\/worker\?demo=replay$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
