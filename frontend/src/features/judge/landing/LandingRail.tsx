"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { currentChapter, media, subscribeScroll } from "./landing-scroll";

/*
 * The chapter rail: the through-line of the page, seven entries with the current chapter marked (`aria-current`) from the page's one scroll
 * listener. The links are plain in-page anchors, so they work with the mouse, the keyboard and a screen reader.
 *   - From 1100 px: a fixed column on the start edge (the right edge in Arabic and Urdu): the brand, the seven entries, the demo note, the
 *     language picker and the machine-translation line. `.bar` is `display: contents` there, so it adds no box.
 *   - Under 1100 px (redesign S14): ONE slim bar fixed to the top, 56 px high: the brand, a menu button that shows which chapter is in view
 *     ("02/07") and opens the seven entries as a sheet under the bar, and the language picker (its label is visually hidden but is still its
 *     name). A 2 px strip along the bar's foot shows the seven chapters and the one in view. The machine-translation line (`notice`) is in
 *     the rail but below the bar, in the page's flow, so it scrolls away and never takes room from the bar. The sheet closes on a chosen
 *     entry, on Escape (focus goes back to the button), on a tap or focus outside it, and on a change to a wide screen.
 * With scripts off a phone shows the bar and the page as a plain column (the sheet needs the button); every chapter is still reached by scrolling.
 */

export const CHAPTERS = ["forecast", "morning", "plan", "boundary", "evidence", "ways", "limits"] as const;
const ANCHORS: Readonly<Record<(typeof CHAPTERS)[number], string>> = { forecast: "forecast", morning: "morning", plan: "plan", boundary: "boundary", evidence: "evidence", ways: "ways", limits: "limits" };
const two = (n: number): string => `0${String(n)}`;

export interface LandingRailProps {
  /** The language picker, in the bar on a phone and under the demo note on a wide screen. */
  readonly language?: ReactNode;
  /** The machine-translation line (renders nothing in English). */
  readonly notice?: ReactNode;
}

export function LandingRail({ language, notice }: LandingRailProps) {
  const t = useTranslations("judge.landing.rail");
  const brand = useTranslations("common");
  const [current, setCurrent] = useState(1);
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useId();

  useEffect(() => {
    const read = (): void => {
      const sections = Array.from(document.querySelectorAll<HTMLElement>("section[data-ch]")).map((el) => ({ top: el.getBoundingClientRect().top, n: Number(el.dataset.ch) }));
      const atFoot = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setCurrent(currentChapter(sections, window.innerHeight, atFoot, CHAPTERS.length));
    };
    read();
    return subscribeScroll(read);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (target: EventTarget | null): boolean => !(target instanceof Node) || bar.current === null || !bar.current.contains(target);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent): void => {
      if (outside(event.target)) setOpen(false);
    };
    const onFocus = (event: FocusEvent): void => {
      if (outside(event.target)) setOpen(false);
    };
    const wide = media("(min-width: 1100px)");
    const onWide = (): void => {
      if (wide?.matches === true) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    wide?.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
      wide?.removeEventListener("change", onWide);
    };
  }, [open]);

  const name = t(CHAPTERS[current - 1] ?? "forecast");

  return (
    <nav className="rail" aria-label={t("label")}>
      <div ref={bar} className="bar">
        <p className="mark">{brand("appName")}</p>
        <button
          ref={button}
          type="button"
          className="menu"
          aria-expanded={open}
          aria-controls={sheet}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M3 6.5h18M3 12h18M3 17.5h18" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className="cnt" dir="ltr" aria-hidden="true">{`${two(current)}/${two(CHAPTERS.length)}`}</span>
          <span className="sr-only">{`${t("label")}: ${name}`}</span>
        </button>
        <ol id={sheet} className="idx" data-open={open}>
          {CHAPTERS.map((chapter, i) => (
            <li key={chapter}>
              <a
                href={`#${ANCHORS[chapter]}`}
                data-ch={i + 1}
                aria-current={current === i + 1 ? "true" : "false"}
                onClick={() => {
                  setOpen(false);
                }}
              >
                <span>{two(i + 1)}</span>
                {t(chapter)}
              </a>
            </li>
          ))}
        </ol>
        <p className="note">{t("note")}</p>
        {language}
        <div className="prog" aria-hidden="true">
          {CHAPTERS.map((chapter, i) => (
            <i key={chapter} data-state={current === i + 1 ? "now" : current > i + 1 ? "done" : "todo"} />
          ))}
        </div>
      </div>
      {notice}
    </nav>
  );
}
