"use client";

import { createContext, useContext, useEffect } from "react";

/*
 * What a page tells the field shell's header. The header is in the layout and the data is in the page: a crew's name comes
 * with the crew's timeline, which only the Today view asks for. Passing it up through this one-way slot keeps the layout from
 * running a query of its own on every worker page just to print a name (the layout's script budget, F2 Part 0).
 */

export interface FieldHeadingSlot {
  readonly setCrewLabel: (label: string | null) => void;
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
