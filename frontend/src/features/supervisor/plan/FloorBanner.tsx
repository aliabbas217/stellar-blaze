"use client";

import { useTranslations } from "next-intl";
import type { components } from "@/api/schema";

/*
 * The floor banner of every plan payload (`banner_code` is always `plan.floor_banner`): Green is not permission to extend work,
 * legal and ADOSH minimums still apply, advisory only. The API sends the code and the client holds the words; the code is looked
 * up, never assumed, so a code this client does not know renders nothing instead of the wrong sentence.
 */

type BannerCode = components["schemas"]["DayPlan"]["banner_code"];

export function FloorBanner({ code }: { readonly code: BannerCode }) {
  const t = useTranslations("supervisor.plan");
  const words: Record<BannerCode, string> = { "plan.floor_banner": t("floorBanner") };
  const text = words[code] as string | undefined;
  if (text === undefined) return null;
  return (
    <p role="note" data-floor-banner="" className="px-4 text-base leading-(--sign-leading-text) text-ink-2">
      {text}
    </p>
  );
}
