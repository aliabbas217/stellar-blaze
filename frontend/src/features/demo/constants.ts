import type { components } from "@/api/schema";

/*
 * What every demo screen shares. This feature is neutral ground (eslint.config.mjs): worker, supervisor and judge code
 * all use it, so it imports no role's code.
 */

/** The scored crew of the demo fixture (ADR 0057). Crew ids are the API's; this is the one the story follows. */
export const DEMO_CREW_ID = "crew-b";

/**
 * The replay day, passed explicitly as `date` in replay mode (ADR 0051 decision 4; Thursday 3 September 2026, inside the
 * 15 Jun to 15 Sep ban window). Live mode omits the date and the server decides.
 */
export const REPLAY_DATE = "2026-09-03";

/*
 * There is no replay moment here on purpose: in replay mode "now" is the API's own clock (the `now` of its forecast response,
 * src/features/demo/useClock.ts), so the web app and the API cannot disagree about the hour. `?at=HH:MM` moves it.
 */

/** The URL parameter of the mode switch, and of the replay time override (`?at=HH:MM`, the judge's time travel). */
export const DEMO_PARAM = "demo";
export const AT_PARAM = "at";

export type DemoMode = "live" | "replay";

export function parseDemoMode(raw: string | null): DemoMode {
  if (raw === "live" || raw === "replay") return raw;
  throw new RangeError(`Not a demo mode: ${String(raw)}`);
}

/**
 * THE demo-mode switch (ADR 0062, F2 decision D4): true on the public demo deployment, whose BFF holds the demo employer
 * token and whose visitors can act. Everything that must behave differently on the demo reads this and nothing else:
 * the unwell sheet shows the number and a confirmation instead of dialling a `tel:` link, and no real phone number or
 * ambulance is ever reached from a demo.
 *
 * It reads NEXT_PUBLIC_SB_DEMO, which Next.js inlines at BUILD time, and DEFAULTS TO DEMO: a missing variable means demo,
 * so a build that forgot the flag can never dial a synthetic number. Demo is off only when the variable is exactly "0"
 * (a real deployment builds with NEXT_PUBLIC_SB_DEMO=0 on purpose). It is a separate setting from DEMO_EMPLOYER_TOKEN,
 * which the BFF reads per request; the deployment owner sets both, and the e2e asserts the demo build.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_SB_DEMO !== "0";
}

/** The demo site: the first synthetic entry of `list_sites`, never a literal id (ADR 0057). */
export function pickDemoSite<S extends Pick<components["schemas"]["Site"], "synthetic">>(sites: readonly S[]): S | null {
  return sites.find((site) => site.synthetic) ?? null;
}
