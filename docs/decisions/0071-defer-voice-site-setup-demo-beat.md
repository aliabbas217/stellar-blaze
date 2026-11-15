# ADR 0071: Defer the voice site-setup demo beat (ADR 0038 tiers A and B)

- **Status:** Accepted by the architect (Ali asked "is it really good or are you pushing it?" on 2026-11-15; the answer below stands unless he overrules)
- **Date:** 2026-11-15
- **Deciders:** the architect (Claude)
- **Supersedes / superseded by:** defers the demo scope of [ADR 0038](0038-agentic-workflows-and-voice.md) §7 (tier A and tier B); ADR 0038 stays Proposed and its decisions D1 to D4 stay open. Does not change ADR 0015 (copilot and shift drafter stay cut) or ADR 0056 (the compliance drafter stays deferred)
- **Evidence:** ADR 0038 §7 (tier A 0.5 build-day, tier B +1.5 build-days; the mic is shown as a 15 s video beat; the public URL refuses voice by design); the F2 controller's capacity report of 2026-11-15 (F2 is the bottleneck lane; 15 h of wall-clock remain with about a day of float); the project's own evaluation record (the honest 2026 scoreboard, the governance refusal and the law checker are already demonstrable live)

## Context
The voice beat was recommended as the most novel piece still addable. Asked whether it is really good, the architect's honest assessment is: it is a convenience for supervisors, not the heat problem itself; it would be demonstrated only as a pre-recorded 15 s clip, because the public URL cannot run a self-hosted speech model and refuses voice by design; the quality evidence would be a scripted set in Ali's own voice, which reads as staged and would sit badly next to a pre-registered, honest evaluation; spoken-roster demos are common in hackathons, so the novelty is low compared with what the project already has; and it needs the F2 mic screen, in the lane that is already the schedule's bottleneck, plus ten new privacy tests and a security review, with usage limits already hit three times. The recommendation was weighted too much towards novelty and too little towards finishing.

## Options
1. **Build tiers A and B** (about 2 days of agent time and a mic screen).
2. **Tier A only** (types, ports, fail-closed router): invisible to judges.
3. **Defer both (chosen).**

## Decision
Neither tier is built before the submission. ADR 0038 stays Proposed. The same capacity goes to: the landing hero (the 3D heat field, ADR 0037), the real-phone push moment on the public URL, hosting, the 3-minute video and deck, and Urdu and Arabic quality. "Zero-form site setup by voice or pasted text, with self-hosted models" is named on the roadmap slide as the next product step, with the privacy design of ADR 0038 as its starting point.

## Consequences
- **Cost of being wrong:** no agent-style beat in the demo, so a judge looking for a visible LLM or voice feature sees none; the AI story is the calibrated corrector, the legal planner and validator, and the governance layer.
- No code, no new dependency and no GPU route.

## Revisit trigger
Spare capacity after the Tuesday 17 Nov checkpoint with hosting and F2 finished; a pilot asks for voice or text site setup; a UAE GPU route exists.

## Links
[ADR 0038](0038-agentic-workflows-and-voice.md) · [0015](0015-cut-llm-copilot-and-shift-drafter.md) · [0056](0056-defer-compliance-report-drafter.md) · [0037](0037-reverse-0014-cinematic-3d-landing.md)
