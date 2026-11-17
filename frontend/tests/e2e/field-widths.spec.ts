import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { axeViolations } from "./axe.ts";
import { watchConsole } from "./gate.ts";
import { withScenario, type Scenario } from "./helpers/scenario.ts";

/*
 * Integration check after the Task 22 header change (FieldShell: the site name is no longer clamped to two lines, and the gap beside
 * "(synthetic)" went from 12 to 8 px), which touches EVERY field screen (architect, 2026-11-16): an accessibility pass (axe, WCAG 2.2 A and AA,
 * both themes) and an overflow check at 320, 390 and 768 px wide on every field screen and both supervisor screens, in en, ur and ar.
 *
 * Overflow means two things, both asserted with numbers (never only a screenshot):
 *   - the page scrolls sideways: document `scrollWidth` is greater than `clientWidth`;
 *   - something is outside the viewport or clipped: an element of the header, the main area or the Stop bar whose box starts left of 0
 *     or ends right of the viewport (an ancestor that scrolls sideways on purpose, a chart strip, is excused), or a box that hides
 *     its overflow (`overflow` hidden or clip) while its content is wider than it is.
 *
 * The result matrix (screen x width x locale: axe findings, scrollWidth against clientWidth, offenders) is printed one row per cell
 * and attached to each test as widths-matrix.json: the freeze summary copies it.
 *
 * A viewport is set by the test, so this runs once per project (the two projects differ in device emulation: touch, user agent).
 */

const WIDTHS = [320, 390, 768] as const;
const LOCALES = ["en", "ur", "ar"] as const;
const PIN = `?site=${SITE_DEMO}&crew=crew-b`;
const VALID_FROM = encodeURIComponent("2026-09-03T06:00:00Z");

type Locale = (typeof LOCALES)[number];
const MESSAGES = { en, ur, ar } as const;

interface Screen {
  readonly name: string;
  readonly path: string;
  readonly scenario?: Scenario;
  /** What shows once the screen has settled: its own content, not the loading state. */
  readonly settled: (page: Page, locale: Locale) => Promise<void>;
}

/**
 * The clock in the header ("--:--") is NOT a sign that the page has loaded: it shows a time only once a forecast has answered, so a
 * screen that never asks for one (the site is not chosen yet, the alerts page) or whose forecast failed keeps "--:--" for good, which is
 * right (the app never invents a time; ADR 0034, the clock amendment of 2026-11-17). So a screen is settled when its own post-hydration
 * content is there, which is what each screen below waits for; FRAME is the heading plus the clock, for screens that do read a forecast.
 */
const FRAME = async (page: Page): Promise<void> => {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  await expect(page.locator("header")).not.toContainText("--:--");
};
/** A frame for a screen that shows no time: its heading, and an element that only exists once the client has taken the page over. */
const FRAME_WITH = (ready: (page: Page, locale: Locale) => ReturnType<Page["getByRole"]>) => async (page: Page, locale: Locale): Promise<void> => {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  await expect(ready(page, locale)).toBeVisible();
};
/** Worker today with no crew chosen: the entry asks for the QR code, and offers the demo yard once the site list has loaded. */
const SITE_ENTRY = FRAME_WITH((page, locale) => page.getByRole("button", { name: MESSAGES[locale].worker.today.entry.demo }));
/** A screen whose forecast failed: the error state, which only exists after the failed request. */
const LOAD_ERROR = FRAME_WITH((page, locale) => page.getByText(MESSAGES[locale].states.error.title));
/** The alerts page: its Enable button is decided by the browser after hydration (as in a11y.spec.ts). */
const ALERTS_ENABLE = FRAME_WITH((page, locale) => page.getByRole("button", { name: MESSAGES[locale].alerts.enable }));
const CREWS = async (page: Page): Promise<void> => {
  await FRAME(page);
  await page.locator("[data-crew]").first().waitFor();
};
const PLAN = async (page: Page): Promise<void> => {
  await FRAME(page);
  await page.locator("[data-block]").first().waitFor();
};

const SCREENS: readonly Screen[] = [
  { name: "today (pinned crew)", path: `/worker${PIN}`, settled: FRAME },
  { name: "today (no QR: empty)", path: "/worker", settled: SITE_ENTRY },
  { name: "today (stale forecast)", path: `/worker${PIN}`, scenario: "stale", settled: FRAME },
  { name: "today (API error)", path: `/worker${PIN}`, scenario: "error", settled: LOAD_ERROR },
  { name: "alert card", path: `/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${VALID_FROM}`, settled: FRAME },
  { name: "unwell sheet", path: "/worker/unwell", settled: FRAME },
  { name: "alerts page", path: "/worker/alerts", settled: ALERTS_ENABLE },
  { name: "supervisor crews", path: "/supervisor", settled: CREWS },
  { name: "supervisor crew plan", path: "/supervisor/crews/crew-b?at=09:30", settled: PLAN },
];

interface Offender {
  readonly element: string;
  readonly left: number;
  readonly right: number;
  readonly why: string;
}
interface Measure {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly offenders: readonly Offender[];
}

/** Runs in the page: the horizontal overflow of the document and of the boxes of the frame, the main area and the Stop bar. */
async function overflowOf(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollsSideways = (el: Element): boolean => {
      for (let node = el.parentElement; node !== null && node !== document.body; node = node.parentElement) {
        const x = getComputedStyle(node).overflowX;
        if ((x === "auto" || x === "scroll") && node.scrollWidth > node.clientWidth) return true;
      }
      return false;
    };
    const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.id === "" ? "" : `#${el.id}`}${typeof el.className === "string" && el.className !== "" ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}`;
    const offenders: { element: string; left: number; right: number; why: string }[] = [];
    for (const el of document.querySelectorAll("header *, main *, [role='region'] *, [data-stop-bar] *, header, main")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest("[hidden], [aria-hidden='true']") !== null) continue;
      const box = el.getBoundingClientRect();
      // A box of one pixel or less is text kept for screen readers (`sr-only`: clipped on purpose), not layout.
      if (box.width <= 1 || box.height <= 1) continue;
      if ((box.left < -0.5 || box.right > width + 0.5) && !scrollsSideways(el) && style.position !== "fixed") {
        offenders.push({ element: name(el), left: Math.round(box.left), right: Math.round(box.right), why: "outside the viewport" });
      } else if ((style.overflowX === "hidden" || style.overflowX === "clip") && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        offenders.push({ element: name(el), left: Math.round(box.left), right: Math.round(box.right), why: `clips its content (scrollWidth ${String(el.scrollWidth)} > clientWidth ${String(el.clientWidth)})` });
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders: offenders.slice(0, 8) };
  });
}

async function setTheme(page: Page, theme: "sun" | "night"): Promise<void> {
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
}

for (const locale of LOCALES) {
  for (const screen of SCREENS) {
    test(`field widths: ${screen.name} in ${locale}: no axe finding (both themes) and no overflow at 320, 390 and 768 px`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = watchConsole(page);
      if (screen.scenario !== undefined) await withScenario(page, screen.scenario);
      const rows: Record<string, unknown>[] = [];
      for (const theme of ["night", "sun"] as const) {
        await setTheme(page, theme);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(`/${locale}${screen.path}`);
          await screen.settled(page, locale);
          await page.evaluate(() => document.fonts.ready);
          const axe = await axeViolations(page);
          const overflow = await overflowOf(page);
          rows.push({ screen: screen.name, locale, theme, width, axe: axe.map((f) => `${f.rule}: ${f.targets.join(" ")}`), scrollWidth: overflow.scrollWidth, clientWidth: overflow.clientWidth, offenders: overflow.offenders });
          console.log(`widths ${locale} ${screen.name} ${theme} ${String(width)}: axe ${String(axe.length)}, scroll ${String(overflow.scrollWidth)}/${String(overflow.clientWidth)}, offenders ${String(overflow.offenders.length)}`);
        }
      }
      await test.info().attach("widths-matrix.json", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
      const failures = rows.flatMap((row) => [
        ...(row["axe"] as string[]).map((finding) => `${String(row["theme"])} ${String(row["width"])} px axe ${finding}`),
        ...(Number(row["scrollWidth"]) > Number(row["clientWidth"]) ? [`${String(row["theme"])} ${String(row["width"])} px the page scrolls sideways (${String(row["scrollWidth"])} > ${String(row["clientWidth"])})`] : []),
        ...(row["offenders"] as Offender[]).map((o) => `${String(row["theme"])} ${String(row["width"])} px ${o.element} ${o.why} (${String(o.left)}..${String(o.right)})`),
      ]);
      expect(failures, `${screen.name} in ${locale}`).toEqual([]);
      // The error scenario makes the API fail on purpose: its HTTP 500s are the state under test, not a console finding.
      if (screen.scenario !== "error") expect(errors, "console").toEqual([]);
    });
  }
}
