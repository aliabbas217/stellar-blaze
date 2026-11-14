# ADR 0058: Alert events (escalate now, de-escalate after a dwell), the F1 Web Push contract adopted as is, and the fallback when the forecast is missing or stale

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** adopts F1 `docs/contracts/web-push.md` §1-§4 and settles its §5 open points; implements ADR 0004 §1, ADR 0010 §1(b) (dwell only delays de-escalation) and ADR 0011 P-H12.
- **Evidence:** ADR 0004 (payload: level code + site/crew id; `Urgency: high`; pywebpush 2.5.0); ADR 0002 (`OutboundMessage`, `extra="forbid"`); F1 web-push contract (six keys `v, audience, target_id, level, template_id, valid_from`; TTL 3600; VAPID `mailto:`; endpoint never logged; RFC 8030 §7.3: 404 for an expired subscription); PyPI `pywebpush` 2.5.0 released 2026-08-29, requires aiohttp, documents `webpush_async` (checked 2026-11-14).

## Decision
1. **Alert event model.** For each site and crew, the level timeline of the day (ADR 0046) is compared with the last event sent for that target. A **more severe** level creates an event immediately (`kind = escalate`), with `valid_from` = the first hour at that level. A **milder** level creates an event only once it has held for `deescalation_dwell_minutes` (tunable, default 60, range [0, 180], `safer = "higher"`). Events are created no earlier than `alert_lead_hours` (default 12, range [1, 24], `safer = "higher"`) before `valid_from`. Each event row carries ruleset id/SHA, model id, config version id/SHA. Dedupe key: `(target, level, valid_from)`.
2. **Push.** `WebPushChannel` (pywebpush **2.5.0**, the one new dependency) sends the six-key payload, `TTL: 3600`, `Urgency: high`, aes128gcm, VAPID from `SB_VAPID_PRIVATE_KEY` / `SB_VAPID_SUBJECT` (`mailto:`). A site event goes to every subscription of the site; a crew event to that crew's subscriptions. `template_id` values come from the ruleset (`level-change`, `level-end`).
3. **Subscriptions.** `endpoint` is the natural key: a repeat POST returns the existing id (201, same body). 404 **or 410** from the push service deletes the subscription. Delete is idempotent (204). The endpoint is stored for delivery only and never logged; logs carry the subscription id.
4. **Stale or missing forecast.** Live mode: a forecast for the site-date older than `forecast_stale_after_hours` (default 30, range [6, 48], `safer = "lower"`) is `stale`; the last forecast is still shown with `forecast_status = "stale"` (F1 R41). With no usable forecast for an hour, the hour is `fallback`: `site_level = null`, and the planner treats every on-shift tick as **High** (the most severe workable zone; never less protective than the ban). Replay mode is never stale (fixed snapshot) and says `mode = "replay"`.
5. Pushes are triggered by `sb-jobs alerts dispatch --site <id> [--date] [--as-of]` (the refresh job and the demo); there is no HTTP trigger.

## Consequences
- **Cost of being wrong:** a 60-minute dwell holds a higher level longer (more warnings, never fewer). High-everywhere fallback stops nothing but cycles every tick; it is labelled "No fresh forecast: protective plan".
- pywebpush pulls aiohttp and requests into the image; pip-audit and deptry must stay green.

## Revisit trigger
The real-phone spike (F1 Task 15) shows TTL or urgency misbehaving; alert-burden complaints in a pilot.

## Links
[ADR 0002](0002-infra-minimalism-and-ports.md) · [0004](0004-tiered-alert-delivery.md) · [0010](0010-runtime-tunable-configuration.md) · [0011](0011-heat-aware-planner.md) · [0046](0046-warning-level-policy.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. Nothing else changed.
