"use client";

import type { ReactNode } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
import { ACTION_PRIMARY } from "@/components/states/actions";
import { setDemoRole, type DemoRole } from "@/lib/demo-role";

/**
 * The one button of a role entry. A link, not a form: it remembers the demo role for this browser session (src/lib/demo-role.ts) and
 * goes to the role's screen. Without script it still goes there, only without the label. Nothing is asked, checked or sent.
 */
export function RoleEnterLink({ role, href, children }: { readonly role: DemoRole; readonly href: string; readonly children: ReactNode }) {
  return (
    <FieldLink
      href={href}
      data-primary=""
      data-enter-role={role}
      onClick={() => {
        setDemoRole(role);
      }}
      className={`${ACTION_PRIMARY} w-full`}
    >
      {children}
    </FieldLink>
  );
}
