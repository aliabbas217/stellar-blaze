import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
import { policyClaim } from "@/features/judge/adapters";
import { useClaimsAttrs } from "@/i18n/claims-english";
import { dirFor } from "@/i18n/direction";
import { stripFill } from "./landing-colour";
import { DAY_STEPS, DAY_STRIP, MIDDAY_BREAK, clockText, hoursOf, type DayLevel } from "./landing-day";
import { BoundaryFigure, PlanFigure } from "./LandingFigures";
import { LandingVideo } from "./LandingVideo";
import type { Evidence, Headline } from "./evidence";
import { ROLE_DOOR_DESTINATIONS, ROLE_DOOR_ORDER } from "./role-door-destinations";

/*
 * Slides 02 to 07 of the landing: each chapter after the forecast is ONE whole screen that comes to rest (landing.css). Server components with
 * no script: reveals and bar counters are LandingEffects.tsx, the rail is LandingRail.tsx. Their numbers are never typed: the four bars, the
 * axis and the two big verdict numbers come from `evidence.ts` (the scored Warnings file), the strip of the morning from the recorded forecast.
 *
 * Language (decision D2): the chapters' own words are Tier 2 (`judge.landing.story.*`, English by design), so those slides carry
 * `lang="en" dir="ltr"`; the words that are the app's own (the level names and what the sign says, the Demo tag, the role door, the video) are
 * Tier 1 and restore the page's language on their own block. "Ways in" is Tier 1 all through.
 */

/** The story chapters' language attributes: English and left to right, or the page's own where the story is translated (Arabic). */
function useClaims() {
  return { ...useClaimsAttrs(), "data-claims-english": "" } as const;
}
export const AUDITORS_HREF = `/replay/proof/${policyClaim("P3_protect", "missed_danger_hours")}#audit`;
type Custom = CSSProperties & Record<`--${string}`, string | number>;

function Mark({ n, label }: { readonly n: string; readonly label: string }) {
  const locale = useLocale();
  return (
    <p className="chi" lang={locale} dir={dirFor(locale)}>
      {`${n} / ${label}`}
    </p>
  );
}

function Level({ level }: { readonly level: DayLevel }) {
  const t = useTranslations("levels.name");
  return (
    <>
      <i className="mk" aria-hidden="true" />
      {t(level)}
    </>
  );
}

const pct = (hour: number): string => `${String(((hour - DAY_STRIP.from) / (DAY_STRIP.to - DAY_STRIP.from)) * 100)}%`;

function Spine({ omaa }: { readonly omaa: readonly number[] }) {
  const t = useTranslations("judge.landing.story.morning.spine");
  const hours = Array.from({ length: DAY_STRIP.to - DAY_STRIP.from + 1 }, (_, i) => DAY_STRIP.from + i);
  const ends = [DAY_STRIP.from, ...DAY_STEPS.slice(0, 3).map((s) => hoursOf(s.until)), DAY_STRIP.to];
  return (
    <div className="spine rv" aria-hidden="true">
      <span className="rl" style={{ top: 22 }}>{t("level")}</span>
      <span className="rl" style={{ top: 46, width: 112, lineHeight: 1.3 }}>{t("airport")}</span>
      <div className="in">
        <div className="slot" style={{ insetInlineStart: pct(MIDDAY_BREAK.from), width: `${String(((MIDDAY_BREAK.to - MIDDAY_BREAK.from) / (DAY_STRIP.to - DAY_STRIP.from)) * 100)}%` }}>
          <span>{t("break")}</span>
        </div>
        {hours.map((h) => (
          <span key={h} className="hr" style={{ insetInlineStart: pct(h) }}>{String(h).padStart(2, "0")}</span>
        ))}
        <div className="lvls">
          {DAY_STEPS.map((s, i) => (
            <i key={s.level} style={{ "--c": `var(--lv-${s.level})`, insetInlineStart: pct(ends[i] ?? 0), width: `${String((((ends[i + 1] ?? 0) - (ends[i] ?? 0)) / (DAY_STRIP.to - DAY_STRIP.from)) * 100)}%` } as Custom} />
          ))}
        </div>
        <div className="heat">
          {hours.slice(0, -1).map((h) => (
            <i key={h} style={{ insetInlineStart: pct(h), width: `${String(100 / (DAY_STRIP.to - DAY_STRIP.from))}%`, background: stripFill(omaa[h] ?? 0) }} />
          ))}
        </div>
        {DAY_STEPS.map((s, i) => (
          <span key={`tick${s.level}`}>
            <i className={i === 0 ? "tick first" : "tick"} style={{ insetInlineStart: pct(s.minute / 60) }} />
            <span className={i === 0 ? "tl first" : "tl"} style={{ insetInlineStart: pct(s.minute / 60) }}>{clockText(s.minute)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Morning({ omaa }: { readonly omaa: readonly number[] }) {
  const claims = useClaims();
  const t = useTranslations("judge.landing");
  const today = useTranslations("worker.today");
  const lv = useTranslations("levels");
  const rail = useTranslations("judge.landing.rail");
  const locale = useLocale();
  const lead = (s: (typeof DAY_STEPS)[number]): string => (s.lead.kind === "cycle" ? today("lead.cycle", { work: String(s.lead.work), rest: String(s.lead.rest) }) : today(s.lead.kind === "stop" ? "lead.stop" : "lead.siteRules"));
  return (
    <section id="morning" className="ch sl" data-ch="2" aria-labelledby="h-morning" {...claims}>
      <Mark n="02" label={rail("morning")} />
      <div className="fill">
        <div className="g head rv">
          <h2 id="h-morning" className="c-a">{t("story.morning.heading")}</h2>
        </div>
        <div className="states rv" role="list" lang={locale} dir={dirFor(locale)}>
          {DAY_STEPS.map((s, i) => (
            <article key={s.level} className="st" role="listitem" style={{ "--c": `var(--lv-${s.level})` } as Custom}>
              <p className="t" dir="ltr">{clockText(s.minute)}</p>
              <p className="lv"><Level level={s.level} /></p>
              <p className="u">{today.rich("until", { time: s.until, bdi: (chunks) => <bdi>{chunks}</bdi> })}</p>
              <p className="lead">{lead(s)}</p>
              <div className="scale" role="img" aria-label={lv("scale.live", { index: String(i + 1), name: lv(`name.${s.level}`) })}>
                {DAY_STEPS.map((o, k) => (
                  <i key={o.level} className={k === i ? "on" : undefined} />
                ))}
              </div>
            </article>
          ))}
        </div>
        <Spine omaa={omaa} />
        <div className="foot rv">
          <p className="tag-row" lang={locale} dir={dirFor(locale)}>
            <span className="tag">{t("phone.demo")}</span>
            <span>{t("phone.site")}</span>
          </p>
          <p className="cap2">{t("story.morning.body2")}</p>
        </div>
      </div>
    </section>
  );
}

export function Plan() {
  const claims = useClaims();
  const t = useTranslations("judge.landing.story.plan");
  const rail = useTranslations("judge.landing.rail");
  const locale = useLocale();
  const crews = (["A", "C", "D"] as const).map((letter) => ({ letter, name: t(`crew${letter}.name`), task: t(`crew${letter}.task`) }));
  return (
    <section id="plan" className="ch sl" data-ch="3" aria-labelledby="h-plan" {...claims}>
      <Mark n="03" label={rail("plan")} />
      <div className="fill">
        <div className="g two">
          <div className="c-a rv">
            <h2 id="h-plan">{t("heading")}</h2>
            <p className="copy">{t("copy")}</p>
            <p className="lnk">
              <FieldLink href="/supervisor">{t("link")}</FieldLink>
            </p>
          </div>
          <div className="c-b rv">
            <PlanFigure label={`${t("heading")}: ${crews.map((c) => c.name).join(", ")}. ${t("stop")}.`} crews={crews} level={t("level")} unsigned={t("unsigned")} stop={t("stop")} />
            <p className="tag-row" lang={locale} dir={dirFor(locale)}>
              <span className="tag">{t("tag")}</span>
              <span lang="en" dir="ltr">{t("demo")}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Boundary() {
  const claims = useClaims();
  const t = useTranslations("judge.landing.story.boundary");
  const rail = useTranslations("judge.landing.rail");
  return (
    <section id="boundary" className="ch sl" data-ch="4" aria-labelledby="h-boundary" {...claims}>
      <Mark n="04" label={rail("boundary")} />
      <div className="fill">
        <div className="g head rv">
          <h2 id="h-boundary" className="c-a">{t("heading")}</h2>
          <div className="c-b copy">
            <p className="lnk">
              <FieldLink href="/replay/governance">{t("link")}</FieldLink>
            </p>
          </div>
        </div>
        <div className="wide rv">
          <BoundaryFigure
            label={`${t("request")} ${t("refused")} ${t("panel.seenLine")}`}
            asked={{ tag: t("panel.asked"), lead: t("request"), line: t("requestDetail") }}
            refused={{ tag: t("panel.refused"), lead: t("refused"), line: t("panel.refusedLine") }}
            seen={{ tag: t("panel.seen"), lead: t("panel.seenLine"), line: t("panel.chain") }}
            earlier={t("panel.earlier")}
            entry={t("panel.entry")}
          />
        </div>
      </div>
    </section>
  );
}

function Verdict({ headline, plain, met, notMet, line, noClaim }: { readonly headline: Headline | undefined; readonly plain: string | undefined; readonly met: string; readonly notMet: string; readonly line: string; readonly noClaim: string | null }) {
  const outcome = headline?.outcome ?? null;
  const number = headline === undefined || headline.direction === "unclear" ? null : `${headline.direction === "more" ? "+" : ""}${headline.value}`;
  return (
    <article className="vc" role="listitem">
      <p className={outcome === "met" ? "vs met" : "vs not"}>
        <i className="mk" aria-hidden="true" />
        {outcome === "met" ? met : notMet}
      </p>
      <div className="vb">
        {number === null ? (
          <p className="vl">{plain}</p>
        ) : (
          <>
            <p className="vn">{number}</p>
            <p className="vl">{noClaim === null ? line : `${line} ${noClaim}`}</p>
          </>
        )}
      </div>
    </article>
  );
}

export function EvidenceSlides({ evidence }: { readonly evidence: Evidence | null }) {
  const claims = useClaims();
  const t = useTranslations("judge.landing.story.evidence");
  const rail = useTranslations("judge.landing.rail");
  const falseAlarms = (n: string): string => t("falseAlarms", { n });
  const h4 = evidence?.headlines.find((h) => h.id === "H4");
  const h5 = evidence?.headlines.find((h) => h.id === "H5");
  const plainOf = (id: string): string | undefined => evidence?.verdicts.find((v) => v.id === id)?.text;
  const longest = evidence?.bars[0]?.missed ?? "";
  return (
    <>
      <section id="evidence" className="ch sl" data-ch="5" aria-labelledby="h-evidence" {...claims}>
        <Mark n="05" label={rail("evidence")} />
        <div className="fill">
          <div className="g head rv">
            <h2 id="h-evidence" className="c-a">{t("heading")}</h2>
            <div className="c-b copy"><p>{t("short.body")}</p></div>
          </div>
          {evidence === null ? (
            <p className="copy rv">{t("unavailable")}</p>
          ) : (
            <div className="bars rv" data-bars="">
              <p className="bcap">{t("short.caption")}</p>
              <div className="axis" aria-hidden="true">
                <span />
                <span className="ax"><span>0</span><span>{longest}</span></span>
                <span />
              </div>
              <ul>
                {evidence.bars.map((bar) => (
                  <li key={bar.id} className={bar.ours ? "ours" : undefined} data-policy={bar.id} style={{ "--v": bar.share } as Custom}>
                    <div className="lab">
                      <b>{bar.ours ? <i className="mk" aria-hidden="true" /> : null}{bar.label}</b>
                      <span data-bar-false-alarms="">{falseAlarms(bar.falseAlarms)}</span>
                    </div>
                    <div className="trk" aria-hidden="true"><i /></div>
                    <p className="val" data-count={bar.missedValue} data-bar-missed="">{bar.missed}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
      <section id="checks" className="ch sl" data-ch="5" aria-labelledby="h-checks" {...claims}>
        <Mark n="05" label={rail("evidence")} />
        <div className="fill">
          <div className="g head rv">
            <h2 id="h-checks" className="c-a">{t("verdicts")}</h2>
            <div className="c-b copy"><p>{t("short.trade")}</p></div>
          </div>
          {evidence === null ? null : (
            <div className="vd rv" role="list" data-verdict-list="">
              <Verdict headline={h4} plain={plainOf("H4")} met={t("met")} notMet={t("notMet")} line={t(`headline.H4.${h4?.direction === "more" ? "more" : "fewer"}`)} noClaim={null} />
              <Verdict headline={h5} plain={plainOf("H5")} met={t("met")} notMet={t("notMet")} line={t(`headline.H5.${h5?.direction === "fewer" ? "fewer" : "more"}`)} noClaim={t("noClaim")} />
            </div>
          )}
          <p className="lnk rv">
            <FieldLink href="/replay">{t("scoreboard")}</FieldLink>
          </p>
        </div>
      </section>
    </>
  );
}

export function WaysIn() {
  const t = useTranslations("judge.landing");
  const rail = useTranslations("judge.landing.rail");
  return (
    <section id="ways" className="ch sl" data-ch="6" aria-labelledby="h-ways">
      <p className="chi">{`06 / ${rail("ways")}`}</p>
      <div className="fill">
        <div className="g head rv">
          <h2 id="h-ways" className="c-a">{t("ways.heading")}</h2>
        </div>
        <nav aria-label={t("door.label")} data-role-door="">
          <ul className="door rv">
            {ROLE_DOOR_ORDER.map((role) => (
              <li key={role}>
                <FieldLink href={ROLE_DOOR_DESTINATIONS[role]} data-role={role}>
                  <b>{t(`door.${role}.title`)}</b>
                  <span>{t(`door.${role}.line`)}</span>
                </FieldLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}

export function Limits() {
  const claims = useClaims();
  const t = useTranslations("judge.landing.story.limits");
  const v = useTranslations("judge.landing.video");
  const rail = useTranslations("judge.landing.rail");
  const locale = useLocale();
  const items: readonly ReactNode[] = (["one", "two", "three", "four"] as const).map((k) => t(k));
  return (
    <section id="limits" className="ch sl" data-ch="7" aria-labelledby="h-limits" {...claims}>
      <Mark n="07" label={rail("limits")} />
      <div className="fill">
        <h2 id="h-limits" className="rv">{t("eyebrow")}</h2>
        <div className="g two late">
          <div className="c-a rv" lang={locale} dir={dirFor(locale)}>
            <h3>{v("title")}</h3>
            <LandingVideo />
          </div>
          <div className="c-b rv">
            <ul className="lim">
              {items.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
            <p className="lnk">
              <FieldLink href="/replay">{t("tested")}</FieldLink>
              <FieldLink href={AUDITORS_HREF}>{t("auditors")}</FieldLink>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
