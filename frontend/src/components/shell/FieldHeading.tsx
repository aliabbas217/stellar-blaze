"use client";

import { createContext, useContext, useEffect } from "react";

/*
 * What a page tells the field shell's header. The header is in the layout and the data is in the page: a crew's name comes
 * with the crew's timeline, which only the Today view asks for. Passing it up through this one-way slot keeps the layout from
 * running a query of its own on every worker page just to print a name (the layout's script budget, F2 Part 0).
 *
 * A page may also name the SITE it is about: a warning opened from a notification on a phone that is pinned to no site is
 * about the warning's site, and a header that said "No site chosen" above it would contradict the page.
 */

export interface FieldHeadingSlot {
  readonly setCrewLabel: (label: string | null) => void;
  readonly setSiteLabel: (label: string | null) => void;
}

export const FieldHeadingContext = createContext<FieldHeadingSlot | null>(null);

/** Shows `label` as the crew in the header while the calling page is mounted; `null` shows none. A page outside a shell is a no-op. */
export function useFieldCrewLabel(label: string | null): void {
  const slot = useContext(FieldHeadingContext);
  useEffect(() => {
    if (slot === null) return;
    slot.setCrewLabel(label);
    return () => {
      slot.setCrewLabel(null);
    };
  }, [slot, label]);
}

/** Shows `label` as the site in the header while the calling page is mounted (over the pinned site's name); `null` leaves the header's own. */
export function useFieldSiteLabel(label: string | null): void {
  const slot = useContext(FieldHeadingContext);
  useEffect(() => {
    if (slot === null) return;
    slot.setSiteLabel(label);
    return () => {
      slot.setSiteLabel(null);
    };
  }, [slot, label]);
}
