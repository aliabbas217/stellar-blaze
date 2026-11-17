import { useTranslations } from "next-intl";
import { Stamp, type StampKind } from "@/components/provenance/Stamp";
import { Cell, CellGrid } from "./Cell";

const KINDS: readonly StampKind[] = ["REPLAY", "RECORDED", "SIMULATED", "DESIGNED", "DEV_2025", "NOT_CLINICALLY_REVIEWED"];

/** Each stamp bare, and each with a detail after the label. */
export function StampsSection() {
  const t = useTranslations("common.kit.sample");
  return (
    <CellGrid>
      {KINDS.map((kind) => (
        <Cell key={kind} caption={kind}>
          <div className="flex flex-col items-start gap-3">
            <Stamp kind={kind} />
            <Stamp kind={kind} detail={t("stampDetail")} />
          </div>
        </Cell>
      ))}
    </CellGrid>
  );
}
