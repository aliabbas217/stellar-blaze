/*
 * What the `live` Playwright project reads from the environment, kept free of Playwright so a unit test pins it
 * (tests/unit/e2e/live-env.test.ts). The live project runs the specs in this folder against a REAL B3 backend
 * (replay mode) instead of the MSW mock; nothing here starts or stops that backend: it is the operator's.
 *
 *   E2E_LIVE                      "1" selects the live project (set by `pnpm e2e:live`); anything else is the mock projects.
 *   E2E_API_ORIGIN                the running B3's origin, for example http://127.0.0.1:8000. Unset: every live spec skips.
 *   E2E_DEMO_EMPLOYER_TOKEN       the plain bearer token whose SHA-256 is a key of the backend's SB_ACCESS_TOKENS. It becomes the web
 *                                 server's DEMO_EMPLOYER_TOKEN (the BFF holds it, the browser never sees it). Unset: the web server has
 *                                 no token, and the specs that need one skip. It is never printed.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const LIVE_SKIP_MESSAGE =
  "Live project skipped: E2E_API_ORIGIN is not set. Start B3 in replay mode and set E2E_API_ORIGIN (see README, 'Running F2 against the real B3').";

export const NO_TOKEN_SKIP_MESSAGE =
  "Skipped: E2E_DEMO_EMPLOYER_TOKEN is not set, so the web server holds no employer token and the employer routes answer 401.";

/** Whether `pnpm e2e:live` selected the live project. */
export function isLive(env: Env): boolean {
  return env.E2E_LIVE === "1";
}

/**
 * The backend origin: scheme, host and port, no path, no credentials. Unset or blank is null (the specs skip); a value that is
 * not an http(s) origin throws, because starting a web server against a half-typed origin would fail in a confusing way.
 */
export function liveApiOrigin(env: Env): string | null {
  const raw = env.E2E_API_ORIGIN?.trim();
  if (raw === undefined || raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E2E_API_ORIGIN is not a URL: expected an origin such as http://127.0.0.1:8000");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("E2E_API_ORIGIN must be an http(s) origin with no credentials, query or fragment");
  }
  if (url.pathname !== "/") throw new Error("E2E_API_ORIGIN must be an origin with no path (the API paths start with /api/v1)");
  return url.origin;
}

/** The employer token the web server's BFF holds, or null. Never log it. */
export function liveEmployerToken(env: Env): string | null {
  const raw = env.E2E_DEMO_EMPLOYER_TOKEN?.trim();
  return raw === undefined || raw === "" ? null : raw;
}
