/*
 * Which WCAG contrast threshold a line of text is held to, decided from what the browser rendered (computed font size and weight),
 * never from an attribute: shrinking a heading below 24 px must not leave it on the 3:1 of large text. Pure, so it is unit tested
 * (tests/unit/e2e/contrast-class.test.ts) and the e2e helper imports it.
 *
 * WCAG 2.2 "large text" (1.4.3): at least 18 pt (24 CSS px), or at least 14 pt (18.66 CSS px) and bold (weight 700 or more).
 */

export type ContrastKind = "body" | "large" | "label";
/** What a threshold is chosen by: a station name ("label") is held like body text. */
export type TextClass = "body" | "large";

export const LARGE_PX = 24;
export const LARGE_BOLD_PX = 18.66;
export const BOLD_WEIGHT = 700;

export function classify(fontSizePx: number, fontWeight: number): TextClass {
  if (fontSizePx >= LARGE_PX) return "large";
  if (fontSizePx >= LARGE_BOLD_PX && fontWeight >= BOLD_WEIGHT) return "large";
  return "body";
}

export function thresholdFor(cls: TextClass): number {
  return cls === "large" ? 3 : 4.5;
}

export function declaredKind(kind: ContrastKind): TextClass {
  return kind === "large" ? "large" : "body";
}

export interface Declared {
  readonly name: string;
  readonly declared: ContrastKind;
  readonly fontSizePx: number;
  readonly fontWeight: number;
}

/** A readable message when the page's declared kind is not what its rendered size says; null when they agree. */
export function disagreement({ name, declared, fontSizePx, fontWeight }: Declared): string | null {
  const rendered = classify(fontSizePx, fontWeight);
  if (rendered === declaredKind(declared)) return null;
  return `${name}: declared ${declared} but rendered at ${String(Math.round(fontSizePx * 100) / 100)}px weight ${String(fontWeight)}, which is ${rendered} text`;
}
