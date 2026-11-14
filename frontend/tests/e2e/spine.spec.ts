import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "./axe.ts";

/*
 * The time spine kit (/en/dev/kit/spine, a dev page served by a production build with SB_SPECIMEN=1, which
 * playwright.config.ts sets). What jsdom cannot prove, a browser does here: the labels' rendered size at 390 px, the
 * mirrored columns in Arabic, the slot's edges in pixels, and axe in both themes.
 */

const PHONE = { width: 390, height: 844 };
const THEMES = ["night", "sun"] as const;

async function open(page: Page, path: string, theme: (typeof THEMES)[number] = "night"): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(PHONE);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate((name) => {
    if (name === "sun") document.documentElement.dataset["theme"] = "sun";
    else delete document.documentElement.dataset["theme"];
  }, theme);
  return errors;
}

/** The smallest rendered font size, in px, among the text nodes' elements matching `selector` inside `scope`. */
async function minFontSize(page: Page, scope: string, selector: string): Promise<{ count: number; min: number }> {
  return page.evaluate(
    ({ scope: s, selector: sel }) => {
      const sizes = [...document.querySelectorAll(sel.split(",").map((part) => `${s} ${part.trim()}`).join(", "))].map((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      return { count: sizes.length, min: Math.min(...sizes) };
    },
    { scope, selector },
  );
}

test("spine labels are at least 16 px on a field surface at 390 px (test_spine_label_sizes)", async ({ page }) => {
  await open(page, "/en/dev/kit/spine");
  for (const cell of ["spine-field-v-in", "spine-field-v-out", "spine-field-h-in", "spine-field-h-out"]) {
    const scope = `[data-testid="${cell}"]`;
    // ticks, slot label and waypoints: every label element's own text
    const size = await minFontSize(page, scope, "[data-tick], [data-slot-label] p, [data-waypoint] p");
    expect(size.count, cell).toBeGreaterThan(0);
    expect(size.min, cell).toBeGreaterThanOrEqual(16);
  }
});

test("spine labels are at least 12 px on a desk surface at 390 px", async ({ page }) => {
  await open(page, "/en/dev/kit/spine");
  for (const cell of ["spine-desk-v-in", "spine-desk-v-out", "spine-desk-h-in", "spine-desk-h-out"]) {
    const size = await minFontSize(page, `[data-testid="${cell}"]`, "[data-tick], [data-slot-label] p, [data-waypoint] p");
    expect(size.count, cell).toBeGreaterThan(0);
    expect(size.min, cell).toBeGreaterThanOrEqual(12);
  }
});

test("the slot sits at 12:30 to 15:00 on the rendered vertical spine, and only where the break is in force", async ({ page }) => {
  await open(page, "/en/dev/kit/spine");
  const track = page.locator('[data-testid="spine-field-v-in"] [data-spine] svg[aria-hidden="true"]');
  const slot = page.locator('[data-testid="spine-field-v-in"] [data-slot] rect');
  const box = await track.boundingBox();
  const slotBox = await slot.boundingBox();
  expect(box).not.toBeNull();
  expect(slotBox).not.toBeNull();
  if (box === null || slotBox === null) return;
  const hourOf = (y: number) => 6 + ((y - box.y) / box.height) * 12;
  expect(hourOf(slotBox.y)).toBeCloseTo(12.5, 1);
  expect(hourOf(slotBox.y + slotBox.height)).toBeCloseTo(15, 1);
  await expect(page.locator('[data-testid="spine-field-v-out"] [data-slot]')).toHaveCount(0);
  await expect(page.locator('[data-testid="spine-field-v-out"] [data-slot-outline]')).toHaveCount(0);
  await expect(page.locator('[data-testid="spine-desk-v-out"] [data-slot-outline]')).toHaveCount(1);
  await expect(page.locator('[data-testid="spine-desk-v-out"] [data-slot-label]')).toContainText("not in force until 15 Jun");
});

test("a vertical spine mirrors in Arabic: the ticks and labels swap sides, the digits do not", async ({ page }) => {
  await open(page, "/en/dev/kit/spine");
  const side = async () => {
    const root = page.locator('[data-testid="spine-field-v-in"] [data-spine]');
    const tick = await root.locator('[data-tick="12"]').boundingBox();
    const band = await root.locator('svg[role="img"]').boundingBox();
    const label = await root.locator("[data-waypoint]").first().boundingBox();
    if (tick === null || band === null || label === null) throw new Error("spine parts not found");
    return { ticksBeforeBand: tick.x < band.x, labelsAfterBand: label.x > band.x };
  };
  expect(await side()).toEqual({ ticksBeforeBand: true, labelsAfterBand: true });

  await open(page, "/ar/dev/kit/spine");
  expect(await side()).toEqual({ ticksBeforeBand: false, labelsAfterBand: false });
  await expect(page.locator('[data-testid="spine-field-v-in"] [data-tick="12"]')).toHaveText("12:00");
});

for (const theme of THEMES) {
  test(`the spine kit has no axe violation, no overflow and no console error (${theme})`, async ({ page }) => {
    const errors = await open(page, "/en/dev/kit/spine", theme);
    expect(await axeViolations(page)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test("horizontal labels stay inside their spine in Arabic, where the track runs right to left", async ({ page }) => {
  await open(page, "/ar/dev/kit/spine");
  for (const cell of ["spine-field-h-in", "spine-desk-h-in", "spine-desk-h-out"]) {
    const frame = await page.locator(`[data-testid="${cell}"] [data-spine]`).boundingBox();
    const labels = page.locator(`[data-testid="${cell}"] [data-slot-label], [data-testid="${cell}"] [data-waypoint]`);
    expect(await labels.count(), cell).toBeGreaterThan(0);
    for (const box of await labels.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { left: number; right: number }))) {
      expect(box.left, cell).toBeGreaterThanOrEqual((frame?.x ?? 0) - 1);
      expect(box.right, cell).toBeLessThanOrEqual((frame?.x ?? 0) + (frame?.width ?? 0) + 1);
    }
  }
});
