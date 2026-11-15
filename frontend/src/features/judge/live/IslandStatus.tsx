import { useTranslations } from "next-intl";

/**
 * The line a gated judge page shows when the interactive chunk could not be loaded after a tap (`useIslandGate().failed`).
 * The live region is always in the page (empty until it has something to say) so that the text is announced when it appears;
 * it sits at the bottom of the viewport so it is seen wherever the tap was, and the next tap retries.
 */
export function IslandStatus({ failed }: { readonly failed: boolean }) {
  const t = useTranslations("judge.island");
  return (
    <p role="status" data-island-status="" className="fixed inset-x-0 bottom-0 z-50 border-t border-edge bg-ground px-4 py-3 text-base text-ink empty:hidden">
      {failed ? t("loadFailed") : null}
    </p>
  );
}
