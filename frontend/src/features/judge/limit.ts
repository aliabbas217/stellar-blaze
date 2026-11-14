/**
 * The heavy-work limit the judge screens draw as a line on the season and day charts, in degrees C WBGT.
 *
 * NIOSH 2016 criteria document, chapter 8.1 (ADR 0006): REL = 56.7 - 11.5 * log10(M) for an acclimatised worker doing
 * work of M watts; heavy work is 415 W, which gives 26.6. The worker app computes the same figure from the formula
 * (`rel` in src/features/risk/niosh.ts). Judge code must not import worker code (eslint.config.mjs), so this is the
 * recorded value and tests/unit/features/judge/limit.test.ts, the one place a judge file meets a worker file, fails the
 * moment the two differ.
 */
export const HEAVY_WORK_LIMIT_WBGT_C = 26.6;
