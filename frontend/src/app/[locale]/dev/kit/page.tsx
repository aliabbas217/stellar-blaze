import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ScreenColors } from "@/components/shell/ScreenColors";
import { Link } from "@/i18n/navigation";
import { KIT_SECTIONS } from "./sections/registry";

/*
 * Dev-only gallery of the shared components in every state (design system, plan F2 Task 4). Not part of the product:
 * like the specimen it returns 404 in production unless SB_SPECIMEN=1 (one switch for every dev page).
 *
 * It renders in the language of its route and in either theme (the sun toggle in the header), so the same page checks
 * the kit in each script and each theme. The sections are a registry (sections/registry.ts): a later task adds a
 * section file and one registry entry, not an edit to this page. The time spine is not a registry section: it has its own
 * route (kit/spine), registered here by the link in the header so the gallery reaches it.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.kit");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function KitPage(props: PageProps<"/[locale]/dev/kit">) {
  // Opt into request-time rendering so SB_SPECIMEN is read per request, not frozen at build.
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.SB_SPECIMEN !== "1") {
    notFound();
  }

  const { locale } = await props.params;
  const t = await getTranslations("common.kit");

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 py-8 font-body">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-sm text-ink-3">{t("kicker", { locale })}</p>
        <h1 className="font-display text-5xl leading-solid tracking-display">{t("title")}</h1>
        <p className="max-w-(--measure) text-lg text-ink-2">{t("lead")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <LocaleSwitcher />
          <ScreenColors />
          <Link href="/dev/kit/spine" className="inline-flex min-h-(--target) items-center text-base text-ink-2 underline">
            {t("spineLink")}
          </Link>
        </div>
        <nav aria-label={t("title")} className="flex flex-wrap gap-x-4 gap-y-1">
          {KIT_SECTIONS.map(({ id }) => (
            <a key={id} href={`#${id}`} className="inline-flex min-h-6 items-center text-base text-ink-2 underline">
              {t(`sections.${id}.title`)}
            </a>
          ))}
        </nav>
      </header>

      {KIT_SECTIONS.map(({ id, Content }, index) => (
        <section key={id} id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-4 flex-col gap-4">
          <h2
            id={`${id}-title`}
            className="flex items-baseline gap-3 border-b border-hair pb-2 font-display text-2xl font-medium"
          >
            <span className="tabular-nums text-ink-3">{String(index + 1).padStart(2, "0")}</span>
            {t(`sections.${id}.title`)}
          </h2>
          <p className="max-w-(--measure) text-base text-ink-2">{t(`sections.${id}.note`)}</p>
          <Content />
        </section>
      ))}
    </main>
  );
}
