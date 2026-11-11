# ADR 0004: Tiered alert delivery: site/crew Web Push, personal risk on app open, supervisor crew relay

- **Status:** Accepted (Ali, 2026-11-11)
- **Evidence:** `docs/research/2026-11-11-frontend-platform.md` §1.1-1.3, §4, §5; plan §8.8-8.9

## Context
Plan §8.8 computes personal risk on the worker's device and sends the server only aggregated levels. A closed PWA cannot wake itself: Chrome ended Notification Triggers, Periodic Background Sync is Chrome-only, install-only and engagement-gated. Only a server-initiated push wakes the service worker, and the server never computes the personal result. Meta's WhatsApp Business policy (updated 23 Sep 2026) says "Don't use WhatsApp for telemedicine or to send or request any health related information"; Nepali is not a supported template language; templates cannot carry audio. UAE SMS needs sender-ID pre-registration, a health-authority letter for health content, and allows no URLs. The best-documented delivery to low-literacy migrant workers is supervisor-mediated (Delhi pilot: WhatsApp groups, voice notes, colour boards).

## Decision
1. **Tier A, site/crew alerts by Web Push.** The server pushes a non-personal level for a site or crew ("Level Amber from 13:00"). The payload carries a **level code and site/crew id only**; the app renders localised text and audio from its cache. Pushes are sent with `Urgency: high`. Sent from FastAPI through `NotificationChannel` (`WebPushChannel`, pywebpush 2.5.0) in B3.
2. **Tier B, personal risk on app open.** Computed on the device from the cached forecast and the worker's locally held profile when the app is opened or a push is tapped. Never sent to the server.
3. **Supervisor crew-relay mode** is a first-class feature: large colour state, shareable bulletin text, pre-rendered audio, printable crew card.
4. **WhatsApp and SMS** exist only as adapters tested against fakes, plus an on-screen payload inspector. Not wired live. Never carry individual health information.

## Consequences
- **Stated openly in the technical document (proposed wording):** "When the app is closed, a worker receives site- and crew-level warnings only. Their personal risk is shown when they open the app or tap the warning. Personal risk is computed on the phone and is never sent to the server, so the server cannot push it."
- Notifications cannot play the pre-rendered clip (the Notification API has no sound option); audio plays in-app after a gesture.
- iOS requires a Home Screen install (iOS 16.4+) and a user-gesture permission prompt.
- The 3-hour real-phone Web Push spike is the riskiest integration and starts by 13 Nov (roadmap).
- Messages that a worker sends ("I feel unwell") are queued in IndexedDB and retried while the app is open; background sync is not claimed.

## Rejected options
| Option | Why rejected |
|---|---|
| Push the worker's personal level from the server (opt-in) | Weakens "server sees aggregates only"; needs separate governance sign-off |
| Native app with background execution | Not feasible by 20 Nov (ADR 0003) |
| WhatsApp-first or SMS-first worker channel | Policy (health information), Nepali gap, no audio templates, registration lead times, cost |
| Outbound voice (IVR) | International caller ID only, USD 0.2995/min |

## Revisit trigger
Written confirmation from Meta or a UAE regulator that site-level heat alerts are not health information; pilot-employer data on phone ownership and on-site phone rules; a native wrapper decision.
