import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The worker's way in (redesign S6a) in a production build against the mock API. Every title contains "join", so `pnpm e2e -g join`
 * selects them. A worker has no account: the phone remembers which site and crew it is pinned to, and the page that pins it is
 * `/<locale>/worker/join`, reached from a crew's link or QR code (`?s=&c=`), from the picker (no code), or from Today when the phone has
 * no site. These cases drive it the way a worker does: the link, the picker, a wrong or garbled code, no connection, and Urdu at 320 px.
 *
 * What the page must not do is asserted as hard as what it does: nothing is pinned until the tap, and what is on the phone afterwards is the
 * site and the crew and nothing else (no profile, no push registration, nothing sent).
 */

const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 320, height: 640 };
const STORAGE_KEY = "sb-profile-v1";

type Locale = "en" | "ur";

async function openJoin(page: Page, query = "", { locale = "en", viewport = PHONE, theme = "sun" }: { locale?: Locale; viewport?: { width: number; height: number }; theme?: "sun" | "night" } = {}): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(viewport);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  await page.goto(`/${locale}/worker/join${query}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  return errors;
}

/** What the phone holds under the profile store's key: the pin, and whatever else is there. */
async function stored(page: Page): Promise<{ state: { site: { siteId: string; crewId: string | null } | null; profile: unknown; push: unknown } } | null> {
  return JSON.parse((await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)) ?? "null") as never;
}

test("a crew link shows the site and the crew, pins nothing until Yes, then opens Today for that crew (join)", async ({ page }) => {
  await openJoin(page, `?s=${SITE_DEMO}&c=crew-c`);
  await expect(page.getByRole("heading", { level: 1, name: en.worker.join.confirmTitle })).toBeVisible();
  const card = page.locator("[data-join-card]");
  await expect(card).toContainText("Mussafah M-14 yard");
  await expect(card).toContainText(en.shell.field.demo);
  await expect(card).toContainText("Crew C");
  await expect(card).toContainText("Formwork");
  await expect(page.getByText(en.worker.join.note)).toBeVisible();
  expect(await stored(page), "nothing is pinned by opening a link").toBeNull();
  await expect(page.locator("[data-primary]")).toHaveCount(1);

  // The only request a tap on Yes makes is a read: nothing about the worker is sent.
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.getByRole("button", { name: en.worker.join.confirm }).click();
  await expect(page).toHaveURL(/\/en\/worker$/);
  await expect(page.getByRole("banner")).toContainText("Mussafah");
  await expect(page.getByRole("banner")).toContainText("Crew C");
  const kept = await stored(page);
  expect(kept?.state.site).toMatchObject({ siteId: SITE_DEMO, crewId: "crew-c" });
  expect(kept?.state.profile ?? null, "no profile was made").toBeNull();
  expect(kept?.state.push ?? null, "no push registration was made").toBeNull();
  expect(writes).toEqual([]);

  // The pin survives a reload: Today again, for the same crew, with no link.
  await page.reload();
  await expect(page.getByRole("banner")).toContainText("Crew C");
});

test("with no code the picker lists the workplaces (and says only the demo yard is listed), then the crews, then the same confirm card (join)", async ({ page }) => {
  await openJoin(page);
  await expect(page.getByRole("heading", { level: 1, name: en.worker.join.pageTitle })).toBeVisible();
  await expect(page.getByText(en.worker.join.demoOnly)).toBeVisible();
  await page.getByRole("link", { name: /Mussafah M-14 yard/ }).click();
  await expect(page).toHaveURL(new RegExp(`/en/worker/join\\?s=${SITE_DEMO}$`));
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(en.worker.join.crews) })).toBeVisible();
  await expect(page.getByText(en.worker.join.crewMissing)).toBeVisible();
  await page.getByRole("link", { name: /Crew A/ }).click();
  await expect(page).toHaveURL(new RegExp(`/en/worker/join\\?s=${SITE_DEMO}&c=crew-a$`));
  await expect(page.getByRole("heading", { level: 1, name: en.worker.join.confirmTitle })).toBeVisible();
  await expect(page.locator("[data-join-card]")).toContainText("Rebar fixing");

  // "No, choose another" goes back to the picker, and Back still works from it.
  await page.getByRole("link", { name: en.worker.join.other }).click();
  await expect(page.getByRole("heading", { level: 1, name: en.worker.join.pageTitle })).toBeVisible();
  expect(await stored(page), "choosing another pinned nothing").toBeNull();
});

test("'Just looking? Try the demo yard' opens Today on the demo site with its scored crew (join)", async ({ page }) => {
  await openJoin(page);
  await page.getByRole("button", { name: en.worker.join.demo }).click();
  await expect(page).toHaveURL(/\/en\/worker$/);
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Crew B");
});

test("a crew that is not at that site says so with the site's name, lists that site's crews, and pins nothing (join)", async ({ page }) => {
  await openJoin(page, `?s=${SITE_DEMO}&c=crew-zzz`);
  await expect(page.getByText(en.worker.join.unknownCrew.replace("{site}", "Mussafah M-14 yard"))).toBeVisible();
  await expect(page.getByRole("button", { name: en.worker.join.confirm })).toHaveCount(0);
  await expect(page.locator("main a[href*='c=crew-']")).toHaveCount(4);
  expect(await stored(page)).toBeNull();
});

test("a site the API does not have says so and offers the workplaces (join)", async ({ page }) => {
  await openJoin(page, "?s=site-gone&c=crew-a");
  await expect(page.getByText(en.worker.join.unknownSite)).toBeVisible();
  await expect(page.getByRole("link", { name: /Mussafah M-14 yard/ })).toBeVisible();
  await expect(page.getByRole("button", { name: en.worker.join.confirm })).toHaveCount(0);
});

test("an expired or garbled code says it did not work and shows the picker, and reads no crew for it (join)", async ({ page }) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) paths.push(new URL(request.url()).pathname);
  });
  await openJoin(page, "?s=%3Cscript%3E&c=..%2F..%2Fadmin");
  await expect(page.getByText(en.worker.join.badCode)).toBeVisible();
  await expect(page.getByRole("link", { name: /Mussafah M-14 yard/ })).toBeVisible();
  expect(paths.filter((path) => path !== "/api/v1/sites")).toEqual([]);
});

test("with the API offline the join page says so, offers a retry, and the card appears when it is back (join)", async ({ page }) => {
  await page.route("**/api/v1/sites", (route) => route.abort("connectionrefused"));
  const errors = watchConsole(page);
  await page.setViewportSize(PHONE);
  await page.goto(`/en/worker/join?s=${SITE_DEMO}&c=crew-b`);
  await expect(page.getByText(en.states.error.title)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: en.worker.join.confirm })).toHaveCount(0);
  expect(await stored(page), "a crew nobody confirmed is not pinned").toBeNull();

  await page.unroute("**/api/v1/sites");
  await page.getByRole("button", { name: en.states.retry }).click();
  await expect(page.getByRole("button", { name: en.worker.join.confirm })).toBeVisible();
  // The failed reads are the state under test, not a defect of the page.
  expect(errors.filter((message) => !/api\/v1\/sites|Failed to load resource|ERR_/.test(message))).toEqual([]);
});

test("the header's language pill is on the join page and keeps the code when the language changes (join)", async ({ page }) => {
  await openJoin(page, `?s=${SITE_DEMO}&c=crew-c`);
  await expect(page.getByRole("button", { name: en.worker.join.confirm })).toBeVisible();
  // No dock here: a phone with no crew has no Today, Alerts or unwell tab to go to.
  await expect(page.locator("[data-emergency]")).toHaveCount(0);
  await page.getByRole("banner").getByRole("button", { name: /Settings/ }).click();
  const sheet = page.getByRole("dialog", { name: en.shell.settings.title });
  await expect(sheet.getByRole("link")).toHaveCount(6);
  await expect(sheet.getByRole("link", { name: en.shell.settings.changeCrew })).toHaveCount(0);
  await sheet.getByRole("link", { name: "اردو" }).click();
  await expect(page).toHaveURL(new RegExp(`/ur/worker/join\\?s=${SITE_DEMO}&c=crew-c$`));
  await expect(page.getByRole("button", { name: ur.worker.join.confirm })).toBeVisible();
});

test("in Urdu at 320 px the join page reads right to left and nothing overflows (join)", async ({ page }) => {
  await openJoin(page, `?s=${SITE_DEMO}&c=crew-c`, { locale: "ur", viewport: SMALL_PHONE });
  await expect(page.getByRole("button", { name: ur.worker.join.confirm })).toBeVisible();
  await expect(page.locator('html[lang="ur"][dir="rtl"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: ur.worker.join.confirmTitle })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const card = document.querySelector("[data-join-card]") as HTMLElement;
    const glyph = card.querySelector("[data-pictogram]") as HTMLElement;
    const crew = [...card.querySelectorAll("p")].find((p) => p.textContent.includes("Crew C")) as HTMLElement;
    const yes = document.querySelector("[data-primary]") as HTMLElement;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      glyphLeft: glyph.getBoundingClientRect().left,
      crewLeft: crew.getBoundingClientRect().left,
      yesHeight: yes.getBoundingClientRect().height,
      yesWidth: yes.getBoundingClientRect().width,
      cardWidth: card.getBoundingClientRect().width,
    };
  });
  expect(geometry.scrollWidth, "no sideways scroll").toBeLessThanOrEqual(geometry.clientWidth);
  // Right to left: the crew glyph sits at the inline start, which is the right-hand side, so it is to the right of the crew's name.
  expect(geometry.glyphLeft).toBeGreaterThan(geometry.crewLeft);
  expect(geometry.yesHeight).toBeGreaterThanOrEqual(52);
  expect(geometry.yesWidth).toBeGreaterThan(geometry.cardWidth - 4);

  // The picker's rows point the other way round in right to left: the chevron is mirrored.
  await page.goto(`/ur/worker/join?s=${SITE_DEMO}`);
  const row = page.locator("main a[href*='c=crew-']").first();
  await expect(row).toBeVisible();
  const mirrored = await row.locator("svg").evaluate((svg) => getComputedStyle(svg).transform);
  expect(mirrored, "the chevron is flipped (a matrix with a negative x scale)").toMatch(/^matrix\(-1,/);
});

for (const theme of ["night", "sun"] as const) {
  test(`the join page passes the design gate at 390: the confirm card and the picker, en, ${theme} (join)`, async ({ page }) => {
    const gate = async (label: string): Promise<void> => {
      await page.evaluate(() => document.fonts.ready);
      const report = await gateReport(page, { consoleErrors: errors, field: true, hero: false, locale: "en" });
      await test.info().attach(`gate-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
      console.log(`gate ${label}: minText=${String(report.minTextPx)} minTarget=${report.minTargetPx.toFixed(0)} overflow=${String(report.overflowPx)} label=${String(report.minFieldLabelPx)}`);
      expect(report.failures, label).toEqual([]);
    };
    const errors = await openJoin(page, `?s=${SITE_DEMO}&c=crew-c`, { theme });
    await expect(page.getByRole("button", { name: en.worker.join.confirm })).toBeVisible();
    await gate(`confirm-en-${theme}`);
    await page.goto("/en/worker/join");
    await expect(page.getByRole("button", { name: en.worker.join.demo })).toBeVisible();
    await gate(`picker-en-${theme}`);
  });
}
