/**
 * What must never reach the main layer of the product (docs/design/redesign-2026-11-17/01b-content-audit.md section 5, plus the leaks the
 * owner saw): file paths and extensions, fingerprints, protocol, policy codes, theta, hypothesis ids, "lead N", epoch, fixtures, ADR numbers,
 * export keys and placeholders. Shared by the story layer's tests (proof-story.test.tsx) and the judge pages' tests (judge-jargon.test.tsx), so
 * one list decides what jargon is.
 */
export const JARGON: readonly [name: string, pattern: RegExp][] = [
  ["file extension", /\.(json|md|ts|tsx|py|mjs|csv)\b/i],
  ["path", /\b(src|docs|eval|static|data|backend|tests)\//i],
  ["SHA", /\bsha(-?\d+)?\b/i],
  ["fingerprint", /[0-9a-f]{40,64}/i],
  ["protocol", /protocol/i],
  ["theta", /\btheta\b/i],
  ["policy code", /\bP[0-3]\b/],
  ["hypothesis id", /\bH[0-9]\b/],
  ["lead N", /\blead[ -]?[0-9]\b/i],
  ["epoch", /\bepoch\b/i],
  ["fixture", /fixture/i],
  ["ADR", /\bADR\b/],
  ["export key", /[a-z]+_[a-z0-9]+/],
  ["placeholder", /Not recorded|\bnull\b|\bundefined\b|\bNaN\b|\{|\}/],
  ["policy=config=", /policy=|config=/],
  ["function name", /\bget_[a-z_]+|\bbuild_[a-z_]+/],
];
