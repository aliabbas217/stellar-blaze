# ADR 0029: Reject LiteLLM; one `openai`-client adapter behind our own port

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. ADR 0008 (Accepted) rejects LiteLLM in its table; this ADR adds the cost of being wrong and a revisit trigger, which 0008 lacks
- **Evidence:** `docs/research/2026-11-11-backend-ml-stack.md` §4 (litellm row), §6.10; ADR 0008 "LLM" row and Rejected options; ADR 0010 §8 (routes are OpenAI-compatible `base_url`s)

## Context
The kept compliance drafter (ADR 0015) needs one LLM client. Routes are OpenAI-compatible endpoints (managed for `NonPersonal`, self-hosted vLLM/llama.cpp/Ollama for `Personal`, ADR 0010 §8), so one client parameterised by `base_url` covers every route.

## Options considered
| Option | Evidence (stack §6.10) | Verdict |
|---|---|---|
| `litellm` 1.109.0 | PyPI 1.82.7 and 1.82.8 were malicious in March 2026 (credential stealer); very wide dependency tree; pins `httpx<1.0`; about 5,100 open issues + PRs | Rejected |
| `any-llm-sdk` 1.50.0 | Thin gateway; an alternative to our own port | Not needed |
| `pydantic-ai-slim` 2.67.0 | Only if a tool-calling copilot is built (cut, ADR 0015) | Not needed |
| `openai` 3.49.0 behind our `LlmClient` Protocol (chosen) | Apache-2.0, active, depends on httpx2 | Accepted |

## Decision
No LiteLLM. One adapter over the `openai` client, created with the `LlmClient` port when the drafter is built.

## Consequences
- **Cost of being wrong:** if many non-OpenAI-compatible providers are needed, we write one adapter per provider instead of using a gateway. Low: every route in ADR 0010 §8 is OpenAI-compatible.

## Revisit trigger
A required provider has no OpenAI-compatible endpoint, **and** LiteLLM (or a successor) passes a fresh supply-chain review (signed releases or provenance, narrow dependency set).

## Links
[ADR 0008](0008-backend-stack.md) · [ADR 0010 §8](0010-runtime-tunable-configuration.md) · [ADR 0015](0015-cut-llm-copilot-and-shift-drafter.md)
