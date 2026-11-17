"use client";

import type { ReactNode } from "react";
import { FieldShell } from "@/components/shell/FieldShell";
import { RoleBadge } from "@/components/shell/RoleBadge";
import { useDemo } from "@/features/demo/DemoProvider";
import { usePathname } from "@/i18n/navigation";

/*
 * Glue between the safety routes and the presentational field shell: the demo site's name and the demo role badge (a label and "Switch
 * role": it gates nothing). The Replay or Live switch and Reset are not here: they are the "Demo controls" of the safety view itself, out
 * of the way. No clock and no dock. Imports no worker code.
 */
export function HseFrame({ children }: { children: ReactNode }) {
  const { site } = useDemo();
  // The role entry is where the role is chosen: it carries its own "Choose another role".
  const entry = usePathname().endsWith("/hse/enter");

  return (
    <FieldShell siteName={site?.name ?? null}>
      {entry ? null : <RoleBadge className="border-b border-hair px-4" />}
      {children}
    </FieldShell>
  );
}
