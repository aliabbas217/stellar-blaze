import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import { isDeferredRoute } from "@/components/states/deferred-routes";
import { parseHourlySeries, seasonFacts } from "@/features/judge/facts";
import { SEASON_BAN } from "@/features/judge/ban";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { parseCoast, parseField, readingAt } from "@/features/judge/landing/field-data";
import { FieldIsland } from "@/features/judge/landing/FieldIsland";
import { readoutText } from "@/features/judge/landing/FieldReadout";
import { LandingView } from "@/features/judge/landing/LandingView";
import urMessages from "../../../../../messages/ur.json";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * The landing page on the REAL committed files: the hero's first HTML (skip link first, the h1, one primary action, the
 * hook from the scored file), chapter 1's counts with their proofs, chapter 2's table and verdicts, the live island's
 * keyboard and motion rules, and the claim-rule scan over everything the page says.
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
const facts = seasonFacts(hourly.series, SEASON_BAN, HEAVY_WORK_LIMIT_WBGT_C);

/** What the architect's claim rules forbid on any scoreboard, landing, day or proof surface (English), plus the landing's own. */
const FORBIDDEN = /calibrated|catches 90|fewer alerts than|best overall|highest CSI|beats every|beats ADOSH|robust|consistently|improved over static|untouched|tamper-proof|restricted members|immediately|\b58\s?%/i;
const EXPORT_KEY = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

const view = (dataOverride = data) => renderWithIntl(<LandingView field={field} hourly={hourly} data={dataOverride} dir="ltr" />);

describe("the landing page", () => {
  it("test_first_focusable_is_skip_link: the first tabbable element is 'Skip to the scoreboard', to /replay", () => {
    const { container } = view();
    const first = container.querySelector<HTMLElement>("a[href], button, [tabindex='0'], input, select, summary");
    expect(first?.textContent).toBe("Skip to the scoreboard");
    expect(first?.getAttribute("href")).toBe("/replay");
  });

  it("has the h1 from the messages, one primary action and a secondary that walks to the problem", () => {
    const { container } = view();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Heat that stops work, forecast about 24 hours ahead.");
    const primary = container.querySelectorAll("[data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent("See the scoreboard");
    expect(primary[0]?.getAttribute("href")).toBe("/replay");
    expect(screen.getByRole("link", { name: "Walk me through it" })).toHaveAttribute("href", "#problem");
    expect(container.querySelector("#problem")).not.toBeNull();
    expect(container.querySelector("[data-hero]")).not.toBeNull();
  });

  it("test_no_page_language_text_inside_a_claims_block: in Urdu every lang=en block of the landing (the sr-only table caption included) holds no Arabic-script text of its own", () => {
    const { container } = renderWithIntl(<LandingView field={field} hourly={hourly} data={data} dir="rtl" />, { locale: "ur", messages: urMessages });
    const blocks = [...container.querySelectorAll("[lang='en']")];
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    const arabic = /[؀-ۿݐ-ݿ]/;
    const leaks: string[] = [];
    for (const block of blocks) {
      const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
        const text = n.textContent ?? "";
        if (!arabic.test(text)) continue;
        // a translated piece that restores the page language with its own lang attribute is allowed (a banner, the story footer)
        const own = n.parentElement?.closest("[lang]");
        if (own !== null && own !== undefined && own !== block && own.getAttribute("lang") !== "en") continue;
        leaks.push(text.trim().slice(0, 60));
      }
    }
    expect(leaks).toEqual([]);
  });

  it("test_hero_controls_are_label_obstacles: both buttons and the hook's Proof chip carry data-avoid (a station name is kept clear of them)", () => {
    const { container } = view();
    const hero = container.querySelector("[data-landing-hero]") as HTMLElement;
    const avoided = [...hero.querySelectorAll("[data-avoid]")];
    expect(avoided.map((el) => el.textContent.trim())).toEqual(expect.arrayContaining(["See the scoreboard", "Walk me through it"]));
    const chip = hero.querySelector("[data-hook] button") as HTMLElement;
    expect(chip.closest("[data-avoid]")).not.toBeNull();
    expect(avoided).toHaveLength(3);
  });

  it("states the readout at the peak hour in the first HTML, with the station value, the limit and the proof", () => {
    const { container } = view();
    const readout = container.querySelector("[data-field-readout]");
    const expected = readoutText(readingAt(grid, field.omaa, field.peakHour));
    expect(field.peakHour).toBe(14);
    expect(readout).toHaveTextContent(`Hottest grid cell at ${expected.hour}`);
    expect(readout?.querySelector("[data-readout-hottest]")).toHaveTextContent(`${expected.hottest}°C`);
    expect(readout?.querySelector("[data-readout-station]")).toHaveTextContent(`${expected.station} °C`);
    expect(readout).toHaveTextContent("26.6 °C");
    expect(readout).toHaveTextContent("not as the day we scored");
    expect(within(readout as HTMLElement).getByRole("button", { name: /^Proof for The forecast heat field/ })).toBeInTheDocument();
  });

  it("the hook is the station's danger-hour count read from the scored file, with its definition and a proof (never typed, never the 58 percent)", () => {
    const { container } = view();
    const metric = policy.leads.find((lead) => lead.lead_days === 1)?.truth_danger_hours;
    if (metric?.ci == null) throw new Error("fixture: no interval");
    const hook = container.querySelector("[data-hook]");
    expect(hook).toHaveTextContent(metric.value.toFixed(1));
    expect(hook).toHaveTextContent(`${metric.ci.lo.toFixed(1)} to ${metric.ci.hi.toFixed(1)}, 95% interval`);
    expect(hook).toHaveTextContent(policy.working_hours_utc);
    // The hour range is a left-to-right run inside a sentence that may be Arabic or Urdu: it is isolated (LRI ... PDI) so "06:00-14:59 UTC" is never shown reversed.
    expect(hook?.textContent).toContain(`${String.fromCharCode(0x2066)}${policy.working_hours_utc}${String.fromCharCode(0x2069)}`);
    expect(hook).toHaveTextContent(`${String(policy.margin_w_m2)} W/m² is an assumption`);
    // what the truth is: "observation-derived truth" (the architect's demo story), against the ADOSH High or Red zone
    expect(hook).toHaveTextContent("is decided by observation-derived truth");
    expect(hook).not.toHaveTextContent("recorded observations");
    expect(hook).toHaveTextContent("ADOSH High or Red zone");
    expect(within(hook as HTMLElement).getByRole("button", { name: /Proof for/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/58/);
  });

  it("test_hours_bridge: one line says the season's raw-forecast hours and the danger hours count different things against different limits, with both numbers read from the files", () => {
    const { container } = view();
    const metric = policy.leads.find((lead) => lead.lead_days === 1)?.truth_danger_hours;
    const bridge = container.querySelector("[data-hours-bridge]");
    expect(bridge).not.toBeNull();
    expect(bridge).toHaveTextContent(`These ${facts.over.toLocaleString("en-US")} hours and the ${metric?.value.toFixed(1) ?? "?"} danger hours`);
    expect(bridge).toHaveTextContent("different things against different limits");
    expect(bridge).toHaveTextContent(`${String(HEAVY_WORK_LIMIT_WBGT_C)} °C heavy-work limit`);
    expect(bridge).toHaveTextContent("ADOSH High or Red zone");
    expect(container.querySelectorAll("[data-hours-bridge]")).toHaveLength(1);
  });

  it("has no bridge without the hook: with no scored file there is no danger-hour count to reconcile", () => {
    const { container } = view(null as never);
    expect(container.querySelector("[data-hours-bridge]")).toBeNull();
  });

  it("the lede says what the product does, not 'every outdoor crew', and the sub-hook line does not claim every number is a recorded file's", () => {
    const { container } = view();
    const text = container.textContent;
    expect(text).not.toMatch(/every outdoor crew/i);
    expect(text).toContain("for the crews on a worksite, shift by shift");
    expect(text).not.toContain("Each number on this page comes from a recorded file");
    expect(text).toContain("Every figure about the season and the scores comes from a recorded file");
  });

  it("drops the hook, not the page, when there is no scored file", () => {
    const { container } = view(null as never);
    expect(container.querySelector("[data-hook]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("test_problem_counts_have_proofs: the three counts are the season facts of the file, each with a proof chip", () => {
    const { container } = view();
    const counts = container.querySelector("[data-problem-counts]") as HTMLElement;
    expect(facts.over).toBe(1624);
    expect(facts.inBan).toBe(279);
    expect(facts.daysOver).toBe(139);
    for (const [id, value] of [["hours", facts.over], ["inBan", facts.inBan], ["days", facts.daysOver]] as const) {
      const item = counts.querySelector(`[data-count="${id}"]`) as HTMLElement;
      expect(item, id).not.toBeNull();
      expect(item).toHaveTextContent(value.toLocaleString("en-US"));
      expect(within(item).getByRole("button", { name: /^Proof for/ }), id).toBeInTheDocument();
    }
    expect(counts).toHaveTextContent(`of ${facts.n.toLocaleString("en-US")} working hours`);
    // the counts are labelled as the recorded raw forecast before correction, never as hours that were over a limit
    expect(container.querySelector("[data-season-caption]")).toHaveTextContent("Recorded raw forecast, before correction. These are not hours that were actually over the limit");
    expect(counts).toHaveTextContent("raw forecast");
  });

  it("the calendar has a table alternative whose rows add up to the same counts", () => {
    const { container } = view();
    const table = container.querySelector("[data-calendar-table] table") as HTMLElement;
    const rows = [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => Number(cell.textContent.replaceAll(",", ""))));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.reduce((sum, row) => sum + (row[0] ?? 0), 0)).toBe(facts.n);
    expect(rows.reduce((sum, row) => sum + (row[1] ?? 0), 0)).toBe(facts.over);
    expect(rows.reduce((sum, row) => sum + (row[2] ?? 0), 0)).toBe(facts.inBan);
    const chart = container.querySelector("[data-calendar] svg[role=img]");
    expect(chart?.getAttribute("aria-label")).toContain(`${facts.over.toLocaleString("en-US")} of ${facts.n.toLocaleString("en-US")} hours are above the 26.6 °C heavy-work limit`);
    // non-vacuous: the break is cut in for exactly the days it is in force
    expect(container.querySelector("[data-calendar] .fill-slot")).not.toBeNull();
  });

  it("chapter 2 shows all four ways to warn (P3 at both thetas), the baseline labelled, and the run's verdicts verbatim", () => {
    const { container } = view();
    const table = container.querySelector("#scoreboard table[data-scoreboard]") as HTMLElement;
    for (const row of ["P0", "P1", "P2", "P3_protect", "P3_balanced"]) expect(table.querySelector(`[data-row="${row}"]`), row).not.toBeNull();
    expect(table).toHaveTextContent("Baseline: ban only");
    expect(table.querySelector('[data-row="P3_protect"] th')).toHaveTextContent("Stellar Blaze");
    const missed = policy.leads.find((lead) => lead.lead_days === 1)?.rows.find((row) => row.policy === "P1")?.missed_danger_hours.value;
    expect(table.querySelector('[data-row="P1"]')).toHaveTextContent((missed ?? NaN).toFixed(1));
    for (const id of ["H4", "H5"]) {
      const verdict = policy.verdicts.find((v) => v.id === id);
      expect(verdict, id).toBeDefined();
      expect(container.querySelector(`[data-verdict-id="${id}"]`)?.textContent).toContain(verdict?.text);
    }
    // the unfavourable verdict is shown beside the favourable one
    expect(container.querySelector('[data-verdict-id="H5"]')).toHaveTextContent("not supported");
    expect(screen.getByRole("link", { name: "Open the scoreboard" })).toHaveAttribute("href", "/replay");
  });

  it("links only to routes that exist, never to a deferred view", () => {
    const { container } = view();
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(8);
    const built = new Set(["/", "/replay", "/replay/day", "/replay/try", "/replay/governance", "/supervisor", "/worker", "#problem", "#main-content"]);
    for (const href of hrefs) {
      if (href.startsWith("/replay/proof/")) continue;
      expect(built.has(href), href).toBe(true);
      expect(isDeferredRoute(href), href).toBe(false);
    }
  });

  it("says nothing the claim rules forbid and renders no export key as copy", () => {
    const { container } = view();
    const text = container.textContent;
    expect(text.length).toBeGreaterThan(2000);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(EXPORT_KEY);
    const messages = JSON.stringify((JSON.parse(readFileSync(path.join(root, "messages/en.json"), "utf8")) as { judge: { landing: unknown } }).judge.landing);
    expect(messages).not.toMatch(FORBIDDEN);
    expect(messages).not.toMatch(/[–—]/);
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
    highestOfSeason: true,
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
    // test_readout_text_equals_canvas_values: the readout names the hour's own hottest cell
    expect(document.querySelector("[data-readout-hottest]")).toHaveTextContent(`${readoutText(readingAt(grid, field.omaa, 15)).hottest}°C`);
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
    expect(document.querySelector("[data-readout-where]")).toHaveTextContent(/^\d\d\.\d\d N \d\d\.\d\d E$/);
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

  it("test_live_region_is_smaller_than_the_card: only the hour, hottest and airport sentence is live, not the eight nodes of the card", () => {
    stubBrowser(true);
    island();
    const card = document.querySelector("[data-field-readout]") as HTMLElement;
    const live = document.querySelector("[data-readout-live]") as HTMLElement;
    expect(card).not.toHaveAttribute("aria-live");
    expect(card.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(card.contains(live)).toBe(true);
    const sentence = `14:00: hottest grid cell ${readoutText(readingAt(grid, field.omaa, 14)).hottest} degrees, Abu Dhabi airport ${field.omaa[14]?.toFixed(1) ?? ""}`;
    expect(live.textContent).toBe(sentence);
    expect(live.textContent.length).toBeLessThan(card.textContent.length / 2);
    expect(live).toHaveAttribute("aria-live", "polite");
    // an arrow press changes the live sentence and nothing else of the card is a live region
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(live.textContent).toContain("15:00");
    expect(card.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("test_no_double_announce_on_the_slider: while the slider has focus the readout sentence is not live (the slider's own value text is heard once); it is live again on blur", () => {
    stubBrowser(true);
    island();
    const slider = screen.getByRole("slider");
    const live = document.querySelector("[data-readout-live]") as HTMLElement;
    expect(live).toHaveAttribute("aria-live", "polite");
    act(() => {
      slider.focus();
    });
    expect(live).toHaveAttribute("aria-live", "off");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(live).toHaveAttribute("aria-live", "off");
    // the slider carries the same words, so nothing is lost: its value text is the live sentence
    expect(slider.getAttribute("aria-valuetext")).toBe(live.textContent);
    act(() => {
      slider.blur();
    });
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("test_spine_tick_thinning_pinned: on a phone every other 3-hourly label is hidden by parity, leaving 00:00 06:00 12:00 18:00 00:00", () => {
    stubBrowser(true);
    island();
    const track = document.querySelector("[data-spine-track]") as HTMLElement;
    // the rule that hides them is on the track (a media query jsdom does not evaluate; the e2e proves it on a 390 page)
    expect(track.className).toContain("max-[899px]:[&_[data-tick]:nth-child(even)]:hidden");
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
    expect(document.querySelector("[data-readout-live]")).toHaveAttribute("aria-live", "polite");
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
    expect(document.querySelector("[data-readout-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("plays the day once on its own without reduced motion, silent for screen readers while it plays, and Pause stops it", () => {
    const { raf } = stubBrowser(false);
    island();
    expect(raf).toHaveBeenCalled();
    expect(document.querySelector("[data-readout-live]")).toHaveAttribute("aria-live", "off");
    act(() => {
      screen.getByRole("button", { name: "Pause the day" }).click();
    });
    expect(screen.getByRole("button", { name: "Play the day" })).toBeInTheDocument();
    expect(document.querySelector("[data-readout-live]")).toHaveAttribute("aria-live", "polite");
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
    expect(Number(document.querySelector("[data-readout-live]")?.getAttribute("aria-live") === "off")).toBe(1); // it really was playing
    expect(nowLine(), "the now line moved").not.toBe(startedAt);
    expect(positions.size, "and it moved on (nearly) every frame, not once per hour").toBeGreaterThan(100);
    expect(renders, "whole-hour changes (3 in 2 s) plus slack, never one per frame").toBeLessThanOrEqual(6);
    vi.useRealTimers();
  });

  it("test_readout_text_equals_canvas_values: every hour's readout equals the reading the canvas is drawn from", () => {
    stubBrowser(true);
    island();
    const slider = screen.getByRole("slider");
    for (let hour = 0; hour < 24; hour++) {
      fireEvent.keyDown(slider, { key: "Home" });
      for (let step = 0; step < hour; step++) fireEvent.keyDown(slider, { key: "ArrowRight" });
      const text = readoutText(readingAt(grid, field.omaa, hour));
      expect(document.querySelector("[data-readout-hottest]")).toHaveTextContent(`${text.hottest}°C`);
      expect(document.querySelector("[data-readout-cells]")).toHaveTextContent(`${text.cells} of ${text.cellsTotal}`);
    }
  });
});
