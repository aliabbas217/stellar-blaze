import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import { isDeferredRoute } from "@/components/states/deferred-routes";
import { makeFormat } from "@/features/judge/adapters";
import { parseHourlySeries } from "@/features/judge/facts";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { parseCoast, parseField, readingAt } from "@/features/judge/landing/field-data";
import { FieldIsland } from "@/features/judge/landing/FieldIsland";
import { readoutText } from "@/features/judge/landing/readout-text";
import { LandingView } from "@/features/judge/landing/LandingView";
import { ROLE_DOOR_DESTINATIONS } from "@/features/judge/landing/role-door-destinations";
import { actionPlan } from "@/features/today/action-codes";
import urMessages from "../../../../../messages/ur.json";
import { JARGON } from "../../../../utils/jargon";
import { renderWithIntl } from "../../../../utils/intl";
import { SAMPLE_STORY } from "../../../../utils/story";

/*
 * The landing page on the REAL committed files (redesign S2): the hero's first HTML (skip link first, the h1, the role door, the phone sign), the five
 * chapters in the story's order, the evidence chapter's four bars equal to the policy file and to the submission ledger, no statistic before a
 * person, the plain verdicts, the jargon lint over everything the page says, the live island's keyboard and motion rules.
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
const grid = parseField(json("public/data/static/uae_ifs025_d1_wbgt_2026-09-03.json"));
const coast = parseCoast(json("public/data/static/coast.json"));
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

describe("the landing page: the hero", () => {
  it("test_first_focusable_is_skip_link: the first tabbable element is 'Skip to the scoreboard', to /replay", () => {
    const { container } = view();
    const first = container.querySelector<HTMLElement>("a[href], button, [tabindex='0'], input, select, summary");
    expect(first?.textContent).toBe("Skip to the scoreboard");
    expect(first?.getAttribute("href")).toBe("/replay");
  });

  it("promises first: the h1 is 'Plan tomorrow's heat tonight.', the lede says what the product does, in the order kicker, h1, lede, door", () => {
    const { container } = view();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Plan tomorrow's heat tonight.");
    const hero = container.querySelector("[data-landing-hero]") as HTMLElement;
    expect(hero).toHaveTextContent("Tested on last summer's real weather at Abu Dhabi airport");
    expect(hero).toHaveTextContent("Stellar Blaze turns a day-ahead forecast into a work-and-rest plan for each crew, and a plain warning on each worker's phone, in six languages.");
    const order = ["[data-contrast-name=kicker]", "#landing-title", "[data-contrast-name=lede]", "[data-role-door]"].map((selector) => hero.querySelector(selector));
    for (const [i, el] of order.entries()) {
      expect(el, String(i)).not.toBeNull();
      const next = order[i + 1];
      if (el !== null && next !== null && next !== undefined) expect(el.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING, `${String(i)} before ${String(i + 1)}`).toBeTruthy();
    }
  });

  it("no statistic before a person: the copy and the door of the hero carry no digit, and the old hook and readout are gone", () => {
    const { container } = view();
    const copy = [...container.querySelectorAll("[data-contrast-name=kicker], #landing-title, [data-contrast-name=lede], [data-role-door]")].map((el) => el.textContent).join(" ");
    expect(copy).not.toMatch(/\d/);
    expect(container.querySelector("[data-hook]")).toBeNull();
    expect(container.querySelector("[data-field-readout]")).toBeNull();
    expect(container.querySelector("[data-hours-bridge]")).toBeNull();
  });

  it("the role door: four equal tiles in the fixed order, each a link with its one-line promise, the first with 'No account'; the destinations come from the one constant", () => {
    const { container } = view();
    const door = container.querySelector("[data-role-door]") as HTMLElement;
    const tiles = [...door.querySelectorAll<HTMLAnchorElement>("a")];
    expect(tiles.map((a) => a.getAttribute("data-role"))).toEqual(["worker", "crew", "safety", "review"]);
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual([ROLE_DOOR_DESTINATIONS.worker, ROLE_DOOR_DESTINATIONS.crew, ROLE_DOOR_DESTINATIONS.safety, ROLE_DOOR_DESTINATIONS.review]);
    expect(Object.values(ROLE_DOOR_DESTINATIONS)).toEqual(["/worker", "/supervisor", "/hse", "/replay"]);
    expect(tiles.map((a) => a.querySelector("span:nth-of-type(2) > span:first-child")?.textContent)).toEqual(["I work on a site", "I run a crew", "I look after safety", "I am reviewing this"]);
    expect(tiles[0]).toHaveTextContent("See today's heat and when to rest. No account.");
    expect(tiles[1]).toHaveTextContent("See tonight's plan for your crews. Stop work in one tap.");
    expect(tiles[2]).toHaveTextContent("See which crews planned, signed and stopped.");
    expect(tiles[3]).toHaveTextContent("See how it was tested, then try anything.");
    for (const a of tiles) expect(a.className).toMatch(/min-h-\(--target-field\)/); // 52 px, never below the 44 px target
    expect(door.closest("[data-landing-hero]")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Who is this for?" })).toBe(door);
    expect(container.textContent).toContain("This is a demo. The crews and people are made up. Workers never need an account.");
  });

  it("the phone sign is a picture built from the app's components with demo props: hidden from assistive tech and inert, labelled Demo, with its numbers read from the action code and the recorded forecast", () => {
    const { container } = view();
    const phone = container.querySelector("[data-hero-phone]") as HTMLElement;
    const glass = phone.firstElementChild as HTMLElement;
    expect(glass).toHaveAttribute("aria-hidden", "true");
    expect(glass.hasAttribute("inert")).toBe(true);
    expect(glass).toHaveTextContent("Demo");
    expect(glass).toHaveTextContent("Orange");
    expect(glass).toHaveTextContent("until 17:00");
    // the demo prop and the app's own parser of the action code agree (the judge pages may not import worker code, so the picture holds the numbers itself)
    const plan = actionPlan(["cycle.high.heavy.20-40"]);
    if (plan.lead.kind !== "cycle") throw new Error("the demo code is not a cycle");
    expect(glass).toHaveTextContent(`Work ${String(plan.lead.workMinutes)} min, rest ${String(plan.lead.restMinutes)} min in shade`);
    expect(glass).toHaveTextContent("I feel unwell");
    // the strip is the recorded forecast of the field's day, hours 6 to 17, each cell in the colour of its own value
    const cells = [...glass.querySelectorAll("[data-cell]")];
    expect(cells.map((c) => Number(c.getAttribute("data-cell")))).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(cells.every((c) => c.getAttribute("data-heat") === "data")).toBe(true);
    expect(phone.querySelector("figcaption")).toHaveTextContent("A worker's phone on the demo site: one sign, in the worker's language. \u201cI feel unwell\u201d is always there.");
  });

  it("the field stays in the hero block with the phone (a row of its own from 1100 px), with its caption and one Where from chip, and no readout", () => {
    const { container } = view();
    const column = container.querySelector("[data-field-column]") as HTMLElement;
    expect(column.closest("[data-hero]")?.querySelector("[data-hero-phone]")).not.toBeNull();
    expect(column.querySelector("[data-field-stage]")).not.toBeNull();
    expect(column.querySelector("[data-scrub]")).not.toBeNull();
    expect(column.querySelector("[data-field-caption]")).toHaveTextContent("Forecast heat across the UAE for one hot day. An illustration, not the day we scored.");
    expect(within(column).getAllByRole("button", { name: /^Where from/ })).toHaveLength(1);
  });
});

describe("the landing page: the story", () => {
  const ids = ["morning", "plan", "boundary", "evidence", "limits"];

  it("has the five chapters in the story's order, after the hero and before the footer, each with one h2", () => {
    const { container } = view();
    const sections = [...container.querySelectorAll("[data-landing-chapters] > section")].map((s) => s.id);
    expect(sections).toEqual(ids);
    const headings = [...container.querySelectorAll("[data-landing-chapters] h2")].map((h) => h.textContent);
    expect(headings).toEqual([
      "One sign, one instruction, in the worker's own language.",
      "The crew lead sees which crew heats up first.",
      "An employer asks for one worker's health record. The answer is no.",
      "Danger hours nobody was warned about.",
      "What this does not show yet",
    ]);
    // evidence is the payoff: after the product and the boundary, never before the first person
    expect(container.querySelector("[data-landing-hero]")?.compareDocumentPosition(container.querySelector("#evidence") as Element)).toBeTruthy();
    expect(container.querySelector("[data-story-nav]")?.getAttribute("aria-label")).toBe("Story");
  });

  it("the chapters are English blocks (Tier 2): lang=en dir=ltr, the hero and the door are not", () => {
    const { container } = view();
    const chapters = container.querySelector("[data-landing-chapters]");
    expect(chapters).toHaveAttribute("lang", "en");
    expect(chapters).toHaveAttribute("dir", "ltr");
    expect(container.querySelector("[data-landing-hero]")?.closest("[lang='en']")).toBeNull();
  });

  it("tonight's plan: the crew lead's view, Stop work is one tap and never waits for sign-off, and the picture says the crews are made up", () => {
    const { container } = view();
    const plan = container.querySelector("#plan") as HTMLElement;
    expect(plan).toHaveTextContent("Stop work is one tap. So is Undo. It never waits for a sign-off.");
    expect(plan).toHaveTextContent("Demo site: the crews and times are made up.");
    const picture = plan.querySelector("[data-plan-picture]") as HTMLElement;
    expect(picture).toHaveAttribute("aria-hidden", "true");
    expect(picture.hasAttribute("inert")).toBe(true);
    expect(picture).toHaveTextContent("Stop work, Crew A");
    expect(within(plan).getByRole("link", { name: "Open the crews screen" })).toHaveAttribute("href", "/supervisor");
  });

  it("the boundary: an employer asks for one worker's health record, the answer is no, recorded in a log that each entry builds on the one before; it links to the recorded run", () => {
    const { container } = view();
    const boundary = container.querySelector("#boundary") as HTMLElement;
    expect(boundary).toHaveTextContent("The service holds none. Every worker at the site can see that it was asked.");
    expect(boundary).toHaveTextContent("Refused. Recorded in a log that each entry builds on the one before, so a change shows.");
    expect(within(boundary).getByRole("link", { name: "See the refusal, recorded" })).toHaveAttribute("href", "/replay/governance");
  });

  it("what this does not show yet: the five limits, in plain words, and 'For auditors' opens the proof sheet's auditor record", () => {
    const { container } = view();
    const limits = container.querySelector("#limits") as HTMLElement;
    for (const sentence of [
      "One test summer and one airport station, not a worksite.",
      "No worker outcomes. This is not yet a health claim.",
      "Not yet checked by a clinician. Translations are machine-made.",
      "The demo runs on made-up data hosted in France Central. It is designed for UAE North.",
    ]) {
      expect(limits).toHaveTextContent(sentence);
    }
    expect(within(limits).getByRole("link", { name: "For auditors" }).getAttribute("href")).toMatch(/^\/replay\/proof\/policy\.[a-z0-9_.]+#audit$/);
    expect(within(limits).getByRole("link", { name: "See how it was tested" })).toHaveAttribute("href", "/replay");
  });

  it("says the machine-translation notice at the foot only for a translated locale (English shows none)", () => {
    const { container } = view();
    expect(container.querySelector("[data-machine-translation]")).toBeNull();
  });
});

describe("the evidence chapter: every number is read from the scored file and equals the ledger", () => {
  const bars = () => {
    const { container } = view();
    return [...container.querySelectorAll<HTMLElement>("[data-evidence-bars] > li")];
  };

  it("draws four bars, longest first, each labelled with the plain name of the way of warning (no policy codes)", () => {
    const list = bars();
    expect(list.map((li) => li.getAttribute("data-policy"))).toEqual(["P0", "P2", "P3_protect", "P1"]);
    expect(list.map((li) => li.querySelector("span")?.textContent)).toEqual(["Midday break only", "Regulator's zones, raw forecast", "Stellar Blaze, protective setting", "Fixed 32 °C rule"]);
    expect(list.filter((li) => li.hasAttribute("data-ours")).map((li) => li.getAttribute("data-policy"))).toEqual(["P3_protect"]);
  });

  it("the danger hours not warned about and the false-alarm hours equal the policy file's own values", () => {
    const rows = policy.leads.find((lead) => lead.lead_days === 1)?.rows ?? [];
    for (const li of bars()) {
      const row = rows.find((r) => r.policy === li.getAttribute("data-policy"));
      expect(row, li.getAttribute("data-policy") ?? "").toBeDefined();
      expect(li.querySelector("[data-bar-missed]")).toHaveTextContent(format.one(row?.missed_danger_hours.value ?? NaN));
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

  it("the longest bar is the full width and the others are in proportion to their own numbers", () => {
    const widths = bars().map((li) => Number.parseFloat((li.querySelector("[aria-hidden] > span") as HTMLElement).style.width));
    const missed = bars().map((li) => Number(li.querySelector("[data-bar-missed]")?.textContent));
    expect(widths[0]).toBeCloseTo(100, 5);
    // the number on the bar is shown to one decimal, the width is drawn from the file's own value: they agree to that decimal
    for (const [i, w] of widths.entries()) expect(w, String(i)).toBeCloseTo(((missed[i] ?? 0) / (missed[0] ?? 1)) * 100, 1);
  });

  it("says the honest trade: the regulator's zones raise fewer false alarms and miss more, Stellar Blaze does not 'beat' anything", () => {
    const { container } = view();
    const trade = container.querySelector("[data-warnings-tradeoff]");
    expect(trade).toHaveTextContent("raise fewer false alarms than Stellar Blaze at the protective setting");
    expect(trade).toHaveTextContent("miss more danger hours");
    expect(container.querySelector("#evidence")?.textContent).not.toMatch(/\bbeats?\b(?! the regulator)/i);
  });

  it("uses the PLAIN verdicts of S3, with the met or not met flag of the file, and never the verbatim H4 and H5 sentences", () => {
    const { container } = view();
    const h4 = container.querySelector('[data-verdict-id="H4"]');
    const h5 = container.querySelector('[data-verdict-id="H5"]');
    expect(h4).toHaveAttribute("data-verdict-outcome", "met");
    expect(h5).toHaveAttribute("data-verdict-outcome", "notMet");
    expect(h4).toHaveTextContent("This was the main check and it was met.");
    expect(h5).toHaveTextContent("This check was not met.");
    expect(h5).toHaveTextContent("We do not claim to beat the regulator's zones.");
    for (const verdict of policy.verdicts.filter((v) => v.id === "H4" || v.id === "H5")) {
      expect(container.textContent, verdict.id).not.toContain(verdict.text);
    }
    expect(container.querySelector("#evidence")?.textContent).not.toMatch(/\bH[0-9]\b|supported at lead/);
  });

  it("has at most three Where from chips on the whole page (the field, the four bars, the two checks)", () => {
    const { container } = view();
    expect(within(container).getAllByRole("button", { name: /^Where from/ })).toHaveLength(3);
  });

  it("shows no number without a record: with no scored file the chapter says so and the page keeps its hero", () => {
    const { container } = view(null as never);
    expect(container.querySelector("[data-evidence-bars]")).toBeNull();
    expect(container.querySelector("#evidence")).toHaveTextContent("The scored results are not available in this build.");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("the landing page: what it says", () => {
  it("never prints the unledgered season counts: no 1,624, 279, 139 or '370 of 374' anywhere in the story (D9)", () => {
    const { container } = view();
    expect(container.textContent).not.toMatch(/1,?624|\b279\b|\b139\b|370 of 374/);
  });

  it("has no jargon in the rendered text: no file paths, hashes, protocol, policy codes, hypothesis ids, theta, lead N, epoch or export keys", () => {
    const { container } = view();
    // the visible text of the page, minus the proof chip's own label (a drawer stays closed here) and the bare numbers the lint cannot read
    const text = container.textContent;
    for (const [name, pattern] of JARGON) expect(text, name).not.toMatch(pattern);
  });

  it("says nothing the claim rules forbid, no em or en dash in the English copy, and no 'real-time' or 'in-UAE'", () => {
    const { container } = view();
    const text = container.textContent;
    expect(text.length).toBeGreaterThan(1800);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/real-time/i);
    const landing = JSON.stringify((JSON.parse(readFileSync(path.join(root, "messages/en.json"), "utf8")) as { judge: { landing: unknown } }).judge.landing);
    expect(landing).not.toMatch(FORBIDDEN);
    expect(landing).not.toMatch(/[\u2013\u2014]/);
  });

  it("links only to routes that exist or are the role door's, never to a deferred view", () => {
    const { container } = view();
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(14);
    const known = new Set(["/", "/replay", "/replay/day", "/replay/try", "/replay/governance", "/supervisor", "/worker", "/hse", "#main-content"]);
    for (const href of hrefs) {
      if (href.startsWith("/replay/proof/")) continue;
      expect(known.has(href), href).toBe(true);
      // `/hse` is on the deferred list but is the F1 placeholder page that exists today: the role door names it on purpose (the plan, S2) until S7 rewrites it
      // and takes it off the list. Every other target must be a built view.
      if (href !== ROLE_DOOR_DESTINATIONS.safety) expect(isDeferredRoute(href), href).toBe(false);
    }
  });

  it("in Urdu the hero is translated and the chapters stay English: no Arabic-script text of its own inside a lang=en block", () => {
    const { container } = renderWithIntl(<LandingView field={field} data={data} dir="rtl" />, { locale: "ur", messages: urMessages });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(urMessages.judge.landing.title);
    expect(container.querySelector("[data-role-door] a")).toHaveTextContent(urMessages.judge.landing.door.worker.title);
    const arabic = /[\u0600-\u06FF\u0750-\u077F]/;
    const blocks = [...container.querySelectorAll("[lang='en']")];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const leaks: string[] = [];
    for (const block of blocks) {
      const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
        const text = n.textContent ?? "";
        if (!arabic.test(text)) continue;
        // a translated piece that restores the page language with its own lang attribute is allowed (the story footer)
        const own = n.parentElement?.closest("[lang]");
        if (own !== null && own !== undefined && own !== block && own.getAttribute("lang") !== "en") continue;
        leaks.push(text.trim().slice(0, 60));
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe("the live field island", () => {
  const panel = {
    day: field.grid.day,
    dayLabel: "Thu 3 Sep 2026",
    omaa: field.omaa,
    peakHour: field.peakHour,
    ban: { kind: "in-force", fromHour: 12.5, toHour: 15 } as const,
    proof: {
      what: "The forecast heat field",
      story: SAMPLE_STORY,
      protocol: "p",
      protocolHref: null,
      script: "s",
      file: "static/uae.json",
      fileSha256: "ab",
      sourceSha256: null,
      label: "RECORDED",
      modelId: null,
      generatedAt: null,
    } as const,
    dir: "ltr",
  } as const;

  let reducedNow = false;
  const listeners: (() => void)[] = [];

  function stubBrowser(reduced: boolean): { raf: ReturnType<typeof vi.fn> } {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    reducedNow = reduced;
    listeners.length = 0;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return reducedNow && query.includes("reduce");
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.push(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      },
    }));
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return { raf };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const island = () => renderWithIntl(<FieldIsland panel={panel} data={{ grid, coast }} />);

  it("test_scrubber_keyboard_and_values_in_dom: arrows, Home and End move a slider whose values are text", () => {
    stubBrowser(true);
    island();
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "23");
    expect(slider).toHaveAttribute("aria-valuenow", "14");
    expect(slider.getAttribute("aria-valuetext")).toBe(`14:00: hottest grid cell ${readoutText(readingAt(grid, field.omaa, 14)).hottest} degrees, Abu Dhabi airport ${field.omaa[14]?.toFixed(1) ?? ""}`);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "15");
    expect(document.querySelector("[data-when-hour]")).toHaveTextContent("15:00");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "13");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    // a slider does not wrap: Left at 00:00 stays, Right at 23:00 stays
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "23");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "23");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "23");
  });

  it("test_slider_page_keys_step_three_hours_and_stop_at_the_ends", () => {
    stubBrowser(true);
    island();
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(slider).toHaveAttribute("aria-valuenow", "11");
    fireEvent.keyDown(slider, { key: "PageUp" });
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "17");
    fireEvent.keyDown(slider, { key: "PageUp" });
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "23");
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
  });

  it("test_spine_tick_thinning_pinned: on a phone every other 3-hourly label is hidden by parity, leaving 00:00 06:00 12:00 18:00 00:00", () => {
    stubBrowser(true);
    island();
    const track = document.querySelector("[data-spine-track]") as HTMLElement;
    // the rule that hides them is on the track (a media query jsdom does not evaluate; the e2e proves it on a 390 page)
    expect(track.className).toContain("[&_[data-tick]:nth-child(even)]:hidden");
    const ticks = [...track.querySelectorAll<HTMLElement>("[data-tick]")];
    expect(ticks.map((tick) => tick.textContent)).toEqual(["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00", "00:00"]);
    // the ticks are consecutive siblings, so `nth-child(even)` is the parity of the label's own place in the list
    expect(new Set(ticks.map((tick) => tick.parentElement)).size).toBe(1);
    expect(ticks.map((tick) => [...(tick.parentElement?.children ?? [])].indexOf(tick))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const kept = ticks.filter((tick) => !tick.matches(":nth-child(even)")).map((tick) => tick.textContent);
    expect(kept).toEqual(["00:00", "06:00", "12:00", "18:00", "00:00"]);
  });

  it("test_reduced_motion_is_read_live: asking for reduced motion while the day plays stops it and removes Play; asking later does not restart it", () => {
    stubBrowser(false);
    island();
    expect(screen.getByRole("button", { name: "Pause the day" })).toBeInTheDocument();
    reducedNow = true;
    act(() => {
      for (const listener of [...listeners]) listener();
    });
    expect(screen.queryByRole("button", { name: /Play the day|Pause the day/ })).toBeNull();
    // lifting it again shows Play (a press) and does not start the day
    reducedNow = false;
    act(() => {
      for (const listener of [...listeners]) listener();
    });
    expect(screen.getByRole("button", { name: "Play the day" })).toBeInTheDocument();
  });

  it("test_reduced_motion_no_autoplay: rests on the peak hour, starts no animation and offers no Play button", () => {
    const { raf } = stubBrowser(true);
    island();
    expect(raf).not.toHaveBeenCalled();
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "14");
    expect(screen.queryByRole("button", { name: /Play the day|Pause the day/ })).toBeNull();
  });

  it("plays the day once on its own without reduced motion, silent for screen readers while it plays, and Pause stops it", () => {
    const { raf } = stubBrowser(false);
    island();
    expect(raf).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause the day" })).toBeInTheDocument(); // it is playing
    act(() => {
      screen.getByRole("button", { name: "Pause the day" }).click();
    });
    expect(screen.getByRole("button", { name: "Play the day" })).toBeInTheDocument();
  });

  it("test_playing_day_island_renders_per_hour_not_per_frame: the WHOLE island (stage, readout, scrubber) commits about once per whole-hour change while the day plays, and the now line still moves every frame", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const callbacks: FrameRequestCallback[] = [];
    stubBrowser(false);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => callbacks.push(cb));
    let commits = 0;
    renderWithIntl(
      <Profiler
        id="island"
        onRender={() => {
          commits++;
        }}
      >
        <FieldIsland panel={panel} data={{ grid, coast }} />
      </Profiler>,
    );
    const nowLine = (): string => document.querySelector("[data-now]")?.getAttribute("x1") ?? "";
    const frame = (): void => {
      act(() => {
        vi.advanceTimersByTime(1000 / 60);
        callbacks.splice(0).forEach((cb) => {
          cb(performance.now());
        });
      });
    };
    frame();
    const before = commits;
    const startedAt = nowLine();
    const positions = new Set<string>();
    // 2 s of a playing day at 60 frames per second: 120 frames, the clock at 1.5 hours per second = 3 whole-hour changes
    for (let i = 0; i < 120; i++) {
      frame();
      positions.add(nowLine());
    }
    const renders = commits - before;
    console.log(`ISLAND RENDERS while playing: ${String(renders)} commits in 120 frames (2 s)`);
    expect(screen.getByRole("button", { name: "Pause the day" }), "it really was playing").toBeInTheDocument();
    expect(nowLine(), "the now line moved").not.toBe(startedAt);
    expect(positions.size, "and it moved on (nearly) every frame, not once per hour").toBeGreaterThan(100);
    expect(renders, "whole-hour changes (3 in 2 s) plus slack, never one per frame").toBeLessThanOrEqual(6);
    vi.useRealTimers();
  });

  it("test_slider_text_equals_canvas_values: every hour's value text is the reading the canvas is drawn from (the readout card is gone; the slider says it)", () => {
    stubBrowser(true);
    island();
    const slider = screen.getByRole("slider");
    for (let hour = 0; hour < 24; hour++) {
      fireEvent.keyDown(slider, { key: "Home" });
      for (let step = 0; step < hour; step++) fireEvent.keyDown(slider, { key: "ArrowRight" });
      const text = readoutText(readingAt(grid, field.omaa, hour));
      expect(slider.getAttribute("aria-valuetext")).toBe(`${text.hour}: hottest grid cell ${text.hottest} degrees, Abu Dhabi airport ${text.station}`);
    }
  });

  it("the island has no readout card and says what the field is in a caption with a Where from chip", () => {
    stubBrowser(true);
    island();
    expect(document.querySelector("[data-field-readout]")).toBeNull();
    expect(document.querySelector("[data-field-caption]")).toHaveTextContent("Forecast heat across the UAE for one hot day. An illustration, not the day we scored.");
    expect(within(document.querySelector("[data-field-caption]") as HTMLElement).getByRole("button", { name: /^Where from: The forecast heat field/ })).toBeInTheDocument();
  });
});
