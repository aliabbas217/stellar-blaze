import { useTranslations } from "next-intl";
import { ruleNameKey } from "@/lib/copy/rule-names";

/** The plain-language name of a rule id on the judge's validator screen (`judge.try.rules.*`, English in every catalogue like the rest of it), or null for an id with no name. */
export function useRuleName(): (ruleId: string) => string | null {
  const t = useTranslations("judge.try.rules");
  return (ruleId) => {
    const key = ruleNameKey(ruleId);
    return key === null ? null : t(key);
  };
}
