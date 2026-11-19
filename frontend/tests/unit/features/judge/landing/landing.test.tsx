import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { isDeferredRoute } from "@/components/states/deferred-routes";
import { makeFormat } from "@/features/judge/adapters";
import { parseHourlySeries } from "@/features/judge/facts";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { buildEvidence } from "@/features/judge/landing/evidence";
import { HEAT_NUMBER } from "@/features/judge/landing/landing-colour";
import { LandingView } from "@/features/judge/landing/LandingView";
import { ROLE_DOOR_DESTINATIONS } from "@/features/judge/landing/role-door-destinations";
import urMessages from "../../../../../messages/ur.json";
import { JARGON } from "../../../../utils/jargon";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * The landing page on the REAL committed files (redesign S10, "Real Earth"): the hero's first HTML (skip link first, the h1, the lede, the two
 * links), the rail, the seven chapters in order, the evidence bars and the two big verdict numbers equal to the scored file and to the submission
 * ledger, the plain claims (no win claim, nothing unledgered), the jargon lint over everything the page says, and the stylesheet's own rules (every
 * selector scoped, nothing soft, snapping only on the landing).
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/en" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const { loadEval } = await import("@/features/judge/data");
const { loadFieldHero } = await import("@/features/judge/landing/field-server");

const root = path.resolve(import.meta.dirname, "../../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;
const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;
const hourly = {
  series: parseHourlySeries(json(`data/${HOURLY}`)),
  file: { path: HOURLY, sha256: DATA_MANIFEST[HOURLY].sha256 },
  source: DATA_MANIFEST[HOURLY].source,
};
const data = await loadEval({ dataRoot: path.join(root, "data"), production: true });
const field = await loadFieldHero(hourly, path.join(root, "data"));
if (data.policy === null) throw new Error("the 2026 Warnings file is not in data/eval/2026");
const policy = data.policy;
const format = makeFormat("en");

const LEDGER = process.env["SB_LEDGER"] ?? "D:/dev/stellar-blaze/docs/submission/numbers.json";
const ledger: Readonly<Record<string, { value: number }>> | null = existsSync(LEDGER)
  ? (JSON.parse(readFileSync(LEDGER, "utf8")) as { entries: Record<string, { value: number }> }).entries
  : null;

/** What the architect's claim rules forbid on any scoreboard, landing, day or proof surface (English), plus the landing's own. */
const FORBIDDEN = /calibrated|catches 90|fewer alerts than|best overall|highest CSI|beats every|beats ADOSH|robust|consistently|improved over static|untouched|tamper-proof|restricted members|immediately|\b58\s?%|clinically reviewed|certified|compliant|in-UAE|prevents|saves lives/i;

const view = (dataOverride = data) => renderWithIntl(<LandingView field={field} data={dataOverride} dir="ltr" />);
const SLIDES = ["morning", "plan", "boundary", "evidence", "checks", "ways", "limits"] as const;

describe("the landing page: the hero and the rail", () => {
  it("test_first_focusable_is_skip_link: the first tabbable element is 'Skip to the scoreboard', to /replay", () => {
    const { container } = view();
    const first = container.querySelector<HTMLElement>("a[href], button, select, input, [tabindex]:not([tabindex='-1'])");
    expect(first).toHaveAttribute("href", "/replay");
    expect(first).toHaveTextContent("Skip to the scoreboard");
  });

  it("promises first: one h1, 'Plan tomorrow's heat tonight.', a lede that says what the product does, and the two links to the story and to the demo", () => {
    const { container } = view();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Plan tomorrow's heat tonight.");
    expect(container.querySelector(".lede")).toHaveTextContent("We forecast it a day ahead and give every crew a plan and every worker a warning.");
    expect(container.querySelector("a.btn")).toHaveAttribute("href", "#morning");
    expect(container.querySelector("a.quiet")).toHaveAttribute("href", "#ways");
  });

  it("the stage is complete without script: the legend, the source line, the attribution and the caption that says the map is an illustration", () => {
    const { container } = view();
    const stage = container.querySelector("#forecast");
    expect(stage).toHaveTextContent("Heavy-work limit 26.6 °C WBGT (NIOSH REL)");
    expect(stage).toHaveTextContent("ECMWF IFS, day-1 forecast, 3 Sep 2026");
    expect(stage).toHaveTextContent("An illustration of one hot day, not the day we scored.");
    expect(stage?.querySelector(".attr")).toHaveTextContent(field.attribution);
    expect(field.attribution).toMatch(/NASA/);
    expect(stage?.querySelectorAll(".chips i")).toHaveLength(5);
    // the limit and the class steps in the legend are the field's own constants, never typed in the markup
    expect([...(stage?.querySelectorAll(".chl span") ?? [])].map((s) => s.textContent)).toEqual(["none", "26.6", "30", "33", "36"]);
  });

  it("the hero's words are a sibling of the map box, never inside it (a text block inside the positioned map was painted over by the canvas and the still image on narrow screens)", () => {
    const { container } = view();
    const body = container.querySelector("#forecast .body");
    expect(body?.querySelector(":scope > .txt h1")).not.toBeNull();
    expect(body?.querySelector(":scope > .mapwrap")).not.toBeNull();
    expect(container.querySelector(".mapwrap .txt")).toBeNull();
    expect(container.querySelector(".mapwrap h1")).toBeNull();
  });

  it("the giant caption numbers take the heat colour of the ramp, set once on the page's root from the one constant the scene's shader also reads", () => {
    const { container } = view();
    expect(container.querySelector<HTMLElement>(".lp")?.style.getPropertyValue("--heat")).toBe(HEAT_NUMBER);
    expect(HEAT_NUMBER).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it("has the seven chapters in order, each slide one screen (`section.sl`) with its own h2, and the rail's seven links point at them", () => {
    const { container } = view();
    const ids = [...container.querySelectorAll("section[id]")].map((s) => s.id);
    expect(ids).toEqual(["forecast", ...SLIDES]);
    for (const id of SLIDES) {
      const section = container.querySelector(`section#${id}`);
      expect(section, id).toHaveClass("ch", "sl");
      expect(section?.querySelectorAll("h2"), id).toHaveLength(1);
      expect(section?.getAttribute("aria-labelledby"), id).toBe(section?.querySelector("h2")?.id);
    }
    expect([...container.querySelectorAll(".idx a")].map((a) => a.getAttribute("href"))).toEqual(["#forecast", "#morning", "#plan", "#boundary", "#evidence", "#ways", "#limits"]);
    expect(container.querySelectorAll('.idx a[aria-current="true"]')).toHaveLength(1);
    // which one is current is the scroll listener's call (a test DOM has no layout: it reads "the foot of the page"); the server's first HTML marks chapter 1
  });

  it("keeps the language picker reachable in the rail, under the demo note", () => {
    const { container } = view();
    const rail = container.querySelector("nav.rail");
    expect(rail).toHaveTextContent("Demo. The crews and people are made up.");
    expect(rail?.querySelector("select")).not.toBeNull();
  });

  it("the way in: four doors in the fixed order, each a link with its one-line promise, the first with 'No account'; the destinations are the one constant", () => {
    const { container } = view();
    const doors = [...container.querySelectorAll<HTMLAnchorElement>("[data-role-door] a")];
    expect(doors.map((a) => a.getAttribute("data-role"))).toEqual(["worker", "crew", "safety", "review"]);
    expect(doors.map((a) => a.getAttribute("href"))).toEqual(Object.values(ROLE_DOOR_DESTINATIONS));
    expect(doors[0]).toHaveTextContent("No account");
  });
});

describe("the landing page: the story", () => {
  it("the chapters are English blocks (Tier 2): lang=en dir=ltr on every slide but 'Ways in'; the hero and the door are not", () => {
    const { container } = view();
    for (const id of ["morning", "plan", "boundary", "evidence", "checks", "limits"]) {
      expect(container.querySelector(`section#${id}`), id).toHaveAttribute("lang", "en");
      expect(container.querySelector(`section#${id}`), id).toHaveAttribute("dir", "ltr");
    }
    expect(container.querySelector("section#ways")).not.toHaveAttribute("lang");
    expect(container.querySelector("section#forecast")).not.toHaveAttribute("lang");
  });

  it("the morning: four levels with the app's own words, the made-up day labelled Demo, the strip coloured from the recorded forecast", () => {
    const { container } = view();
    const cards = [...container.querySelectorAll("#morning .st")];
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.querySelector(".lv")?.textContent)).toEqual(["Green", "Amber", "Orange", "Red"]);
    expect(cards.map((c) => c.querySelector(".t")?.textContent)).toEqual(["06:00", "08:40", "11:20", "14:00"]);
    expect(cards[3]).toHaveTextContent("Stop work");
    expect(container.querySelector("#morning .tag")).toHaveTextContent("Demo");
    expect(container.querySelectorAll("#morning .spine .heat i")).toHaveLength(12);
  });

  it("tonight's plan: the crew lead's view, Stop work is one tap, and the picture says the crews are made up", () => {
    const { container } = view();
    const plan = container.querySelector("#plan");
    expect(plan).toHaveTextContent("Follows the ADOSH heat rules. Stop work in one tap.");
    expect(plan?.querySelector("svg.fg")).toHaveAccessibleName(/Crew A, Crew C, Crew D\. Stop work, Crew A\./);
    expect(plan).toHaveTextContent("Demo site: the crews and times are made up.");
    expect(plan?.querySelector("a")).toHaveAttribute("href", "/supervisor");
  });

  it("the boundary: Asked, Refused, Seen, and it links to the recorded refusal", () => {
    const { container } = view();
    const panels = [...container.querySelectorAll("#boundary .pn")];
    expect(panels.map((p) => p.querySelector(".pl")?.textContent)).toEqual(["1Asked", "2Refused", "3Seen"]);
    expect(container.querySelector("#boundary")).toHaveTextContent("The service holds none.");
    expect(container.querySelector("#boundary a")).toHaveAttribute("href", "/replay/governance");
  });

  it("what this does not show yet: the four limits, the video panel, and 'For auditors' opens the proof sheet's auditor record", () => {
    const { container } = view();
    const limits = container.querySelector("#limits");
    expect([...(limits?.querySelectorAll(".lim li") ?? [])].map((li) => li.textContent)).toEqual([
      "One summer, one airport station.",
      "No worker outcomes yet.",
      "No clinician review yet. Translations are machine-made.",
      "Made-up demo data, hosted in France. Built for UAE North.",
    ]);
    expect(limits?.querySelector("[data-video-panel]")).toHaveAttribute("data-video-panel", "soon");
    expect(limits?.querySelector('a[href*="#audit"]')?.getAttribute("href")).toMatch(/^\/replay\/proof\/.+#audit$/);
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("the evidence slides: every number is read from the scored file and equals the ledger", () => {
  const bars = () => {
    const { container } = view();
    return [...container.querySelectorAll<HTMLElement>("[data-bars] li")];
  };

  it("draws four bars, longest first, each labelled with the plain name of the way of warning (no policy codes)", () => {
    const list = bars();
    expect(list.map((li) => li.getAttribute("data-policy"))).toEqual(["P0", "P2", "P3_protect", "P1"]);
    expect(list.map((li) => li.querySelector(".lab b")?.textContent)).toEqual(["Midday break only", "Regulator's zones, raw forecast", "Stellar Blaze, protective setting", "Fixed 32 °C rule"]);
    expect(list.filter((li) => li.classList.contains("ours")).map((li) => li.getAttribute("data-policy"))).toEqual(["P3_protect"]);
  });

  it("the danger hours not warned about and the false-alarm hours equal the policy file's own values", () => {
    const rows = policy.leads.find((lead) => lead.lead_days === 1)?.rows ?? [];
    for (const li of bars()) {
      const row = rows.find((r) => r.policy === li.getAttribute("data-policy"));
      expect(row, li.getAttribute("data-policy") ?? "").toBeDefined();
      expect(li.querySelector("[data-bar-missed]")).toHaveTextContent(format.one(row?.missed_danger_hours.value ?? NaN));
      expect(li.querySelector("[data-bar-missed]")?.getAttribute("data-count")).toBe(String(row?.missed_danger_hours.value));
      expect(li.querySelector("[data-bar-false-alarms]")).toHaveTextContent(`False-alarm hours: ${format.one(row?.false_alarm_hours.value ?? NaN)}`);
    }
  });

  it.runIf(ledger !== null)("and equal the submission ledger: 252.5, 80.5, 45.5, 19.0 danger hours; 0.0, 74.5, 183.5, 276.5 false-alarm hours", () => {
    const expected = { P0: [252.5, 0], P2: [80.5, 74.5], P3_protect: [45.5, 183.5], P1: [19, 276.5] } as const;
    for (const li of bars()) {
      const id = li.getAttribute("data-policy") as keyof typeof expected;
      const [missed, alarms] = expected[id];
      expect(ledger?.[`warn.l1.${id}.missed_danger_hours`]?.value, id).toBe(missed);
      expect(ledger?.[`warn.l1.${id}.false_alarm_hours`]?.value, id).toBe(alarms);
      expect(li.querySelector("[data-bar-missed]")?.textContent, id).toBe(format.one(missed));
      expect(li.querySelector("[data-bar-false-alarms]")?.textContent, id).toBe(`False-alarm hours: ${format.one(alarms)}`);
    }
  });

  it("the longest bar is the full length, the others are in proportion to their own numbers, and the axis ends on the longest number", () => {
    const list = bars();
    const shares = list.map((li) => Number(li.style.getPropertyValue("--v")));
    const missed = list.map((li) => Number(li.querySelector("[data-bar-missed]")?.getAttribute("data-count")));
    expect(shares[0]).toBe(1);
    for (const [i, s] of shares.entries()) expect(s, String(i)).toBeCloseTo((missed[i] ?? 0) / (missed[0] ?? 1), 10);
    const { container } = view();
    expect(container.querySelector("#evidence .axis .ax span:last-child")).toHaveTextContent(format.one(missed[0] ?? NaN));
  });

  it("the two big numbers are the structured fields of the verdicts (H4: danger hours missed fewer than the midday break; H5: false-alarm hours more than the regulator's zones), not a reading of a sentence", () => {
    const evidence = buildEvidence(data, format, (() => "") as never);
    expect(evidence).not.toBeNull();
    const h4 = policy.verdicts.find((v) => v.id === "H4")?.comparisons.find((c) => c.subject === "P3_protect" && c.baseline === "P0" && c.metric === "missed_danger_hours");
    const h5 = policy.verdicts.find((v) => v.id === "H5")?.comparisons.find((c) => c.subject === "P3_protect" && c.baseline === "P2" && c.metric === "false_alarm_hours");
    expect(evidence?.headlines.find((h) => h.id === "H4")?.valueRaw).toBe(Math.abs(h4?.difference.value ?? NaN));
    expect(evidence?.headlines.find((h) => h.id === "H5")?.valueRaw).toBe(Math.abs(h5?.difference.value ?? NaN));
    const { container } = view();
    const numbers = [...container.querySelectorAll("#checks .vn")].map((n) => n.textContent);
    expect(numbers).toEqual([format.one(Math.abs(h4?.difference.value ?? NaN)), `+${format.one(Math.abs(h5?.difference.value ?? NaN))}`]);
    // and on the committed 2026 file they are the numbers the submission quotes
    expect(numbers).toEqual(["207.0", "+109.0"]);
  });

  it("says each check's status from the file's own flag, and 'We do not claim to beat them' stays next to the regulator's zones; nothing says Stellar Blaze beats anything", () => {
    const { container } = view();
    const cards = [...container.querySelectorAll("#checks .vc")];
    expect(cards.map((c) => c.querySelector(".vs")?.textContent)).toEqual(["Met", "Not met"]);
    expect(cards[0]).toHaveTextContent("fewer danger hours missed than the midday break alone");
    expect(cards[1]).toHaveTextContent("more false-alarm hours than the regulator's own zones. We do not claim to beat them.");
    expect(container.querySelector("#checks")?.textContent).not.toMatch(/\bbeats?\b(?! them)/i);
    expect(container.querySelector("#evidence")?.textContent).not.toMatch(/\bbeats?\b/i);
    expect(container.querySelector("#checks")?.textContent).not.toMatch(/\bH[0-9]\b|supported at lead/);
    for (const verdict of policy.verdicts.filter((v) => v.id === "H4" || v.id === "H5")) expect(container.textContent, verdict.id).not.toContain(verdict.text);
  });

  it("shows no number without a record: with no scored file the evidence slide says so, the checks keep their link, and the page keeps its hero", () => {
    const { container } = view(null as never);
    expect(container.querySelector("[data-bars]")).toBeNull();
    expect(container.querySelector("#evidence")).toHaveTextContent("The scored results are not available in this build.");
    expect(container.querySelector("#checks .vc")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("the landing page: what it says", () => {
  it("never prints the unledgered season counts: no 1,624, 279, 139 or '370 of 374' anywhere on the page (D9)", () => {
    const { container } = view();
    expect(container.textContent).not.toMatch(/1,?624|\b279\b|\b139\b|370 of 374/);
  });

  it("has no jargon in the rendered text: no file paths, hashes, protocol, policy codes, hypothesis ids, theta, lead N, epoch or export keys", () => {
    const { container } = view();
    for (const [name, pattern] of JARGON) expect(container.textContent, name).not.toMatch(pattern);
  });

  it("says nothing the claim rules forbid, no em or en dash in the English copy, no emoji, and no 'real-time' or 'in-UAE'", () => {
    const { container } = view();
    const text = container.textContent;
    expect(text.length).toBeGreaterThan(1500);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/real-time/i);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    const landing = JSON.stringify((JSON.parse(readFileSync(path.join(root, "messages/en.json"), "utf8")) as { judge: { landing: unknown } }).judge.landing);
    expect(landing).not.toMatch(FORBIDDEN);
    expect(landing).not.toMatch(/[\u2013\u2014]/);
  });

  it("links only to routes that exist or are the page's own anchors, never to a deferred view", () => {
    const { container } = view();
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(14);
    const known = new Set(["/replay", "/replay/governance", "/supervisor", "/worker", "/supervisor/enter", "/hse/enter", "/tour", "#forecast", "#morning", "#plan", "#boundary", "#evidence", "#ways", "#limits"]);
    for (const href of hrefs) {
      if (href.startsWith("/replay/proof/")) continue;
      expect(known.has(href), href).toBe(true);
      expect(isDeferredRoute(href), href).toBe(false);
    }
  });

  it("in Urdu the hero, the rail and the door are translated and the chapters stay English: no Arabic-script text of its own inside a lang=en block", () => {
    const { container } = renderWithIntl(<LandingView field={field} data={data} dir="rtl" />, { locale: "ur", messages: urMessages });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(urMessages.judge.landing.title);
    expect(container.querySelector("[data-role-door] a")).toHaveTextContent(urMessages.judge.landing.door.worker.title);
    expect(container.querySelector(".idx a")).toHaveTextContent(urMessages.judge.landing.rail.forecast);
    const arabic = /[\u0600-\u06FF\u0750-\u077F]/;
    const blocks = [...container.querySelectorAll("[lang='en']")];
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    const leaks: string[] = [];
    for (const block of blocks) {
      const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
        const text = n.textContent ?? "";
        if (!arabic.test(text)) continue;
        // a translated piece that restores the page language with its own lang attribute is allowed (the chapter mark, the four levels)
        const own = n.parentElement?.closest("[lang]");
        if (own !== null && own !== undefined && own !== block && own.getAttribute("lang") !== "en") continue;
        leaks.push(text.trim().slice(0, 60));
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe("the stylesheet (src/styles/landing.css)", () => {
  const css = readFileSync(path.join(root, "src/styles/landing.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("nothing soft: no shadow, blur, glow or gradient (flat surfaces, hairlines, tonal steps)", () => {
    expect(css).not.toMatch(/box-shadow|text-shadow|drop-shadow|backdrop-filter|filter:|blur\(|gradient\(/);
  });

  it("every selector is scoped under .lp, so nothing leaks into the app; scroll snapping is on the landing only (`html:has(.lp)`)", () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? "").trim()).filter((s) => s !== "" && !s.startsWith("@"));
    expect(selectors.length).toBeGreaterThan(100);
    for (const group of selectors) for (const sel of group.split(",")) expect(sel.trim().startsWith(".lp") || sel.trim().startsWith("html:has(.lp)"), sel.trim()).toBe(true);
    expect(css.match(/scroll-snap-type/g)).toHaveLength(1);
    expect(css).toMatch(/html:has\(\.lp\) \{ scroll-snap-type: y mandatory; \}/);
  });

  it("links look like links: the app's reset takes the underline off every anchor, so the page's base rule puts it back (the buttons, the door rows and the rail opt out)", () => {
    expect(css).toMatch(/\.lp a \{[^}]*text-decoration-line: underline/);
    expect(css).toMatch(/\.lp a\.btn, \.lp \.door a \{ text-decoration-line: none; \}/);
    expect(css).toMatch(/\.lp \.idx a \{[^}]*text-decoration: none/);
  });

  it("snaps only where a hand drives the wheel and motion is not reduced, on a wide and tall screen", () => {
    const block = /@media \(min-width: 1100px\) and \(min-height: 600px\) and \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(css);
    expect(block?.[1]).toContain("scroll-snap-type: y mandatory");
    expect(block?.[1]).toContain("scroll-snap-stop: always");
  });
});
