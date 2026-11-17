import { expect, test } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { axeViolations } from "./axe.ts";

/*
 * WCAG 2.2 A and AA with axe (tests/e2e/axe.ts), against a production build (see playwright.config.ts), on every page
 * that exists today. The screens that are still placeholders (/worker, /supervisor, /hse) are checked as they are; their
 * designed states (seeded, empty, crews) get their own cases when those screens land.
 */

/** A page to check: its URL, and what it shows once it is ready to be judged. */
interface PageUnderTest {
  readonly path: string;
  /** The page's heading: seeing it proves the right page, in the right language, has rendered. */
  readonly heading: string;
  /** The Enable button, on pages whose state is decided by the browser after hydration. */
  readonly enable?: string;
}

const pages: PageUnderTest[] = [
  { path: "/en", heading: en.judge.landing.title },
  { path: "/ar", heading: ar.judge.landing.title },
  { path: "/en/worker", heading: en.worker.today.title },
  { path: "/en/worker/alerts", heading: en.alerts.title, enable: en.alerts.enable },
  { path: "/ur/worker/alerts", heading: ur.alerts.title, enable: ur.alerts.enable },
  { path: "/en/supervisor", heading: en.supervisor.title },
  { path: "/en/hse", heading: en.hse.title },
  { path: "/en/offline", heading: en.offline.title },
  { path: "/ur/offline", heading: ur.offline.title },
];

for (const { path, heading, enable } of pages) {
  test(`${path} has no WCAG 2.2 AA violation`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    if (enable !== undefined) await expect(page.getByRole("button", { name: enable })).toBeVisible();

    expect(await axeViolations(page)).toEqual([]);
  });
}

test("the axe run covers every WCAG tag it is configured with", async ({ page }) => {
  // One element for each tag: if a tag is dropped from the configuration, or a rule stops running under it, the page
  // above would pass without having been checked, and this is what notices.
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head><title>Canary</title></head>
      <body>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
        <input type="text" aria-label="Name" autocomplete="not-a-token">
        <p style="color: silver; background: white">Low contrast</p>
        <button aria-label="Submit order">Go</button>
        <button style="width: 10px; height: 10px; padding: 0">a</button><button style="width: 10px; height: 10px; padding: 0">b</button>
      </body>
    </html>`);

  const rules = (await axeViolations(page)).map((finding) => finding.rule);

  expect(rules).toEqual(
    expect.arrayContaining([
      "image-alt", // wcag2a
      "color-contrast", // wcag2aa
      "autocomplete-valid", // wcag21aa
      "label-content-name-mismatch", // wcag21a
      "target-size", // wcag22aa
    ]),
  );
});
