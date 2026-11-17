"use client";

import { useTranslations } from "next-intl";
import { FieldLink } from "@/components/shell/FieldLink";
import { ACTION_QUIET } from "@/components/states/actions";
import { clearDemoRole, useDemoRole } from "@/lib/demo-role";

/**
 * The demo role as a label: "Demo: crew lead" or "Demo: safety officer", and "Switch role", which forgets the role and opens the
 * front door (`/start`). With no role chosen (a deep link, a new tab) it offers "Choose a role" instead: the screen works the same,
 * because the role gates nothing (src/lib/demo-role.ts: it is navigation state, and the BFF allow-list is the only gate).
 *
 * Its height is reserved (the target size) before the browser has been asked what the role is, and is the same for each answer, so
 * nothing moves when it arrives. The badge is a label to read, so it is cut, not rounded (DESIGN.md 5.1).
 */
export function RoleBadge({ className = "" }: { readonly className?: string }) {
  const t = useTranslations("shell.role");
  const role = useDemoRole();

  return (
    <div data-role-badge={role ?? ""} className={`flex min-h-(--target) flex-wrap items-center gap-x-3 ${className}`}>
      {role === undefined ? null : (
        <>
          {role === null ? null : (
            <span className="inline-flex min-h-7 items-center border border-edge px-2 font-body text-sm font-semibold text-ink">
              {t(role === "crew-lead" ? "crew" : "officer")}
            </span>
          )}
          <FieldLink
            href="/start"
            data-switch-role=""
            onClick={clearDemoRole}
            className={ACTION_QUIET}
          >
            {t(role === null ? "choose" : "switch")}
          </FieldLink>
        </>
      )}
    </div>
  );
}
