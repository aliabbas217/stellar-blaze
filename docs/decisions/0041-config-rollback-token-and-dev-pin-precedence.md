# ADR 0041: Config rollback carries an expected-previous token, and a dev environment pin is not overridden by DB activations

- **Status:** Accepted-by-controller (B1 ruling, awaiting Ali's review)
- **Date:** 2026-11-12
- **Deciders:** the B1 controller (Claude); recorded for the architect (Claude); Ali's review pending
- **Supersedes / superseded by:** none. Fills two gaps in [ADR 0010](0010-runtime-tunable-configuration.md) §3 (rollback) and §4.6 (env pins); 0010 carries a dated amendment pointing here
- **Evidence:** B1 controller rulings 29 and 30 (`b1-summary.md`, deleted after merge; the paths below last); `backend/src/stellar_blaze/application/runtime_config.py` (`ConfigService.rollback`, `ConfigPoller`, `config.db_activations_ignored`); `backend/src/stellar_blaze/jobs/cli.py` (`config rollback --expected-previous`); Task 7B review (one Important finding) and fix round 1, commits `c5ef303` and `723074d` on `feat/b1-backend-foundation`

## Context
Two separate gaps surfaced in the Task 7B review, and both change behaviour that ADR 0010 described only loosely.

**Rollback.** ADR 0010 §3 builds optimistic concurrency into activation (`UNIQUE NULLS NOT DISTINCT (previous_activation_id)`; `activate` takes `expected_previous`), and describes rollback as "activates the version of the previous activation". The plan's `rollback(actor, reason)` took no token. "The previous activation" moves after every rollback, so two concurrent rollbacks, or one request retried by a client, each read the same history and the second silently undoes the first.

**Env pins.** ADR 0010 §4.6 says pins "build a file snapshot for back-tests and DB-less runs" in dev and test, and are rejected in prod. It does not say which wins when a DB activation then arrives. The first 7B build let the DB replace the pinned snapshot within one poll, which would silently change the ruleset under a back-test that was pinned to `ae-heat-0.1`.

## Options considered
| Question | Option | Verdict |
|---|---|---|
| Rollback concurrency | No token (as planned) | Rejected: a retried or racing rollback undoes the previous one with no error |
| | Token required everywhere | Rejected: the CLI operator reads the history first and a required flag adds friction without safety |
| | Optional token; default "latest I read"; required for any caller acting on a view it showed a person (chosen) | Accepted |
| Dev pin vs DB | DB activation replaces the pin | Rejected: defeats the pin; a back-test changes rulesets mid-run |
| | Warn only, still replace | Rejected: the replacement is the harm |
| | A snapshot whose source is `env` is never replaced by the poller, which logs once (chosen) | Accepted |

## Decision
1. **Rollback token.** `ConfigService.rollback(actor, reason, *, expected_previous: int | None = None)`; CLI `sb-jobs config rollback --expected-previous <activation id>`. `expected_previous` is the latest activation id the caller saw. If it is not the latest, nothing is written and `StaleActivationError` is raised (B3 maps it to `409 stale-activation`). `None` means "whatever is latest when this reads it", for a command line whose operator has just read `config history`. **B3's HTTP rollback route must make the token a required parameter**, and a test must show that two rollbacks naming the same activation cannot both succeed. A rollback whose target holds the version that is already active raises `NothingToRollBackError` (it would change nothing). Rollback goes through the same validation as activation.
2. **Dev pin precedence.** When the initial snapshot's source is `env` (`SB_RULESET_ID` or `SB_MODEL_ID` set; prod rejects both with `ConfigSourceError`, so this is dev and test only), `ConfigPoller` leaves it in place, does not read the database, and logs `config.db_activations_ignored` once. To follow the DB, a developer unsets the pin. A snapshot whose source is `file` (the git seed) is still replaced by the first DB activation.

## Consequences
- **Cost of being wrong (1):** an optional keyword argument that nobody uses.
- **Cost of being wrong (2):** a developer who sets a pin and expects the DB to win must unset it; the log line says why nothing changed.
- The CLI default of `None` is safe only because the operator is a person who read the history; any automated or UI caller must not rely on it. This is the obligation on B3 above.
- ADR 0010 §4.6 is unchanged in text: prod still rejects pins; this ADR only states what dev does after an activation.

## Revisit trigger
B3's admin API lands (the required token and its two-rollback test must exist before it ships); a developer workflow needs a pin that follows the DB (add an explicit "follow DB" mode, not a default).

## Links
[ADR 0010](0010-runtime-tunable-configuration.md) §3, §4.6 · [ADR 0009](0009-evolvability-configurability.md) · [B1 plan, Task 7B](../superpowers/plans/2026-11-11-b1-backend-foundation.md)
