import { LevelScale } from "@/components/level/LevelScale";
import { LEVELS } from "@/components/level/level";
import { Cell, CellGrid } from "./Cell";

/** The scale alone: each level live with labels, the dashed kinds, no level, and the label-free form of the mini sign. */
export function LevelScaleSection() {
  return (
    <CellGrid>
      {LEVELS.map((level) => (
        <Cell key={level} caption={`live · ${level}`}>
          <LevelScale level={level} kind="live" />
        </Cell>
      ))}
      <Cell caption="stale · orange (dashed marker)">
        <LevelScale level="orange" kind="stale" />
      </Cell>
      <Cell caption="fallback · red (dashed marker)">
        <LevelScale level="red" kind="fallback" />
      </Cell>
      <Cell caption="no level (no marker)">
        <LevelScale level={null} kind="fallback" />
      </Cell>
      <Cell caption="live · amber · labels off">
        <LevelScale level="amber" kind="live" labels={false} />
      </Cell>
    </CellGrid>
  );
}
