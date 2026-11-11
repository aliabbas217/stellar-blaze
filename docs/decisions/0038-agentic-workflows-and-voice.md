# ADR 0038: Agentic workflows and voice layer: everything that hears or reads free text is PERSONAL and self-hosted; one schema-bound site-setup slice, gated

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Extends ADR 0010 §8 (LLM data-class routing) to audio and free text; builds on ADR 0002 (ports); does **not** reopen ADR 0015 (copilot and shift drafter stay cut) or ADR 0004 ("I feel unwell" stays a button)
- **Evidence:** `docs/research/2026-11-11-agentic-voice-layer.md` §0-§10 (sources S1-S75, fetched 2026-11-11); ADR 0002, 0004, 0010 §8, 0012, 0015, 0029, 0031, 0034; roadmap §1; competition Terms and FAQ (`D:\dev\future-health-challenge\research\raw\`, 2026-11-06)

## Context
- **Goal from Ali:** near-zero user friction (zero-form site setup, roster import, QR onboarding), with **no PII ever reaching a third-party service**, inside the competition rules.
- **Voice is personal data.** The PDPL definition names "voice" as an identifier [secondary, research §1.1]; the EDPB calls voice "inherently biometric personal data" and lists "transcriptions of voice" as personal data, while special-category biometric processing starts only when voice is used to identify someone (paras 31, 81, 95) [research §1.2]. Content cannot be controlled, and anonymising it "is specially challenging" (para 105).
- **Redaction cannot rescue a transcript.** Presidio has no first-party ar/ur/hi/bn/ne support; spaCy has no trained pipeline for any of them; no verified NER covers Nepali or Bengali [research §4.1]. So a "redact, then call a managed model" design would rest on a detector that cannot see most of our users' names.
- **STT quality.** Whisper large-v3/turbo is usable for en, ur, hi and MSA Arabic, weak for Gulf Arabic (SADA WER 55.96), and unusable for bn (77-104 WER) and ne (47-85) [research §2.3]. Meta Omnilingual ASR (Apache-2.0) reports CER bn 2.8, ne 12.3, ur 3.5, hi 3.6 on its own sets, Gulf Arabic 41.8; it needs Python ≤3.12 and Linux [research §2.4].
- **Managed STT.** Deepgram retains and trains on requests by default unless each request sets `mip_opt_out=true`, and has no UAE endpoint. Azure Speech real-time STT runs in UAE North and "no data is stored at rest", but it is still a third-party processor [research §2.1, §2.2]. Chrome's Web Speech default sends audio to a remote service; Android has no on-device mode [research §2.5].
- **Capacity.** The roadmap has no free build day (feature freeze Wed 18 Nov 18:00). The judges research rated live voice and copilots as table stakes with "distinctiveness 0" (ADR 0015, ADR 0034). No GPU runs in UAE North (ADR 0031); Container Apps serverless GPU is not offered there; the cheapest suitable VM sizes cost $1.617-4.576/h [research §6.4].
- **Correction to the request.** The suggested demo pairing "self-hosted Whisper + a non-personal-class LLM" is inconsistent with the request's own rule: a supervisor transcript is PERSONAL, and ADR 0010 §8 says the class "is declared, never inferred … Nothing classifies the text after the fact." The LLM reading it must be self-hosted as well.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Managed STT + managed LLM with PII redaction in between | Redactor blind to ar-script/Devanagari/Bengali names (research §4.1); out-of-country transfer needs a PDPL Art. 23 basis with no regulations issued (§1.1) | Rejected |
| Deepgram for any class | No UAE endpoint; per-request opt-out from retention/training; no NON_PERSONAL audio use case (§2.1) | **Rejected** (no adapter) |
| Azure Speech real-time (UAE North) as the PERSONAL STT route | In-country, no retention documented (§2.2); but a third party under the current floor | Not now; needs a floor change (decision D2) |
| Browser Web Speech API | Server-based by default; no on-device on Android; on-device locales lack ar/ur/bn/ne (§2.5) | **Rejected and banned in code** |
| Self-hosted STT + self-hosted LLM for everything that hears or reads free text; managed only for fixed-template or aggregate content (chosen) | Satisfies the floor by construction; runs on the dev GPU; production needs one UAE North GPU | **Accepted (proposed)** |
| Agent framework: OpenAI Agents SDK | "Tracing is enabled by default" and exports to "the OpenAI backend" (§5.2) | Rejected |
| Agent framework: `pydantic-ai-slim` 2.67.0 | MIT, telemetry opt-in, `TestModel`/`FunctionModel` (§5.2) | Deferred to the first multi-step tool loop |
| One JSON-schema-constrained call through `LlmClient` (chosen for the demo) | Site setup is extraction, not a loop | Accepted (proposed) |

## Decision

### 1. Data classes (fixed, class c floor, extends ADR 0010 §8)
| Input | Class |
|---|---|
| Any microphone capture (worker or supervisor) | `Personal` (`AudioInput[Personal]`); there is no code path from a microphone to `AudioInput[NonPersonal]` |
| Any transcript, typed free text, OCR output | `Personal` (`LlmInput[Personal]`); a transcript inherits its audio's class |
| Fixed, approved template text (alert clips) | `NonPersonal` |
| k-suppressed aggregates (compliance drafter, ADR 0015) | `NonPersonal` |
| Speaker identification, voiceprints, emotion/stress-from-voice | **Not built** (would be biometric/inferential processing) |

### 2. Ports
- **`SpeechToText`** (new): `transcribe(AudioInput[D], language_hint) -> LlmInput[D]`. Adapters: `SelfHostedSttAdapter` (HTTP to a self-hosted sidecar exposing an OpenAI-style `/v1/audio/transcriptions`) and `InMemorySttFake`. No managed STT adapter exists.
- **`LlmClient`** (already greenlit for the drafter, ADR 0002 amendment): unchanged rule; gains the self-hosted route used by site setup.
- **`PiiGuard`** (new): a **tripwire on the `NonPersonal` egress path only** (patterns, own-roster gazetteer, a script tripwire for aggregate payloads, Presidio English recognizers). A hit refuses, audits `llm.pii_blocked`, never reroutes, never reclassifies.
- **No `TextToSpeech` runtime port.** ADR 0002 keeps TTS as a build-time script; alert clips stay pre-rendered with Azure Neural TTS (UAE North lists Neural TTS ✅, research §3). A port is created only when dynamic TTS is greenlit, and dynamic TTS of personal content has no licence-clean voice for ur/bn today.

### 3. Routing and fail-closed
- STT routes join the ADR 0010 §8 route catalog (wiring, `hosting: managed | self_hosted`). `validate_runtime_config` rejects a `personal` STT or LLM route that is not `self_hosted`.
- No `personal` route configured → the request is refused with a problem response and an audit row, **zero outbound calls**, and the UI falls back to the ordinary form. Never a managed fallback.

### 4. Providers per data class
| Class | STT | LLM | TTS |
|---|---|---|---|
| `Personal` | **Demo:** faster-whisper 1.2.1 + ctranslate2 4.9.0, `large-v3-turbo`, on the local RTX 3080, language hint from the UI locale (en, ar, ur, hi). **Production:** a UAE North GPU VM; model chosen per language by eval among Whisper turbo, Omnilingual ASR (bn, ne, ur, hi) and IndicConformer | **Demo:** Ollama v0.40.16 serving Gemma 4 12B-it QAT Q4_0 or Qwen3.5-9B (both Apache-2.0), picked by the day-1 eval. **Production:** vLLM 0.33.0 on the same GPU VM; Jais 3 7B evaluated for Arabic | none |
| `NonPersonal` | none needed | managed route allowed per ADR 0010 §8 (compliance drafter only) | Azure Neural TTS, UAE North, build-time |

### 5. Safeguards
- **Retention:** audio is never written to disk (browser memory → HTTPS → sidecar memory; sidecar request logging off). Transcript lives only in the unconfirmed `SiteSetupDraft`; deleted on confirm/discard, hard TTL 24 h. Determinism-cache rows share that TTL.
- **Audit:** route id, model id + digest, data class, prompt/schema version, input and output SHA-256, latency, outcome. Never content.
- **Notice** on the supervisor mic (research §4.6): processed on our own server, recording deleted at once, never sent to another company, use crew letters not names, use this mic not the keyboard's, you confirm before saving. The mic is optional; the form is always available. Worker voice input is not offered.
- **Minimisation:** roster import keeps crew letter, trade and acclimatisation date; the name column is dropped in the browser before upload.
- **Schema as the injection boundary:** `SiteSetupDraft` (research §6.4) has no risk-level, override or worker-identity field, so an instruction to change a level cannot be expressed. The LLM never writes user-facing facts: for any future plan query it maps the question to a typed intent and the answer is a template filled from engine tool outputs.
- **Determinism:** `temperature = 0`, fixed seed, JSON-schema-constrained decoding, content-hash cache keyed on model digest + prompt version + schema hash + input hash.

### 6. Tests (research §4.7)
T1 must-not-typecheck fixtures (`Personal` into any managed adapter); T2 runtime guard before I/O; T3 config floor for STT and LLM routes; T4 fail-closed with zero HTTP calls; T5 canary end-to-end with a recording `httpx2` transport (only allowlisted self-hosted hosts; canary absent from logs, audit and non-draft tables); T6 `PiiGuard` table tests in six scripts; T7 log redaction + OTel content capture off; T8 ESLint ban on `SpeechRecognition`/`webkitSpeechRecognition` + Playwright same-origin-only network assertion during capture; T9 lockfile deny-list (`openai-agents`, `litellm`, `deepgram-sdk`); T10 24 h purge. Extractor eval: 30 scripted utterances (10 en, 10 ar, 5 ur, 5 hi; Ali's own voice), 0 hallucinated fields, 5 refusals, 5 injections, identical second run with 100% cache hits.

### 7. Demo scope (by 20 Nov)
| Tier | Scope | Build-days | Gate |
|---|---|---|---|
| **MUST (A)** | §1-§3 types, ports, router, fakes; tests T1-T4, T6, T7, T9 | **0.5** | Rides with the drafter's `LlmClient` work in B3 (Mon 16) |
| **SHOULD (B)** | STT sidecar + Ollama + `SiteSetupDraft` extractor + eval + mic-and-confirm UI + T5, T8, T10 | **+1.5** | Only if the 16 Nov governance gate is green; placed in ADR 0034's cut order (recommended: cut **before** the climate what-if) |
Tier B is shown as a 15 s video beat recorded on the local GPU with scripted data. On the deployed URL (no GPU, ADR 0031) the mic **fails closed** with "Voice needs our private server, which isn't running here. Type in the form instead." and an audit row; that refusal is itself a governance beat.

### 8. Deferred or rejected (separate decisions per ADR 0012; each gets its own ADR when acted on, listed here so nothing is lost)
| Item | Decision | Revisit trigger |
|---|---|---|
| Production PERSONAL GPU route in UAE North (NV36ads A10 v5 $4.576/h, or RTX PRO 6000 BSE v6 from $1.617/h, fraction unverified) | Defer (ADR 0031 trigger now also fires on "voice ships beyond the video") | A pilot commits to voice site setup |
| Omnilingual ASR / IndicConformer for bn and ne | Defer | Production route exists; eval on recorded worker-accent audio |
| Supervisor voice query of the plan | Stays cut under ADR 0015; if revived, a new ADR supersedes ADR 0015's copilot cut and uses the intent → tool → template pattern | ADR 0015's trigger |
| Roster import from a photo (OCR) | Defer (PaddleOCR lacks Bengali; names should not be ingested) | A pilot needs paper rosters **and** a name-free target schema is not enough |
| Worker voice ("I feel unwell" spoken) | Reject for now (button exists, ADR 0004; sensitive data for little gain) | Pilot evidence that workers cannot use the button |
| Azure Speech real-time (UAE North) as a PERSONAL route | Not allowed under the current floor | Decision D2 below |
| Deepgram (cloud or self-hosted) | Reject | A UAE endpoint with contractual zero retention **and** a measured accuracy win on our audio |
| Dynamic runtime TTS | Reject (no licence-clean ur/bn voices; MMS-TTS non-commercial) | A licence-clean voice set for all six languages |
| `pydantic-ai-slim` | Defer | First multi-step tool loop |

## Consequences
- The privacy rule becomes a property of types, config validation and the network allowlist, demonstrable in CI, not a promise in a slide.
- Every free-text or voice feature needs a GPU we run. Until the production route exists, those features are demo-only and the live URL shows the fail-closed state.
- Competition compliance: no rule forbids third-party tools (FAQ: "technology-neutral"); all models used are MIT or Apache-2.0; non-commercial models (MMS, MMS-TTS, Piper `hi_IN pratham`, Surya weights) are excluded because results relying on rights "not commercially available … may not be qualified to win". The submission declares: Whisper large-v3-turbo, the chosen LLM and their revisions, faster-whisper/ctranslate2, the model server, Azure Neural TTS, the scripted eval set (Ali's own voice), and the limitations in research §7. The post-registration "full requirements" are still not captured; check them before 18 Nov.
- `docs/parking-lot.md` should gain index rows for each §8 item, linking here (left to the controller; this change writes only this ADR, the research doc and the README row).
- **Cost of being wrong:** if the floor is too strict, voice cannot run on the live URL and judges see a refusal instead of a feature (low: the wow is the scoreboard, ADR 0034). If Tier B is built and the schedule slips, it displaces evidence work (medium; mitigated by the gate and the cut order). If the floor were too loose, worker health utterances could leave the country under a law whose regulations are not issued (high; this is what the decision prevents).

## Decisions for Ali
- **D1.** Approve Tier A (0.5 day) and whether Tier B (+1.5 days) enters the ADR 0034 cut order, and where (recommended: first to cut, before the climate what-if).
- **D2.** Does "our infrastructure" mean only servers we operate, or also processors under our contract in UAE North with no retention or training (Azure Speech real-time; note Postgres Flexible is already Microsoft-operated)? Recommended: keep the strict reading for the submission; revisit with counsel for production.
- **D3.** Accept that the live URL refuses voice during judging rather than paying ~$390-1,100 for a UAE GPU over 20-30 Nov. Recommended: accept.
- **D4.** Approve dropping worker names from roster import (minimisation), which the design lead's friction work must reflect.

## Revisit trigger
Any of: the 16 Nov gate result; the post-registration requirements mention tools, AI or data declarations; a pilot asks for voice or bn/ne support; the PDPL Executive Regulations are issued (transfer conditions, Art. 23); Azure lists Container Apps serverless GPU in UAE North; a licence-clean multilingual TTS or a verified ar/ur/bn/ne NER appears; any change to ADR 0010 §8.

## Links
[Research](../research/2026-11-11-agentic-voice-layer.md) · [ADR 0002](0002-infra-minimalism-and-ports.md) · [ADR 0004](0004-tiered-alert-delivery.md) · [ADR 0010 §8](0010-runtime-tunable-configuration.md) · [ADR 0015](0015-cut-llm-copilot-and-shift-drafter.md) · [ADR 0029](0029-reject-litellm.md) · [ADR 0031](0031-defer-azure-extras.md) · [ADR 0034](0034-demo-strategy.md)
