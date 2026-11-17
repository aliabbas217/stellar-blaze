# ADR 0043: Credentials are masked structurally, by one log processor in front of every renderer, not at each call site

- **Status:** Accepted-by-controller (B1 ruling, awaiting Ali's review)
- **Date:** 2026-11-12
- **Deciders:** the B1 controller (Claude); recorded for the architect (Claude); Ali's review pending
- **Supersedes / superseded by:** none. Extends [ADR 0008](0008-backend-stack.md) (structlog, JSON in prod, console in dev); 0008 carries a dated amendment pointing here
- **Evidence:** B1 controller rulings 24 and 32 (`b1-summary.md`, deleted after merge; the paths below last); `backend/src/stellar_blaze/logging.py` (`redact_exceptions`, `configure_logging`); `backend/src/stellar_blaze/redaction.py` (`redact`, `redact_tree`, `describe_exception`, `MAX_REDACTED_CHARS`); `backend/tests/unit/test_redaction.py` and `test_redaction_performance.py`; commits `64efe24` (the processor) and `5f00cbe` (the linear-time rewrite) on `feat/b1-backend-foundation`; the Task 10 security finding and the final-review re-review

## Context
In the Task 10 review the coordinator reported an Important security finding: `jobs/runner.py` logged `exc_info=True` / `log.exception` with the raw exception and traceback, which bypassed `describe_error()` masking. An exception quotes what it was given (a connection string, a header, a response body), so a DSN password, an `Authorization` header or a token could reach the log stream. In prod that stream goes to Log Analytics with 30-day retention (I1 plan), so a leaked DSN would stay readable there for a month.

A fix at each call site cannot be exhaustive: it has to be remembered at every future `log.exception`, and it does nothing for stdlib loggers (SQLAlchemy, uvicorn) whose exceptions go through the same handler.

## Options considered
| Option | Verdict |
|---|---|
| Mask at each call site with `describe_error()` | Rejected: not exhaustive; each new call site reopens the hole; stdlib loggers are not ours |
| Stop logging tracebacks | Rejected: loses the diagnosis (prod has no debugger) |
| One structlog processor in the shared chain, before JSON and console renderers (chosen) | Covers structlog and stdlib records, both formats, every logger |
| Rely on secret scanning of logs downstream | Not available in this stack; it also finds a leak after it was stored |

## Decision
1. `logging.redact_exceptions` is the **one place exceptions become text**. It removes `exc_info` from the event (so no raw exception object reaches a renderer), renders the plain traceback (cause, context, notes and `ExceptionGroup` members included) into `exception`, and runs `redact` over `exception`, `stack`, `stack_info` and the message `event`. Frame locals are never rendered, so a secret that only sat in a variable is never in the text.
2. `redact` is a **bounded pattern mask**, not a promise: it masks URL userinfo, `password=...` pairs (including quoted values with spaces and JSON/dict keys), `Authorization` and `Bearer`/`Basic` values, JSON Web Tokens and cookies, and leaves every other character alone. It is linear or bounded per position, and scans at most `MAX_REDACTED_CHARS` (32,768); a longer text keeps its head and tail around an elision marker, with the cut moved to whitespace within 256 characters. The README states that it is a pattern mask.
3. The processor is in the shared chain, so a later `configure_logging` with the other output format cannot lose it.

## Consequences
- **Format change:** the JSON log's `exception` field is now a redacted string, not structlog's frame dictionaries.
- **Limits, recorded and not hidden:** URL masking runs to the last `@` of the word, so it can over-mask (`?next=u@b.c`). The processor redacts `event`, `exception`, `stack` and `stack_info`; other bound fields (`url=`, `body_excerpt=`) rely on `describe_exception` at the call site. Typer's own traceback for an exception that escapes a command is outside the logging chain.
- **Performance, found by the final review and fixed in `5f00cbe`:** the first version's `[\w-]*` prefix backtracked quadratically (a 32 KB hyphen run took about 40 s on one log line). After the rewrite `redact` takes at most 25 ms at the 32 KB ceiling across 28 adversarial families, and agrees with the reference implementation on 150,000 generated cases.
- **Parked residual (ruling 32):** a whitespace-separated credential (`Bearer`, `password: v`, a JSON pair, `Basic`, a cookie, a quoted value) can leak when the elision cut of a text over 32 KB lands on its key word, because the cut can separate the key from its value (about 1e-4 per oversized line). First follow-up: mask redaction windows with about 256 characters of context before trimming at the cut. **Cost of being wrong:** a rare credential fragment in an oversized log line. No second fix wave: the SDD process allows one final wave, and this residual was found in its re-review.
- ADR 0008's Sentry settings (`send_default_pii=False`, no local variables) are unaffected.

## Revisit trigger
A log line over 32 KB appears in prod; a log handler or renderer is added outside the shared chain; B3 logs request or response bodies (they must go through the processor); the first follow-up is scheduled (do it before the first prod deploy if capacity allows).

## Links
[ADR 0008](0008-backend-stack.md) · [ADR 0001](0001-hosting-azure-uae-north.md) · [I1 plan](../superpowers/plans/2026-11-11-i1-azure-infra.md) · [parking lot](../parking-lot.md)
