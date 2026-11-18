import { useTranslations } from "next-intl";
import { FieldLink } from "@/components/shell/FieldLink";
import { NAV_TAB } from "@/components/states/actions";

/*
 * The landing's header: the wordmark and the judge menu, the same links as the desk header of the scoreboard pages (shell.desk.nav).
 * A server component with no script, so the landing keeps the skip link as its first focusable element and ships no shell code.
 * Links never prefetch (FieldLink): the landing is measured on its own.
 */
export function LandingHeader() {
  const t = useTranslations();
  const items = [
    { href: "/", label: t("shell.desk.nav.story"), current: true },
    { href: "/replay", label: t("shell.desk.nav.scoreboard") },
    { href: "/replay/day", label: t("shell.desk.nav.day") },
    { href: "/replay/try", label: t("shell.desk.nav.try") },
    { href: "/replay/governance", label: t("shell.desk.nav.governance") },
    { href: "/supervisor", label: t("shell.desk.nav.crews") },
  ] as const;
  return (
    <header className="relative z-20 flex items-center gap-4 border-b border-hair bg-ground px-4 py-1 sm:px-6">
      <FieldLink
        href="/"
        className="inline-flex min-h-(--target) flex-none items-center font-display text-sm font-semibold uppercase tracking-wordmark text-ink no-underline"
      >
        {t("common.appName")}
      </FieldLink>
      <nav aria-label={t("shell.desk.menu")} className="min-w-0 flex-1 overflow-x-auto">
        <ul className="flex gap-1">
          {items.map((item) => (
            <li key={item.href} className="flex-none">
              <FieldLink
                href={item.href}
                aria-current={"current" in item ? "page" : undefined}
                className={`${NAV_TAB} font-body text-sm`}
              >
                {item.label}
              </FieldLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
