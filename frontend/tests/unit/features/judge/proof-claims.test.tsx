import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import messages from "../../../../messages/en.json";
import { isUnreadableClaim, loaderOfClaim, type ClaimLoader } from "@/features/judge/claims";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The proof page's read-failure decision (F-gov review I4, I5). A claim is missing because no such number exists (an unknown
 * id: "No provenance recorded") or because the loader that owns its id family failed (a read failure). The two are told apart
 * by WHICH LOADER failed; every family is covered, and a file that cannot be read at request time is a calm state, not a 500.
 */

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({
  getTranslations: ({ locale, namespace }: { locale: string; namespace: string }) =>
    Promise.resolve(createTranslator({ locale, messages, namespace } as never)),
}));
vi.mock("next/navigation", () => ({ notFound: () => undefined }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { loadClaims } = await import("@/features/judge/proof-claims");
const REPO_DATA = path.join(process.cwd(), "data");
const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json";
const FRONTIER = "static/roster_frontier.json";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sb-proof-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function put(relative: string, text: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
const copy = (relative: string): void => {
  put(relative, readFileSync(path.join(REPO_DATA, relative), "utf8"));
};

describe("claim id families map to the loader that owns them", () => {
  it.each([
    ["policy.p3.missed_danger_hours", "scored"],
    ["plan.p1.heat_exposure_hours", "scored"],
    ["frontier.best.ge30.commute_30", "frontier"],
    ["frontier.legalisation.ge30", "frontier"],
    ["forecast.days_over_limit", "forecast"],
  ] as const)("%s -> %s", (id, loader) => {
    expect(loaderOfClaim(id)).toBe(loader);
  });

  it("an id of no family has no loader and is never a read failure", () => {
    expect(loaderOfClaim("nonsense.id")).toBeNull();
    expect(isUnreadableClaim("nonsense.id", ["scored", "frontier", "forecast"])).toBe(false);
  });

  it("test_unreadable_decision: an id is a read failure only when its OWN loader failed", () => {
    const ids: Record<ClaimLoader, string> = { scored: "policy.p3.x", frontier: "frontier.legalisation.ge30", forecast: "forecast.hours_over_limit" };
    for (const failing of ["scored", "frontier", "forecast"] as const) {
      for (const loader of ["scored", "frontier", "forecast"] as const) {
        expect(isUnreadableClaim(ids[loader], [failing])).toBe(loader === failing);
      }
    }
    expect(isUnreadableClaim(ids.scored, [])).toBe(false);
  });

  it("every claim id the real loaders produce belongs to a family (a new family cannot slip past the decision)", async () => {
    const { claims, unreadable } = await loadClaims("en", { dataRoot: REPO_DATA });
    expect(unreadable).toEqual([]);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(loaderOfClaim(claim.id)).not.toBeNull();
  });
});

describe("loadClaims: a loader that fails is named, the others still serve", () => {
  it("frontier file unreadable (bad JSON): only `frontier`; forecast claims are still there", async () => {
    copy(HOURLY);
    put(FRONTIER, "{ not json");
    const { claims, unreadable } = await loadClaims("en", { dataRoot: root });
    expect(unreadable).toEqual(["frontier"]);
    expect(claims.some((claim) => claim.id.startsWith("forecast."))).toBe(true);
    expect(claims.some((claim) => claim.id.startsWith("frontier."))).toBe(false);
  });

  it("frontier file with the wrong shape: `frontier`", async () => {
    copy(HOURLY);
    put(FRONTIER, JSON.stringify({ label: "x" }));
    expect((await loadClaims("en", { dataRoot: root })).unreadable).toEqual(["frontier"]);
  });

  it("hourly file missing at request time: `forecast` and no throw (a 500 before this fix); frontier claims still there", async () => {
    copy(FRONTIER);
    const { claims, unreadable } = await loadClaims("en", { dataRoot: root });
    expect(unreadable).toEqual(["forecast"]);
    expect(claims.some((claim) => claim.id.startsWith("frontier."))).toBe(true);
  });

  it("hourly file with the wrong shape: `forecast`", async () => {
    copy(FRONTIER);
    put(HOURLY, JSON.stringify({ not: "hourly" }));
    expect((await loadClaims("en", { dataRoot: root })).unreadable).toEqual(["forecast"]);
  });

  it("a scored file that is not what its location promises: `scored`", async () => {
    copy(HOURLY);
    copy(FRONTIER);
    put("eval/2026/policy_scoreboard.json", JSON.stringify({ evaluation_set: "dev_2025" }));
    expect((await loadClaims("en", { dataRoot: root })).unreadable).toEqual(["scored"]);
  });

  it("a scored file that does not exist yet is NOT a read failure (pending: an unknown number)", async () => {
    copy(HOURLY);
    copy(FRONTIER);
    const { unreadable } = await loadClaims("en", { dataRoot: root });
    expect(unreadable).toEqual([]);
  });

  it("several loaders failing at once are all named", async () => {
    put(FRONTIER, "x");
    expect((await loadClaims("en", { dataRoot: root })).unreadable.toSorted()).toEqual(["forecast", "frontier"]);
  });
});

describe("the page: the read-failure condition", () => {
  async function page(id: string, loaded: Awaited<ReturnType<typeof loadClaims>>) {
    vi.resetModules();
    vi.doMock("@/features/judge/proof-claims", () => ({ loadClaims: () => Promise.resolve(loaded) }));
    const { default: ProofPage } = await import("@/app/[locale]/(judge)/replay/proof/[claim]/page");
    const element = await ProofPage({ params: Promise.resolve({ locale: "en", claim: encodeURIComponent(id) }) } as never);
    return renderWithIntl(element as ReactElement);
  }
  afterEach(() => {
    vi.doUnmock("@/features/judge/proof-claims");
  });

  it.each([
    ["policy.p3.missed_danger_hours", "scored"],
    ["frontier.legalisation.ge30", "frontier"],
    ["forecast.days_over_limit", "forecast"],
  ] as const)("%s with the %s loader failed renders the read-failure state, never 'No provenance recorded'", async (id, loader) => {
    const { container } = await page(id, { claims: [], source: "none", unreadable: [loader] });
    expect(container.querySelector("[data-sheet-state=unreadable]")).not.toBeNull();
    expect(screen.queryByText(/No provenance recorded/)).toBeNull();
  });

  it("an unknown id stays the empty state even when a loader failed", async () => {
    const { container } = await page("policy.nope", { claims: [], source: "none", unreadable: ["frontier"] });
    expect(container.querySelector("[data-sheet-state=empty]")).not.toBeNull();
    expect(container.querySelector("[data-sheet-state=unreadable]")).toBeNull();
  });
});
