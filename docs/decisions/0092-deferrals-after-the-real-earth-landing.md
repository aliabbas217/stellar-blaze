# ADR 0092: Deferrals after the real-earth landing (ten items, each with a trigger)

- **Status:** Accepted by the architect (the owner informed in the controller's brief of 2026-11-20; he can overrule). Where no reason for an item was ever recorded, the item says so instead of inventing one.
- **Date:** 2026-11-20
- **Deciders:** the architect (Claude); Ali (owner) informed
- **Supersedes / superseded by:** none. Follows the [ADR 0082](0082-deferrals-after-the-redesign.md) pattern: one ADR, one heading per item, nothing deleted. Items 5 and 6 keep the rule of [ADR 0083](0083-tier-2-english-only-story-copy.md) as written. The replay-window item "a web page that stays open across the clock wrap" is **already a row** of the parking lot (the row "Replay window repeats (2026-11-20)", part (a), under [ADR 0034](0034-demo-strategy.md)) and is not repeated here.
- **Evidence:** [ADR 0090](0090-landing-is-seven-whole-screen-slides-over-real-imagery-and-terrain.md); `frontend/src/features/judge/landing/*`; `frontend/src/i18n/routing.ts`; `frontend/src/features/judge/tour-steps.ts`; `frontend/src/components/shell/ResetDemoControl.tsx`; `frontend/tests/e2e/judge-day.spec.ts`; `frontend/src/features/demo/constants.ts`; the file listing of `frontend/public` and `frontend/src/app` on `main` at `b72a81a`.

## Context
The real-earth landing merged on 2026-11-20 (PR #5, `b72a81a`) while the demo is being judged (20 to 30 November). A live audit and the S10 review left ten things that are not built or not decided. Each is recorded here so it is a row of the parking lot with a trigger, not a memory.

## 1. Hour control and the hours after 14:00 on the landing map
- **What:** a keyboard and pointer control for the hour on the forecast scene (the removed `HourScrubber` and its Play and Pause), and map hours after 14:00. The scene's hour follows the scroll from 06:00 to 14:00 and holds at 06:00, 09:00 and 14:00 (`landing-camera.ts`); the three captions are also a hidden text list.
- **Why parked:** the scroll-linked day, parked in the draft ADR 0089 (not on `main`), was **built** by S10 ([ADR 0090](0090-landing-is-seven-whole-screen-slides-over-real-imagery-and-terrain.md) decision 3), so that part is not parked. The scrubber went with the old field island, which nothing else used.
- **Revisit:** a keyboard or switch user cannot reach an hour they need; the owner asks for the control back; a reviewer asks what the map shows after 14:00.

## 2. Dot or progress navigation for the landing
- **What:** dots or a progress marker at the screen edge.
- **Why parked:** the chapter rail already lists the seven chapters and marks the current one (`aria-current`, from the page's one scroll listener); under 1100 px it is a strip at the top, not fixed.
- **Revisit:** a reviewer reports getting lost on the landing, above all in a window narrower than 1100 px.

## 3. Captions and a transcript for the recorded video
- **What:** captions on the video and a text transcript beside it.
- **Why parked:** no video is published (`landing-video.json` holds `youtubeId: null`; the block shows one sentence). When an id is set the embed is created with `cc_load_policy=1` (captions on), which shows captions only if the video has them; no transcript exists or is built.
- **Revisit:** the video is published (set the id, and add captions and a transcript in the same change).

## 4. A self-hosted video file in place of the YouTube embed
- **What:** our own file, poster and player.
- **Why parked:** the embed is one config value and one Content-Security-Policy directive (`frame-src https://www.youtube-nocookie.com`, added only while an id is set); a file needs hosting, a poster and a player.
- **Revisit:** the video is final and a third-party embed is unwanted; then replace the player and drop `frame-src` (`video-config.ts` says both places).

## 5. Non-English replay pages
- **What:** translated text on the replay pages (`/replay`, `/replay/day`, `/replay/try`, `/replay/governance`, `/replay/proof/...`). Every locale has the routes, but the copy under `judge.scoreboard.`, `judge.frontier.`, `judge.proof.`, `judge.day.`, `judge.try.`, `judge.governance.` and `states.proof.` is English in all six catalogues (`CLAIM_PREFIXES` in `i18n-sync.mjs`).
- **Why parked:** a machine translation of a verdict is an unverified claim; the rule is [ADR 0083](0083-tier-2-english-only-story-copy.md) decision 1, unchanged.
- **Revisit:** a native reviewer is found; a worker-facing screen needs a replay sentence; a judge reports the English blocks as a defect (the triggers of ADR 0083).

## 6. `NEXT_LOCALE` does not choose the language at `/`
- **What:** a returning visitor's language is not restored at the site root. The proxy writes the `NEXT_LOCALE` cookie from the URL prefix, but `localeDetection` is `false`, so `/` is a plain 307 to `/en` for every visitor (`routing.ts`).
- **Why parked:** the comment in `routing.ts` gives the reason: with detection on, the root would answer differently per browser, "unreproducible for a judge who opens a shared link, and uncacheable". A stored choice still applies on URLs that carry a prefix.
- **Revisit:** a pilot with returning workers who set a language once; a judge reports losing the language on return.

## 7. `robots.txt` and `sitemap.xml`
- **What:** a robots file and a sitemap. The app serves neither: `frontend/public` holds `data/`, `icons/` and `technical-report.pdf`, and `frontend/src/app` has no `robots` or `sitemap` route. Ten pages set `robots: { index: false }` themselves (the proof page, a crew page, the worker alert, join and unwell pages, the offline page, four dev pages).
- **Why parked:** no decision about whether search engines may index the demo is recorded; this is undecided, not decided against.
- **Revisit:** after the judging window (30 November), or when the owner decides the demo's public discoverability.

## 8. The scored demo day and the landing's illustration day differ
- **What:** the day and the validator pages show the scored demo day, Sunday 14 June 2026 (`judge-day.spec.ts`: "One day, hour by hour: 14 June 2026"), the day before the midday break comes into force. The landing's map, captions and strip show Thursday 3 September 2026 (`uae_ifs025_d1_wbgt_2026-09-03.json`; `REPLAY_DATE` in `features/demo/constants.ts` is the same day), a day inside the ban window. A reader can meet two different days.
- **Why parked:** the landing says so on the map ("An illustration of one hot day, not the day we scored.") and ADR 0037 decision 1 requires an illustrative day to be labelled; no decision to align them is recorded.
- **Revisit:** a judge asks why the days differ; the field file is regenerated; the landing is next edited.

## 9. "Reset demo site" is one tap with no confirmation
- **What:** the control is one tap and has no confirm dialog (`ResetDemoControl.tsx`; [ADR 0062](0062-public-demo-access-model.md), [0066](0066-demo-reset-is-a-new-epoch-audit-stays-append-only.md)). It is mounted on the crews screen, the crew plan screen, the governance page and the safety view's Demo controls (not on the worker screens). A reset starts a new epoch of the shared synthetic site and re-anchors the replay clock ([ADR 0034](0034-demo-strategy.md) amendments); one shared token means one global rate ceiling (1 per 60 s, 10 per hour, 0066 amendment), so another visitor's reset can change a judge's screen mid-journey.
- **Why parked:** 0066 chose "nothing is deleted, so there is nothing to confirm" and records the shared-token cost; no later decision weighs a confirmation against a one-tap reset during the judging window.
- **Revisit:** a judge reports lost state or a reset they did not make; judging shows concurrent visitors; the owner wants a confirmation.

## 10. The 3-minute tour has no "One day" stop
- **What:** the tour's stops are story, worker, crew, try a plan, boundary and scoreboard (`TOUR_STEP_IDS`); the story's "one day" step (`/replay/day`) is not a stop, although the story pager has it.
- **Why parked:** the 2026-11-20 amendment of [ADR 0076](0076-story-order-and-plain-landing-and-verdicts.md) added "Try a plan" only; no reason for leaving out the day page is recorded.
- **Revisit:** the tour is revised; a judge test shows the day page is missed; the 0076 trigger that the story is too long or too short.

## 11. The submission walkthrough video is served by the demo, not by YouTube (2026-11-20)
- **What:** the 3-minute walkthrough is a static page, `/video.html`, with the MP4 (about 12 MB, H.264, faststart) and its poster in `frontend/public/media/`, plus the full transcript as text. The landing's YouTube facade (`youtubeId`) stays unset.
- **Why:** the owner's YouTube account was not reachable when the video was finished, and a plain page on the demo's own origin is viewable by anyone and needs no new CSP rule (`default-src 'self'` covers media).
- **Cost:** the file lives in the git history and the web image (about 12 MB); the pre-commit large-file hook (500 kB) excludes `frontend/public/media/` and nothing else.
- **Revisit:** the owner publishes the video on YouTube (set `youtubeId`, then remove the file and the hook exclusion), or the demo is torn down after GITEX.

## Consequences
- **Cost of being wrong:** none of these blocks the judge path; items 8 and 9 are the two a judge could notice (two different days, a screen that resets under them), and both are visible in the page text or the audit.
- Items 3 and 4 depend on the owner's video being published. The landing's real-device check has no record yet ([ADR 0090](0090-landing-is-seven-whole-screen-slides-over-real-imagery-and-terrain.md) weak spots).

## Links
[ADR 0090](0090-landing-is-seven-whole-screen-slides-over-real-imagery-and-terrain.md) · [0082](0082-deferrals-after-the-redesign.md) · [0083](0083-tier-2-english-only-story-copy.md) · [0066](0066-demo-reset-is-a-new-epoch-audit-stays-append-only.md) · [0076](0076-story-order-and-plain-landing-and-verdicts.md)
