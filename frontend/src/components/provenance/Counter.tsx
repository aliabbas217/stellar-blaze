import { LevelMark } from "@/components/level/LevelSign";
import { Proved } from "./Proved";
import type { Proof } from "./proof";

export interface CounterProps {
  /** The number, already formatted for the reader ("1,624", "93%"); Western digits in every locale. */
  readonly value: string;
  /** What is counted, in words ("working hours forecast above the limit"). It also names the number in the proof chip. */
  readonly unit: string;
  /** The uncertainty line ("95% interval 1.2 to 3.4"), when the number has one. */
  readonly interval?: string;
  /** The language and direction of `interval`, when it is a translated line inside an English claims block (the landing's "of N working hours"). */
  readonly intervalAttrs?: { readonly lang: string; readonly dir: "ltr" | "rtl" };
  /** Null: no provenance, so the value is not rendered at all (a note stands in its place). */
  readonly proof: Proof | null;
  /** `mega` is the hero figure (76 px), `numeral` the row figure (36 px). */
  readonly size: "mega" | "numeral";
  /** A danger count: a small level mark stands beside the words, never a colour on the number. */
  readonly danger?: boolean;
}

const SIZE = {
  mega: "text-6xl",
  numeral: "text-3xl",
} as const;

/**
 * A scored or counted number with its provenance: the figure, what it counts, its interval, and the proof chip. Every
 * number has provenance or is not shown: with no proof the value never reaches the markup (see `Proved`).
 */
export function Counter({ value, unit, interval, intervalAttrs, proof, size, danger = false }: CounterProps) {
  return (
    <div data-counter={size} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Proved proof={proof} what={unit}>
          <strong className={`font-display ${SIZE[size]} leading-solid font-normal tracking-display tabular-nums text-ink`}>{value}</strong>
        </Proved>
      </div>
      <p className="flex items-center gap-2 text-sm text-ink-2">
        {danger ? <LevelMark level="red" /> : null}
        <span>{unit}</span>
      </p>
      {interval !== undefined && proof !== null ? <p {...intervalAttrs} className="text-sm text-ink-3 tabular-nums">{interval}</p> : null}
    </div>
  );
}
