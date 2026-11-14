import { useTranslations } from "next-intl";
import { LevelSign } from "@/components/level/LevelSign";
import { LEVELS } from "@/components/level/level";
import { Cell, CellGrid } from "./Cell";

/** The level sign: hero and mini, every level live, then the stale and fallback kinds that must never read as live. */
export function LevelSignSection() {
  const t = useTranslations("common.kit.sample");
  return (
    <div className="flex flex-col gap-6">
      <CellGrid>
        {LEVELS.map((level) => (
          <Cell key={level} caption={`hero · live · ${level}`}>
            <LevelSign level={level} kind="live" size="hero" kicker={t("kickerNow")} until={t("untilNow")} />
          </Cell>
        ))}
        <Cell caption="hero · stale · orange">
          <LevelSign level="orange" kind="stale" size="hero" kicker={t("kickerStale")} until={t("untilStale")} />
        </Cell>
        <Cell caption="hero · fallback · no level">
          <LevelSign level={null} kind="fallback" size="hero" kicker={t("kickerFallback")} />
        </Cell>
      </CellGrid>
      <CellGrid>
        {LEVELS.map((level) => (
          <Cell key={level} caption={`mini · live · ${level}`}>
            <LevelSign level={level} kind="live" size="mini" kicker={t("kickerNow")} until={t("untilNow")} />
          </Cell>
        ))}
        <Cell caption="mini · stale · orange">
          <LevelSign level="orange" kind="stale" size="mini" kicker={t("kickerStale")} until={t("untilStale")} />
        </Cell>
        <Cell caption="mini · fallback · no level">
          <LevelSign level={null} kind="fallback" size="mini" kicker={t("kickerFallback")} />
        </Cell>
      </CellGrid>
    </div>
  );
}
