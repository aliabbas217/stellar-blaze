import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { watchConsole } from "./gate.ts";

/*
 * The demo, walked once per audience on the mock backend (F2 Task 26, reduced): the three journeys a judge, a worker and a supervisor
 * take in the three-minute video, each as ONE test that goes screen to screen the way a person does (links and buttons, not URLs,
 * wherever the product offers them), with the CURRENT copy read from the catalogue and the browser's console watched the whole way
 * (errors, warnings, hydration messages: none). The screens' own gates (hero share, axe, overflow, states) stay in their specs;
 * what only a journey can show is that the screens connect and that one screen's state does not break the next.
 *
 * The supervisor journey writes to the mock API (sign-off, Stop, Undo): the demo site is reset before and after (a new demo epoch).
 * The file sorts ahead of every spec that presses Stop, so the BFF's small Stop reserve is full when it starts.
 */

const PIN = `?site=${SITE_DEMO}&crew=crew-b`;
const VALID_FROM = encodeURIComponent("2026-09-03T06:00:00Z");
const stopLabel = (crew: string): string => en.supervisor.stop.button.replace("<bdi>{crew}</bdi>", crew);

/** The field frames show "--:--" until the client has taken the page over, then the time. */
async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  await expect(page.locator("header")).not.toContainText("--:--");
}

async function resetEpoch(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const response = await page.request.post(`/api/v1/sites/${SITE_DEMO}/demo-reset`);
    if (response.ok()) return;
    expect(response.status(), "demo-reset is only ever refused for its limit").toBe(429);
    await page.waitForTimeout(5_000);
  }
  throw new Error("demo-reset kept answering 429");
}

test("demo journey, worker: Today, the alert card, the unwell sheet, back to Today", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page, { warnings: true });

  await page.goto(`/en/worker${PIN}`);
  await hydrated(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.worker.today.title);
  await expect(page.locator("[data-hero]")).toBeVisible();

  // Alerts, through the navigation
  await page.getByRole("link", { name: en.worker.nav.alerts }).first().click();
  await expect(page).toHaveURL(/\/en\/worker\/alerts$/);
  await hydrated(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.alerts.title);

  // The alert card is what a tapped push opens: the URL is the push's own
  await page.goto(`/en/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${VALID_FROM}`);
  await hydrated(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(en.worker.alert.title);
  await expect(page.locator("[data-hero]")).toBeVisible();

  // Today again, then the unwell sheet, through the dock
  await page.goto(`/en/worker${PIN}`);
  await hydrated(page);
  await page.getByRole("link", { name: en.worker.nav.unwell }).first().click();
  await expect(page).toHaveURL(/\/en\/worker\/unwell$/);
  await hydrated(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.worker.unwell.title);
  // The public demo never dials: no tel: link (the number and the demo confirmation are shown instead)
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: en.worker.nav.backToToday }).first()).toBeVisible();

  expect(errors, "the console, the whole way").toEqual([]);
});

test("demo journey, supervisor: crews, Crew B's plan and sign-off, Stop and Undo, Stop again", async ({ page }) => {
  test.setTimeout(240_000);
  await resetEpoch(page);
  try {
    const errors = watchConsole(page, { warnings: true });

    await page.goto("/en/supervisor");
    await hydrated(page);
    await page.locator("[data-crew]").first().waitFor();
    expect(await page.locator("[data-crew]").count(), "the crews of the site").toBeGreaterThan(1);
    await expect(page.getByRole("button", { name: /^Stop work, / })).toBeEnabled();

    // Crew B's plan: through the crew's row
    await page.locator('a[href$="/supervisor/crews/crew-b"]').first().click();
    await expect(page).toHaveURL(/\/en\/supervisor\/crews\/crew-b/);
    await hydrated(page);
    await page.getByRole("checkbox").first().waitFor();
    for (const box of await page.getByRole("checkbox").all()) await box.check();
    await page.getByRole("button", { name: "Sign off" }).click();
    await expect(page.locator("[data-signed]")).toBeVisible();

    // Stop work never waited for any of it; Undo inside the window; Stop again and let the window pass
    const bar = page.locator("[data-emergency]");
    await page.getByRole("button", { name: stopLabel("Crew B") }).click();
    await expect(bar).toContainText("Stop recorded");
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(page.getByRole("button", { name: stopLabel("Crew B") })).toBeVisible();
    await page.getByRole("button", { name: stopLabel("Crew B") }).click();
    await expect(bar).toContainText("Work stopped", { timeout: 25_000 });

    expect(errors, "the console, the whole way").toEqual([]);
  } finally {
    await resetEpoch(page);
  }
});

test("demo journey, judge: scoreboard, a proof chip and its sheet, the day, try a plan, governance", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchConsole(page, { warnings: true });
  // The two live calls fail on purpose in no scenario here; the console must be clean, expected 4xx included only where the page says so.

  await page.goto("/en/replay");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.judge.scoreboard.title);
  const chip = page.locator("[data-tally] [data-proof-id]").first();
  await chip.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // the drawer tells the story in plain words; the fingerprint is one deliberate step away, under For auditors
  await expect(drawer).toContainText("Made by");
  await expect(drawer.locator("dt", { hasText: "SHA-256" })).toHaveCount(0);
  await drawer.getByRole("link", { name: "For auditors" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/proof\/[^/]+#audit$/);
  await expect(page.locator("[data-sheet-number]")).toBeVisible();
  await expect(page.locator("details#audit")).toHaveJSProperty("open", true);
  await expect(page.locator("details#audit dt", { hasText: "SHA-256" }).locator("xpath=following-sibling::dd[1]").locator("code").first()).toHaveText(/^[0-9a-f]{64}$/);
  await page.getByRole("link", { name: "Back to the scoreboard" }).first().click();
  await expect(page).toHaveURL(/\/en\/replay$/);

  await page.goto("/en/replay/day");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One day, hour by hour");

  await page.goto("/en/replay/try");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.judge.try.title);
  const check = page.getByRole("button", { name: "Check this plan" });
  await expect(check).toBeVisible();
  await check.click();
  await expect(page.locator("[data-try]")).toHaveAttribute("data-try", /answer|none/);

  await page.goto("/en/replay/governance");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset demo site" })).toBeVisible();
  await page.getByRole("button", { name: "Send the employer's request" }).click();
  await expect(page.locator("[data-governance]")).toHaveAttribute("data-governance", "live");
  await expect(page.locator("[data-answer=shown] [data-status]")).toHaveText("403");
  await expect(page.locator("[data-log-source=live] [data-access-row]").first()).toContainText("A request for a worker's health data was refused");
  // reload: the recorded run again; a tap on Replay brings in the rows the API already has, the refusal among them
  await page.reload();
  await expect(page.getByRole("button", { name: "Reset demo site" })).toBeVisible();
  await page.getByRole("button", { name: "Replay" }).click();
  const live = page.locator("[data-live-rows]");
  await expect(live.getByRole("heading", { name: "Live rows from the demo API" })).toBeVisible();
  await expect(live.locator("[data-access-row]").first()).toContainText("A request for a worker's health data was refused");

  // the one expected failure of this journey is the refused request: a 403 is the product's answer, not a console error of the page
  expect(errors.filter((line) => !/data-requests/.test(line)), "the console, the whole way").toEqual([]);
});
