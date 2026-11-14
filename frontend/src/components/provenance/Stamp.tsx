import { useTranslations } from "next-intl";

export type StampKind = "REPLAY" | "RECORDED" | "SIMULATED" | "DESIGNED" | "DEV_2025" | "NOT_CLINICALLY_REVIEWED";

export interface StampProps {
  readonly kind: StampKind;
  /** A date or a note after the label ("3 Sep 2026"), already worded for the locale. */
  readonly detail?: string;
}

// The message key and the frame of each kind. Full class names so Tailwind's scanner finds them.
const STAMPS = {
  REPLAY: { key: "replay", frame: "border-edge text-ink-2" },
  RECORDED: { key: "recorded", frame: "border-edge text-ink-2" },
  SIMULATED: { key: "simulated", frame: "border-edge text-ink-2" },
  // Dashed: the content is not an observation (a design placeholder, or wording a clinician has not reviewed).
  DESIGNED: { key: "designed", frame: "border-dashed border-edge text-ink-2" },
  NOT_CLINICALLY_REVIEWED: { key: "notClinicallyReviewed", frame: "border-dashed border-edge text-ink-2" },
  // Inverted: development data must never be read as a result, so this is the loudest stamp.
  DEV_2025: { key: "dev2025", frame: "border-ink bg-ink text-ground" },
} as const satisfies Record<StampKind, { key: string; frame: string }>;

/**
 * Says what kind of data a screen or a number is: a replayed day, a recorded one, a simulation, a design placeholder,
 * the 2025 development files, or wording a clinician has not reviewed. One small frame, no color: it labels the
 * evidence, it does not rank it.
 */
export function Stamp({ kind, detail }: StampProps) {
  const t = useTranslations("states.stamp");
  const { key, frame } = STAMPS[kind];
  return (
    <span
      role="note"
      className={`inline-flex min-h-6 w-fit items-center gap-2 rounded-sign border px-2 text-xs font-medium ${frame}`}
    >
      <span>{t(key)}</span>
      {detail === undefined ? null : (
        <>
          {" "}
          <bdi className="font-normal">{detail}</bdi>
        </>
      )}
    </span>
  );
}
