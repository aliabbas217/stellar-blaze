import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { LEVELS, levelIndex, type Level } from "@/components/level/level";
import { LevelPictogram } from "@/components/level/pictograms";
import { DraftBadge } from "@/components/shell/DraftBadge";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

/*
 * Dev-only visual specimen for the "Arish Signal" direction (DESIGN.md).
 * Not part of the product: it returns 404 in production unless SB_SPECIMEN=1.
 *
 * It renders in the language of its route, so /en, /ar, /ur, /hi, /bn and /ne/dev/specimen show the
 * same page in each script with that locale's fonts, direction and line height. Its copy lives in
 * messages (common.specimen.*, levels.*); the non-English text there is machine draft.
 * The four level badges are inline placeholders until LevelBadge exists (Task 10). The shell controls
 * (language, theme, draft badge) are mounted in the header so they can be seen and tried here before
 * the app shell (Task 4) exists.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.specimen");
  return { title: t("title"), robots: { index: false, follow: false } };
}

// Full class names, never built by interpolation, so Tailwind's scanner finds them.
const LEVEL_CLASS = {
  green: {
    fill: "bg-level-green",
    on: "text-on-level-green",
    pattern: "pattern-level-green",
    soft: "bg-level-green-soft text-on-level-green-soft",
  },
  amber: {
    fill: "bg-level-amber",
    on: "text-on-level-amber",
    pattern: "pattern-level-amber",
    soft: "bg-level-amber-soft text-on-level-amber-soft",
  },
  orange: {
    fill: "bg-level-orange",
    on: "text-on-level-orange",
    pattern: "pattern-level-orange",
    soft: "bg-level-orange-soft text-on-level-orange-soft",
  },
  red: {
    fill: "bg-level-red",
    on: "text-on-level-red",
    pattern: "pattern-level-red",
    soft: "bg-level-red-soft text-on-level-red-soft",
  },
} as const satisfies Record<
  Level,
  { fill: string; on: string; pattern: string; soft: string }
>;

// One shade-band hour: the heat curve of a long outdoor shift, 08:00 to 19:00.
const BAND: readonly { hour: string; level: Level }[] = [
  { hour: "08", level: "green" },
  { hour: "09", level: "green" },
  { hour: "10", level: "amber" },
  { hour: "11", level: "amber" },
  { hour: "12", level: "orange" },
  { hour: "13", level: "orange" },
  { hour: "14", level: "red" },
  { hour: "15", level: "red" },
  { hour: "16", level: "orange" },
  { hour: "17", level: "amber" },
  { hour: "18", level: "green" },
  { hour: "19", level: "green" },
];
const NOW_HOUR = "13";

// Token names and sizes are identifiers of the design system, not copy: they stay in code.
const TYPE_STEPS = [
  { cls: "text-sm font-body", rem: "0.875", name: "label", numeral: false },
  { cls: "text-base font-body", rem: "1", name: "body", numeral: false },
  { cls: "text-lg font-body", rem: "1.25", name: "lead", numeral: false },
  { cls: "text-xl font-display font-semibold", rem: "1.5625", name: "title", numeral: false },
  { cls: "text-2xl font-display font-semibold", rem: "1.953", name: "headline", numeral: false },
  { cls: "text-3xl font-display font-bold", rem: "3.052", name: "display", numeral: true },
  { cls: "text-4xl font-display font-bold", rem: "4.768", name: "numeral", numeral: true },
] as const;

function Section({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-baseline gap-3 border-b-2 border-ink pb-2 font-display text-2xl font-semibold uppercase tracking-signage">
        <span className="tabular-nums text-ink-muted">{index}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function LevelBadgePlaceholder({ level }: { level: Level }) {
  const t = useTranslations("levels");
  const c = LEVEL_CLASS[level];
  return (
    <li className={`${c.fill} ${c.on} ${c.pattern} rounded-sign`}>
      {/* The plate is solid so text never sits on the hatch; the hatch runs out past its end edge. */}
      <div className={`${c.fill} me-16 flex items-center gap-4 px-4 py-3`}>
        <span className="font-display text-3xl font-bold leading-solid tabular-nums">{levelIndex(level)}</span>
        <LevelPictogram level={level} className="size-10 shrink-0" />
        <span className="font-display text-2xl font-semibold uppercase tracking-signage">
          {t(`name.${level}`)}
        </span>
      </div>
    </li>
  );
}

function ShadeBandPreview() {
  const t = useTranslations("levels");
  return (
    <ol className="grid auto-cols-fr grid-flow-col gap-[var(--shade-cell-gap)]">
      {BAND.map(({ hour, level }) => {
        const c = LEVEL_CLASS[level];
        const isNow = hour === NOW_HOUR;
        return (
          <li
            key={hour}
            aria-label={t("cellLabel", {
              time: `${hour}:00`,
              name: t(`name.${level}`),
              index: levelIndex(level),
            })}
            aria-current={isNow ? "time" : undefined}
            className="flex min-w-0 flex-col gap-1"
          >
            <div
              className={`${c.fill} ${c.on} ${c.pattern} flex min-h-[var(--shade-cell-height)] flex-col justify-center rounded-sign`}
            >
              <span
                className={`${c.fill} px-[var(--shade-plate-padding)] py-1 text-center font-display text-xl font-bold leading-solid tabular-nums`}
              >
                {levelIndex(level)}
              </span>
            </div>
            <span
              className={`rounded-sign py-0.5 text-center font-display text-sm font-semibold leading-solid tabular-nums ${
                isNow ? "bg-ink text-surface" : "text-ink-muted"
              }`}
            >
              {hour}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TypeScale() {
  const t = useTranslations("common.specimen");
  return (
    <div className="flex flex-col gap-6">
      {TYPE_STEPS.map((step) => (
        <div key={step.name} className="flex flex-col gap-1 border-b border-hairline pb-4">
          <p className="font-body text-sm tabular-nums text-ink-muted">
            {step.name} · {step.rem}rem · {step.cls.split(" ")[0]}
          </p>
          <p className={step.cls}>{step.numeral ? t("time") : t("phrase")}</p>
        </div>
      ))}
    </div>
  );
}

function Swatch({
  label,
  sub,
  boxClass,
  children,
}: {
  label: string;
  sub?: string;
  boxClass: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1">
      <div className={`flex h-14 items-center justify-center rounded-sign ${boxClass}`}>{children}</div>
      <span className="font-body text-sm leading-tight">{label}</span>
      {sub === undefined ? null : <span className="font-body text-sm leading-tight text-ink-muted">{sub}</span>}
    </li>
  );
}

const SAMPLE_MARK = "font-display text-2xl font-bold leading-solid";

function ThemePanel({ theme, title }: { theme: "light" | "dark"; title: string }) {
  return (
    <section
      data-theme={theme}
      aria-label={title}
      className="flex flex-col gap-4 rounded-sign border-2 border-control bg-surface p-4 text-ink"
    >
      <h3 className="font-display text-xl font-semibold uppercase tracking-signage">{title}</h3>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Swatch label="surface" boxClass="border-2 border-control bg-surface" />
        <Swatch label="surface-raised" boxClass="border border-hairline bg-surface-raised" />
        <Swatch label="ink" boxClass="border border-hairline bg-surface text-ink">
          <span className={SAMPLE_MARK}>Aa</span>
        </Swatch>
        <Swatch label="ink-muted" boxClass="border border-hairline bg-surface text-ink-muted">
          <span className={SAMPLE_MARK}>Aa</span>
        </Swatch>
        <Swatch label="hairline" boxClass="border-2 border-hairline bg-surface" />
        <Swatch label="control" boxClass="border-2 border-control bg-surface" />
        <Swatch label="action" sub="on-action" boxClass="bg-action text-on-action">
          <span className={SAMPLE_MARK}>Aa</span>
        </Swatch>
        <Swatch label="focus ring" boxClass="m-1 bg-surface outline-3 outline-offset-2 outline-focus" />
        <Swatch label="scrim" sub="bg-scrim/50" boxClass="bg-scrim/50" />
        {LEVELS.map((level) => (
          <Swatch
            key={level}
            label={`level-${level}`}
            sub={`on-level-${level}`}
            boxClass={`${LEVEL_CLASS[level].fill} ${LEVEL_CLASS[level].on}`}
          >
            <span className={SAMPLE_MARK}>{levelIndex(level)}</span>
          </Swatch>
        ))}
        {LEVELS.map((level) => (
          <Swatch
            key={level}
            label={`level-${level}-soft`}
            sub={`on-level-${level}-soft`}
            boxClass={LEVEL_CLASS[level].soft}
          >
            <span className={SAMPLE_MARK}>{levelIndex(level)}</span>
          </Swatch>
        ))}
      </ul>
    </section>
  );
}

export default async function SpecimenPage(props: PageProps<"/[locale]/dev/specimen">) {
  // Opt into request-time rendering so SB_SPECIMEN is read per request, not frozen at build.
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.SB_SPECIMEN !== "1") {
    notFound();
  }

  const { locale } = await props.params;
  const t = await getTranslations("common.specimen");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-8 font-body">
      <header className="flex flex-col gap-3">
        <p className="font-display text-sm font-semibold uppercase tracking-signage text-ink-muted">
          {t("kicker", { locale })}
        </p>
        <h1 className="font-display text-4xl font-bold uppercase leading-solid tracking-signage">{t("title")}</h1>
        <p className="text-lg text-ink-muted">{t("lead")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <LocaleSwitcher />
          <ThemeToggle />
          <DraftBadge />
        </div>
      </header>

      <Section index="01" title={t("levelsHeading")}>
        <ul className="flex flex-col gap-3">
          {LEVELS.map((level) => (
            <LevelBadgePlaceholder key={level} level={level} />
          ))}
        </ul>
      </Section>

      <Section index="02" title={t("bandHeading")}>
        <ShadeBandPreview />
        <p className="text-sm text-ink-muted">{t("bandNote")}</p>
      </Section>

      <Section index="03" title={t("typeHeading")}>
        <TypeScale />
      </Section>

      <Section index="04" title={t("tokensHeading")}>
        <ThemePanel theme="light" title={t("lightTheme")} />
        <ThemePanel theme="dark" title={t("darkTheme")} />
      </Section>
    </main>
  );
}
