import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/*
 * The security headers of a deployed environment (plan F1 Task 13), against the production build (`pnpm build && pnpm e2e`:
 * playwright.config.ts starts the mock API and the standalone server itself). The values below are the contract with
 * infrastructure (I1), written out in full on purpose: a change to next.config.ts must change this file too.
 *
 * Two things are pinned: the headers are on every kind of response the server gives (pages, the 404 page, the service
 * worker script, the manifest, the web health route), and the policy breaks nothing the app does (no violation on the
 * worker routes, with the service worker installed and controlling the page).
 */

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;

interface ResponseUnderTest {
  readonly path: string;
  readonly status: number;
  readonly kind: string;
}

const responses: ResponseUnderTest[] = [
  { path: "/en/worker", status: 200, kind: "a page" },
  { path: "/ur/offline", status: 200, kind: "the offline page" },
  { path: "/en/no-such-page", status: 404, kind: "the localized 404 page" },
  { path: "/serwist/sw.js", status: 200, kind: "the service worker script" },
  { path: "/en/manifest.webmanifest", status: 200, kind: "a manifest" },
  { path: "/api/healthz", status: 200, kind: "the web health route" },
];

for (const { path, status, kind } of responses) {
  test(`${path} (${kind}) carries the security headers`, async ({ request }) => {
    const response = await request.get(path);

    expect(response.status()).toBe(status);
    const headers = response.headers();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers[name], name).toBe(value);
    }
  });
}

test("the service worker script is JavaScript", async ({ request }) => {
  const response = await request.get("/serwist/sw.js");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/javascript/);
});

// What Chromium writes to the console when a policy blocks something (the page's and the service worker's alike).
const VIOLATION = /Content Security Policy|Refused to /i;

/** Collects every CSP violation the browser logs, from pages and from workers. */
function watchViolations(page: Page): string[] {
  const violations: string[] = [];
  page.context().on("console", (message: ConsoleMessage) => {
    if (VIOLATION.test(message.text())) violations.push(message.text());
  });
  return violations;
}

/** Waits for the app's service worker to be active and for the page to be loaded under its control. */
async function loadControlled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.waitForLoadState("networkidle");
}

test("the violation watcher sees a blocked request (so that a clean run below means something)", async ({ page }) => {
  const violations = watchViolations(page);
  await loadControlled(page, "/en/worker");

  // A cross-origin request, which `connect-src 'self'` forbids. The host does not resolve: the policy refuses before any lookup.
  await page.evaluate(() => fetch("https://csp-canary.invalid/").catch(() => undefined));

  await expect.poll(() => violations.filter((violation) => violation.includes("connect-src"))).not.toEqual([]);
});

test("the service worker's own policy forbids another origin", async ({ page, context }) => {
  // A worker's policy is the one on its script response. Without `connect-src 'self'` there, a cross-origin request
  // could reach the worker's runtime caching rule for /api/ and be answered from, or stored in, a cache. The worker's
  // console does not reach Playwright, so this listens for the browser's own violation event inside the worker. (The
  // host does not resolve, so a request that no policy stopped would also fail, but with no violation event.)
  await loadControlled(page, "/en/worker");

  const [worker] = context.serviceWorkers();
  expect(worker, "the app's service worker").toBeDefined();
  const events = await worker?.evaluate(async () => {
    const seen: string[] = [];
    // The "dom" lib types this event only on Document and Element, not on a worker's global scope, hence the annotation and cast.
    globalThis.addEventListener("securitypolicyviolation", (event: Event) => {
      const { violatedDirective, blockedURI } = event as SecurityPolicyViolationEvent;
      seen.push(`${violatedDirective} ${blockedURI}`);
    });
    await fetch("https://csp-canary.invalid/api/v1/risk-policy").catch(() => undefined);
    // The event is a task of its own: let it run before the list is read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return seen;
  });

  expect(events).toEqual(["connect-src https://csp-canary.invalid/api/v1/risk-policy"]);
});

for (const path of ["/en/worker", "/en/worker/alerts", "/ur/offline"]) {
  test(`${path} loads with no CSP violation, with the service worker in control`, async ({ page }) => {
    const violations = watchViolations(page);

    await loadControlled(page, path);

    expect(violations).toEqual([]);
  });
}
