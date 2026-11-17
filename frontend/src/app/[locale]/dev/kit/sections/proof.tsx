import { useTranslations } from "next-intl";
import { ProofChip } from "@/components/provenance/ProofChip";
import { Proved } from "@/components/provenance/Proved";
import type { Proof, ProofLabel } from "@/components/provenance/proof";
import { buildStory } from "@/components/provenance/proof-story";
import { EvalSourceStamp } from "@/features/judge/EvalSourceStamp";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { Cell, CellGrid } from "./Cell";

// A real published file, so "Recount in this browser" on the first chip answers Matches against the bytes served.
const RECOUNTABLE = "static/omaa_2026_ifs_d1_wbgt_hourly.json";

// A specimen story (made-up numbers, like the rest of the kit): it only has to show the five lines and the stamp.
const SAMPLE_STORY = buildStory("policy", {
  policy: "P3_protect",
  metric: "missed_danger_hours",
  lead: 1,
  station: "OMAA",
  seasonStart: "2026-05-15",
  seasonEnd: "2026-09-30",
  nDays: 100,
  marginWm2: 7,
  range: { lo: "10.0", hi: "20.0", unit: "hours" },
});

function sample(what: string, label: ProofLabel, overrides: Partial<Proof> = {}): Proof {
  return {
    what,
    story: SAMPLE_STORY,
    protocol: "docs/protocol/preregistration.md#72-warnings-row",
    protocolHref: null,
    script: "backend.eval.policy_scoreboard:build_policy_scoreboard @ 661b373a1b2c",
    file: RECOUNTABLE,
    fileSha256: DATA_MANIFEST[RECOUNTABLE].sha256,
    sourceSha256: "9f2c7a41d0b8e6531a4c9d7e2b0f58a3c61e94d7b2a08f35c1d6e7a94b30c2f1",
    label,
    modelId: "corrector-20261112-0000000-000001",
    generatedAt: "2026-11-12T09:14:00Z",
    ...overrides,
  };
}

const LABELS: readonly ProofLabel[] = ["REAL", "REAL weather + assumed crew", "SIMULATED", "DEV 2025", "RECORDED"];

/** The chip with each label, the failing recount, the null case, the gate that hides a number, and the source stamps. */
export function ProofSection() {
  const t = useTranslations("common.kit.sample");
  const what = t("proofWhat");
  return (
    <CellGrid>
      {LABELS.map((label) => (
        <Cell key={label} caption={`ProofChip · ${label}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-medium tabular-nums">{t("proofValue")}</span>
            <ProofChip proof={sample(what, label)} />
          </div>
        </Cell>
      ))}
      <Cell caption="ProofChip · file changed after export (Recount says it does not match)">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-medium tabular-nums">{t("proofValue")}</span>
          <ProofChip proof={sample(t("proofChangedWhat"), "REAL", { fileSha256: "0".repeat(64) })} />
        </div>
      </Cell>
      <Cell caption="ProofChip · exporter file not published (no recount)">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-medium tabular-nums">{t("proofValue")}</span>
          <ProofChip proof={sample(what, "DEV 2025", { file: "eval/dev/policy_scoreboard.2025.json" })} />
        </div>
      </Cell>
      <Cell caption="ProofChip · proof is null (renders nothing)" testId="proof-null">
        <ProofChip proof={null} />
      </Cell>
      <Cell caption="Proved · with a proof">
        <div className="flex flex-wrap items-center gap-3">
          <Proved proof={sample(what, "REAL")} what={what}>
            <span className="text-lg font-medium tabular-nums">{t("proofValue")}</span>
          </Proved>
        </div>
      </Cell>
      <Cell caption="Proved · no proof: the number is not shown">
        <Proved proof={null} what={t("missingWhat")}>
          <span className="text-lg font-medium tabular-nums">{t("proofValue")}</span>
        </Proved>
      </Cell>
      <Cell caption="EvalSourceStamp · dev-2025 and synthetic-shape">
        <div className="flex flex-col items-start gap-3">
          <EvalSourceStamp source="dev-2025" />
          <EvalSourceStamp source="synthetic-shape" />
        </div>
      </Cell>
    </CellGrid>
  );
}
