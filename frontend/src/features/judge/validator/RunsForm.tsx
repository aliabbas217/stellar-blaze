import { useTranslations } from "next-intl";
import { clockOf, parseTime, TEMPLATES, type Run, type RunProblem, type TemplateId } from "./runs";
import { CLAIMS_LOCALE } from "@/i18n/claims-english";

/*
 * The inputs of the check: the three roster templates, the work times (three editable runs), and the two crew assumptions the
 * contract requires (`acclimatised`, `days_per_week`), filled with the protective defaults and editable. Presentational and
 * shared by the server-rendered first paint and the island: the controls carry `data-island-action` (the gate loads the island
 * on the first tap) and the fields `data-island-field` (the gate hands what was typed to the island), and handlers are optional.
 *
 * Times are plain text inputs, 16 px, `inputmode="numeric"`, written `hh:mm` (also `0600`; paste is allowed, never
 * `type=time`). A time is checked when the field loses focus, so nobody is told off mid-keystroke. The check button is NEVER
 * pre-disabled (a disabled submit hides why it does nothing); a plan that does not read is said under it when it is pressed.
 */

export interface RunsFormHandlers {
  readonly onTemplate: (id: TemplateId) => void;
  readonly onRun: (index: number, field: "start" | "end", value: string) => void;
  readonly onRunBlur: (index: number, field: "start" | "end") => void;
  readonly onAcclimatised: (value: boolean) => void;
  readonly onDays: (value: string) => void;
}

export interface RunsFormProps {
  /** The rows of the form (blank rows included), at most three. */
  readonly runs: readonly Run[];
  /** What is wrong with each row after its fields lost focus, or null. */
  readonly rowProblems: readonly (RunProblem | null)[];
  /** The template the runs are, or null for the visitor's own times. */
  readonly templateId: TemplateId | null;
  readonly acclimatised: boolean;
  readonly daysPerWeek: string;
  readonly daysProblem: boolean;
  /** Undefined in the first paint: the gate loads the island, which owns the state. */
  readonly handlers?: RunsFormHandlers;
}

const FIELD = "min-h-(--target) w-28 rounded-sign border border-edge bg-ground px-3 text-base text-ink tabular-nums placeholder:text-ink-3";

export function RunsForm({ runs, rowProblems, templateId, acclimatised, daysPerWeek, daysProblem, handlers }: RunsFormProps) {
  const t = useTranslations("judge.try");
  const locale = CLAIMS_LOCALE;
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const rangeText = (run: Run): string => {
    const start = parseTime(run.start);
    const end = parseTime(run.end);
    return "minutes" in start && "minutes" in end ? t("runs.range", { from: clockOf(start.minutes), to: clockOf(end.minutes) }) : `${run.start} ${run.end}`;
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2" data-try-form="">
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-semibold text-ink">{t("templates.heading")}</legend>
          <div className="flex flex-wrap gap-2" role="group">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                aria-pressed={templateId === template.id}
                data-island-action={`template-${template.id}`}
                {...(handlers === undefined
                  ? {}
                  : {
                      onClick: () => {
                        handlers.onTemplate(template.id);
                      },
                    })}
                className="group/tpl inline-flex min-h-(--target) flex-col items-start justify-center rounded-ctl bg-panel px-4 py-2 text-start text-base text-ink inset-ring-[1.5px] inset-ring-hair transition-transform duration-(--dur-press) active:scale-[0.985] aria-pressed:bg-ink aria-pressed:font-semibold aria-pressed:text-ground aria-pressed:inset-ring-0"
              >
                <span>{t(`templates.${template.id}`)}</span>
                <span className="text-sm font-normal text-ink-3 tabular-nums group-aria-pressed/tpl:text-ground">{list.format(template.runs.map(rangeText))}</span>
              </button>
            ))}
          </div>
          {templateId === null ? <p className="text-sm text-ink-3">{t("templates.custom")}</p> : null}
        </fieldset>

        <fieldset className="flex flex-col gap-2" data-runs="">
          <legend className="text-base font-semibold text-ink">{t("runs.heading")}</legend>
          <p className="max-w-(--measure) text-sm text-ink-3" id="try-runs-hint">
            {t("runs.hint")}
          </p>
          <div className="grid gap-3">
            {runs.map((run, i) => {
              const problem = rowProblems[i] ?? null;
              const label = t("runs.run", { n: String(i + 1) });
              return (
                <div key={i} className="flex flex-col gap-1" data-run={i + 1}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-14 text-base text-ink-2">{label}</span>
                    {(["start", "end"] as const).map((field) => (
                      <input
                        key={field}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                        dir="ltr"
                        name={`run-${String(i)}-${field}`}
                        data-island-field={`run-${String(i)}-${field}`}
                        aria-label={`${label}: ${t(`runs.${field}`)}`}
                        aria-describedby="try-runs-hint"
                        aria-invalid={problem !== null}
                        placeholder={t("runs.placeholder")}
                        className={FIELD}
                        {...(handlers === undefined
                          ? { defaultValue: run[field] }
                          : {
                              value: run[field],
                              onChange: (event) => {
                                handlers.onRun(i, field, event.target.value);
                              },
                              onBlur: () => {
                                handlers.onRunBlur(i, field);
                              },
                            })}
                      />
                    ))}
                  </div>
                  {problem === null ? null : (
                    <p className="text-sm text-ink" data-run-problem={problem}>
                      {t(`runs.problem.${problem}`)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      </div>

      <fieldset className="flex flex-col gap-3" data-assumptions="">
        <legend className="text-base font-semibold text-ink">{t("assumptions.heading")}</legend>
        <p className="max-w-(--measure) text-sm text-ink-3">{t("assumptions.note")}</p>
        <div className="flex min-h-(--target) items-start gap-3">
          <input
            id="try-acclimatised"
            type="checkbox"
            name="acclimatised"
            data-island-field="acclimatised"
            aria-describedby="try-acclimatised-note"
            className="mt-1 size-6 shrink-0 accent-signal"
            {...(handlers === undefined
              ? { defaultChecked: acclimatised }
              : {
                  checked: acclimatised,
                  onChange: (event) => {
                    handlers.onAcclimatised(event.target.checked);
                  },
                })}
          />
          <div className="flex flex-col">
            <label htmlFor="try-acclimatised" className="text-base text-ink">
              {t("assumptions.acclimatised")}
            </label>
            <span id="try-acclimatised-note" className="text-sm text-ink-3">
              {t("assumptions.acclimatisedNote")}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="try-days" className="text-base text-ink">
            {t("assumptions.days")}
          </label>
          <input
            id="try-days"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            name="days"
            data-island-field="days"
            aria-invalid={daysProblem}
            aria-describedby="try-days-note"
            className={FIELD}
            {...(handlers === undefined
              ? { defaultValue: daysPerWeek }
              : {
                  value: daysPerWeek,
                  onChange: (event) => {
                    handlers.onDays(event.target.value);
                  },
                })}
          />
          <span id="try-days-note" className="text-sm text-ink-3">
            {daysProblem ? t("assumptions.daysProblem") : t("assumptions.daysNote")}
          </span>
        </div>
      </fieldset>
    </div>
  );
}
