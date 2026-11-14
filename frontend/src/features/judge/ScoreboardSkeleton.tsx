import { RIBBON_HEIGHT } from "@/components/charts/SeasonRibbon";
import { Skeleton, TableRowsSkeleton } from "@/components/states/Skeletons";

/**
 * The scoreboard before its data arrives: the title block, the hero at its final height (the ribbon box shares its classes
 * with the real ribbon, so it is the same height by construction), then the two tables as rows. Nothing moves when the
 * page arrives. Used by the route's `loading.tsx` and by the kit page.
 */
export function ScoreboardSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Skeleton height="var(--t-36)" width="min(100%, 28rem)" />
        <Skeleton height="var(--t-18)" width="min(100%, 40rem)" />
      </div>
      <div className={`w-full ${RIBBON_HEIGHT}`} data-skeleton-hero="">
        <Skeleton height="100%" />
      </div>
      <TableRowsSkeleton rows={5} rowHeight="var(--s-16)" />
      <TableRowsSkeleton rows={4} rowHeight="var(--s-16)" />
    </>
  );
}
