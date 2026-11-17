import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The season scoreboard (/en/replay) and the proof sheet (/en/replay/proof/<claim>) in a production build, which ships the REAL
 * held-out 2026 files (data/eval/2026, synced from the B3 run): Warnings at lead 1 and lead 2, Plans, the runner's own verdict
 * sentences, the roster frontier. The pending state (no scored file) and the shape fixtures are covered by the unit tests; the
 * specs read the same files from disk so no number is typed twice.
 * Every title contains "scoreboard" or "proof sheet", so `pnpm e2e -g scoreboard` selects the scoreboard ones.
 * Screenshots are written only when SB_GATE_SHOTS names a directory (the design gate run), never in a normal e2e run.
 */

const JUDGE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SEASON_DAYS = 139;

interface Verdict {
  readonly id: string;
  readonly text: string;
}
const eval2026 = (name: string): { verdicts: readonly Verdict[] } & Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(process.cwd(), "data", "eval", "2026", `${name}.json`), "utf8")) as { verdicts: readonly Verdict[] } & Record<string, unknown>;

async function shot(page: Page, view: string, name: string, viewport: { width: number; height: number }): Promise<void> {
  const dir = process.env.SB_GATE_SHOTS;
  if (dir === undefined || dir === "") return;
  const wide = viewport.width === JUDGE.width ? "1440" : "390";
  mkdirSync(path.join(dir, view), { recursive: true });
  // The whole page (never clipped: review item I5 found P3, lead 2, H5, Plans and the limits line missing from clipped PNGs) and one
  // PNG per section, so each card is legible at full size. The gate run shrinks any file over 450 KB to a 256-colour palette.
  await page.screenshot({ path: path.join(dir, view, `${name}-${wide}-night.png`), fullPage: true });
  for (const section of view === "scoreboard" ? ["warnings", "plans", "frontier"] : []) {
    const target = page.locator(`#${section}`);
    if ((await target.count()) > 0) await target.screenshot({ path: path.join(dir, view, `${name}-${section}-${wide}-night.png`) });
  }
}

async function open(page: Page, path: string, viewport = JUDGE): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

test("scoreboard final frame at first paint: the whole season is drawn and Play is not playing", async ({ page }) => {
  await open(page, "/en/replay");
  const ribbon = page.locator("figure[data-ribbon]").first();
  await expect(ribbon).toBeVisible();
  await expect(ribbon).toHaveAttribute("data-upto", String(SEASON_DAYS - 1));
  const play = page.getByRole("button", { name: "Play the season" });
  await expect(play).not.toHaveAttribute("aria-pressed");
  // the tally is the finished one, from the recorded forecast file
  const tally = page.locator("[data-tally]");
  await expect(tally.getByText("1,624")).toBeVisible();
  await expect(tally.getByText("279")).toBeVisible();
  await expect(tally.getByText("139", { exact: true })).toBeVisible();
  // and it stays there: nothing autoplays
  await page.waitForTimeout(1200);
  await expect(ribbon).toHaveAttribute("data-upto", String(SEASON_DAYS - 1));
});

test("scoreboard Play runs the season, Pause stops it, and reduced motion lands on the final frame", async ({ page }) => {
  // A Windows host with animation effects off reports reduced motion to the desktop browser; this test chooses its own.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, "/en/replay");
  const ribbon = page.locator("figure[data-ribbon]").first();
  // Pressing Play before React is attached does nothing (the flake): wait for the island to say it has hydrated.
  await expect(page.locator("[data-primary][data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", { name: "Play the season" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).not.toHaveAttribute("aria-pressed");
  await expect.poll(async () => Number(await ribbon.getAttribute("data-upto")), { timeout: 4000 }).toBeLessThan(SEASON_DAYS - 1);
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await ribbon.getAttribute("data-upto");
  await page.waitForTimeout(600);
  await expect(ribbon).toHaveAttribute("data-upto", paused ?? "");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-primary][data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", { name: "Play the season" }).click();
  await expect(ribbon).toHaveAttribute("data-upto", String(SEASON_DAYS - 1));
  await expect(page.getByText("Animation is off on this device, so the whole season is shown.")).toBeVisible();
});

test("scoreboard renders with the API stopped: the page makes no API request at all", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  const errors = await open(page, "/en/replay");
  await expect(page.locator("figure[data-ribbon]").first()).toBeVisible();
  await expect(page.locator("[data-tally]").getByText("1,624")).toBeVisible();
  expect(api).toEqual([]);
  // the only console noise allowed is none: an aborted API call would be logged
  expect(errors).toEqual([]);
});

test("scoreboard scored state: three scored tables, no pending cell, no DEV stamp, every number with its proof", async ({ page }) => {
  await open(page, "/en/replay");
  // Warnings at lead 1 and at lead 2, and Plans
  await expect(page.locator("table[data-scoreboard=scored]")).toHaveCount(3);
  await expect(page.locator("table[data-scoreboard=pending]")).toHaveCount(0);
  await expect(page.locator("[aria-label='not scored yet']")).toHaveCount(0);
  await expect(page.getByText("###")).toHaveCount(0);
  await expect(page.getByText("DEV 2025")).toHaveCount(0);
  await expect(page.locator("#warnings > table tbody tr")).toHaveCount(5);
  await expect(page.locator("#warnings [data-lead='2'] table tbody tr")).toHaveCount(5);
  await expect(page.locator("#plans tbody tr")).toHaveCount(3);
  // ban only has no false alarms to take a share of: "not computed", never 0 %
  await expect(page.locator("[data-not-computed]")).toHaveCount(2);
  await expect(page.locator("#warnings > table [data-row=P0] [data-not-computed]")).toHaveText("not computed");
  // the plan cut and its rest cost are one sentence, over the scored days of the plans file
  const tradeoff = page.locator("[data-plans-tradeoff]");
  for (const part of ["33,875", "2,140", "31,680", "13,560", "138 scored days", "simulated crew"]) await expect(tradeoff).toContainText(part);
});

test("scoreboard shows every verdict sentence exactly as the runner wrote it, including the one that did not hold", async ({ page }) => {
  await open(page, "/en/replay");
  const main = page.locator("main");
  const sentences = [...eval2026("policy_scoreboard").verdicts, ...eval2026("plan_scoreboard").verdicts];
  expect(sentences.map((v) => v.id)).toEqual(["H4", "H5", "H4-lead2", "H6", "H7"]);
  for (const verdict of sentences) await expect(main).toContainText(verdict.text, { useInnerText: false });
  await expect(main).toContainText("H5 not supported at lead 1 (secondary)");
  // the stamp "issued by 18:00 the evening before" belongs to lead 2 only
  await expect(page.locator("main > header")).not.toContainText(/evening before/i);
  await expect(page.locator("[data-lead='2']")).toContainText("issued by 18:00 GST the evening before");
  // H4 is not a stable result: the page names the prior run and never says robust
  await expect(page.locator("[data-verdict-caption]")).toHaveText("Supported on 2026 (pre-registered). On the 2025 development run, the prior run, this check was not supported.");
  await expect(main).not.toContainText(/robust|consistently|calibrated|beats every|beats ADOSH|catches 90|best overall|highest CSI|untouched/i);
});

test("scoreboard evaluation chip shows the held-out label and the pre-registration lock in the drawer", async ({ page }) => {
  await open(page, "/en/replay");
  const record = JSON.parse(readFileSync(path.join(process.cwd(), "data", "eval", "2026", "evaluation_record.json"), "utf8")) as { lock_sha256: string; protocol_commit: string };
  await expect(page.locator("[data-evaluation]")).toContainText("Scored once on summer 2026, under a protocol locked before the run.");
  await page.locator("[data-evaluation] [data-proof-id]").click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // the number has no sheet of its own, so its record sits in the drawer behind For auditors (closed until the reader opens it)
  await expect(drawer.locator("dt", { hasText: "Pre-registration" })).toBeHidden();
  await drawer.getByText("For auditors: the full record").click();
  await expect(drawer.locator("dt", { hasText: "Pre-registration" })).toBeVisible();
  await expect(drawer.getByText(record.lock_sha256)).toBeVisible();
  await expect(drawer.getByText(record.protocol_commit)).toBeVisible();
  await expect(drawer.getByText("REAL", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("scoreboard where-from chip opens a plain story with no path or fingerprint, For auditors opens the record, and Escape returns focus to the chip", async ({ page }) => {
  await open(page, "/en/replay");
  const chip = page.locator("[data-tally] [data-proof-id]").first();
  await chip.click();
  const drawer = page.getByRole("dialog", { name: "Where this number comes from" });
  await expect(drawer).toBeVisible();
  for (const row of ["Made by", "About", "How we counted", "It shows", "It does not show"]) await expect(drawer.getByText(row, { exact: true })).toBeVisible();
  // the main layer never prints a file name, a fingerprint or a source path (docs/design/redesign-2026-11-17/02b section 6, test 4)
  expect(await drawer.innerText()).not.toMatch(/[A-Za-z0-9_-]+\.json|[0-9a-f]{40,}|src\//);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(chip).toBeFocused();
  // one deliberate step: For auditors, on the sheet, opened by the #audit link
  await chip.click();
  await page.getByRole("dialog").getByRole("link", { name: "For auditors" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/proof\/forecast\.days_over_limit#audit$/);
  const audit = page.locator("details#audit");
  await expect(audit).toHaveJSProperty("open", true);
  await expect(audit.locator("dt", { hasText: "SHA-256" }).locator("xpath=following-sibling::dd[1]").locator("code").first()).toHaveText(/^[0-9a-f]{64}$/);
  await expect(audit.getByText("static/omaa_2026_ifs_d1_wbgt_hourly.json")).toBeVisible();
});

test("scoreboard drawer links to the proof sheet and back", async ({ page }) => {
  await open(page, "/en/replay");
  await page.locator("[data-tally] [data-proof-id]").first().click();
  await page.getByRole("dialog").getByRole("link", { name: "Open the proof sheet" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/proof\/forecast\.days_over_limit$/);
  await expect(page.locator("[data-sheet-number]")).toContainText("139");
  await page.getByRole("link", { name: "Back to the scoreboard" }).first().click();
  await expect(page).toHaveURL(/\/en\/replay$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Summer 2026, replayed honestly");
});

test("scoreboard frontier commute lives in the URL and survives a reload", async ({ page }) => {
  await open(page, "/en/replay?commute=60#frontier");
  const slider = page.getByRole("slider", { name: "One-way commute" });
  await expect(slider).toHaveValue("60");
  await expect(page.locator("[data-frontier-chart]")).toHaveAttribute("data-commute", "60");
  await slider.fill("75");
  await expect(page).toHaveURL(/commute=75/);
  await page.reload();
  await expect(page.getByRole("slider", { name: "One-way commute" })).toHaveValue("75");
  // the default commute leaves the URL clean
  await page.getByRole("slider", { name: "One-way commute" }).fill("45");
  await expect(page).not.toHaveURL(/commute=/);
  await expect(page.getByRole("heading", { name: /^At a 45 minute commute the analysis finds no gain on top of the legal default./ })).toBeVisible();
});

test("scoreboard story footer links only to routes that exist and Next goes to the day page", async ({ page }) => {
  await open(page, "/en/replay");
  const nav = page.getByRole("navigation", { name: "Story" });
  await expect(nav.getByText("Step 2 of 5: Scoreboard")).toBeVisible();
  for (const href of await nav.locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBeLessThan(400);
  }
  await nav.getByRole("link", { name: "Next: One day" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/day$/);
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`scoreboard design gate, scored state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, "/en/replay", viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: true, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    if (process.env.SB_GATE_SHOTS !== undefined && process.env.SB_GATE_SHOTS !== "") {
      const heroPct = report.heroShare === null ? "n/a" : (report.heroShare * 100).toFixed(1);
      console.log(`GATE scoreboard ${name}: hero ${heroPct}% overflow ${String(report.overflowPx)}px minText ${String(report.minTextPx)}px minTarget ${String(report.minTargetPx)}px axe ${String(report.axeViolations.length)} failures ${String(report.failures.length)}`);
    }
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    if (viewport === JUDGE) expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
    await shot(page, "scoreboard", "ideal", viewport);
  });
}

test("proof sheet recounts the file in this browser and reports a match", async ({ page }) => {
  await open(page, "/en/replay/proof/forecast.hours_over_limit");
  await expect(page.locator("[data-sheet-number]")).toContainText("1,624");
  // a count made from a recorded forecast is not a scored result: one honest line, no timeline
  await expect(page.getByText("This is a count made from a recorded forecast file. It is not a scored result.")).toBeVisible();
  await expect(page.locator("[data-timeline]")).toHaveCount(0);
  await expect(page.locator("details#audit")).toHaveJSProperty("open", false);
  await page.getByText("For auditors: the full record").click();
  await page.getByRole("button", { name: "Recount in this browser" }).click();
  await expect(page.getByText("Matches", { exact: true })).toBeVisible();
});

test("proof sheet serves the lead 2 and day counter claims, with the lock", async ({ page }) => {
  await open(page, "/en/replay/proof/policy.lead2.p3.pod");
  await expect(page.locator("[data-sheet-number]")).toBeVisible();
  // a scored number: the lock is in the auditor record, and its timeline has three steps
  await page.getByText("For auditors: the full record").click();
  await expect(page.locator("dt", { hasText: "Pre-registration" })).toBeVisible();
  await expect(page.locator("[data-timeline] li")).toHaveCount(3);
  await open(page, "/en/replay/proof/day.balanced");
  await expect(page.locator("[data-sheet-number]")).toContainText("5 of 7");
  await open(page, "/en/replay/proof/policy.p3.pod#audit");
  const record = JSON.parse(readFileSync(path.join(process.cwd(), "data", "eval", "2026", "evaluation_record.json"), "utf8")) as { lock_sha256: string };
  await expect(page.getByText(record.lock_sha256)).toBeVisible();
});

test("proof sheet for an unknown number is the empty state, with a way to a number that has proof", async ({ page }) => {
  await open(page, "/en/replay/proof/policy.p9.nothing");
  await expect(page.getByRole("heading", { name: "This number is not shown" })).toBeVisible();
  await expect(page.locator("[data-sheet-number]")).toHaveCount(0);
  await page.getByRole("link", { name: "Open a number that has proof" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/proof\/forecast\.hours_over_limit$/);
  await expect(page.locator("[data-sheet-number]")).toBeVisible();
});

test("proof sheet has a sheet for the frontier readouts the page offers", async ({ page }) => {
  await open(page, "/en/replay/proof/frontier.legalisation.ge30");
  await expect(page.locator("[data-sheet-number]")).toContainText("%");
  await expect(page.getByText("This is an analysis of recorded data. It is not a scored result.")).toBeVisible();
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`proof sheet design gate, ${name} wide`, async ({ page }) => {
    const errors = await open(page, "/en/replay/proof/policy.p3.pod", viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: false, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    if (process.env.SB_GATE_SHOTS !== undefined && process.env.SB_GATE_SHOTS !== "") {
      console.log(`GATE proof sheet ${name}: overflow ${String(report.overflowPx)}px minText ${String(report.minTextPx)}px minTarget ${String(report.minTargetPx)}px axe ${String(report.axeViolations.length)} failures ${String(report.failures.length)}`);
    }
    expect(report.failures).toEqual([]);
    await shot(page, "proof", "ideal", viewport);
  });

  test(`proof sheet design gate, empty state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, "/en/replay/proof/not-a-number", viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: false, locale: "en" });
    expect(report.failures).toEqual([]);
  });
}
