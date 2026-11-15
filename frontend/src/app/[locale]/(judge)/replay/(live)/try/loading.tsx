import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/states/Skeletons";

/** The try-a-plan page while its route loads: the title block, the plan strip at its final height, the form as rows. */
export default function Loading() {
  const t = useTranslations("judge.try");
  return (
    <main role="status" aria-busy="true" aria-label={t("loading")} className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-3">
        <Skeleton height="var(--t-36)" width="min(100%, 28rem)" />
        <Skeleton height="var(--t-18)" width="min(100%, 40rem)" />
      </div>
      <div className="h-24 w-full sm:h-28" data-skeleton-hero="">
        <Skeleton height="100%" />
      </div>
      <Skeleton height="var(--s-24)" />
    </main>
  );
}
