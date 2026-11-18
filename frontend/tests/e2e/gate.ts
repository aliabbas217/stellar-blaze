import type { Page } from "@playwright/test";
import { axeViolations } from "./axe.ts";
import { consoleLineToRecord, requestFailure, responseError, UNBUILT_CORE_ROUTES } from "./gate-console.ts";

/*
 * The deterministic half of the design gate (F2 plan, "Design gate protocol" item 2). Every view's e2e calls `gateReport`
 * on the state it renders and asserts `report.failures` is empty; the numbers it measured are returned too, so a gate
 * run can print them. The pixel half (look at the PNG, the independent critique) is not automatable and is not here.
 *
 *   console clean            no console error and no uncaught exception since `watchConsole`
 *   overflow                 no horizontal scroll: scrollWidth minus clientWidth is 0
 *   text size                every rendered text node is at least 12 px; on a field surface the time and level labels
 *                            (`time`, `[data-level-word]`, `[data-time-label]`) are at least 16 px
 *   targets                  every control is at least 24 px square (44 px on a field surface); an inline link inside a
 *                            sentence is exempt, as WCAG 2.5.8 exempts it
 *   axe                      WCAG 2.2 A and AA, zero violations
 *   hero                     the `[data-hero]` area inside the first fold is at least 35 % of the fold (at the viewport the
 *                            caller sets: 1440x900 for a judge view, 390x844 for a field view)
 *   primary                  at most one `[data-primary]` in the first fold, `[data-emergency]` (the unwell call, Stop work)
 *                            not counted
 *   spine                    a `[data-spine]` where the view has one (`spine: true`)
 *   view transitions         React applies `view-transition-name` while a transition runs, so it cannot be read at rest;
 *                            what is asserted is that the carriers (`[data-spine]`, the wordmark link) exist, that no element
 *                            carries a STATIC name outside root, wordmark, spine, level, unwell, and that no name repeats
 *   copy                     no visible text matching /ADR \d|HANDOFF|\bB[123]\b/, and in English no em or en dash
 */

export const MIN_TEXT_PX = 12;
export const MIN_FIELD_LABEL_PX = 16;
export const MIN_TARGET_PX = 24;
export const MIN_FIELD_TARGET_PX = 44;
export const MIN_HERO_SHARE = 0.35;

/**
 * Hero shares below the 35 % floor that were RECORDED instead of fixed (F2 Task 22, ruling 5), keyed `<state>:<locale>`, with the number
 * measured at 390 x 844 when it was recorded. tests/e2e/hero-share.spec.ts holds each to its number minus RECORDED_HERO_TOLERANCE, so an
 * exception can only improve; an entry is removed the day its state meets the floor. The Urdu "partial" Today state (a banner above the
 * sign) is the older exception recorded in worker-today-notlive.spec.ts.
 */
export type HeroKey = {
  readonly state: "today-live" | "today-personal" | "today-partial" | "today-not-live" | "alert" | "unwell" | "crews" | "plan";
};
export const RECORDED_HERO_EXCEPTIONS: Readonly<Record<string, number>> = {
  // EMPTY since the Today restructure (redesign S5, 2026-11-18). The four exceptions that stood here (Urdu Today live 33.2 %, personal
  // 26.4 %, partial 19.2 %, and Arabic partial 32.8 %) were recorded because the 76 px (64 px in Arabic script) level word and the
  // vertical spine left too little of the first fold to the hero in the languages with the tallest line heights. Today's hero is now the
  // level card (the 28 px action sentence, the 32 px level word and its scale) together with the full-width shift strip: measured at
  // 390 x 844 on 2026-11-18, every Today state in every locale is at least 58.2 % (today-live: en 59.1, ar 67.9, ur 75.4, hi 64.3, bn 69.3,
  // ne 69.3; today-personal: 66.9 to 82.1; today-partial: en 59.1, ar 67.9, ur 69.9; today-not-live, whose hero is the protective-plan
  // lead: en 58.2, ar 62.7, ur 70.4, hi 64.5, bn 78.0, ne 69.4). An entry is added again only with a measured number and a reason.
};
export const RECORDED_HERO_TOLERANCE = 0.01;

/** The `[data-hero]` area inside the first fold as a share of the fold (the same measure `gateReport` takes), or null when the page has none. */
export async function heroShareOf(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const hero = document.querySelector("[data-hero]");
    if (hero === null) return null;
    const r = hero.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    return (w * h) / (window.innerWidth * window.innerHeight);
  });
}
/** `root` is the document's own default name (the page cross-fade), not a shared element. */
export const SHARED_TRANSITION_NAMES = ["root", "wordmark", "spine", "level", "unwell"] as const;

export interface GateOptions {
  /** Console errors and exceptions collected since the page opened (`watchConsole`). */
  readonly consoleErrors: readonly string[];
  /** A worker or supervisor phone surface: 44 px targets and 16 px time and level labels. */
  readonly field?: boolean;
  /** The view has a hero and it is required (default true): the `[data-hero]` share must be reached. */
  readonly hero?: boolean;
  /** The view has a time spine: `[data-spine]` must exist. */
  readonly spine?: boolean;
  /** The language of the page: the dash rule applies to English only. */
  readonly locale?: string;
  /** Skip axe (a state that is covered by its own axe test). */
  readonly skipAxe?: boolean;
}

export interface GateReport {
  readonly overflowPx: number;
  readonly minTextPx: number;
  readonly smallTextSamples: readonly string[];
  readonly minTargetPx: number;
  readonly smallTargets: readonly string[];
  readonly minFieldLabelPx: number | null;
  readonly axeViolations: readonly string[];
  readonly heroShare: number | null;
  readonly primariesInFold: number;
  readonly spineCount: number;
  readonly transitionNames: readonly string[];
  readonly forbiddenText: readonly string[];
  /** Empty when every check passed; each entry says which check and by how much. */
  readonly failures: readonly string[];
}

export { UNBUILT_CORE_ROUTES };

/**
 * Starts collecting console errors, uncaught exceptions, HTTP errors (400 and up) and network-layer failures, each with its
 * URL (the console message for a failed resource does not say which one, and `response` never fires for a request that got
 * no response). Call before `page.goto`; pass the array to `gateReport`. The rules are in gate-console.ts. A hydration message
 * of any console type is always recorded; `warnings: true` (the console-clean gate) also records every console warning.
 */
export function watchConsole(page: Page, { warnings = false }: { readonly warnings?: boolean } = {}): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    const line = consoleLineToRecord(message.type(), message.text(), warnings);
    if (line !== null) errors.push(line);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const error = responseError(response.status(), response.url());
    if (error !== null) errors.push(error);
  });
  page.on("requestfailed", (request) => {
    const error = requestFailure(request.url(), request.failure()?.errorText);
    if (error !== null) errors.push(error);
  });
  return errors;
}

interface Measured {
  overflowPx: number;
  minTextPx: number;
  smallTextSamples: string[];
  minTargetPx: number;
  smallTargets: string[];
  minFieldLabelPx: number | null;
  heroShare: number | null;
  primariesInFold: number;
  spineCount: number;
  transitionNames: string[];
  wordmark: boolean;
  forbiddenText: string[];
}

export async function gateReport(page: Page, options: GateOptions): Promise<GateReport> {
  const field = options.field === true;
  const measured = await page.evaluate(
    ({ field: isField, textFloor, targetFloor }): Measured => {
      const visible = (el: Element): boolean => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const describe = (el: Element): string => {
        const text = el.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
        return `${el.tagName.toLowerCase()}${el.id === "" ? "" : `#${el.id}`}${text === "" ? "" : ` "${text}"`}`;
      };

      // text size: the element that owns each non-empty text node
      let minText = Infinity;
      const smallText: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "") continue;
        const owner = node.parentElement;
        if (owner === null || owner.closest("script, style, noscript, svg") !== null || !visible(owner)) continue;
        const rect = owner.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue; // a screen-reader-only string
        const size = Number.parseFloat(getComputedStyle(owner).fontSize);
        minText = Math.min(minText, size);
        if (size < textFloor && smallText.length < 5) smallText.push(`${String(size)}px ${describe(owner)}`);
      }

      // field labels
      let minLabel: number | null = null;
      if (isField) {
        for (const el of document.querySelectorAll("time, [data-level-word], [data-time-label]")) {
          if (!visible(el)) continue;
          const size = Number.parseFloat(getComputedStyle(el).fontSize);
          minLabel = minLabel === null ? size : Math.min(minLabel, size);
        }
      }

      // targets
      let minTarget = Infinity;
      const smallTargets: string[] = [];
      for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=slider]")) {
        if (!visible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue; // a skip link until it is focused
        const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p, li, dd, span, small") !== null;
        if (inline) continue;
        const side = Math.min(rect.width, rect.height);
        minTarget = Math.min(minTarget, side);
        if (side < targetFloor && smallTargets.length < 5) smallTargets.push(`${side.toFixed(1)}px ${describe(el)}`);
      }

      // hero and primary actions, inside the first fold
      const fold = { width: window.innerWidth, height: window.innerHeight };
      const hero = document.querySelector("[data-hero]");
      let heroShare: number | null = null;
      if (hero !== null) {
        const r = hero.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, fold.width) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, fold.height) - Math.max(r.top, 0));
        heroShare = (w * h) / (fold.width * fold.height);
      }
      const primariesInFold = [...document.querySelectorAll("[data-primary]:not([data-emergency])")].filter((el) => {
        const r = el.getBoundingClientRect();
        return visible(el) && r.top < fold.height && r.bottom > 0;
      }).length;

      // view-transition names that are in the stylesheet (React adds the others while a transition runs)
      const names: string[] = [];
      for (const el of document.querySelectorAll("*")) {
        const name = getComputedStyle(el).getPropertyValue("view-transition-name");
        if (name !== "" && name !== "none") names.push(name);
      }

      // copy
      const body = document.body.innerText;
      const forbidden = [...body.matchAll(/ADR \d|HANDOFF|\bB[123]\b|[–—]/g)].map((m) => m[0]);

      return {
        overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        minTextPx: minText === Infinity ? 0 : minText,
        smallTextSamples: smallText,
        minTargetPx: minTarget === Infinity ? 0 : minTarget,
        smallTargets,
        minFieldLabelPx: minLabel,
        heroShare,
        primariesInFold,
        spineCount: document.querySelectorAll("[data-spine]").length,
        transitionNames: names,
        wordmark: document.querySelector("header a") !== null,
        forbiddenText: forbidden,
      };
    },
    { field, textFloor: MIN_TEXT_PX, targetFloor: field ? MIN_FIELD_TARGET_PX : MIN_TARGET_PX },
  );

  const failures: string[] = [];
  if (options.consoleErrors.length > 0) failures.push(`console: ${options.consoleErrors.join(" | ")}`);
  if (measured.overflowPx !== 0) failures.push(`horizontal overflow ${String(measured.overflowPx)} px`);
  if (measured.minTextPx < MIN_TEXT_PX) failures.push(`text below ${String(MIN_TEXT_PX)} px: ${measured.smallTextSamples.join("; ")}`);
  if (measured.minFieldLabelPx !== null && measured.minFieldLabelPx < MIN_FIELD_LABEL_PX) {
    failures.push(`field time or level label ${String(measured.minFieldLabelPx)} px, under ${String(MIN_FIELD_LABEL_PX)}`);
  }
  const targetFloor = field ? MIN_FIELD_TARGET_PX : MIN_TARGET_PX;
  if (measured.smallTargets.length > 0) failures.push(`targets under ${String(targetFloor)} px: ${measured.smallTargets.join("; ")}`);

  const axe = options.skipAxe === true ? [] : await axeViolations(page);
  if (axe.length > 0) failures.push(`axe: ${axe.map((a) => `${a.rule} ${a.targets.join(",")}`).join(" | ")}`);

  if (options.hero !== false) {
    if (measured.heroShare === null) failures.push("no [data-hero] element");
    else if (measured.heroShare < MIN_HERO_SHARE) {
      failures.push(`[data-hero] is ${(measured.heroShare * 100).toFixed(1)} % of the first fold, under ${String(MIN_HERO_SHARE * 100)} %`);
    }
  }
  if (measured.primariesInFold > 1) failures.push(`${String(measured.primariesInFold)} [data-primary] in the first fold, at most 1`);
  if (options.spine === true && measured.spineCount === 0) failures.push("no [data-spine] element");

  const allowed: readonly string[] = SHARED_TRANSITION_NAMES;
  const strays = measured.transitionNames.filter((name) => !allowed.includes(name));
  if (strays.length > 0) failures.push(`static view-transition-name outside the shared set: ${strays.join(", ")}`);
  if (new Set(measured.transitionNames).size !== measured.transitionNames.length) failures.push("a view-transition-name appears twice");
  if (!measured.wordmark) failures.push("no wordmark link in the header");

  const dashRule = (options.locale ?? "en") === "en";
  const forbidden = measured.forbiddenText.filter((hit) => dashRule || !/[–—]/.test(hit));
  if (forbidden.length > 0) failures.push(`forbidden visible text: ${[...new Set(forbidden)].join(", ")}`);

  return {
    overflowPx: measured.overflowPx,
    minTextPx: measured.minTextPx,
    smallTextSamples: measured.smallTextSamples,
    minTargetPx: measured.minTargetPx,
    smallTargets: measured.smallTargets,
    minFieldLabelPx: measured.minFieldLabelPx,
    axeViolations: axe.map((a) => a.rule),
    heroShare: measured.heroShare,
    primariesInFold: measured.primariesInFold,
    spineCount: measured.spineCount,
    transitionNames: measured.transitionNames,
    forbiddenText: forbidden,
    failures,
  };
}
