"use client";

import { useEffect } from "react";
import { media, REDUCED_QUERY } from "./landing-scroll";

/*
 * What the slides do as they arrive, and nothing else: each `.rv` block fades in and rises 12 px when it is 12 % in view, and the evidence bars
 * grow and count up from zero to the number the server wrote (read from the element, never typed here). Reduced motion keeps every number and bar
 * where it is. Renders nothing; the markup is complete and visible without it (`.js` is only set when this script has run).
 */
export function LandingEffects() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js");
    const reduce = media(REDUCED_QUERY)?.matches === true;
    const targets = Array.from(document.querySelectorAll<HTMLElement>(".lp .rv"));
    const count = (box: HTMLElement): void => {
      if (reduce) return;
      for (const p of box.querySelectorAll<HTMLElement>("[data-count]")) {
        const v = Number.parseFloat(p.dataset.count ?? "");
        if (!Number.isFinite(v)) continue;
        const t0 = performance.now();
        const step = (now: number): void => {
          const k = Math.min(1, (now - t0) / 900);
          p.textContent = (v * (1 - Math.pow(1 - k, 3))).toFixed(1);
          if (k < 1) requestAnimationFrame(step);
          else p.textContent = v.toFixed(1);
        };
        step(t0);
      }
    };
    if (!("IntersectionObserver" in window)) {
      for (const t of targets) t.classList.add("in");
      return () => {
        root.classList.remove("js");
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || !(e.target instanceof HTMLElement)) continue;
          e.target.classList.add("in");
          if (e.target.dataset.bars !== undefined) count(e.target);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    for (const t of targets) io.observe(t);
    return () => {
      io.disconnect();
      root.classList.remove("js");
    };
  }, []);
  return null;
}
