import { useTranslations } from "next-intl";
import { FieldLink } from "@/components/shell/FieldLink";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";
import { CopyStepLink } from "./CopyStepLink";
import { STORY_STEPS, type StoryStepId } from "./story-steps";

/**
 * The footer of every judge page: where this page sits in the five-step story, links to the steps that exist, Back and Next
 * (skipping a step whose view is not built, see story-steps.ts), and "Copy link to this step". Every target is 48 px. The
 * current step is `aria-current="step"`; a step that is not built is text, never a dead link. No link prefetches (`FieldLink`):
 * on a short page (the proof sheet's empty state) the footer is in view, and a prefetch pulled the next page's script into the
 * route's own budget (Lighthouse counted 223 KB on it).
 */
export function StoryNav({ current }: { readonly current: StoryStepId }) {
  const t = useTranslations("judge.story");
  const attrs = useLocaleAttrs();
  const position = STORY_STEPS.findIndex((step) => step.id === current);
  const built = STORY_STEPS.map((step, index) => ({ ...step, index })).filter((step) => step.built);
  const previous = [...built].reverse().find((step) => step.index < position);
  const next = built.find((step) => step.index > position);
  const label = (id: StoryStepId): string => t(`steps.${id}`);
  const action =
    "inline-flex min-h-12 items-center justify-center rounded-sign border border-edge bg-ground px-4 text-base text-ink no-underline hover:bg-panel";

  return (
    <nav {...attrs} aria-label={t("label")} data-story-nav="" className="flex flex-col gap-4 border-t border-hair pt-6">
      <p className="text-sm text-ink-3">{t("chapter", { n: String(position + 1), total: String(STORY_STEPS.length), label: label(current) })}</p>
      <ol className="flex flex-wrap gap-2">
        {STORY_STEPS.map((step) => (
          <li key={step.id}>
            {step.built ? (
              <FieldLink
                href={step.href}
                aria-current={step.id === current ? "step" : undefined}
                className="inline-flex min-h-12 items-center rounded-sign border border-transparent px-3 text-base text-ink-2 no-underline hover:text-ink aria-[current=step]:border-ink aria-[current=step]:font-semibold aria-[current=step]:text-ink"
              >
                {label(step.id)}
              </FieldLink>
            ) : (
              <span className="inline-flex min-h-12 items-center px-3 text-base text-ink-3">{label(step.id)}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        {previous === undefined ? null : (
          <FieldLink href={previous.href} rel="prev" className={action}>
            {t("back", { label: label(previous.id) })}
          </FieldLink>
        )}
        {next === undefined ? null : (
          <FieldLink href={next.href} rel="next" data-story-next="" className={action}>
            {t("next", { label: label(next.id) })}
          </FieldLink>
        )}
        <CopyStepLink />
      </div>
    </nav>
  );
}
