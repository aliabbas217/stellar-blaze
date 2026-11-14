"use client";

import { useTranslations } from "next-intl";
import { LevelSign } from "@/components/level/LevelSign";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { MissingProvenance } from "@/components/states/MissingProvenance";
import { OfflineBanner } from "@/components/states/OfflineBanner";
import { PendingBanner } from "@/components/states/PendingBanner";
import { LevelSignSkeleton, TableRowsSkeleton } from "@/components/states/Skeletons";
import { StaleBanner } from "@/components/states/StaleBanner";
import { Cell, CellGrid } from "./Cell";

// An identifier shaped like the server's request ids; the code font, because it is read aloud and copied.
const SAMPLE_REQUEST_ID = "req_7f3a91c2";

// The sample table row is 3 rem: the same constant would be the real row's height, so it is named, not repeated.
const TABLE_ROW = "var(--s-12)";

/** Every state a screen can be in besides "ideal": empty, error, stale, offline, pending, missing provenance, loading. */
export function StatesSection() {
  const t = useTranslations("common.kit.sample");
  const tStates = useTranslations("states");
  return (
    <div className="flex flex-col gap-4">
      <CellGrid>
        <Cell caption="EmptyState · actionable, with a level">
          <EmptyState
            title={t("emptyTitle")}
            reason={t("emptyReason")}
            level="amber"
            primary={{ label: t("emptyPrimary"), href: "/worker" }}
            secondary={{ label: t("emptySecondary"), href: "/worker/alerts" }}
          />
        </Cell>
        <Cell caption="ErrorState · retry and request id">
          <ErrorState
            title={tStates("error.title")}
            detail={tStates("error.detail")}
            requestId={SAMPLE_REQUEST_ID}
            onRetry={() => undefined}
          >
            <p className="max-w-(--measure) text-base text-ink-2">{t("errorGuidance")}</p>
          </ErrorState>
        </Cell>
        <Cell caption="ErrorState · no request id">
          <ErrorState title={tStates("error.title")} detail={tStates("error.detail")} requestId={null} onRetry={() => undefined} />
        </Cell>
      </CellGrid>

      <CellGrid>
        <Cell caption="StaleBanner">
          <StaleBanner updatedAt="06:00" ageLabel={t("staleAge")} />
        </Cell>
        <Cell caption="OfflineBanner">
          <OfflineBanner />
        </Cell>
        <Cell caption="OfflineBanner · with the last known level">
          <OfflineBanner updatedAt="09:40" ageLabel={t("offlineAge")} />
        </Cell>
        <Cell caption="PendingBanner">
          <PendingBanner what={t("pendingWhat")} />
        </Cell>
        <Cell caption="MissingProvenance">
          <MissingProvenance what={t("missingWhat")} />
        </Cell>
      </CellGrid>

      {/* Each skeleton sits beside the element it stands in for, so the heights can be read against each other. */}
      <CellGrid>
        <Cell caption="hero sign" testId="sign-hero">
          <LevelSign level="green" kind="live" size="hero" kicker={t("kickerNow")} until={t("untilNow")} />
        </Cell>
        <Cell caption="hero skeleton" testId="skeleton-hero">
          <LevelSignSkeleton size="hero" />
        </Cell>
        <Cell caption="mini sign" testId="sign-mini">
          <LevelSign level="green" kind="live" size="mini" kicker={t("kickerNow")} until={t("untilNow")} />
        </Cell>
        <Cell caption="mini skeleton" testId="skeleton-mini">
          <LevelSignSkeleton size="mini" />
        </Cell>
        <Cell caption="table skeleton · 4 rows" wide>
          <TableRowsSkeleton rows={4} rowHeight={TABLE_ROW} />
        </Cell>
      </CellGrid>
    </div>
  );
}
