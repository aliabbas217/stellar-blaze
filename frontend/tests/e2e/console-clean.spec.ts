import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { watchConsole } from "./gate.ts";

/*
 * The console-clean gate: after a HARD load of every route of ADR 0069 and of the landing, once hydration is done, the browser
 * has reported nothing. It exists because a React hydration mismatch (#418) was seen once in 33 minutes of e2e and passed on
 * re-run: a flake that is really a function of the environment the server and the browser disagree on (their clocks, zones,
 * locales), so the same routes are loaded in several environments, and the rule is the same one the design gates use
 * (`watchConsole` in gate.ts) with warnings switched on:
 *
 *   zero console errors, zero console warnings, zero uncaught exceptions, zero HTTP or network failures, zero hydration
 *   messages (#418, #419, #422, #423, #425, "Hydration failed", "did not match") of any console type.
 *
 * Allow-list: NONE. An entry may only be added for a message a named dependency prints in production, with its text and the
 * reason in a comment beside it; today the production build prints nothing on these routes.
 *
 * Environments (each is a block of the same route list):
 *   default         the project's own browser (Pixel 7 / Desktop Chrome: en-US, the host's time zone)
 *   new-york        time zone America/New_York, locale en-US: the site zone is Asia/Dubai, so a time formatted in the browser's
 *                   zone instead of the site's shows (an eight hour difference)
 *   clock-ahead     the device clock is 3 minutes ahead of the server's (a phone with a wrong clock; the server renders one
 *                   minute, the browser's first render reads another): the deterministic stand-in for "the minute ticked
 *                   between the server render and hydration"
 *   ur, ar          the right-to-left locales, in the zone and browser locale of the people who read them
 * plus ONE real minute-boundary test (no faked clock): the scripts are held until the wall clock passes a minute after the
 * server rendered the page, which is what a slow phone on a busy cell does.
 *
 * The service worker is NOT blocked: it is what a visitor has, and what it logs is part of "clean". The BFF admits 20 day-plan
 * reads a client a minute, so a plan route waits for budget (the same rule as supervisor-plan.spec.ts) instead of caching the
 * response, which a service worker that has taken the page over would bypass.
 */

const PHONE = { width: 390, height: 844 };
const PIN = `?site=${SITE_DEMO}&crew=crew-b`;
const VALID_FROM = encodeURIComponent("2026-09-03T06:00:00Z");

interface Route {
  readonly name: string;
  /** The path after the locale prefix. */
  readonly path: string;
  /** What shows once the client has hydrated and the screen has settled. */
  readonly settled: (page: Page, locale: string) => Promise<void>;
}

const MESSAGES = { en, ur, ar } as const;

/**
 * The field frames show the demo clock as "--:--" until a forecast has answered, and then as the time. That settles the screens that
 * read a forecast; a screen that never asks for one (the alerts page) keeps "--:--" for good, which is right (the app never invents a
 * time; ADR 0034, the clock amendment of 2026-11-17), so it waits for its own post-hydration content instead (ALERTS_HYDRATED).
 */
const FRAME_HYDRATED = async (page: Page): Promise<void> => {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  await expect(page.locator("header")).not.toContainText("--:--");
};
/** The alerts page: its Enable button is decided by the browser after hydration (as in a11y.spec.ts). */
const ALERTS_HYDRATED = async (page: Page, locale: string): Promise<void> => {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  const words = MESSAGES[locale as keyof typeof MESSAGES];
  await expect(page.getByRole("button", { name: words.alerts.enable })).toBeVisible();
};
const SUPERVISOR_CREWS = async (page: Page): Promise<void> => {
  await FRAME_HYDRATED(page);
  await page.locator("[data-crew]").first().waitFor();
};
const PLAN = async (page: Page): Promise<void> => {
  await FRAME_HYDRATED(page);
  await page.locator("[data-block]").first().waitFor();
  await page.getByRole("checkbox").first().waitFor().catch(() => undefined);
};
const SIGNED_PLAN = async (page: Page): Promise<void> => {
  await FRAME_HYDRATED(page);
  await page.locator("[data-signed]").waitFor();
};
const LANDING = async (page: Page): Promise<void> => {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  await expect(page.locator("[data-field-stage][data-field-path]")).toBeAttached({ timeout: 15_000 });
};

const LANDING_ROUTES: readonly Route[] = [
  { name: "landing (WebGL path)", path: "", settled: LANDING },
  { name: "landing (?static)", path: "?static", settled: LANDING },
];
const WORKER_ROUTES: readonly Route[] = [
  { name: "worker today", path: `/worker${PIN}`, settled: FRAME_HYDRATED },
  { name: "worker alerts", path: "/worker/alerts", settled: ALERTS_HYDRATED },
  { name: "worker alert", path: `/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${VALID_FROM}`, settled: FRAME_HYDRATED },
];
const SUPERVISOR_ROUTES: readonly Route[] = [
  { name: "supervisor crews", path: "/supervisor", settled: SUPERVISOR_CREWS },
  { name: "supervisor plan, form open (Crew B at work)", path: "/supervisor/crews/crew-b?at=09:30", settled: PLAN },
  { name: "supervisor plan, signed (Crew A)", path: "/supervisor/crews/crew-a", settled: SIGNED_PLAN },
];

const WINDOW_MS = 62_000;
const PLAN_READS_PER_WINDOW = 12; // the BFF admits 20 a client; the rest is room for the reads a retry makes
const planReads: number[] = [];

/** Counts the page's day-plan reads, and waits (when `route` is a plan) until the BFF's window has room for the ones this load makes. */
async function watchPlanBudget(page: Page, route: Route): Promise<void> {
  page.on("request", (request) => {
    if (/\/api\/v1\/crews\/[^/]+\/day-plan/.test(request.url())) planReads.push(Date.now());
  });
  if (!route.path.startsWith("/supervisor/crews/")) return;
  while (planReads.filter((at) => Date.now() - at < WINDOW_MS).length >= PLAN_READS_PER_WINDOW) await page.waitForTimeout(2_000);
}

/** A phone whose clock is `minutes` ahead: only `Date` moves (timers are real), as on a device with a wrong clock. */
async function skewDeviceClock(page: Page, minutes: number): Promise<void> {
  await page.addInitScript((offset) => {
    const Real = Date;
    class Skewed extends Real {
      constructor(...args: [] | [number | string | Date] | [number, number, ...number[]]) {
        if (args.length === 0) super(Real.now() + offset);
        else super(...(args as [number]));
      }
      static override now(): number {
        return Real.now() + offset;
      }
    }
    globalThis.Date = Skewed as DateConstructor;
  }, minutes * 60_000);
}

async function expectClean(page: Page, errors: readonly string[], label: string): Promise<void> {
  // Hydration is done when `settled` returned; a mismatch is reported at that moment, a late warning shortly after.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  expect(errors, `${label}: the browser reported`).toEqual([]);
}

async function load(page: Page, locale: string, route: Route, prepare?: (page: Page) => Promise<void>): Promise<void> {
  const errors = watchConsole(page, { warnings: true });
  await page.setViewportSize(PHONE);
  await watchPlanBudget(page, route);
  await prepare?.(page);
  const search = route.path.startsWith("?") ? route.path : "";
  const path = route.path.startsWith("?") ? "" : route.path;
  await page.goto(`/${locale}${path}${search}`);
  await route.settled(page, locale);
  await expectClean(page, errors, `/${locale}${route.path}`);
}

function block(title: string, locale: string, routes: readonly Route[], prepare?: (page: Page) => Promise<void>): void {
  for (const route of routes) {
    test(`console clean: ${title}, ${route.name} (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      await load(page, locale, route, prepare);
    });
  }
}

const EVERY_EN = [...LANDING_ROUTES, ...WORKER_ROUTES, ...SUPERVISOR_ROUTES];
const FIELD = [...WORKER_ROUTES, ...SUPERVISOR_ROUTES];

test.describe("default environment", () => {
  block("default", "en", EVERY_EN);
});

test.describe("browser in New York, en-US", () => {
  test.use({ timezoneId: "America/New_York", locale: "en-US" });
  block("New York", "en", EVERY_EN);
});

test.describe("device clock 3 minutes ahead of the server", () => {
  block("clock ahead", "en", EVERY_EN, (page) => skewDeviceClock(page, 3));
});

test.describe("ur, in Pakistan", () => {
  test.use({ timezoneId: "Asia/Karachi", locale: "ur-PK" });
  block("ur", "ur", FIELD);
});

test.describe("ar, in Saudi Arabia", () => {
  test.use({ timezoneId: "Asia/Riyadh", locale: "ar-SA" });
  block("ar", "ar", FIELD);
});

test.describe("ur with a device clock ahead", () => {
  test.use({ timezoneId: "Asia/Karachi", locale: "ur-PK" });
  block("ur, clock ahead", "ur", SUPERVISOR_ROUTES, (page) => skewDeviceClock(page, 3));
});

/*
 * No faked clock: the server renders the page in minute M, the scripts are held until the wall clock is in minute M + 1, then
 * the page hydrates. Starts the request in the last 3 seconds of a minute, so the wait is at most one minute. The mechanism is
 * not about the viewport, so one project runs it.
 */
test("console clean: the minute ticks between the server render and hydration (supervisor plan)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "the mechanism does not depend on the viewport");
  test.setTimeout(150_000);
  const route = SUPERVISOR_ROUTES[1];
  if (route === undefined) throw new Error("no plan route");
  const toNextMinute = () => 60_000 - (Date.now() % 60_000);
  while (toNextMinute() > 3_000) await page.waitForTimeout(Math.min(toNextMinute() - 3_000, 1_000));
  const release = new Promise<void>((resolve) => setTimeout(resolve, toNextMinute() + 1_500));
  const errors = watchConsole(page, { warnings: true });
  await page.setViewportSize(PHONE);
  await watchPlanBudget(page, route);
  await page.route("**/_next/static/**/*.js", async (request) => {
    await release;
    await request.continue();
  });
  await page.goto(`/en${route.path}`);
  await route.settled(page, "en");
  await expectClean(page, errors, "minute boundary");
});
