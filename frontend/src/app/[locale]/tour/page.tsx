import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { FieldLink } from "@/components/shell/FieldLink";
import { ACTION_PRIMARY_DENSE, ACTION_SECONDARY_DENSE } from "@/components/states/actions";
import { claimsAttrs } from "@/i18n/claims-english";
import { DEMO_CONTROLS_HREF, TOUR_STEPS } from "@/features/judge/tour-steps";

/*
 * `/tour`: the 3-minute tour for a reviewer (03 section 6). Numbered stops, each one plain sentence and a link to the real screen, in
 * the order that tells the story. Static, server markup, no script. The page chrome and the buttons are in the visitor's language; the
 * stops' own sentences are English by design (Tier 2, `judge.tour.steps.`: story copy, like the landing's chapters), so each sits in a
 * `lang="en"` block. No number is written here, and the one "Where from" link points at a proof sheet that already exists.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.tour");
  return { title: t("title") };
}

export default async function TourPage() {
  const t = await getTranslations("judge.tour");
  const steps = await getTranslations("judge.tour.steps");
  const proof = await getTranslations("states.proof");
  const door = await getTranslations("judge.landing.door");
  const claims = claimsAttrs(await getLocale());

  return (
    <main id="main-content" className="mx-auto flex w-full max-w-(--content-max) flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-medium text-ink">{t("title")}</h1>
        <p className="max-w-(--measure) text-lg text-ink-2">{t("lead")}</p>
      </header>
      <ol className="flex max-w-(--measure) flex-col gap-3">
        {TOUR_STEPS.map((step, index) => (
          <li
            key={step.id}
            data-tour-step={step.id}
            className="flex items-start gap-4 rounded-card bg-panel p-4 inset-ring-[1.5px] inset-ring-edge"
          >
            <span aria-hidden="true" className="grid min-h-11 min-w-11 flex-none place-items-center rounded-ctl bg-raised font-display text-lg font-semibold text-ink">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div {...claims} className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-ink">{steps(`${step.id}.title`)}</h2>
                <p className="text-base text-ink-2">{steps(`${step.id}.text`)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <FieldLink href={step.href} {...(index === 0 ? { "data-primary": "" } : {})} className={index === 0 ? ACTION_PRIMARY_DENSE : ACTION_SECONDARY_DENSE}>
                  {t("open")}
                </FieldLink>
                {step.proof === undefined ? null : (
                  <FieldLink href={step.proof} {...claims} data-where-from="" className="inline-flex min-h-(--target) items-center text-base text-ink-2 underline underline-offset-4 hover:text-ink">
                    {proof("chip")}
                  </FieldLink>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <section className="flex max-w-(--measure) flex-col items-start gap-2">
        <p className="text-base text-ink-2">{t("controls")}</p>
        <FieldLink href={DEMO_CONTROLS_HREF} className={ACTION_SECONDARY_DENSE}>
          {t("controlsLink")}
        </FieldLink>
      </section>
      <p className="max-w-(--measure) text-base text-ink-2">{door("note")}</p>
      <MachineTranslationNotice />
    </main>
  );
}
