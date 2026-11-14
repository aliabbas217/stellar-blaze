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
  test("shows the header, the six language chips, the unwell link and the tabs, in sun mode", async ({ page }) => {
    await page.goto("/en/worker");

    const header = page.getByRole("banner");
    await expect(header.getByRole("button", { name: /Sun mode/ })).toBeVisible();
    await expect(page.getByRole("navigation", { name: en.shell.language }).getByRole("link")).toHaveCount(6);
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

  test("the sun toggle reads the theme the inline script set, and flips it with one tap", async ({ page }) => {
    await page.goto("/en/worker");
    const toggle = page.getByRole("banner").getByRole("button", { name: /Sun mode/ });
    // Hydrated, not just server-rendered: the server's "off" must have been replaced by what <html data-theme> says.
    await expect(toggle).toHaveText("Sun mode: on");
    await toggle.click();
    await expect(toggle).toHaveText("Sun mode: off");
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

  test("the chips switch language as a new document and keep the query string", async ({ page }) => {
    await page.goto("/en/worker?demo=replay");
    await page.getByRole("link", { name: "العربية" }).click();
    await expect(page).toHaveURL(/\/ar\/worker\?demo=replay$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
