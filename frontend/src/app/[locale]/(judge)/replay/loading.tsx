import { useTranslations } from "next-intl";
import { ScoreboardSkeleton } from "@/features/judge/ScoreboardSkeleton";

/**
 * The scoreboard while its route loads (also shown, briefly, for the pages below `/replay`: it is a route-segment boundary).
 */
export default function Loading() {
  const t = useTranslations("judge.scoreboard");
  return (
    <main
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8"
    >
      <ScoreboardSkeleton />
    </main>
  );
}
