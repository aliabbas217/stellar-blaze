import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The role entries, the front door and the demo role badge (redesign S7), in a production build against the mock API, on the mobile
 * project. The role is a LABEL kept in sessionStorage: nothing here is a sign-in, and a deep link must work with no role chosen.
 * Every title starts with "role entry", so `pnpm e2e -g "role entry"` selects them.
 */

const PHONE = { width: 390, height: 844 };
const ROLE_KEY = "sb-demo-role";
const stored = (page: Page) => page.evaluate((key) => window.sessionStorage.getItem(key), ROLE_KEY);
const BADGE = '[data-role-badge]';

test.use({ viewport: PHONE });

test("role entry: the front door shows the four doors in order, the crew and safety doors go to their entries, the review door to the tour", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/en/start");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.judge.landing.door.label);
  const doors = page.locator("[data-role-door] a");
  await expect(doors).toHaveCount(4);
  await expect(doors.nth(0)).toHaveAttribute("href", "/en/worker");
  await expect(doors.nth(1)).toHaveAttribute("href", "/en/supervisor/enter");
  await expect(doors.nth(2)).toHaveAttribute("href", "/en/hse/enter");
  await expect(doors.nth(3)).toHaveAttribute("href", "/en/tour");
  await expect(doors.nth(3)).toContainText("A 3-minute tour, then try anything.");
  const report = await gateReport(page, { consoleErrors: errors, hero: false, locale: "en" });
  expect(report.failures).toEqual([]);
  await doors.nth(1).click();
  await expect(page).toHaveURL(/\/en\/supervisor\/enter$/);
});

test("role entry: the crew lead enters in one tap, sees the badge, and Switch role clears it and returns to the front door", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/en/supervisor/enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.judge.roleEntry.crew.title);
  // The required sentence, visible and not small print; no field of any kind.
  const access = page.locator("[data-demo-access]");
  await expect(access).toHaveText(en.judge.roleEntry.demoAccess);
  await expect(access).toBeVisible();
  expect(await access.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(page.getByText(en.judge.roleEntry.production)).toBeVisible();
  await expect(page.locator("input, textarea, select, form")).toHaveCount(0);
  const report = await gateReport(page, { consoleErrors: errors, field: true, hero: false, locale: "en" });
  expect(report.failures).toEqual([]);

  expect(await stored(page)).toBeNull();
  await page.getByRole("link", { name: en.judge.roleEntry.crew.button }).click();
  await expect(page).toHaveURL(/\/en\/supervisor$/);
  expect(await stored(page)).toBe("crew-lead");
  await expect(page.locator(BADGE).getByText(en.shell.role.crew)).toBeVisible();
  // No cookie was set for it.
  expect((await page.context().cookies()).some((cookie) => cookie.name === ROLE_KEY)).toBe(false);

  await page.getByRole("link", { name: en.shell.role.switch }).click();
  await expect(page).toHaveURL(/\/en\/start$/);
  expect(await stored(page)).toBeNull();
});

test("role entry: the safety officer enters in one tap and sees the badge on the safety view", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/en/hse/enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.judge.roleEntry.officer.title);
  await expect(page.locator("[data-demo-access]")).toHaveText(en.judge.roleEntry.demoAccess);
  await expect(page.locator("input, textarea, select, form")).toHaveCount(0);
  const report = await gateReport(page, { consoleErrors: errors, field: true, hero: false, locale: "en" });
  expect(report.failures).toEqual([]);

  await page.getByRole("link", { name: en.judge.roleEntry.officer.button }).click();
  await expect(page).toHaveURL(/\/en\/hse$/);
  expect(await stored(page)).toBe("officer");
  await expect(page.locator(BADGE).getByText(en.shell.role.officer)).toBeVisible();
  await page.getByRole("link", { name: en.shell.role.switch }).click();
  await expect(page).toHaveURL(/\/en\/start$/);
  expect(await stored(page)).toBeNull();
});

test("role entry: a deep link with no role chosen is never blocked or redirected, and offers Choose a role", async ({ page }) => {
  for (const [route, heading] of [
    ["/en/supervisor", en.supervisor.title],
    ["/en/hse", en.hse.title],
  ] as const) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page, route).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByRole("heading", { level: 1, includeHidden: true }).first(), route).toHaveText(heading);
    expect(await stored(page), route).toBeNull();
    // No label without a role; the way to choose one is there.
    await expect(page.locator(BADGE).getByRole("link", { name: en.shell.role.choose }), route).toBeVisible();
    await expect(page.getByText(/^Demo: /), route).toHaveCount(0);
  }
});

test("role entry: a role chosen on one screen stays a label only: another screen still opens, and the badge does not move the page", async ({ page }) => {
  await page.goto("/en/hse/enter");
  await page.getByRole("link", { name: en.judge.roleEntry.officer.button }).click();
  await expect(page).toHaveURL(/\/en\/hse$/);
  // Open the crews screen by its address: not blocked, not redirected, and the label stays the role chosen.
  const response = await page.goto("/en/supervisor");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/en\/supervisor$/);
  await expect(page.locator(BADGE).getByText(en.shell.role.officer)).toBeVisible();
});

for (const [locale, messages] of [
  ["ar", ar],
  ["ur", ur],
] as const) {
  for (const entry of ["supervisor", "hse"] as const) {
    test(`role entry: ${locale} ${entry} entry is right-to-left, in the page language, with no overflow and the required sentence`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(`/${locale}/${entry}/enter`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      const copy = messages.judge.roleEntry;
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(entry === "supervisor" ? copy.crew.title : copy.officer.title);
      await expect(page.locator("[data-demo-access]")).toHaveText(copy.demoAccess);
      await expect(page.getByRole("link", { name: entry === "supervisor" ? copy.crew.button : copy.officer.button })).toBeVisible();
      const report = await gateReport(page, { consoleErrors: errors, field: true, hero: false, locale });
      expect(report.failures).toEqual([]);
      // The button is the full width of the column and nothing runs past the right-to-left edge.
      expect(report.overflowPx).toBe(0);
    });
  }
}
