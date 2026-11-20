"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { currentChapter, subscribeScroll } from "./landing-scroll";

/*
 * The chapter rail: the through-line of the page, on the start edge (the right edge in Arabic and Urdu), seven entries with the current chapter
 * marked (`aria-current`) from the page's one scroll listener. The links are plain in-page anchors, so they work with the mouse, the keyboard
 * and with scripts off. Under the entries: the demo note, then the slot the page fills with the language picker and the machine-translation
 * line. Under 1100 px the rail is a strip at the top of the page (landing.css).
 */

export const CHAPTERS = ["forecast", "morning", "plan", "boundary", "evidence", "ways", "limits"] as const;
const ANCHORS: Readonly<Record<(typeof CHAPTERS)[number], string>> = { forecast: "forecast", morning: "morning", plan: "plan", boundary: "boundary", evidence: "evidence", ways: "ways", limits: "limits" };

export function LandingRail({ children }: { readonly children?: ReactNode }) {
  const t = useTranslations("judge.landing.rail");
  const brand = useTranslations("common");
  const [current, setCurrent] = useState(1);

  useEffect(() => {
    const read = (): void => {
      const sections = Array.from(document.querySelectorAll<HTMLElement>("section[data-ch]")).map((el) => ({ top: el.getBoundingClientRect().top, n: Number(el.dataset.ch) }));
      const atFoot = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setCurrent(currentChapter(sections, window.innerHeight, atFoot, CHAPTERS.length));
    };
    read();
    return subscribeScroll(read);
  }, []);

  return (
    <nav className="rail" aria-label={t("label")}>
      <p className="mark">{brand("appName")}</p>
      <ol className="idx">
        {CHAPTERS.map((chapter, i) => (
          <li key={chapter}>
            <a href={`#${ANCHORS[chapter]}`} data-ch={i + 1} aria-current={current === i + 1 ? "true" : "false"}>
              <span>{`0${String(i + 1)}`}</span>
              {t(chapter)}
            </a>
          </li>
        ))}
      </ol>
      <p className="note">{t("note")}</p>
      {children}
    </nav>
  );
}
