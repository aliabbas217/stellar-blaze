import { useTranslations } from "next-intl";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";

/**
 * The line a gated judge page shows when the interactive chunk could not be loaded after a tap (`useIslandGate().failed`).
 * The live region is always in the page (empty until it has something to say) so that the text is announced when it appears;
 * it sits at the bottom of the viewport so it is seen wherever the tap was, and the next tap retries. The gated judge pages mount it
 * inside the replay layout's English claims block, and the line is translated: it restores the page's language and direction.
 */
export function IslandStatus({ failed }: { readonly failed: boolean }) {
  const t = useTranslations("judge.island");
  const attrs = useLocaleAttrs();
  return (
    <p {...attrs} role="status" data-island-status="" className="fixed inset-x-0 bottom-0 z-50 border-t border-edge bg-ground px-4 py-3 text-base text-ink empty:hidden">
      {failed ? t("loadFailed") : null}
    </p>
  );
}
