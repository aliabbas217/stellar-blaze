import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Pictogram } from "@/components/level/Pictogram";
import { FieldLink } from "@/components/shell/FieldLink";
import { ROLE_DOOR_DESTINATIONS, ROLE_DOOR_ORDER, type RoleId } from "./role-door-destinations";

/*
 * The role door: four equal tiles in a fixed order ("I work on a site", "I run a crew", "I look after safety", "I am reviewing this"), each a
 * link with its one-line promise. A server component with no script. It is navigation, not sign-in: the destinations are routes
 * (role-door-destinations.ts), nothing is stored, and workers never need an account (the first tile says so). The landing hero shows it and
 * the front door (/start, slice S7) will reuse it. The tiles are cards (the control radius, the tonal fill with the 1.5 px edge ring of the secondary
 * tier) and at least 52 px tall; the title is a verb phrase in the visitor's own words, the line is what they will see.
 *
 * The pictograms of the first two tiles are the Qaylula set; the safety and reviewing tiles have no pictogram in that set yet, so they carry two plain
 * line drawings of the same weight (a ticked box, a magnifier). Decorative: the words name the tile.
 */

const SHAPE = {
  strokeWidth: 2,
  strokeLinecap: "square",
  strokeLinejoin: "miter",
  fill: "none",
  stroke: "currentColor",
} as const;

const ICONS: Readonly<Record<RoleId, ReactNode>> = {
  worker: <Pictogram name="shade" className="size-6" />,
  crew: <Pictogram name="buddy" className="size-6" />,
  safety: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
      <rect x="3.5" y="3.5" width="17" height="17" {...SHAPE} />
      <path d="M7.5 12.5 10.5 15.5 16.5 8.5" {...SHAPE} />
    </svg>
  ),
  review: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
      <circle cx="10.5" cy="10.5" r="6.5" {...SHAPE} />
      <path d="M15.5 15.5 21 21" {...SHAPE} />
    </svg>
  ),
};

export function RoleDoor({ className = "" }: { readonly className?: string }) {
  const t = useTranslations("judge.landing.door");
  return (
    <nav aria-label={t("label")} data-role-door="" className={className}>
      <ul className="grid gap-3 min-[560px]:grid-cols-2">
        {ROLE_DOOR_ORDER.map((role) => (
          <li key={role} className="flex">
            <FieldLink
              href={ROLE_DOOR_DESTINATIONS[role]}
              data-role={role}
              className="group flex min-h-(--target-field) w-full items-start gap-3 rounded-card bg-panel p-4 text-ink no-underline inset-ring-[1.5px] inset-ring-edge transition-transform duration-(--dur-press) hover:bg-[color-mix(in_oklch,var(--panel),var(--ink)_var(--mix-secondary-hover))] active:translate-y-px active:scale-[0.985]"
            >
              <span aria-hidden="true" className="grid min-h-11 min-w-11 flex-none place-items-center rounded-ctl bg-raised text-ink">
                {ICONS[role]}
              </span>
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="text-lg leading-snug font-semibold">{t(`${role}.title`)}</span>
                <span className="text-base leading-snug text-ink-2">{t(`${role}.line`)}</span>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-1 size-5 flex-none self-start text-ink-3 rtl:-scale-x-100">
                <path d="M9 5 16 12 9 19" {...SHAPE} />
              </svg>
            </FieldLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
