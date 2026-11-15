import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The "Reset demo site" button, presentational: the same markup is the live control's button (`ResetDemoControl`) and the
 * plain button of a server-rendered first paint, where it carries `data-island-action="reset"` so a gate can load the
 * interactive island on the first tap. Not disabled while busy (a second tap is ignored by the caller).
 */
export function ResetDemoButton({ busy = false, onClick }: { busy?: boolean; onClick?: () => void }) {
  const t = useTranslations("shell");
  return (
    <button
      type="button"
      aria-busy={busy}
      data-island-action="reset"
      {...(onClick === undefined ? {} : { onClick })}
      className="inline-flex min-h-(--target) w-fit items-center justify-center gap-2 rounded-sign border border-edge px-4 font-body text-base text-ink"
    >
      {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
      {t("demo.reset.button")}
    </button>
  );
}
