# Architecture decision records

Process: [ADR 0012](0012-decision-record-process.md). Accepted ADRs are never deleted or rewritten; changes are dated amendments or a superseding ADR. Every cut, park or defer has an ADR, and [`docs/parking-lot.md`](../parking-lot.md) indexes them.

| # | Title | Status | Date | Supersedes / superseded by |
|---|---|---|---|---|
| [0001](0001-hosting-azure-uae-north.md) | Host on Azure UAE North (Container Apps + Postgres Flexible), Render as fallback | Accepted | 2026-11-11 | — |
| [0002](0002-infra-minimalism-and-ports.md) | Postgres-only infrastructure; three ports now, four deferred with triggers | Accepted (amended 2026-11-11: pointer) | 2026-11-11 | — |
| [0003](0003-frontend-single-nextjs-app-pwa.md) | One Next.js 16 app with worker / supervisor / hse route groups; worker view is an installable PWA (no native app) | Accepted | 2026-11-11 | — |
| [0004](0004-tiered-alert-delivery.md) | Tiered alert delivery: site/crew Web Push, personal risk on app open, supervisor crew relay (WhatsApp/SMS adapter-only) | Accepted | 2026-11-11 | — |
| [0005](0005-data-truth-features-and-validation.md) | Data: IEM METAR truth, GHCNh audit, Open-Meteo Previous Runs features, cluster-held-out validation | Accepted | 2026-11-11 | — |
| [0006](0006-physics-wbgt-phs-niosh-twl.md) | Physics: Liljegren WBGT, guarded ISO 7933 PHS, in-house NIOSH RAL/REL, TWL ported from an MIT reference | Accepted | 2026-11-11 | — |
| [0007](0007-ml-quantile-corrector-conformal.md) | ML: LightGBM quantile corrector with conformalised quantile regression | Accepted | 2026-11-11 | — |
| [0008](0008-backend-stack.md) | Backend stack and tooling | Accepted | 2026-11-11 | — |
| [0009](0009-evolvability-configurability.md) | Evolvability, configurability and low blast radius | Accepted (2026-11-11) | 2026-11-11 | Partially superseded by 0010 |
| [0010](0010-runtime-tunable-configuration.md) | Runtime-tunable configuration without redeployment | Accepted (2026-11-11) | 2026-11-11 | Partially supersedes 0009 |
| [0011](0011-heat-aware-planner.md) | Heat-aware shift planner: rule-based ADOSH planner + independent validator; roster question answered statically | Accepted, v2 (amendment 2026-11-11; header still reads Proposed) | 2026-11-11 | v2 replaced v1 in place while Proposed; v1 numbers superseded by 0033 |
| [0012](0012-decision-record-process.md) | Decision-record process | Accepted | 2026-11-11 | — |
| [0013](0013-cut-landsat-site-heat-layer.md) | Cut the Landsat LST site heat layer | Accepted | 2026-11-11 | — |
| [0014](0014-cut-3d-site-heat-view.md) | Cut the 3D (three.js) site heat view | Accepted; superseded in part 2026-11-11 | 2026-11-11 | Superseded by 0037 for the judge landing |
| [0015](0015-cut-llm-copilot-and-shift-drafter.md) | Cut the LLM supervisor copilot and shift-plan drafter; keep the compliance-report drafter | Accepted | 2026-11-11 | — |
| [0016](0016-cut-personal-strain-model.md) | Cut the personal strain model | Accepted | 2026-11-11 | — |
| [0017](0017-cut-population-view.md) | Cut the Challenge 06 population view | Accepted | 2026-11-11 | — |
| [0018](0018-cut-drn-comparator.md) | Cut the DRN comparator | Accepted | 2026-11-11 | — |
| [0019](0019-cut-adaptive-conformal-arm.md) | Cut the adaptive conformal arm | Accepted | 2026-11-11 | — |
| [0020](0020-cut-aifs-feature-corrector.md) | Cut the AIFS-feature corrector (keep the raw IFS vs AIFS comparison) | Accepted | 2026-11-11 | — |
| [0021](0021-defer-weathernext-3.md) | Defer the WeatherNext 3 arm | Accepted (conditional) | 2026-11-11 | — |
| [0022](0022-reject-weekly-and-daily-re-roster.md) | Reject the weekly (and daily) forecast-driven re-roster | Accepted | 2026-11-11 | — |
| [0023](0023-reject-sub-seasonal-forecasts.md) | Reject sub-seasonal (weeks 2-4) forecasts for decisions | Accepted | 2026-11-11 | — |
| [0024](0024-cut-seasonal-roster-service.md) | Cut the seasonal roster recommender service; static frontier instead | Accepted | 2026-11-11 | — |
| [0025](0025-park-planner-workflow-extras.md) | Park planner workflow extras: stability engine, anomaly flag, second approver, pay-block, full CP-SAT set | Accepted | 2026-11-11 | — |
| [0026](0026-park-planner-modelling-extensions.md) | Park planner modelling extensions (night, sleep, commute, costs, validation scope) | Accepted | 2026-11-11 | — |
| [0027](0027-skip-storybook.md) | Skip Storybook; Vitest + Playwright per-state snapshots | Accepted | 2026-11-11 | — |
| [0028](0028-defer-data-and-ops-libraries.md) | Defer TimescaleDB, PostGIS, MLflow, granian, hishel/cachetools, pandera | Accepted | 2026-11-11 | — |
| [0029](0029-reject-litellm.md) | Reject LiteLLM | Accepted | 2026-11-11 | — |
| [0030](0030-hold-oasdiff-v1-35-0.md) | Hold oasdiff at v1.35.0 | Accepted (inherits 0009) | 2026-11-11 | — |
| [0031](0031-defer-azure-extras.md) | Defer Azure extras: GPU VM, UAE Central | Accepted | 2026-11-11 | — |
| [0032](0032-reject-cctv-computer-vision.md) | Reject CCTV and per-worker computer vision | Accepted | 2026-11-10 | — |
| [0033](0033-superseded-roster-headline-numbers.md) | Supersede the roster headline numbers (34.6% / 58.0%; v1 16.1% / 17.2%) | Accepted | 2026-11-11 | Supersedes Feasibility §0/§2 absolute numbers and ADR 0011 v1 numbers |
| [0034](0034-demo-strategy.md) | Demo strategy: replay wow, Warnings + Plans scoreboard, real-work layer, climate what-if SHOULD, cut order | Accepted | 2026-11-11 | — |
| [0035](0035-clinical-review-labelling.md) | Clinical review by an unnamed independent consultant; labelling rule | Accepted | 2026-11-11 | Supersedes Judges §3 "named clinician" wording |
| [0036](0036-team-and-naming-in-submission.md) | Solo entrant; only Ali named in the submission | Accepted | 2026-11-10 | Supersedes the competition brief's "1–2 people" line |
| [0037](0037-reverse-0014-cinematic-3d-landing.md) | Reverse 0014 for the judge landing: cinematic 3D heat field of real IFS data, 2D fallback, hard performance budget | Accepted (treatment follows the picked v2 direction) | 2026-11-11 | Supersedes 0014 for the landing only |
| [0038](0038-agentic-workflows-and-voice.md) | Agentic workflows and voice: voice and free text are PERSONAL and self-hosted only (STT + LLM), fail closed; Deepgram and Web Speech rejected; Tier A ports/tests MUST, Tier B voice site-setup SHOULD (gated) | Proposed | 2026-11-11 | Extends 0010 §8 to audio; does not reopen 0015 or 0004 |

## Decisions recorded inside earlier ADRs (linked, not duplicated)
| Cut / park / defer | Where decided |
|---|---|
| Native mobile app | [0003](0003-frontend-single-nextjs-app-pwa.md) Decision, Rejected options, Revisit trigger |
| WhatsApp / SMS / voice live delivery | [0004](0004-tiered-alert-delivery.md) Decision 4, Rejected options |
| Redis; `LlmClient`, `ObjectStore`, `JobQueue`, `EventBus` ports | [0002](0002-infra-minimalism-and-ports.md) deferred-ports table |
| Polars 2.1.0 (pinned 2.0.0); Python 3.14; OTel `skip_dep_check`; pythermalcomfort guard; ortools fallback | [0008](0008-backend-stack.md) Rejected options, Consequences, Revisit trigger |
| ECMWF open-data direct ingest for the demo | [0005](0005-data-truth-features-and-validation.md) Rejected options, Revisit trigger |
| Microsoft for Startups | [0001](0001-hosting-azure-uae-north.md) Rejected options |
| Azure App Configuration / flag SaaS; LISTEN/NOTIFY; four-eyes + Entra admin; separate DB roles; blob-fetched models | [0010](0010-runtime-tunable-configuration.md) §2, "Not doing now" |
| LLM data-class routing (PERSONAL self-hosted only) | [0010](0010-runtime-tunable-configuration.md) §8 |
| Rules engine / OPA; per-employer overlays; ruleset admin UI | [0009](0009-evolvability-configurability.md) "Not doing now" (admin UI re-decided in 0010) |
| Brake & Bates Appendix 1; TWL withdrawal-limit primary source | [0006](0006-physics-wbgt-phs-niosh-twl.md) Consequences, Revisit trigger |
| Art. 18 strict reading | [0011](0011-heat-aware-planner.md) Review I2 disposition, §12 Q1 |
