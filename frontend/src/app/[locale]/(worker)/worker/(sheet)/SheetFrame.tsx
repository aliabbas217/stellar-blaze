"use client";

import type { ReactNode } from "react";
import { FieldShell } from "@/components/shell/FieldShell";
import { WorkerDock } from "@/components/shell/WorkerDock";

/*
 * The field shell for the call sheet, with nothing that reads the network or the demo context: no site list (so no site name:
 * the header names none rather than guess), no demo clock, no query provider. The dock is the same worker dock.
 */
export function SheetFrame({ children }: { children: ReactNode }) {
  return <FieldShell dock={<WorkerDock />}>{children}</FieldShell>;
}
