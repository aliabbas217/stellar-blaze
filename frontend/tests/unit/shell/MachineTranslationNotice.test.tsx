import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { routing, type Locale } from "@/i18n/routing";
import enMessages from "../../../messages/en.json";
import arMessages from "../../../messages/ar.json";
import bnMessages from "../../../messages/bn.json";
import hiMessages from "../../../messages/hi.json";
import neMessages from "../../../messages/ne.json";
import urMessages from "../../../messages/ur.json";
import { renderWithIntl } from "../../utils/intl";

/*
 * F2 Task 22, architect ruling 2026-11-15: no banner and no badge on the main screens. Every non-English locale shows ONE quiet
 * line in a settings or about area (here: the worker's Alerts page, which holds "Remove my data"; the foot of the two supervisor
 * screens; the foot of the landing page). It renders only while the active catalogue is not `source` or `reviewed`.
 */

const CATALOGUES = { en: enMessages, ar: arMessages, bn: bnMessages, hi: hiMessages, ne: neMessages, ur: urMessages } as const;

describe("MachineTranslationNotice", () => {
  it("is absent in the source language", () => {
    const { container } = renderWithIntl(<MachineTranslationNotice />, { locale: "en", messages: enMessages });
    expect(container).toBeEmptyDOMElement();
  });

  it.each(routing.locales.filter((locale) => locale !== "en"))("shows the line once, in %s, in that language's own words and direction", (locale: Locale) => {
    const messages = CATALOGUES[locale];
    const { container } = renderWithIntl(<MachineTranslationNotice />, { locale, messages });
    const lines = container.querySelectorAll("[data-machine-translation]");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent(messages.shell.machineTranslation);
    expect(messages.shell.machineTranslation).not.toBe(enMessages.shell.machineTranslation);
    expect(lines[0]).toHaveAttribute("lang", locale);
    expect(lines[0]).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
  });

  it("says what the architect asked for in the English source", () => {
    expect(enMessages.shell.machineTranslation).toBe("Machine translation, not yet reviewed by a native speaker");
  });

  it("is absent once a native speaker has reviewed the file", () => {
    const reviewed = { ...hiMessages, _meta: { review_status: "reviewed" } };
    const { container } = renderWithIntl(<MachineTranslationNotice />, { locale: "hi", messages: reviewed });
    expect(container).toBeEmptyDOMElement();
  });

  it("is a quiet paragraph, not a banner: no role, no live region, no border or fill", () => {
    renderWithIntl(<MachineTranslationNotice />, { locale: "ur", messages: urMessages });
    const line = screen.getByText(urMessages.shell.machineTranslation);
    expect(line.tagName).toBe("P");
    expect(line).not.toHaveAttribute("role");
    expect(line).not.toHaveAttribute("aria-live");
    expect(line.className).not.toMatch(/\b(border|bg-|shadow|rounded)/);
  });

  it("is a safety-adjacent string: listed in _meta.safety_keys", () => {
    expect(enMessages._meta.safety_keys).toContain("shell.machineTranslation");
  });
});

// Where the line may be mounted. The badge it replaced is gone for good: a regression that puts either back on a main screen fails here.
const SRC = join(process.cwd(), "src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const rel = (path: string) => path.slice(SRC.length + 1).replaceAll("\\", "/");

describe("where the machine-translation line is mounted", () => {
  const sources = files(SRC).map((path) => ({ path: rel(path), text: readFileSync(path, "utf8") }));

  it("is mounted on exactly the placed surfaces: Alerts (worker privacy area), the two supervisor screens' foot, the landing foot, and (S7) the safety view, the role entries, the front door and the tour", () => {
    const mounts = sources.filter(({ path, text }) => !path.endsWith("MachineTranslationNotice.tsx") && /<MachineTranslationNotice\b/.test(text)).map(({ path }) => path).sort();
    expect(mounts).toEqual([
      "app/[locale]/(hse)/hse/HseView.tsx",
      "app/[locale]/(worker)/worker/(app)/alerts/page.tsx",
      "app/[locale]/start/page.tsx",
      "app/[locale]/tour/page.tsx",
      "components/shell/RoleEntry.tsx",
      "features/judge/landing/LandingView.tsx",
      "features/supervisor/CrewsView.tsx",
      "features/supervisor/plan/PlanView.tsx",
    ]);
  });

  it("each placed surface mounts it once", () => {
    for (const { path, text } of sources.filter(({ text }) => /<MachineTranslationNotice\b/.test(text))) {
      expect(text.match(/<MachineTranslationNotice\b/g)?.length, path).toBe(1);
    }
  });

  it("the draft badge and its strings are gone", () => {
    expect(sources.filter(({ text }) => /DraftBadge|draftTranslation/.test(text)).map(({ path }) => path)).toEqual([]);
  });
});
