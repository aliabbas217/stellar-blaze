import { LEVEL_SIGN_HEIGHT } from "@/components/level/LevelSign";

/*
 * Loading placeholders. Each reserves the height of the element that replaces it, so the page does not move when the
 * data arrives (CLS budget 0.1): a skeleton takes the final height as a prop and draws nothing taller or shorter.
 * They are hidden from assistive technology; the region around them carries aria-busy and its own label. The shimmer
 * is an opacity pulse only (no gradient sweep), and the global reduced-motion rule stops it.
 */

const BLOCK = "rounded-sign bg-hair motion-safe:animate-pulse";

export interface SkeletonProps {
  /** Any CSS length, normally the final element's height from a token or a published constant. */
  readonly height: string;
  readonly width?: string;
}

/** A solid block of exactly `height`. */
export function Skeleton({ height, width }: SkeletonProps) {
  return <div aria-hidden="true" data-skeleton="" className={BLOCK} style={{ height, width }} />;
}

/** The level sign, hero or mini, at the height `LevelSign` publishes. */
export function LevelSignSkeleton({ size }: { readonly size: "hero" | "mini" }) {
  return <div aria-hidden="true" data-skeleton="level-sign" className={`w-full ${BLOCK}`} style={{ height: LEVEL_SIGN_HEIGHT[size] }} />;
}

/** `rows` table rows of `rowHeight` each. A hairline gap is drawn inside each row, so the total is rows times rowHeight. */
export function TableRowsSkeleton({ rows, rowHeight }: { readonly rows: number; readonly rowHeight: string }) {
  return (
    <div aria-hidden="true" data-skeleton="rows" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          data-skeleton-row=""
          className="border-b-2 border-ground bg-hair motion-safe:animate-pulse"
          style={{ height: rowHeight }}
        />
      ))}
    </div>
  );
}
