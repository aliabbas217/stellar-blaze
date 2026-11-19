import { readFileSync } from "node:fs";
import path from "node:path";
import { act, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { dayFormat } from "@/components/charts/day-format";
import { parseHourlySeries } from "@/features/judge/facts";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { LIMIT_C } from "@/features/judge/landing/field-data";
import { CAPTION_HOURS } from "@/features/judge/landing/landing-captions";
import { hourOf, stepOf } from "@/features/judge/landing/landing-camera";
import { LandingView } from "@/features/judge/landing/LandingView";
import { dirFor } from "@/i18n/direction";
import type { Locale } from "@/i18n/routing";
import ar from "../../../../../messages/ar.json";
import bn from "../../../../../messages/bn.json";
import en from "../../../../../messages/en.json";
import hi from "../../../../../messages/hi.json";
import ne from "../../../../../messages/ne.json";
import ur from "../../../../../messages/ur.json";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * The pinned forecast scene's three captions are drawn over the map only; a screen reader gets the same three facts as a visually hidden, always
 * present text summary (SceneSummary). This test renders the REAL page with the scene stubbed (no WebGL in a test DOM), scrolls the pinned section
 * to the three rest states and asserts, in all six languages, that what the summary says is word for word what the captions on screen say, that
 * the numbers are the recorded forecast's own (counted here from the raw grid, not by the code under test), and that the summary stays out of the layout.
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
// the WebGL scene is not testable in a DOM: a stub with the three calls the stage makes
vi.mock("@/features/judge/landing/landing-scene", () => ({
  createScene: () => ({ ll: () => ({ x: 0, z: 0 }), set: () => undefined, dispose: () => undefined }),
}));

const { loadEval } = await import("@/features/judge/data");
const { loadFieldHero } = await import("@/features/judge/landing/field-server");

const root = path.resolve(import.meta.dirname, "../../../../..");
const FIELD_FILE = "data/static/uae_ifs025_d1_wbgt_2026-09-03.json";
const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;
const hourly = {
  series: parseHourlySeries(JSON.parse(readFileSync(path.join(root, "data", HOURLY), "utf8")) as unknown),
  file: { path: HOURLY, sha256: DATA_MANIFEST[HOURLY].sha256 },
  source: DATA_MANIFEST[HOURLY].source,
};
const data = await loadEval({ dataRoot: path.join(root, "data"), production: true });
const field = await loadFieldHero(hourly, path.join(root, "data"));
const rawField = JSON.parse(readFileSync(path.join(root, FIELD_FILE), "utf8")) as { lat: number[]; lon: number[]; wbgt_c: number[][][] } /* [lat][lon][hour] */;

const CATALOGUES = { en, ar, ur, hi, bn, ne } as const;
const LOCALES = Object.keys(CATALOGUES) as Locale[];
const STEPS = [
  { key: "cells", step: 1, progress: 0.45, hour: 9 },
  { key: "hottest", step: 2, progress: 0.7, hour: 14 },
  { key: "station", step: 3, progress: 0.9, hour: 14 },
] as const;
const WINDOW_HEIGHT = 768;
const SECTION_HEIGHT = 4 * WINDOW_HEIGHT;

/** What the test DOM cannot do: images that decode, files that load, a layout. The pinned section's box is set from a progress the test chooses. */
let progress = 0;
function stubBrowser(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.stubGlobal("fetch", (url: string) => {
    if (url.endsWith("uae-dem.bin")) return Promise.resolve(new Response(new ArrayBuffer(8)));
    if (url.endsWith("uae-geo.json")) return Promise.resolve(new Response("{}"));
    if (url.endsWith("uae_ifs025_d1_wbgt_2026-09-03.json")) return Promise.resolve(new Response(readFileSync(path.join(root, FIELD_FILE), "utf8")));
    return Promise.reject(new Error(`unexpected request ${url}`));
  });
  HTMLImageElement.prototype.decode = () => Promise.resolve();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = this.id === "forecast" ? -progress * (SECTION_HEIGHT - WINDOW_HEIGHT) : 0;
    const height = this.id === "forecast" ? SECTION_HEIGHT : 0;
    return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) };
  });
}

async function scrollTo(to: number): Promise<void> {
  progress = to;
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve(undefined);
      });
    });
  });
}

const words = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** What a caption on screen says, in reading order: its small line, then its number and unit, its sentence and its second line. */
function onScreen(stage: HTMLElement, step: number): { eyebrow: string; body: string } {
  const caption = stage.querySelector(`.s${String(step)}`);
  const part = (selector: string): string => words(caption?.querySelector(selector)?.textContent);
  return { eyebrow: part(".eb"), body: [part(".n"), part(".un"), part(".sen"), part(".sen2")].filter((p) => p !== "").join(" ") };
}

beforeEach(() => {
  stubBrowser();
  progress = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Hours hold at 06:00, 09:00 and 14:00 and the step follows the scroll: the rest hours the summary uses are the ones the camera table holds. */
describe("the scene's rest states", () => {
  it("the summary's three hours are the hours the scroll holds for the three captions, in the order the captions come", () => {
    for (const s of STEPS) {
      expect(stepOf(s.progress), s.key).toBe(s.step);
      expect(Math.floor(hourOf(s.progress)), s.key).toBe(s.hour);
      expect(CAPTION_HOURS[s.key], s.key).toBe(s.hour);
    }
  });
});

describe.each(LOCALES)("the scene summary, %s", (locale) => {
  const render = () => renderWithIntl(<LandingView field={field} data={data} dir={dirFor(locale)} />, { locale, messages: CATALOGUES[locale] });

  it("is in the first HTML, before any script runs, as a list of three items with the language's own name, and it takes no room", () => {
    const { container } = render();
    const summary = container.querySelector<HTMLElement>("[data-scene-summary]");
    expect(summary).not.toBeNull();
    expect(summary?.tagName).toBe("UL");
    expect(summary).toHaveAttribute("aria-label", CATALOGUES[locale].judge.landing.scene.summary);
    expect(summary).toHaveClass("sr-only");
    expect(summary?.querySelectorAll("li")).toHaveLength(3);
    // the unit of the drawn captions is its own left-to-right run, so an Arabic-script page cannot draw it as "C°"
    const units = [...container.querySelectorAll("#forecast .big .un")];
    expect(units).toHaveLength(2);
    for (const unit of units) expect(unit).toHaveAttribute("dir", "ltr");
    // nothing of the summary is drawn: the stage's visible layout (the figure's header, body and footer) does not hold it
    expect(summary?.closest("figure.inst")?.querySelector(".body")?.contains(summary)).toBe(false);
    expect(summary?.closest("figure.inst")?.querySelector(".ik")?.contains(summary)).toBe(false);
  });

  it("says, for the three rest states, word for word what the captions on screen say", async () => {
    const { container } = render();
    const stage = container.querySelector<HTMLElement>("#forecast");
    await waitFor(() => {
      expect(stage).toHaveAttribute("data-scene", "live");
    });
    const items = [...container.querySelectorAll("[data-scene-summary] li")].map((li) => [...li.querySelectorAll("p")].map((p) => words(p.textContent)));
    expect(items).toHaveLength(3);
    for (const [i, s] of STEPS.entries()) {
      await scrollTo(s.progress);
      expect(stage?.querySelector(".stage")).toHaveAttribute("data-step", String(s.step));
      const shown = onScreen(stage as HTMLElement, s.step);
      expect(shown.eyebrow, `${s.key} small line`).not.toBe("");
      expect(shown.body, `${s.key} body`).not.toBe("");
      expect(items[i], `${s.key}: the summary item is the caption's two lines`).toEqual([shown.eyebrow, shown.body]);
    }
  });

  it("holds the recorded forecast's own numbers, counted here from the raw grid", () => {
    const { container } = render();
    const cells = rawField.lat.length * rawField.lon.length;
    const at = (hour: number): number[] => rawField.wbgt_c.flatMap((row) => row.map((cell) => cell[hour] ?? NaN));
    const above = (hour: number): number => at(hour).filter((v) => v > LIMIT_C).length;
    const hottest = (hour: number): number => Math.max(...at(hour));
    const text = [...container.querySelectorAll("[data-scene-summary] li")].map((li) => words(li.textContent));
    const t = CATALOGUES[locale].judge.landing.scene;
    const fill = (template: string, values: Record<string, string>): string => Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), template);
    expect(text[0]).toContain(`${String(above(CAPTION_HOURS.cells))} ${fill(t.cells, { total: String(cells), limit: LIMIT_C.toFixed(1) })}`);
    expect(text[1]).toContain(`${hottest(CAPTION_HOURS.hottest).toFixed(1)} °C`);
    expect(text[1]).toContain(fill(t.hottest, { hour: "14:00" }));
    expect(text[2]).toContain(`${(field.omaa[CAPTION_HOURS.station] ?? NaN).toFixed(1)} °C`);
    expect(text[2]).toContain(fill(t.station, { station: CATALOGUES[locale].judge.landing.field.stations.OMAA, hour: "14:00" }));
    // the first line of each is the hour and the day, in the language's own format
    const day = field.grid.day;
    const date = `${dayFormat(locale).dayMonth(day)} ${day.slice(0, 4)}`;
    expect(text[0]).toContain(fill(t.eyebrow, { hour: "09:00", date }));
    expect(text[1]).toContain(fill(t.eyebrow, { hour: "14:00", date }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
