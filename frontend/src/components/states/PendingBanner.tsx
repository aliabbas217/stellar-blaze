import { useTranslations } from "next-intl";
import { Banner } from "./Banner";

/**
 * One per table, never per cell (critique fix 1): the result file for `what` does not exist yet, so its cells read
 * "###" and this banner says why. A pending number is never read as a result.
 */
export function PendingBanner({ what }: { readonly what: string }) {
  const t = useTranslations("states");
  return (
    <Banner>
      <p>{t("pendingBanner", { what })}</p>
    </Banner>
  );
}
