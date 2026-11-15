# ADR 0072: The demo is hosted cheap by default; the concerns are stated openly and a budget buys the fixes

- **Status:** Accepted by the architect on Ali's instruction of 2026-11-15 ("keep things as cheap as possible"; "document these and share concerns properly and will improve with budget")
- **Date:** 2026-11-15
- **Deciders:** Ali (the cost constraint); the architect (Claude)
- **Supersedes / superseded by:** changes the sizing and process choices of the I1 plan (`docs/superpowers/plans/2026-11-11-i1-azure-infra.md` Global Constraints: min replicas 1 for both apps, a 1 vCPU / 2 GiB api, an always-on alerts process, a USD 75 budget); amends [ADR 0001](0001-hosting-azure-uae-north.md) only in sizing, not in region or provider
- **Evidence:** the I1 controller's reports of 2026-11-15 (the always-on alerts worker likely gives a monthly bill of USD 80-105, about USD 52 idle-only; Render's Blueprint is about USD 76); B3's integration check (api about 205 MiB at rest after serving the demo day, web about 73 MiB); [ADR 0034](0034-demo-strategy.md) amendments (the replay clock is anchored in Postgres, so a restart or scale-to-zero does not desynchronise anything); the costed table in `infra/README.md` on branch `feat/i1-azure-infra` (current official pricing, fetched on the day it was written)

## Context
The demo runs on synthetic data for about three weeks (judging after 20 Nov, GITEX 7 to 11 Dec). Ali's constraint is to spend as little as possible. The first design (always-on api and web, an always-on alerts loop, generous sizing) cost USD 80-105 a month on the controller's estimate.

## Options
1. **The first design** (min replicas 1 everywhere, always-on alerts worker): simplest, most responsive, highest cost.
2. **Cheap by default on the same Container Apps design (chosen):** web min 1 at the smallest size (the landing, scoreboard, proof sheet and day zoom are static data served by web, so judges' first views need no API); api min 0 (scale to zero, safe because the replay clock lives in Postgres) and sized from the measured memory; the alert dispatch as a one-minute scheduled job (billed per execution) with `alert_dispatch_interval_minutes` set to 1; Postgres Burstable B1ms with the smallest storage and HA off; ACR Basic; the lowest log quota; a `-Warm` and `-Cool` switch to hold the api warm for judged sessions and recordings; the budget alert set from the cheap-mode estimate.
3. **One small VM with compose behind Caddy:** probably the cheapest running cost, but a different design with manual operations (patching, Docker, backups); costed in the I1 runbook, not built.
4. **Local only plus the video:** free, but judges cannot open the product and there is no real-phone push moment.
5. **Render:** TLS-correct only if it runs its own Postgres (ADR 0042), about USD 76 a month, no UAE region; kept as the fallback.

## Decision
Option 2. The numbers, the free grants applied and the warm and cool costs are in the I1 runbook table (`infra/README.md`) and are not repeated here, so that they have one source.

## Concerns, stated openly (they travel with the demo and are named in the deck and the video notes)
- **Cold start.** The first live request to the api after idle waits while a replica starts. The static judge views are unaffected. We hold the api warm (`-Warm`, then one demo reset) for judged sessions and recording, and the cold-start time is measured and written in the runbook.
- **Stop-to-phone time.** A one-minute scheduled alert job makes the bound about two minutes, depending on the push services; the copy says "within about two minutes" only if the runbook's measured value supports it, and otherwise "within a few minutes".
- **No high availability.** One replica, Postgres HA off, 7-day backups, one region (UAE North if Azure is used).
- **Hardening deferred (stage 2 of ADR 0001):** public database access with the Azure-services rule, secrets as Container Apps secrets (not Key Vault), password authentication to Postgres (no Entra), shared demo token and shared rate-limit bucket (ADR 0062).
- **Security hygiene in progress:** the image scan reported HIGH and one CRITICAL dependency findings, routed to the backend and frontend lanes; whatever remains is listed with a reason in the freeze summary.
- **No GPU.** Voice and local-LLM features are not offered (ADR 0071); the public URL refuses them by design.
- **Review gaps, not cost gaps:** the clinical review, a native review of the machine translations and counsel on the PDPL are not done (ADR 0035, the evaluation report); the evaluation has one test summer and one site-summer.

## What a budget buys (the roadmap slide's "with budget" column)
Always-on replicas and zone-redundant Postgres; private networking and Key Vault with managed-identity database access; a web application firewall and monitoring with on-call; a UAE GPU for self-hosted speech and language models (the ADR 0038 design); load testing; on-site WBGT sensors and a pilot with real outcomes; more summers and archives and the summer-rotated model (ADR 0070); a native review of the six languages and a clinical review; a counsel review of the PDPL position.

## Consequences
- **Cost of being wrong:** a judge who opens a live page during a cold start waits, and may read the wait as a fault. Mitigation: warm the api before judged sessions, the "waking up" state is a designed loading state, and the static views carry the story.
- The stop-to-phone figure in the deck must be the measured one.

## Revisit trigger
Budget becomes available; the measured cold start is longer than about 30 seconds; the Azure account turns out to carry free credit that makes warm cheap; GITEX preparation.

## Links
[ADR 0001](0001-hosting-azure-uae-north.md) · [0034](0034-demo-strategy.md) · [0038](0038-agentic-workflows-and-voice.md) · [0042](0042-postgres-tls-must-be-verified-in-prod.md) · [0062](0062-public-demo-access-model.md) · [0071](0071-defer-voice-site-setup-demo-beat.md)
