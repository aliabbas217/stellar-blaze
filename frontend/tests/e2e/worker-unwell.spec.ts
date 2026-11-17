import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO, SITE_EMPTY } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole, type GateReport } from "./gate.ts";
import { loadControlled } from "./helpers/service-worker.ts";

/*
 * The "I feel unwell" call sheet (F2 Task 18, safety) in a production build against the mock API. Every title contains
 * "unwell sheet", so `pnpm e2e -g "unwell sheet"` selects them.
 *
 * The build decides whether the calls dial (NEXT_PUBLIC_SB_DEMO, inlined at build time; demo unless it is exactly "0"). The
 * default build is the demo, so the tests of the real `tel:` links run only when the suite is started with
 * NEXT_PUBLIC_SB_DEMO=0 against a build made with the same value (the test reads the same variable to know which build it
 * is looking at):
 *
 *   NEXT_PUBLIC_SB_DEMO=0 pnpm build && NEXT_PUBLIC_SB_DEMO=0 pnpm e2e -g "unwell sheet"
 */

const PHONE = { width: 390, height: 844 };
const REAL_DEPLOYMENT = process.env["NEXT_PUBLIC_SB_DEMO"] === "0";

const SUPERVISOR = "+12025550143";
const FIRST_AIDER = "+12025550144";

type Theme = "night" | "sun";
type Locale = "en" | "ur";

interface Contacts {
  readonly supervisorPhone: string | null;
  readonly firstAiderPhone: string | null;
}

interface Opening {
  readonly locale?: Locale;
  readonly theme?: Theme;
  /** What the phone holds for the site: the demo site's numbers (default), none (an empty site), or no pin at all (null). */
  readonly pin?: { readonly siteId: string; readonly contacts: Contacts } | null;
  /** The phone says it is offline (spoofs navigator.onLine; the network itself is up, so the console stays clean). */
  readonly offline?: boolean;
}

const DEMO_PIN = { siteId: SITE_DEMO, contacts: { supervisorPhone: SUPERVISOR, firstAiderPhone: FIRST_AIDER } } as const;
const EMPTY_PIN = { siteId: SITE_EMPTY, contacts: { supervisorPhone: null, firstAiderPhone: null } } as const;

async function openSheet(page: Page, { locale = "en", theme = "sun", pin = DEMO_PIN, offline = false }: Opening = {}): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(PHONE);
  await page.addInitScript(
    ([chosen, stored]) => {
      localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
      if (stored !== null) localStorage.setItem("sb-profile-v1", stored);
    },
    [
      theme,
      pin === null
        ? null
        : JSON.stringify({
            state: {
              profile: null,
              push: null,
              site: { siteId: pin.siteId, crewId: null, contacts: pin.contacts },
            },
            version: 1,
          }),
    ] as const,
  );
  if (offline) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    });
  }
  await page.goto(`/${locale}/worker/unwell`);
  await expect(page.getByRole("heading", { level: 1, name: (locale === "en" ? en : ur).worker.unwell.title })).toBeAttached();
  await expect(page.getByRole("timer")).toBeVisible();
  return errors;
}

/** The three calls, whichever way the build renders them: a link on a real deployment, a button on the demo. */
function calls(page: Page) {
  const kind = REAL_DEPLOYMENT ? "link" : "button";
  return {
    emergency: page.getByRole(kind, { name: /998/ }),
    supervisor: page.getByRole(kind, { name: new RegExp(en.worker.unwell.calls.supervisor.title) }),
    firstAider: page.getByRole(kind, { name: new RegExp(en.worker.unwell.calls.firstAider.title) }),
  };
}

async function expectGate(page: Page, errors: string[], locale: Locale, extra: Partial<Parameters<typeof gateReport>[1]> = {}): Promise<GateReport> {
  const report = await gateReport(page, { consoleErrors: errors, field: true, locale, ...extra });
  // The numbers behind the gate are attached to the HTML report; SB_GATE_NUMBERS_FILE also appends them to a file for a gate write-up.
  const numbers = JSON.stringify({ test: test.info().title, ...report });
  await test.info().attach("gate-report.json", { body: numbers, contentType: "application/json" });
  const file = process.env["SB_GATE_NUMBERS_FILE"];
  if (file !== undefined) appendFileSync(file, `${numbers}\n`);
  expect(report.failures, report.failures.join("\n")).toEqual([]);
  return report;
}

test.describe("unwell sheet: the calls", () => {
  test("unwell sheet, demo build: nothing is a tel: link, each call shows its number and a confirmation", async ({ page }) => {
    test.skip(REAL_DEPLOYMENT, "the demo build only");
    await openSheet(page);
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    const { emergency, supervisor, firstAider } = calls(page);
    for (const call of [emergency, supervisor, firstAider]) await expect(call).toBeVisible();
    await expect(supervisor).toContainText(SUPERVISOR);
    await expect(firstAider).toContainText(FIRST_AIDER);

    const url = page.url();
    await supervisor.click();
    await expect(page.getByText(en.worker.unwell.calls.demo.supervisor)).toBeVisible();
    await firstAider.click();
    await expect(page.getByText(en.worker.unwell.calls.demo.firstAider)).toBeVisible();
    await emergency.click();
    await expect(page.getByText(en.worker.unwell.calls.demo.emergency)).toBeVisible();
    // A demo never leaves the page: no navigation to a tel: URL, no new tab.
    expect(page.url()).toBe(url);
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  });

  test("unwell sheet, real build: 998, the supervisor and the first-aider are tel: links to the right numbers", async ({ page }) => {
    test.skip(!REAL_DEPLOYMENT, "needs a build made with NEXT_PUBLIC_SB_DEMO=0");
    await openSheet(page);
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(3);
    const { emergency, supervisor, firstAider } = calls(page);
    await expect(emergency).toHaveAttribute("href", "tel:998");
    await expect(supervisor).toHaveAttribute("href", `tel:${SUPERVISOR}`);
    await expect(firstAider).toHaveAttribute("href", `tel:${FIRST_AIDER}`);
    // 998 first in reading order.
    const hrefs = await page.locator('a[href^="tel:"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefs).toEqual(["tel:998", `tel:${SUPERVISOR}`, `tel:${FIRST_AIDER}`]);
  });

  test("unwell sheet: a site with no numbers shows designed rows, never an empty tel: link", async ({ page }) => {
    const errors = await openSheet(page, { pin: EMPTY_PIN });
    await expect(page.getByText(en.worker.unwell.calls.supervisor.absent)).toBeVisible();
    await expect(page.getByText(en.worker.unwell.calls.firstAider.absent)).toBeVisible();
    await expect(page.getByText(en.worker.unwell.calls.firstAider.askNearby)).toBeVisible();
    await expect(page.locator('a[href="tel:"], a[href="tel:null"]')).toHaveCount(0);
    // 998 is still there, first.
    await expect(calls(page).emergency).toBeVisible();
    await expectGate(page, errors, "en");
  });

  test("unwell sheet: a phone that has not seen the site yet says how it will, and keeps 998", async ({ page }) => {
    const errors = await openSheet(page, { pin: null });
    await expect(page.getByText(/supervisor number is saved on this phone/)).toBeVisible();
    await expect(calls(page).emergency).toBeVisible();
    await expectGate(page, errors, "en");
  });
});

test.describe("unwell sheet: content", () => {
  test("unwell sheet: ADOSH steps word for word, the citation, the review label and the privacy line", async ({ page }) => {
    await openSheet(page);
    const steps = page.getByRole("region", { name: en.worker.unwell.steps.heading }).getByRole("listitem");
    await expect(steps).toHaveText(
      [
        "1Call emergency contact number and notify supervisor",
        "2Move the sick employee to a cool shaded area",
        "3Cool the employee using methods such as: soaking their clothes with water; spraying, sponging, or showering them with water; and fanning their body.",
      ],
    );
    await expect(page.getByText("ADOSH-SF Technical Guideline, Safety in the Heat v4.0, section 4.5(c)")).toBeVisible();
    await expect(page.getByText("Not clinically reviewed")).toBeVisible();
    await expect(page.getByText(/Reviewed by/)).toHaveCount(0);
    await expect(
      page.getByText("Nothing you do on this screen is sent to your employer. Call your supervisor now."),
    ).toBeVisible();
    await expect(page.getByText(/sip|drink/i)).toHaveCount(0);
  });

  test("unwell sheet: the dock offers Back to Today and no second emergency link", async ({ page }) => {
    await openSheet(page);
    await expect(page.getByRole("link", { name: en.worker.nav.unwell })).toHaveCount(0);
    await expect(page.locator("[data-emergency]:not(a):not(button)")).toHaveCount(0);
    await page.getByRole("link", { name: en.worker.nav.backToToday }).click();
    await expect(page).toHaveURL(/\/en\/worker$/);
    // Today has the unwell link again.
    await expect(page.getByRole("link", { name: en.worker.nav.unwell })).toBeVisible();
  });

  test("unwell sheet: the timer counts, survives a reload and fills the ruler from the start edge (right in Urdu)", async ({ page }) => {
    await openSheet(page, { locale: "ur" });
    const timer = page.getByRole("timer");
    await expect(timer).toHaveText(/^0:0[1-9]$/, { timeout: 5000 });
    const before = await page.evaluate(() => sessionStorage.getItem("sb-unwell-t0"));
    await page.reload();
    await expect(timer).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("sb-unwell-t0"))).toBe(before);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // The filled part is anchored to the right edge of its track in a right-to-left language.
    const edges = await page.locator("[aria-hidden='true'] .bg-ink").first().evaluate((fill) => {
      const track = fill.parentElement?.getBoundingClientRect();
      const filled = fill.getBoundingClientRect();
      return { fillRight: filled.right, trackRight: track?.right ?? -1 };
    });
    expect(Math.abs(edges.fillRight - edges.trackRight)).toBeLessThan(1);
  });

  test("unwell sheet: sends nothing, logs nothing: the page makes no request at all, not even the site list, and writes only the timer's key", async ({ page }) => {
    // F2 W1, I4. The sheet's layout is outside the group that fetches the site list, so opening it cannot tell the server (or put in
    // its logs, with the Referer) that this phone opened the emergency sheet. Every request is recorded from before the navigation.
    const requests: { method: string; type: string; path: string; afterLoad: boolean }[] = [];
    let loaded = false;
    page.on("request", (request) => {
      requests.push({ method: request.method(), type: request.resourceType(), path: new URL(request.url()).pathname, afterLoad: loaded });
    });
    await openSheet(page);
    await page.waitForLoadState("networkidle");
    loaded = true;
    if (!REAL_DEPLOYMENT) {
      const { supervisor, emergency } = calls(page);
      await supervisor.click();
      await emergency.click();
    }
    await page.waitForTimeout(2500);

    // While loading: the document, its scripts, styles and fonts and nothing the page's own code asks for (fetch, XHR, beacons).
    const asked = requests.filter((request) => !["document", "script", "stylesheet", "font", "image", "manifest", "other"].includes(request.type));
    expect(asked, "no fetch, XHR or beacon while the sheet loads").toEqual([]);
    expect(requests.filter((request) => request.path.startsWith("/api/")), "no API request at all (the site list included)").toEqual([]);
    // After it has loaded, and through every tap on it: nothing whatever.
    expect(requests.filter((request) => request.afterLoad), "no request after load, whatever the type").toEqual([]);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(["sb-unwell-t0"]);
    expect((await page.context().cookies()).filter((cookie) => /unwell|tap|timer/i.test(cookie.name))).toEqual([]);
  });
});

test.describe("unwell sheet: the design gate", () => {
  for (const locale of ["en", "ur"] as const) {
    for (const theme of ["night", "sun"] as const) {
      test(`unwell sheet gate: ideal, ${locale}, ${theme}`, async ({ page }) => {
        const errors = await openSheet(page, { locale, theme });
        await expectGate(page, errors, locale);
      });
    }
  }

  test("unwell sheet gate: offline state, en, night", async ({ page }) => {
    const errors = await openSheet(page, { theme: "night", offline: true });
    await expect(page.getByText(en.worker.unwell.offline.body)).toBeVisible();
    await expect(calls(page).emergency).toBeVisible();
    await expectGate(page, errors, "en");
  });

  test("unwell sheet gate: demo confirmation open, en, sun", async ({ page }) => {
    test.skip(REAL_DEPLOYMENT, "the confirmation exists on the demo build only");
    const errors = await openSheet(page, { theme: "sun" });
    await calls(page).supervisor.click();
    await expect(page.getByText(en.worker.unwell.calls.demo.supervisor)).toBeVisible();
    await expectGate(page, errors, "en");
  });
});

test.describe("unwell sheet: offline", () => {
  test("unwell sheet precache: the sheet of every locale is in the cache after install", async ({ page }) => {
    await loadControlled(page, "/en/worker");
    const cached = await page.evaluate(async () => {
      const found: Record<string, boolean> = {};
      for (const locale of ["en", "ur", "hi", "bn", "ne", "ar"]) {
        found[locale] = (await caches.match(`/${locale}/worker/unwell`, { ignoreSearch: true })) !== undefined;
      }
      return found;
    });
    expect(cached).toEqual({ en: true, ur: true, hi: true, bn: true, ne: true, ar: true });
  });

  test("unwell sheet works offline after one visit: open it from the dock with no connection and the three calls are there", async ({ page, context }) => {
    await page.setViewportSize(PHONE);
    await loadControlled(page, "/en/worker");
    // One visit to Today: the demo yard is one tap and puts the site's numbers on this phone (the pin's contacts).
    await page.getByRole("button", { name: en.worker.join.demo }).click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("sb-profile-v1") ?? ""), { timeout: 10_000 })
      .toContain(SUPERVISOR);

    await context.setOffline(true);
    await page.getByRole("link", { name: en.worker.nav.unwell }).click();
    await expect(page).toHaveURL(/\/en\/worker\/unwell$/);
    await expect(page.getByRole("heading", { level: 1, name: en.worker.unwell.title })).toBeAttached();

    const { emergency, supervisor, firstAider } = calls(page);
    for (const call of [emergency, supervisor, firstAider]) await expect(call).toBeVisible();
    await expect(supervisor).toContainText(SUPERVISOR);
    await expect(page.getByText(en.worker.unwell.worksOffline)).toBeVisible();
    await expect(page.getByText(en.worker.unwell.offline.body)).toBeVisible();
    await expect(page.getByRole("timer")).toBeVisible();

    // A reload with no connection opens the same sheet from the precache, still with the numbers.
    await page.reload();
    await expect(calls(page).supervisor).toContainText(SUPERVISOR);
    await expect(page.getByText(en.worker.unwell.steps.one)).toBeVisible();
  });

  test("unwell sheet opens cold with no connection when the phone has been online on any worker page, in Urdu too", async ({ page, context }) => {
    await loadControlled(page, "/ur/worker");
    await context.setOffline(true);
    await page.goto("/ur/worker/unwell");
    await expect(page.locator('html[lang="ur"][dir="rtl"]')).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: ur.worker.unwell.title })).toBeAttached();
    await expect(calls(page).emergency).toBeVisible();
  });
});
