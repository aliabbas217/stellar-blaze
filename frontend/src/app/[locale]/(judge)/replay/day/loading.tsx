import { useTranslations } from "next-intl";
import { DaySkeleton } from "@/features/judge/DaySkeleton";

/** The day page while its route loads: the title block, the chart at its final height, the counters as rows. */
export default function Loading() {
  const t = useTranslations("judge.day");
  return (
    <main
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8"
    >
      <DaySkeleton />
    </main>
  );
}
