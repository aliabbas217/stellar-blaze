"use client";

import type { ReactNode } from "react";
import { percentAt, screenPercent, type Dir } from "@/components/spine/geometry";

/*
 * The frame that says which part of the day changed: it wraps a horizontal time spine, dims the cells outside the changed
 * window and draws a 2 px --signal frame around it. TimeSpine knows nothing of a "changed" window, and it is not edited for
 * this: the dimming is a style rule on the cells the spine already marks (`data-cell`), and the frame is an overlay laid over
 * the spine's own track (the spine pads its sides by 1.5 rem, so the overlay does too, and the percentages mean the same thing).
 * Both read the hour of each cell, so they follow the spine's direction: in a language written from right to left the frame is mirrored.
 */

/** The spine's own side padding (TimeSpine's horizontal root is `px-6`), which the overlay repeats so a percentage lands on the same pixel. */
const SPINE_SIDE = "1.5rem";

export interface ChangedBracketProps {
  /** The hours the spine draws, as TimeSpine takes them. */
  readonly from: number;
  readonly to: number;
  /** The changed window: an hour of the day to an hour of the day; `null` end means it runs to the end of the day drawn. */
  readonly changedFrom: number;
  readonly changedTo: number | null;
  readonly dir: Dir;
  /** The spine itself. */
  readonly children: ReactNode;
}

/** The hours a cell is drawn for that fall outside [changedFrom, changedTo): those are the unchanged parts of the day. */
export function unchangedHours(from: number, to: number, changedFrom: number, changedTo: number | null): number[] {
  const hours: number[] = [];
  for (let hour = Math.floor(from); hour < Math.ceil(to); hour += 1) {
    const inside = hour + 1 > changedFrom && (changedTo === null || hour < changedTo);
    if (!inside) hours.push(hour);
  }
  return hours;
}

export function ChangedBracket({ from, to, changedFrom, changedTo, dir, children }: ChangedBracketProps) {
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const a = screenPercent(clamp(percentAt(changedFrom, from, to)), "h", dir);
  const b = screenPercent(clamp(changedTo === null ? 100 : percentAt(changedTo, from, to)), "h", dir);
  const left = Math.min(a, b);
  const width = Math.abs(b - a);
  const dimmed = unchangedHours(from, to, changedFrom, changedTo);

  return (
    <div data-changed-spine="" data-from={String(changedFrom)} data-to={changedTo === null ? "end" : String(changedTo)} className="relative">
      {dimmed.length === 0 ? null : (
        // The cells outside the window recede; labels and ticks stay at full contrast (a dimmed label is a label nobody can read).
        <style>{`[data-changed-spine] ${dimmed.map((hour) => `[data-cell="${String(hour)}"]`).join(`, [data-changed-spine] `)} { opacity: 0.32; }`}</style>
      )}
      {children}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0" style={{ insetInline: SPINE_SIDE }}>
        <div data-changed-frame="" className="absolute inset-y-0 rounded-sign border-2 border-signal" style={{ left: `${String(left)}%`, width: `${String(width)}%` }} />
      </div>
    </div>
  );
}
