import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { LEVELS, levelIndex, type Level } from "@/components/level/level";
import { DraftBadge } from "@/components/shell/DraftBadge";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { SunToggle } from "@/components/shell/SunToggle";

/*
 * Dev-only visual specimen for the "Qaylula" direction (DESIGN.md).
 * Not part of the product: it returns 404 in production unless SB_SPECIMEN=1.
 *
 * It renders in the language of its route, so /en, /ar, /ur, /hi, /bn and /ne/dev/specimen show the
 * same page in each script with that locale's fonts, direction and line height. Its copy lives in
 * messages (common.specimen.*, levels.*); the non-English text there is machine draft.
 * The level rows are a minimal token-only stand-in (the level word plus a 10 px mark, no plate, no hatch) until
 * LevelSign exists (Task 4). The shell controls (language, sun toggle, draft badge) are mounted in the header so they
 * can be seen and tried here. Both themes are drawn side by side from nested [data-theme] subtrees.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.specimen");
  return { title: t("title"), robots: { index: false, follow: false } };
}

// Full class names, never built by interpolation, so Tailwind's scanner finds them.
const MARK_CLASS = {
  green: "bg-lv-green",
  amber: "bg-lv-amber",
  orange: "bg-lv-orange",
  red: "bg-lv-red",
} as const satisfies Record<Level, string>;

// One hour strip: a long outdoor shift, 08:00 to 19:00. The two cells on `bg-slot` show the recessed band.
const HOURS: readonly { hour: string; slot: boolean }[] = [
  { hour: "08", slot: false },
  { hour: "09", slot: false },
  { hour: "10", slot: false },
  { hour: "11", slot: false },
  { hour: "12", slot: false },
  { hour: "13", slot: true },
  { hour: "14", slot: true },
  { hour: "15", slot: false },
  { hour: "16", slot: false },
  { hour: "17", slot: false },
  { hour: "18", slot: false },
  { hour: "19", slot: false },
];
const NOW_HOUR = "11";

// Token names and sizes are identifiers of the design system, not copy: they stay in code.
const TYPE_STEPS = [
  { cls: "text-xs", px: 12, numeral: false },
  { cls: "text-sm", px: 14, numeral: false },
  { cls: "text-base", px: 16, numeral: false },
  { cls: "text-lg", px: 18, numeral: false },
  { cls: "text-xl font-medium", px: 22, numeral: false },
  { cls: "text-2xl font-medium", px: 28, numeral: false },
  { cls: "text-3xl", px: 36, numeral: false },
  { cls: "text-4xl tracking-display", px: 48, numeral: true },
  { cls: "text-5xl tracking-display", px: 64, numeral: true },
  { cls: "text-6xl font-medium", px: 76, numeral: true },
] as const;

function Section({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-baseline gap-3 border-b border-hair pb-2 font-display text-2xl font-medium">
        <span className="tabular-nums text-ink-3">{index}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The level word with its 10 px mark: the whole of a level at this stage. Task 4 replaces it with LevelSign. */
function LevelRow({ level }: { level: Level }) {
  const t = useTranslations("levels");
  return (
    <li className="flex items-center gap-3 border-b border-hair py-3">
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-sign ${MARK_CLASS[level]}`} />
      <span className="font-display text-xl font-medium">{t(`name.${level}`)}</span>
      <span className="ms-auto tabular-nums text-ink-3">{levelIndex(level)}</span>
    </li>
  );
}

function HourStrip() {
  return (
    <ol className="grid auto-cols-fr grid-flow-col border border-hair">
      {HOURS.map(({ hour, slot }, i) => {
        const isNow = hour === NOW_HOUR;
        const prev = HOURS[i - 1]?.slot === true;
        const next = HOURS[i + 1]?.slot === true;
        return (
          <li
            key={hour}
            aria-current={isNow ? "time" : undefined}
            className={`py-3 text-center text-sm tabular-nums ${
              isNow ? "bg-ink text-ground" : slot ? "bg-slot text-ink-3" : "text-ink-2"
            } ${slot && !prev ? "border-s border-hair" : ""} ${slot && !next ? "border-e border-hair" : ""}`}
          >
            {hour}
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
        <div key={step.px} className="flex flex-col gap-1 border-b border-hair pb-4">
          <p className="font-mono text-sm text-ink-3">
            {step.px} px · {step.cls.split(" ")[0]}
          </p>
          <p className={`font-display ${step.cls}`}>{step.numeral ? t("time") : t("phrase")}</p>
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
      <span className="font-mono text-sm leading-tight">{label}</span>
      {sub === undefined ? null : <span className="font-mono text-sm leading-tight text-ink-2">{sub}</span>}
    </li>
  );
}

const SAMPLE_MARK = "font-display text-2xl font-medium leading-solid";

function ThemePanel({ theme, title }: { theme: "night" | "sun"; title: string }) {
  return (
    <section
      data-theme={theme}
      aria-label={title}
      className="flex flex-col gap-4 rounded-sign border border-edge bg-ground p-4 text-ink"
    >
      <h3 className="font-display text-xl font-medium">{title}</h3>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Swatch label="ground" boxClass="border border-edge bg-ground" />
        <Swatch label="ground-deep" boxClass="border border-hair bg-ground-deep" />
        <Swatch label="panel" boxClass="border border-hair bg-panel" />
        <Swatch label="raised" boxClass="border border-hair bg-raised" />
        <Swatch label="slot" boxClass="border border-hair bg-slot" />
        <Swatch label="hair" boxClass="border-2 border-hair bg-ground" />
        <Swatch label="edge" boxClass="border-2 border-edge bg-ground" />
        <Swatch label="ink" boxClass="border border-hair bg-ground text-ink">
          <span className={SAMPLE_MARK}>Aa</span>
        </Swatch>
        <Swatch label="ink-2" boxClass="border border-hair bg-ground text-ink-2">
          <span className={SAMPLE_MARK}>Aa</span>
        </Swatch>
        <Swatch label="ink-3" boxClass="border border-hair bg-ground text-ink-3">
          <span className={SAMPLE_MARK}>Aa</span>
        </Swatch>
        <Swatch label="signal" sub="on-signal" boxClass="bg-signal text-on-signal">
          <span className={SAMPLE_MARK}>Aa</span>
        </Swatch>
        <Swatch label="focus ring" boxClass="m-1 bg-ground outline-3 outline-offset-2 outline-focus" />
        <Swatch label="scrim" sub="bg-scrim" boxClass="bg-scrim" />
        {LEVELS.map((level) => (
          <Swatch key={level} label={`lv-${level}`} boxClass={`${MARK_CLASS[level]} text-ground`}>
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
        <p className="font-mono text-sm text-ink-3">{t("kicker", { locale })}</p>
        <h1 className="font-display text-5xl leading-solid tracking-display">{t("title")}</h1>
        <p className="text-lg text-ink-2">{t("lead")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <LocaleSwitcher />
          <SunToggle />
          <DraftBadge />
        </div>
      </header>

      <Section index="01" title={t("levelsHeading")}>
        <ul className="flex flex-col">
          {LEVELS.map((level) => (
            <LevelRow key={level} level={level} />
          ))}
        </ul>
      </Section>

      <Section index="02" title={t("bandHeading")}>
        <HourStrip />
        <p className="text-sm text-ink-2">{t("bandNote")}</p>
      </Section>

      <Section index="03" title={t("typeHeading")}>
        <TypeScale />
      </Section>

      <Section index="04" title={t("tokensHeading")}>
        <ThemePanel theme="night" title={t("nightTheme")} />
        <ThemePanel theme="sun" title={t("sunTheme")} />
      </Section>
    </main>
  );
}
