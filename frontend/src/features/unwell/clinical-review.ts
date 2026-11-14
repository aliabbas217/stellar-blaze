/*
 * Whether a clinician has reviewed the wording of the unwell sheet (ADR 0035). Nobody has: this stays null, and the sheet says
 * "Not clinically reviewed". It becomes the review date (the text shown after "Reviewed by an independent clinical consultant,")
 * only when the owner records a real review; it is never derived from an environment variable, a URL or a flag, so nothing a
 * visitor or a deployment can set makes the sheet claim a review.
 */
export const CLINICAL_REVIEW: string | null = null;

export type ReviewLabel = { readonly kind: "reviewed"; readonly date: string } | { readonly kind: "not-reviewed" };

/** The label for a review record: reviewed only for a non-blank date, else not reviewed. */
export function reviewLabel(review: string | null): ReviewLabel {
  const date = review?.trim() ?? "";
  return date === "" ? { kind: "not-reviewed" } : { kind: "reviewed", date };
}
