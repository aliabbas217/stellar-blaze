# Demo story: potential, value and promise (2026-11-15)

Written by the architect for the deck, the 3-minute video and the live demo. Every number must come from `artifacts/eval/2026/*` or the evaluation report's claims table (`2026-11-15-evaluation-report.md` §7); no line below may be quoted without it.

## The pitch, in one sentence
Heat stops work in the UAE on a legal clock; Stellar Blaze turns tomorrow's forecast into a checked, worker-first work-and-rest plan, and shows its evidence, including where it loses.

## What judges should feel, and the beat that earns it
| They should feel | Beat | Why it is real |
|---|---|---|
| **Awe** | The opening frame: a 3D heat field of real forecast data over the UAE (2D fallback) | ADR 0037; real IFS data, not a mock |
| **Novelty** | "Summer 2026, replayed honestly": the scoreboard from a test we published before running it, with a proof chip behind every number | Pre-registration, lock hash, amendments; the table shows the policies we lose to as well |
| **Problem solving** | Supervisor: crews, the day plan, "try a plan" (the law checker answers with article citations and the 11 rules), Stop work and Undo | Planner plus independent validator; real 422 for an illegal shift |
| **Ease of use** | Worker: one big sign and the day's spine, the alert, "I feel unwell" in three one-tap calls, in six languages including right-to-left | PWA, no accounts, nothing sent or logged by the unwell sheet (ADR 0065) |
| **Trust** | Governance: an employer asks for a worker's health data, is refused, and the worker sees the logged attempt; the log is tamper-evident | Live 403 `individual-data-refused`, hash-chained audit (ADR 0054) |
| **Promise** | The roadmap slide below | The constraint is stated, not hidden |

## Three-minute video (beats and timing)
1. **0:00-0:20** Hook. 3D field; the hook number comes **only from a committed file**, with its definition and proof chip, never typed. Preferred, truth-based (`policy_scoreboard.json`): in summer 2026 at OMAA, 252.5 [191.5, 315.5] working hours were in the ADOSH High zone by observation-derived truth (margin 7 W/m², an assumption, working daytime 06:00-14:59 UTC). A midday ban alone leaves them unwarned, because the ban covers two and a half hours. If the season ribbon's raw-forecast count (the recorded day-1 IFS forecast, 1,624 of 1,807 hours from 06:00 to 19:00) is used, it must say "recorded raw forecast, before correction" and must not read as hours that were actually over a limit (the 2026 forecast ran warm). **Correction, 2026-11-15:** an earlier draft of this line quoted "about 58% of summer-2025 daytime hours at WBGT 32 °C"; that figure comes from an early audit script in the research repo and is in no committed file of this repo, so it is withdrawn.
2. **0:20-1:00** The honest scoreboard, OMAA, summer 2026, lead 1. Show all four policies and both thresholds. Say plainly: we beat ban-only by a wide margin; a naive WBGT 32 rule misses fewer danger hours than ours but raises more false alarms; raw ADOSH zones raise fewer false alarms and miss more. Tap one proof chip.
3. **1:00-1:40** Supervisor on the pre-registered day 2026-06-14. Crew plan, a try-a-plan that the law checker refuses with a cited article, sign-off, Stop work, Undo. (For the phone moment: set `alert_dispatch_interval_minutes` to 1 for the recording; the default bound is about six minutes.)
4. **1:40-2:05** Worker: Today, alert, "I feel unwell", in Urdu and one other language. Say plainly that the translations are machine-made and await native review; each non-English locale shows one quiet line to that effect in its settings or about area ("Machine translation, not yet reviewed by a native speaker"). The judge claims pages stay in English by design.
5. **2:05-2:30** Governance refusal and the access log.
6. **2:30-3:00** Promise: the roadmap slide and the ask.

## Live demo order (if judged live)
Landing, scoreboard and one proof chip, day zoom on 2026-06-14, supervisor plan, try-a-plan, Stop and Undo, worker unwell, governance refusal. Replay clock anchored at about 10:10 Dubai (ADR 0034 amendment of 2026-11-15).

## "Where we improve, and how" (the roadmap slide)
The honest constraint: two training summers, one test summer, eight airports (not worksites), derived heat-stress truth, and no worker-outcome data.
1. **Data:** more summers and earlier forecast archives; on-site WBGT sensors; worker-reported outcomes (the only route to a health claim).
2. **Model (ADR 0070):** summer-rotated validation; station-history and recent-observation features for known sites; a blend of IFS, AIFS and GFS; recalibrated event probabilities.
3. **Decision layer:** warning thresholds set by cost and chosen per employer; the protective-plan rest burden as a tunable operating point.
4. **Product:** a pilot with one or two contractors; production hosting in UAE North; zero-form site setup by voice or pasted text on self-hosted models (ADR 0038 as the starting point).
5. **Assurance:** the clinical review (not yet done, so the product says "Not clinically reviewed"), counsel on the PDPL, and a native Urdu review.

## Words we never use
"Catches 90% of danger hours", "calibrated probabilities", "beats every policy", "beats ADOSH", "works at any airport", "untouched 2026", "tamper-proof", "restricted members are protected", "immediately" for a stop push. The claims table lists the allowed alternatives.

## What must exist by Wed 18 Nov 12:00 to tell this story
Landing hero (3D with 2D fallback); the 2026 data swap; the live backend on a public HTTPS URL (Azure UAE North, or the Render fallback after the Monday 22:00 trigger); a real-phone push check (Ali's phone with the installed PWA); the Urdu and Arabic layouts; the deck; the recorded video on Thu 19 Nov.
