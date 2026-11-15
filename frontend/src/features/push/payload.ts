/*
 * The Web Push payload (docs/contracts/web-push.md section 2, ADR 0002 and 0004): six keys and nothing else. The
 * payload carries no text and no personal data; the service worker renders the words from its bundled strings.
 *
 * This runs inside the service worker, so the guard is hand-written (no zod in the worker bundle) and pure.
 */

export const PUSH_LEVELS = ["green", "amber", "orange", "red"] as const;
export type PushLevel = (typeof PUSH_LEVELS)[number];

export const PUSH_AUDIENCES = ["site", "crew"] as const;
export type PushAudience = (typeof PUSH_AUDIENCES)[number];

export interface PushPayload {
  readonly v: 1;
  readonly audience: PushAudience;
  /** The site id for a site alert, the crew id for a crew alert. */
  readonly target_id: string;
  readonly level: PushLevel;
  /** A message template id owned by the backend ruleset (ADR 0009). */
  readonly template_id: string;
  /** ISO 8601 date-time. */
  readonly valid_from: string;
}

const KEYS: readonly string[] = ["v", "audience", "target_id", "level", "template_id", "valid_from"];

// Date and time with a zone designator, fractions of a second optional: what the API's `date-time` produces.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isLevel(value: unknown): value is PushLevel {
  return PUSH_LEVELS.some((level) => level === value);
}

export function isAudience(value: unknown): value is PushAudience {
  return PUSH_AUDIENCES.some((audience) => audience === value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * The payload when `data` is exactly the contract's six keys with valid values, else null. An extra key (a worker
 * identifier, free text), a missing key, an unknown level or version, a malformed time: all null, never a throw.
 */
export function parsePushPayload(data: unknown): PushPayload | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== KEYS.length || !KEYS.every((key) => keys.includes(key))) return null;

  const { v, audience, target_id, level, template_id, valid_from } = data as Record<string, unknown>;
  if (v !== 1) return null;
  if (!isAudience(audience) || !isLevel(level)) return null;
  if (!isNonEmptyString(target_id) || !isNonEmptyString(template_id) || !isIsoDateTime(valid_from)) return null;
  return { v, audience, target_id, level, template_id, valid_from };
}
