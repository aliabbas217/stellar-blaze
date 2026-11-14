import { useTranslations } from "next-intl";
import { Stamp } from "@/components/provenance/Stamp";
import type { EvalSource } from "./data";

/**
 * The stamp a judge screen puts on scored numbers that are not the held-out 2026 result: the 2025 development run
 * ("DEV 2025") and the made-up shape fixtures ("DEV 2025 synthetic shape"). The held-out run and the empty state carry
 * none (the empty state has its own banner). Always render it where `loadEval().source` is shown, never conditionally on
 * the caller's own judgement.
 */
export function EvalSourceStamp({ source }: { readonly source: EvalSource }) {
  const t = useTranslations("states.proof");
  if (source === "dev-2025") return <Stamp kind="DEV_2025" />;
  if (source === "synthetic-shape") return <Stamp kind="DEV_2025" detail={t("syntheticShape")} />;
  return null;
}
