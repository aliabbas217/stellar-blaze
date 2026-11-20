import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { MissingProvenance } from "@/components/states/MissingProvenance";
import { WakingLine } from "@/components/states/WakingLine";
import { ProofChip } from "@/components/provenance/ProofChip";
import type { Proof } from "@/components/provenance/proof";
import { Stamp } from "@/components/provenance/Stamp";
import { StoryNav } from "@/components/shell/StoryNav";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { IslandStatus } from "@/features/judge/live/IslandStatus";
import { CLAIMS_ENGLISH, CLAIMS_TRANSLATED_LOCALES, claimsAttrs, claimsLocale, ClaimsEnglish } from "@/i18n/claims-english";
import { CLAIMS_TRANSLATED_LOCALES as SYNC_TRANSLATED_LOCALES } from "../../../scripts/i18n-sync.mjs";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import urMessages from "../../../messages/ur.json";
import { renderWithIntl } from "../../utils/intl";
import { SAMPLE_STORY } from "../../utils/story";

/*
 * F2 Task 22, ruling 1: the claims surfaces (scoreboard, day, try, governance, proof) stay English in every catalogue. In a right-to-left
 * page their content blocks carry lang="en" dir="ltr", so bidi, punctuation, hyphenation and a screen reader's voice are right; the
 * page chrome, the nav and the language chips keep the active locale and direction. The translated pieces that sit INSIDE a claims
 * block (the story footer, a banner, a stamp, the demo notice) say so with their own lang and dir, so a screen reader changes voice back.
 */

// The locale-aware Link needs the Next.js app router; only the elements it sits in matter here.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("claims blocks are English and left to right", () => {
  it("ClaimsEnglish marks its content lang=en dir=ltr without adding a box (display: contents)", () => {
    const { container } = renderWithIntl(
      <ClaimsEnglish>
        <p>Warnings</p>
      </ClaimsEnglish>,
    );
    const block = container.querySelector("[data-claims-english]");
    expect(block).toHaveAttribute("lang", "en");
    expect(block).toHaveAttribute("dir", "ltr");
    expect(block?.className).toBe("contents");
    expect(screen.getByText("Warnings").closest("[data-claims-english]")).toBe(block);
    expect(CLAIMS_ENGLISH).toEqual({ lang: "en", dir: "ltr" });
  });

  it("the replay layout wraps the judge pages in it, and the landing marks its story chapters as one English block", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/[locale]/(judge)/replay/layout.tsx"), "utf8");
    expect(layout).toMatch(/<ClaimsEnglish>\{children\}<\/ClaimsEnglish>/);
    const chapters = readFileSync(join(process.cwd(), "src/features/judge/landing/LandingSlides.tsx"), "utf8");
    expect(chapters, "judge.landing.story.* is Tier 2: the story slides are lang=en dir=ltr (the page's own in a translated locale)").toMatch(/\.\.\.useClaimsAttrs\(\), "data-claims-english": ""/);
    expect(chapters.match(/\{\.\.\.claims\}/g)?.length, "six slides carry it, 'Ways in' does not").toBe(6);
  });

  it("the proof chip and the proof drawer (judge.proof, states.proof) are claims blocks wherever they are mounted (English, or the page's own in Arabic)", () => {
    for (const file of ["ProofChip.tsx", "ProofDrawer.tsx"]) {
      expect(readFileSync(join(process.cwd(), "src/components/provenance", file), "utf8"), file).toMatch(/useClaimsAttrs/);
    }
  });
});

describe("translated pieces inside a claims block restore the page's language and direction", () => {
  it.each([
    ["ar", arMessages, "rtl"],
    ["ur", urMessages, "rtl"],
  ] as const)("%s: story footer, banner, stamp, missing-proof note, demo notice and empty state", (locale, messages, dir) => {
    const { container } = renderWithIntl(
      <>
        <StoryNav current="evidence" />
        <Banner>text</Banner>
        <Stamp kind="REPLAY" />
        <MissingProvenance what="x" />
        <SyntheticDemoBanner siteName={null} />
        <EmptyState title="t" reason="r" primary={{ label: "p", href: "/" }} />
      </>,
      { locale, messages },
    );
    const roots = [
      container.querySelector("[data-story-nav]"),
      screen.getByText("text").closest('[role="status"]'),
      screen.getByText(messages.states.stamp.replay).closest('[role="note"]'),
      screen.getByText(/x/, { selector: 'p[role="note"]' }),
      container.querySelector('div[role="note"]'),
      container.querySelector("section"),
    ];
    for (const root of roots) {
      expect(root, `${locale}: ${String(root?.tagName)}`).not.toBeNull();
      expect(root).toHaveAttribute("lang", locale);
      expect(root).toHaveAttribute("dir", dir);
    }
  });
});

describe("the waking line (states.waking) restores the page's language inside a claims block (fix round 1)", () => {
  // WakingLine is mounted in AnswerCard and TryPlanLayout, under the replay claims-English wrapper: without its own lang and dir an Urdu or
  // Arabic sentence there is announced in English and laid out left to right.
  it.each([
    ["ar", arMessages, "rtl"],
    ["ur", urMessages, "rtl"],
    ["en", enMessages, "ltr"],
  ] as const)("%s: the line's root carries the page language and direction", (locale, messages, dir) => {
    const { container } = renderWithIntl(<WakingLine />, { locale, messages });
    const root = container.querySelector("[data-waking]");
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("lang", locale);
    expect(root).toHaveAttribute("dir", dir);
  });

  it("sits inside the claims wrapper in the two replay surfaces that mount it, so the attributes matter", () => {
    for (const file of ["src/features/judge/governance/AnswerCard.tsx", "src/features/judge/validator/TryPlanLayout.tsx"]) {
      expect(readFileSync(join(process.cwd(), file), "utf8"), file).toMatch(/WakingLine/);
    }
  });
});

describe("the island status line (judge.island) is mounted inside the replay claims wrapper", () => {
  it.each([
    ["ar", arMessages, "rtl"],
    ["ur", urMessages, "rtl"],
    ["en", enMessages, "ltr"],
  ] as const)("test_island_status_restores_the_page_language_%s: the failure line carries the page's lang and dir", (locale, messages, dir) => {
    renderWithIntl(<IslandStatus failed />, { locale, messages });
    const line = screen.getByRole("status");
    expect(line).toHaveAttribute("lang", locale);
    expect(line).toHaveAttribute("dir", dir);
    expect(line).toHaveTextContent(messages.judge.island.loadFailed);
  });
});

describe("the proof chip: English for its own words, the page's language for a caller's label", () => {
  const proof: Proof = {
    what: "Alerts per shift, P3 protect",
    story: SAMPLE_STORY,
    protocol: "docs/protocol/preregistration.md#72-warnings-row",
    protocolHref: null,
    script: "backend.eval.policy_scoreboard:build_policy_scoreboard @ 661b373a1b2c",
    file: "static/recount-sample.json",
    fileSha256: "f".repeat(64),
    sourceSha256: "a".repeat(64),
    label: "REAL",
    modelId: "corrector-20261112-0000000-000001",
    generatedAt: "2026-11-12T09:14:00Z",
  };

  it("the default chip (\"Where from\", states.proof) is an English block", () => {
    renderWithIntl(<ProofChip proof={proof} />, { locale: "ur", messages: urMessages });
    expect(screen.getByRole("button")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("button")).toHaveAttribute("dir", "ltr");
  });

  it("in Arabic, whose claims are translated, the default chip is in the page's language and direction", () => {
    renderWithIntl(<ProofChip proof={proof} />, { locale: "ar", messages: arMessages });
    expect(screen.getByRole("button")).toHaveAttribute("lang", "ar");
    expect(screen.getByRole("button")).toHaveAttribute("dir", "rtl");
  });

  it("a chip with its own label (Today's \"Why Orange?\") keeps the page's language and direction", () => {
    renderWithIntl(<ProofChip proof={proof} label="نارنجی کیوں؟" />, { locale: "ur", messages: urMessages });
    expect(screen.getByRole("button")).toHaveAttribute("lang", "ur");
    expect(screen.getByRole("button")).toHaveAttribute("dir", "rtl");
  });
});

describe("claims surfaces format in English, except in a locale whose claims are translated (Arabic)", () => {
  const dir = join(process.cwd(), "src/features/judge");
  const walk = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(path, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(path, entry.name)] : []));
  // The landing page is translated copy (Tier 1) and formats in the page language; every other judge file is a claims surface.
  const claimsFiles = [...walk(dir).filter((file) => !file.split(String.fromCharCode(92)).join("/").includes("/landing/")), join(process.cwd(), "src/components/charts/SeasonPlayer.tsx")];

  it("a claims view reads the page locale only through claimsLocale(): a locale that is not translated gets English dates, numbers and lists", () => {
    expect(claimsFiles.length).toBeGreaterThan(20);
    const readsLocale = claimsFiles.filter((file) => /useLocale\s*\(|getLocale\s*\(/.test(readFileSync(file, "utf8")));
    const raw = readsLocale.filter((file) => !/claimsLocale\(\s*(useLocale|getLocale)\(\)/.test(readFileSync(file, "utf8")) && !/claimsLocale/.test(readFileSync(file, "utf8"))).map((file) => file.slice(process.cwd().length + 1));
    expect(raw).toEqual([]);
  });

  it("claimsLocale and claimsAttrs: Arabic follows the page, the other languages stay English and left to right", () => {
    expect(claimsLocale("en")).toBe("en");
    expect(claimsLocale("ar")).toBe("ar");
    for (const locale of ["ur", "hi", "bn", "ne"]) {
      expect(claimsLocale(locale), locale).toBe("en");
      expect(claimsAttrs(locale), locale).toEqual(CLAIMS_ENGLISH);
    }
    expect(claimsAttrs("ar")).toEqual({ lang: "ar", dir: "rtl" });
  });

  it("the list of translated locales is the same in the page code and in i18n-sync (the catalogue rule)", () => {
    expect([...CLAIMS_TRANSLATED_LOCALES]).toEqual([...SYNC_TRANSLATED_LOCALES]);
  });
});
