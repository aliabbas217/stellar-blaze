import { Skeleton } from "@/components/states/Skeletons";

/**
 * The day page before its data arrives, at the final layout: the title block, the chart box (the same height classes as
 * `DayChart`, so nothing moves when the page arrives), the rule box and the four counters.
 */
export function DaySkeleton() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Skeleton height="var(--t-36)" width="min(100%, 32rem)" />
        <Skeleton height="var(--t-18)" width="min(100%, 40rem)" />
      </div>
      <div className="h-80 w-full sm:h-96" data-skeleton-hero="">
        <Skeleton height="100%" />
      </div>
      <Skeleton height="var(--s-24)" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="var(--s-16)" />
        ))}
      </div>
    </>
  );
}
