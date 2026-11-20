import { useTranslations } from "next-intl";
import { ruleNameKey } from "@/lib/copy/rule-names";

/** The plain-language name of a rule id on the crew plan screens (`supervisor.plan.rules.*`), or null for an id with no name. */
export function useRuleName(): (ruleId: string) => string | null {
  const t = useTranslations("supervisor.plan.rules");
  return (ruleId) => {
    const key = ruleNameKey(ruleId);
    return key === null ? null : t(key);
  };
}
