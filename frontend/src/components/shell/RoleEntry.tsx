import type { ReactNode } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { RoleEnterLink } from "@/components/shell/RoleEnterLink";
import { ACTION_QUIET } from "@/components/states/actions";
import type { DemoRole } from "@/lib/demo-role";

/**
 * The one-screen role entry of a staff role (crew lead, safety officer): what this role sees, one primary button, and in plain sight that
 * it is a demo and what production would be. It is NOT a sign-in form: no email, no password, no field of any kind, no wait. A form that
 * accepted anything would pretend to be authentication, and this app has none for staff yet (ADR 0062: the BFF allow-list is the only
 * gate; the chosen role is a label, see src/lib/demo-role.ts). The words are passed in (read on the server by the page), so this file reads
 * no catalogue and can sit with the shared shell.
 */
export function RoleEntry({
  demoRole,
  href,
  title,
  sees,
  button,
  demoAccess,
  production,
  change,
  children,
}: {
  readonly demoRole: DemoRole;
  /** The screen the button opens: a route without the locale prefix. */
  readonly href: string;
  readonly title: string;
  readonly sees: string;
  readonly button: string;
  /** "Demo access. Anyone can enter.": Tier 1, always visible, never small print. */
  readonly demoAccess: string;
  /** The one honest sentence about what production would be. */
  readonly production: string;
  readonly change: string;
  readonly children?: ReactNode;
}) {
  return (
    <main data-role-entry={demoRole} className="flex flex-1 flex-col gap-5 px-4 pt-6 pb-10">
      <h1 className="font-display text-2xl font-medium text-ink">{title}</h1>
      <p className="max-w-(--measure) text-lg text-ink-2">{sees}</p>
      {children}
      <div className="flex flex-col gap-3">
        <RoleEnterLink role={demoRole} href={href}>
          {button}
        </RoleEnterLink>
        <p data-demo-access="" className="text-base font-semibold text-ink">
          {demoAccess}
        </p>
        <p className="max-w-(--measure) text-base text-ink-2">{production}</p>
      </div>
      <FieldLink href="/start" className={`${ACTION_QUIET} self-start`}>
        {change}
      </FieldLink>
      <MachineTranslationNotice />
    </main>
  );
}
