# Frontend and delivery platform decision (Challenge 07, heat-stress warning product)

**Date:** 2026-11-11 (demo due 2026-11-20, internal target 2026-11-19, solo developer)
**Status:** Research complete, decision proposed for owner sign-off. Nothing here is built.
**Method:** every version came from the npm / PyPI registry today; every platform capability or price came from a fetched primary page today unless marked **[secondary]** or **[UNVERIFIED]**. Source numbers like [S12] point to the list at the bottom. Where the evidence contradicts the brief or `challenge-07-plan.md`, section 1 says so.

---

## 0. Decision in one screen

**Build one Next.js 16 web app with three route groups (supervisor, HSE/regulator, worker), ship the worker surface as an installable PWA, and put every outbound alert behind a `NotificationChannel` port in the FastAPI backend. Implement only the Web Push adapter for the demo. WhatsApp, SMS and voice are specified adapters (templates, costs, constraints, contract tests against a fake channel), not live integrations. No native app.**

| Question | Answer | Why (short) |
|---|---|---|
| Web + PWA, native, both, or messaging? | **Web + PWA** | Stores are not reachable in 9 days (Play: 12 testers x 14 days for new personal accounts [S44]; Apple enrolment delays are widely reported [S47]); organisers judge a prototype link; one codebase serves all three user types. |
| Is WhatsApp the worker channel? | **Documented adapter only, for non-personal content** | Meta's own policy says "Don't use WhatsApp for telemedicine or to send or request any health related information" [S24]; Nepali is not a supported template language [S25]; templates cannot carry an audio header [S26]. It is still the best-evidenced real-world path (Delhi precedent [S40]) and 7.5x cheaper than SMS [S22][S31]. |
| Can the PWA do personal alerts while closed? | **No, not reliably** | Chrome ended work on scheduled notifications [S15]; Periodic Background Sync is Chrome-only, installed-only, engagement-gated [S14]. This conflicts with plan sections 8.8/8.9 (see 1.3). |
| TypeScript version? | **Pin 6.0.3, not 7.0.2** | 7.0 ships no API; typescript-eslint is not compatible and its peer range is `<6.1.0` [S4][S5]. |
| Bundler / PWA lib? | **Turbopack + `@serwist/turbopack` 9.5.13**, hand-written push SW as fallback | `next-pwa` is unmaintained; Next 16 fails `next build` if a webpack config exists [S2]. |

Confidence: high on web + PWA and on not going native; medium-high on the channel conclusions; low on worker phone/WhatsApp penetration (no primary data found, see 5.3).

---

## 1. Where the evidence contradicts the brief or the plan

These are the findings you should read first. Each changes a design decision.

### 1.1 "WhatsApp/SMS adapter for workers" is narrower than assumed

- **Health-information rule.** WhatsApp Business Messaging Policy (last updated 23 Sep 2026), section 3: "Don't use WhatsApp for telemedicine or to send or request any health related information", with the rest of the sentence tying it to regulations that bar sending such data to systems without heightened health-data handling [S24]. The "I feel unwell" self-report and any per-worker risk or symptom text are health-related. They must not travel over WhatsApp. Crew- or site-level environmental alerts ("Site 3: Level Amber from 13:00") are not individual health data, but whether Meta or a UAE regulator treats them that way is **[UNVERIFIED]**; get it in writing before a pilot.
- **Nepali is not a supported template language.** Meta's supported-languages page lists `ar`, `ar_AE`, `hi`, `ur`, `bn`, `bn_IN`, `ml`, `fil`, `ta`, `en` and others, but no Nepali (confirmed by `curl` of the raw page and by grep, not only the summary) [S25]. Plan assumption A5 lists Nepali as one of the six launch languages.
- **No audio in templates.** "Media headers can be an image, video, gif, or a document such as a PDF" [S26]. The plan's pre-rendered audio (8.6) can only be sent as a regular audio message, and non-template messages are allowed only while a 24-hour customer-service window is open, which opens when the worker messages us first [S21]. Audio formats accepted: AAC, AMR, MP3, M4A, OGG (Opus, mono), max 16 MB; a voice-note rendering needs OGG/Opus and shows a play icon only at 512 KB or less [S28].
- **Template review takes up to 24 hours** [S27], so any live WhatsApp demo needs templates submitted at least a day ahead. Whether Meta business verification is needed first is **[UNVERIFIED]**.
- **SMS has its own walls.** Twilio's UAE guidance: alphanumeric sender IDs only through pre-registration; health-related registrations "will require an approval letter from the UAE health authorities"; "Messages containing URL ... are also not allowed" [S30]. So an SMS cannot carry a deep link to the PWA.
- **Voice.** WhatsApp calling is still restricted in the UAE as of 2 May 2026 [S34]. Outbound IVR is feasible only from international numbers (Twilio forbids outbound from UAE geographic numbers) at USD 0.2995 per minute to UAE mobiles [S32][S33].

### 1.2 Reaching workers is probably supervisor-mediated first

- The best-documented heat-alert delivery to low-literacy migrant workers I found is **not** an app. In Delhi (2025 pilot) the India Meteorological Department shares alerts "in English and Hindi", worker representatives forward them to local WhatsApp groups, workers valued "the option to listen to them via WhatsApp's voice note facility", and hand-lettered boards use colour coding and emojis for people who cannot read [S40]. The ILO's field study quotes a Philippine key informant (speaking about destinations such as Hong Kong SAR and Malaysia, not the UAE) saying employers or recruiters "confiscate or restrict" workers' access to their devices and that some work areas have no internet [S38]. Whether this happens on UAE sites is **[UNVERIFIED]**. HRW reports delivery workers whose "phones turn off" in extreme heat [S43].
- Implication: a worker-phone PWA is one surface among three. The supervisor dashboard needs a **crew relay mode** (large colour state, shareable bulletin text, audio clips, printable crew card) as a first-class feature, matching the plan's own "printable crew card and colour flags" fallback (8.9). Plan 8.6 and 8.9 currently treat the worker phone as the primary alert endpoint.

### 1.3 On-device personal risk and closed-app alerts cannot both hold in a PWA

- Plan 8.8: "individual risk is computed on the device; the server receives only levels, aggregated." Plan 8.9: rules engine runs locally in an offline-first PWA.
- A closed PWA cannot wake itself on a schedule: Chrome's Notification Triggers API is dead ("The development of Notification Triggers API ... has ended") [S15]; Periodic Background Sync "is granted only to an installed web app", fires based on engagement score, and is not Baseline [S14]. Only a server-initiated Web Push wakes the service worker.
- A server push cannot contain a personal result the server never computes. Options (needs an ADR before building):
  1. **Tiered alerts (recommended).** Tier A: server pushes site/crew-profile level, non-personal ("Level Amber 13:00, 10-minute break each hour"). Tier B: personal limit, shown when the app is opened or the push is tapped, computed locally from the cached forecast. State the closed-app limitation openly in the technical document.
  2. Worker opts in to send only their personal **level** (not health data) so the server can push it. Weakens "aggregated only"; needs governance sign-off.
  3. Native app with background execution (post-demo; not researched here).

### 1.4 "Latest stable" TypeScript is a trap this week

TypeScript 7.0.2 is the npm `latest` (published 2026-07-08) [S6]. The 7.0 post states "it does not ship with an API" and tells tools like typescript-eslint to use npm aliases [S4]. typescript-eslint maintainers: "isn't compatible with TS 7 at this time, because there is no TS 7 API at this time" (issue closed Aug 2026 as a duplicate, no timeline) [S5]; the package's peer range is `typescript >=4.8.4 <6.1.0` [S6]. Next.js 16 supports TS 7 for `next build` only through an **experimental** CLI path [S3]. The `frontend-discipline` lint gates (jsx-a11y via eslint-config-next) would break. Pin TypeScript 6.0.3.

### 1.5 Stack gotchas that bite on day 1 (details in section 7)

- ESLint 10.14.0 is `latest`, but `eslint-plugin-jsx-a11y` 6.10.2 (last published 2024-10-26) peers `eslint ^9` at most, and `eslint-config-next` bundles it [S6]. Pin ESLint 9.39.5.
- Next 16 makes Turbopack the default and **fails `next build` if a webpack config exists** [S2]. `@serwist/next` is the webpack path; use `@serwist/turbopack` or `--webpack`.

---

## 2. Recommended architecture

```
                         ┌──────────────────────────── FastAPI (plan 8.11) ───────────────────────────┐
 Worker phone (PWA)      │  risk engine · policy engine · consent ledger · audit log · RBAC            │
 /w/*  (lean, no charts) │                                                                             │
   - 6-language alert    │  NotificationPolicy ──► NotificationChannel (port)                          │
   - icons + audio       │        │                    ├─ WebPushChannel   (pywebpush)  DEMO: LIVE      │
   - "I feel unwell"     │        │                    ├─ InAppChannel     (SSE)        DEMO: LIVE      │
   - offline cache       │        │                    ├─ CrewRelayChannel (bulletin)   DEMO: LIVE      │
        ▲   ▲            │        │                    ├─ WhatsAppChannel  (Cloud API)  SPEC + FAKE     │
        │   │ push       │        │                    ├─ SmsChannel                    SPEC + FAKE     │
        │   └────────────┼────────┘                    └─ VoiceChannel                  SPEC ONLY       │
        │ HTTPS          │  contract tests run the same suite against every adapter and a FakeChannel  │
 Next.js 16 (RSC, proxy.ts, next-intl) ─ BFF to FastAPI                                                 │
   /s/*  Supervisor: crew risk timeline, break plan, alerts, crew relay, "break things" panel          │
   /h/*  HSE / regulator: aggregate view (k-suppressed), compliance report                             │
                         └─────────────────────────────────────────────────────────────────────────────┘
```

Key choices:

- **One Next.js app, three route groups.** Shared design tokens, i18n, auth, types. The worker group has its own lean layout and a JS budget; charts and maps never load there.
- **Notification policy and the port live in FastAPI**, not in Next.js. FastAPI already owns risk, consent and audit (plan 8.8); sending from there keeps one place that enforces "no individual health data in any outbound payload". Use `pywebpush` 2.5.0 (PyPI, 2026-08-30) [S61]; the Next.js guide's `web-push` example (npm 4.0.0, published 2026-11-06, a fresh major) is only a reference [S1][S6].
- **Push payload carries a level code and site id only**, never text a third party could read as health data; the app renders localised text and audio from cache.
- **Share only schemas between web and any future native client** (Zod schemas, API client, domain types in a workspace package). UI code is not shareable between shadcn/Tailwind DOM and React Native.

---

## 3. Options evaluated

| Option | Verdict | Reasons (evidence) |
|---|---|---|
| **A. Next.js web + installable PWA + channel port (chosen)** | Accept | Instant deploys, no store review [S1]; push works on Chromium and on iOS 16.4+ Home Screen apps [S1][S7]; judge opens a link; one codebase; port keeps messaging options open. |
| B. Native only (Expo / React Native) | Reject for demo | Expo 58.0.23 / RN 0.88.1 are current [S6], but: Play personal accounts created after 13 Nov 2023 need a closed test with 12 testers for 14 days before production [S44] (9 days left); iOS push credentials need a paid Apple Developer account [S46]; Apple enrolment delays are a documented 2026 pattern in the developer forums [S47] **[anecdotal]**; Expo free tier = 15 Android + 15 iOS builds with low-priority queue waits of "90+ minutes" [S45]; judges would sideload an APK. Gains (background execution) are unproven here. |
| C. Both (web dashboards + Expo worker app) | Reject for demo, keep as post-pilot option | Doubles the surface for one developer; only schemas are shareable. |
| D. WhatsApp-only worker experience (bot-first) | Reject as the primary | Health-information rule [S24], no Nepali [S25], no audio in templates [S26], supervisors/HSE dashboards still needed, cost per message, Meta onboarding lead time unverified. |
| E. SMS-first | Reject | USD 0.1176 per segment (7.5x WhatsApp utility) [S31][S22]; sender-ID registration with a health-authority letter [S30]; no URLs [S30]; text-only for low-literacy users. |
| F. Outbound voice calls (IVR) | Adapter spec only | USD 0.2995 per minute [S33]; international caller ID only [S32]; fits low literacy but is the most expensive. |
| G. `next-pwa` / `@ducanh2912/next-pwa` | Reject | `next-pwa` last published 2022-08-23; `@ducanh2912/next-pwa` last published 2024-09-18 and its README says to consider migrating to `@serwist/next` [S6][S20]. |
| H. `@serwist/next` (webpack plugin) | Reject for default path | Needs webpack; Next 16 fails default `next build` with a webpack config [S2]. Keep as the `--webpack` fallback. |
| I. Static export | Reject | Next's guide: static export means moving Server Actions to an external API [S1]. We want RSC and a BFF. |

---

## 4. Capability evidence for the PWA path

| Capability | What the sources say | Design consequence |
|---|---|---|
| **Install friction, Android** | Chrome installability: HTTPS, `short_name` or `name`, 192 px and 512 px icons, `start_url`, `display` standalone/fullscreen/minimal-ui [S11]. `beforeinstallprompt` custom prompt exists [S11]. | One tap on Chrome. Test on real low-end phones. |
| **Install friction, iOS** | No `beforeinstallprompt`; Next's guide shows a manual "Share, then Add to Home Screen" hint and "we do not recommend" relying on `beforeinstallprompt` as it is not cross-platform [S1]. | Ship an iOS instruction card. Treat iOS as best-effort (Android is about 81% of UAE mobile web traffic, StatCounter Oct 2026 [S36], population-level only). |
| **Web push, Android** | "All modern browsers" incl. Chromium [S1]. | Primary alert path on Android. |
| **Web push, iOS** | "iOS 16.4+ for applications installed to the home screen" [S1, lastUpdated 2026-07-30]; WebKit: "A web app that has been added to the Home Screen can request permission" and only "in response to direct user interaction" [S7]. Declarative Web Push (no service worker) arrived in iOS 18.4 for Home Screen web apps [S8]. | The requirement still stands today. Permission button must be a user gesture. I found no source that extends push to Safari tabs. |
| **Push sound** | `Notification` options list has `silent` and `vibrate` but no `sound` property [S12]. Next's SW example sets `vibrate` [S1]. | Cannot attach the pre-rendered clip to a push. Audio plays in-app only. |
| **Autoplay and audio** | Chrome: autoplay with sound allowed after a user interaction, and "on mobile, the user has added the site to their home screen"; `AudioContext` starts suspended until a gesture [S10]. WCAG 1.4.2: audio over 3 s needs a pause/stop/volume control [S52]. iOS Home Screen autoplay behaviour: **[UNVERIFIED]**. | Alert screen has a large Play button plus an autoplay attempt that degrades to the button. Pre-render AAC in MP4 (MDN: "AAC in an MP4 container is supported by all major browsers"; MP3 as fallback) [S57]. |
| **Offline** | Service worker + cache; Next.js ships an experimental `useOffline` hook and points to Serwist for full offline caching, with Turbopack and webpack examples [S1]. WebKit ITP deletes script-writable storage after 7 days without interaction but exempts Home Screen web apps [S9]. | iOS Safari-tab users lose offline data after a week; installed apps do not. |
| **Background sync for "I feel unwell"** | Background Sync API is "Limited availability", not Baseline [S13]. | Queue in IndexedDB and retry when the app is open/online; do not rely on background sync. Never claim it in the demo. |
| **Background reliability, cheap Android** | RFC 8030 defines `Urgency: high` for time-sensitive alerts [S16]. dontkillmyapp.com rates Xiaomi 5, Samsung 5, Oppo 4, Vivo 3, Tecno 3 (of 5) for killing background apps [S17]. That site is about native apps; its effect on Chrome web push is **[UNVERIFIED]**. | Send `Urgency: high`. Test on at least 2-3 real low-end phones on 12 Nov. "Cheap Android dominant" is itself **[UNVERIFIED]** for this population. |
| **Scheduled local alerts** | Notification Triggers: development ended [S15]. Periodic Background Sync: Chrome, installed, engagement-gated [S14]. | See 1.3. |
| **Store timelines** | Play: 12 testers x 14 days for new personal accounts [S44]. Apple: paid account needed for push credentials [S46]; enrolment complaints in developer forums [S47]. Expo free builds queue [S45]. | Not feasible by 20 Nov. |
| **Code sharing** | Zod schemas, API client, domain types via a workspace package. | Do not pursue React Native Web for the dashboards. |

---

## 5. Channels

### 5.1 Comparison and costs (UAE recipients, today)

| Channel | Unit cost | Reach and rules | Fits our content? | Demo role |
|---|---|---|---|---|
| **Web Push (PWA)** | No per-message fee; push endpoints are operated by Google/Apple/Mozilla | Needs install on iOS; Android Chrome standard [S1][S7] | Level code plus localised in-app text/audio; no sound in notification [S12] | **Live** |
| **WhatsApp Cloud API** | USD 0.0157 utility, 0.0576 marketing, 0.0157 authentication, 0.051 authentication-international, 0.0157 service; AED 0.0576 / 0.2115 / 0.0576 / 0.1872 / 0.0576 (list rates, effective 1 Oct 2026) [S22]. 1,000 free service messages per month per number [S21]. Utility messages sent inside an open service window stopped being free on 1 Oct 2026 [S21][S23]. Meta may change pricing only on 1 Jan / Apr / Jul / Oct [S21]. | Opt-in required: contact people only if they gave their number and "you have received opt-in permission" [S24]. Template review up to 24 h [S27]. Which category Meta assigns a heat alert (utility vs marketing, a 3.7x price gap) is **[UNVERIFIED]**. | Site/crew text yes; individual health info no [S24]; no Nepali template language [S25]; no audio in templates [S26] | **Spec + fake adapter** |
| **SMS (via Twilio list price)** | USD 0.1176 per segment (carrier fees may apply) [S31]. Segments for Arabic/Hindi/Urdu/Bengali/Nepali text: **[UNVERIFIED]**; check before costing. | Sender-ID pre-registration; health-related needs a UAE health-authority letter; no URLs; promotional blackout 21:00-07:00 [S30] | Short text only, no link | **Spec only** |
| **Voice call (IVR)** | USD 0.2995 per minute to UAE mobile, 0.3635 landline [S33] | International caller ID; outbound from UAE geographic numbers forbidden [S32]. WhatsApp calling restricted [S34]. | Good for low literacy; costly | **Spec only** |
| **Crew relay (supervisor)** | Zero marginal cost | Matches Delhi precedent (reps forward to WhatsApp groups, voice notes, colour boards) [S40]. Sharing mechanism from our dashboard (copy text/audio, Web Share): **[UNVERIFIED]**, spike. | Yes; plain-language bulletin plus audio plus colour card | **Live** |
| **Printed crew card / colour flag** | Print cost | Already the plan's last fallback (8.9) | Yes | **Live (print view)** |

**Illustrative arithmetic only** (my numbers on stated assumptions, not data):

| Scenario | Messages | WhatsApp utility at 0.0157 | SMS at 0.1176 |
|---|---|---|---|
| 10 sites x 5 crews x 4 crew-level alerts/day x 100 days | 20,000 | USD 314 | USD 2,352 |
| 2,000 workers x 4 individual alerts/day x 100 days | 800,000 | USD 12,560 | USD 94,080 |

Per-worker messaging scales badly on SMS; crew-level messaging keeps either channel cheap. Arithmetic assumes one segment per SMS and no volume-tier discount; the rate card has volume tiers that I did not apply [S22].

### 5.2 How real heat-safety products reach workers

| Product | What I could verify | Source quality |
|---|---|---|
| **Kenzen** | "sends multi-level alerts to workers through device vibration, iOS or Android app notification, and to supervisors through the web dashboard" (Aug 2021) [S41]. Deployed to 350 volunteers at Emirates Global Aluminium, UAE (Aug 2023) [S42]; the EGA article does not say how alerts reach people. Kenzen's own home page does not describe delivery or languages. | Trade press **[secondary]** |
| **SlateSafety BAND V2** | Band alerts with LED and vibration; connects over cellular without a paired phone; SMS exists at the platform level. | Distributor pages **[secondary]**, delivery to supervisors unclear |
| **OSHA-NIOSH Heat Safety Tool** | English and Spanish; computes heat index from phone location; I found no evidence it sends alerts. | **[secondary]** |
| **Delhi IMD / worker-union pilot** | WhatsApp groups plus voice notes plus colour boards; bulletins in English and Hindi [S40] | Journalism, specific and recent |
| **UAE / GCC** | I found no UAE heat product documented as using WhatsApp for worker alerts, and no GCC product documenting alert languages. Absence of evidence only. | n/a |

Pattern: wearables vibrate on the body and push to a supervisor dashboard; community programmes use WhatsApp groups and voice notes; none of the verified examples relies on workers installing a standalone web app. That supports the crew-relay feature in 1.2.

### 5.3 WhatsApp / phone penetration among UAE migrant workers: evidence gap

I found **no primary survey** of WhatsApp or smartphone use among UAE migrant workers. What exists:

- ILO 2021 (n=300 of 321 analysed respondents; Nepal, Sri Lanka, Philippines workers headed to or in Hong Kong SAR, Kuwait, Malaysia): "93.5 per cent" daily smartphone use. Respondents had to have a device **and** internet access, so this is selection-biased, and it is not UAE [S38]. A Sri Lankan focus-group worker in Kuwait: "smart phones, WhatsApp, Face Book and Viber facilities enable us to constantly be in touch" [S38].
- UAE general population: internet penetration 99.0% at end of 2025 [S37]. WhatsApp reach of "85.8 per cent" of 16-64 year olds is attributed to DataReportal/We Are Social Q3 2023 via Statista, reported by blogs **[secondary, stale]**; the DataReportal 2026 page I fetched does not mention WhatsApp [S37].
- Free internet inside labour accommodation is now mandated, per a Khaleej Times report of 30 Apr 2026 (no threshold or effective date given in the article) [S35]. This helps evening access, not on-site access.
- Qatar's labour ministry runs a 24-hour WhatsApp line for workers (GLMM 2019) [S39]: precedent in a neighbouring state, not evidence for the UAE.
- StatCounter UAE mobile OS share, Oct 2026: Android 80.69%, iOS 19.29% [S36]. It measures web traffic of the whole population, not low-wage workers, and says nothing about price tier.

**Action:** treat plan assumption A5 and "cheap Android dominant" as unverified. Ask the pilot employer or a labour-welfare NGO three questions: personal smartphone share, WhatsApp vs BOTIM/IMO/other usage, and whether phones are allowed on site. Record the answers in the technical document's assumptions section.

---

## 6. Demo scope vs adapter-only scope

### 6.1 Build for the demo (priority order; cut from the bottom)

1. **Walking skeleton, first (target 12 Nov, time-boxed 3 hours; plan section 7 currently schedules the web app on 17-18 Nov, so this pulls the riskiest slice forward):** Next.js 16.4.6 + Tailwind 4.3.5 + shadcn + next-intl with `ar` (RTL) and `en`; PWA manifest; **one real Web Push delivered to a real Android phone**, plus a `next build && next start` offline check. This is the riskiest integration and everything else depends on it.
2. **Worker PWA `/w`:** alert screen per level (colour + pictogram + short text + Play button for pre-rendered audio), "take a break now" prompt, large "I feel unwell" button with offline queue, 6 locales (en, ar, ur, hi, bn, ne), 48 h cached forecast + local rules, iOS install hint card.
3. **Supervisor `/s`:** crew risk timeline (Recharts), shift/break plan table, alert feed, **crew relay panel** (bulletin text, audio, printable card), "break things" fault panel (plan 6 item 7).
4. **HSE/regulator `/h`:** aggregate site view with small-cell suppression, compliance report view (print stylesheet; no PDF library).
5. **NotificationChannel port + WebPushChannel + InAppChannel + CrewRelayChannel + FakeChannel**, with a contract-test suite and an on-screen "channel inspector" that shows the exact payload each adapter would send (WhatsApp template JSON, SMS text) without sending it.
6. Quality gates from `frontend-discipline`: axe on every page/story, Playwright e2e for the three flows, four states per screen, WCAG 2.2 AA.

### 6.2 Adapter-only (specify, test against the fake, do not integrate)

| Adapter | Spec to write | Not built because |
|---|---|---|
| WhatsAppChannel | Template set per language with `ar_AE`, `hi`, `ur`, `bn`, `ml`, `fil`, `en`; documented Nepali gap (fall back to Hindi/English or Meta-supported alternative, native review); opt-in flow; "no individual health data" rule [S24]; category/cost model [S22] | Meta onboarding and review lead time, Nepali gap, policy question |
| SmsChannel | Sender-ID registration path (with the health-authority letter), no-URL constraint, 21:00-07:00 promotional window [S30] | Registration lead time |
| VoiceChannel | International-caller-ID constraint, per-minute cost, pre-rendered clips [S32][S33] | Cost and complexity |
| Native wrapper | Post-pilot decision record | Not feasible by 20 Nov |
| Site map | MapLibre 6.17.0 + `@vis.gl/react-maplibre` 8.1.3 if time allows; no basemap tile provider verified, so use a site-plan image or GeoJSON-only style with no external tiles (also offline-safe) | Should-have only |
| 3D heat view | Out of scope for this decision | Plan "should have" |

---

## 7. Versions (checked 2026-11-11 against the npm / PyPI registry)

Published dates are the registry `time` entry for the `latest` dist-tag unless noted.

| Package | Version | Published | Notes |
|---|---|---|---|
| Node.js | 24.22.2 (Krypton) | 2026-10-27 | Recommended runtime. dist index also lists 26.13.0 (Lithium, 2026-10-28) and 22.23.4 (Jod) with LTS codenames [S58]. Floors: Next 16.4.6 >=20.9; Vitest 5.1.0 `^22.12 || ^24 || >=26`; `@axe-core/playwright` 4.14.0 >=22.12 [S6]. |
| next | **16.4.6** | 2026-11-09 | peer react `^18.2 || ^19`; Turbopack default; `middleware.ts` renamed `proxy.ts` [S2]. |
| react / react-dom | **19.3.1** | 2026-10-14 | |
| typescript | **6.0.3 (pin)** | 2026-04-16 | npm `latest` is 7.0.2 (2026-07-08); not usable with typescript-eslint [S4][S5]. Optional: run 7.x under an npm alias for fast CI `tsc` only. |
| typescript-eslint | 8.72.2 | 2026-11-09 | peer `typescript >=4.8.4 <6.1.0`. |
| eslint | **9.39.5 (pin)** | 2026-07-10 | `latest` is 10.14.0 (2026-10-30), but `eslint-plugin-jsx-a11y` 6.10.2 peers `^9` at most. `eslint-config-next` 16.4.6 peers `eslint >=9`. |
| eslint-config-next | 16.4.6 | 2026-11-09 | bundles `eslint-plugin-jsx-a11y ^6.10.0`; `next lint` was removed in 16 [S2]. |
| tailwindcss | **4.3.5** | 2026-11-06 | `@tailwindcss/postcss` 4.3.5. |
| shadcn (CLI) | **4.23.0** | 2026-10-27 | Node >=20.18.1. RTL support since Jan 2026 [S48]. `@base-ui/react` 1.9.0 (2026-10-09). |
| next-intl | **4.14.10** | 2026-11-10 | peer includes `next ^16`; docs use `proxy.ts` ("`proxy.ts` was called `middleware.ts` up until Next.js 16") [S56]. |
| serwist / @serwist/turbopack | **9.5.13** | 2026-10-04 | peer next >=14, esbuild `>=0.25 <1`; `10.0.0-preview.14` exists. Docs: "Serwist 10 and newer will only support Next.js 15.0.0 and above" [S18]. `@serwist/next` 9.5.13 is the webpack plugin. |
| recharts | **3.10.1** | 2026-07-25 | shadcn `chart` is "Built using Recharts" and targets v3 [S49]. |
| echarts | 6.1.0 | 2026-05-19 | Not chosen. |
| @visx/xychart | 4.0.0 | 2026-06-11 | Not chosen. Lighter, more build effort. |
| maplibre-gl | **6.17.0** | 2026-11-07 | BSD-3-Clause. `@vis.gl/react-maplibre` 8.1.3 peers `maplibre-gl >=4.0.0`; its runtime compatibility with 6.x is **[UNVERIFIED]**, spike if the map is built. |
| @tanstack/react-query | **5.107.1** | 2026-11-06 | |
| zod | **4.6.7** | 2026-10-12 | |
| react-hook-form | 7.91.0 | 2026-10-23 | |
| zustand / nuqs / motion | 5.1.0 / 2.10.3 / 14.12.0 | 2026-11-06 / 11-10 / 11-10 | Per `frontend-discipline` stack. |
| @playwright/test | **1.65.0** | 2026-11-05 | |
| @axe-core/playwright / @axe-core/react | 4.14.0 / 4.14.0 | 2026-10-15 | |
| vitest | **5.1.0** | 2026-11-02 | peers vite `^6.4 || ^7 || ^8`. |
| storybook | 10.6.7 | 2026-11-10 | `frontend-discipline` text still says Storybook 9; update the skill. |
| pywebpush (PyPI) | 2.5.0 | 2026-08-30 | Requires Python >=3.10. |
| fastapi (PyPI) | 0.162.4 | 2026-11-10 | |
| web-push (npm) | 4.0.0 | 2026-11-06 | Reference only; we send from FastAPI. |
| expo / react-native | 58.0.23 / 0.88.1 | 2026-11-03 / 10-27 | Not adopted. |
| next-pwa / @ducanh2912/next-pwa | 5.6.0 / 10.2.9 | 2022-08-23 / 2024-09-18 | Rejected (unmaintained / superseded). |

**Compatibility gotchas**

1. **TypeScript 7 vs tooling.** Section 1.4. Pin 6.0.3. If you try 7, Next 16.4 uses the project-local `tsc` CLI and `experimental.useTypeScriptCli` is marked experimental ("its behavior may change") [S3].
2. **ESLint 10 vs jsx-a11y.** Pin ESLint 9.39.5 until the plugin publishes a release that allows 10.
3. **Turbopack default and webpack configs.** "If your project has a custom `webpack` configuration and you run `next build` ..., the build will fail" [S2]. A plugin that injects webpack config triggers it. Use `@serwist/turbopack`, whose docs serve the worker from `app/serwist/[path]/route.ts` at `/serwist/sw.js` and build `app/sw.ts` with esbuild [S18]. One Next.js 16 + Serwist template disables Serwist in dev because of Turbopack **[secondary, not official]**, so test offline against `next build && next start`.
4. **Serwist and Next 16.4.6 are only peer-range compatible.** The Serwist 9.5.12 release notes mention nothing about Next 16 [S19]. Day-1 spike; fallback is the 40-line hand-written push service worker from Next's own guide [S1] plus `--webpack` if needed.
5. **Windows dev machine.** Open Turbopack reports exist on Windows (for example vercel/next.js#86431 is Sass-specific, and not our stack) [S60]. Low confidence of impact; keep `next dev --webpack` as the escape hatch.
6. **proxy.ts.** The `edge` runtime is not supported in `proxy`; its runtime is `nodejs` [S2]. next-intl's routing runs there.
7. **Bundle weight vs the 170 KB route budget** (bundlephobia full-entry gzip, tree-shaking not applied, so upper bounds): recharts 149,877 B; echarts 367,958 B; @visx/xychart 50,282 B; maplibre-gl 296,691 B; zod 88,906 B; motion 63,271 B; @tanstack/react-query 13,344 B; next-intl 12,817 B; serwist 12,465 B [S55]. Charts and maps go in lazy supervisor/HSE routes only; the worker route group must stay chart-free.
8. **Fonts per locale** (below) are separate Google Fonts subsets; load per locale only.

---

## 8. Accessibility, i18n and fonts for low-literacy multilingual users

### 8.1 Guidance used

- **Text-free design.** Medhi, Sagar and Toyama (ITID 2007, vol. 4, no. 1, pp. 37-50) designed text-free interfaces with ethnographic work among illiterate domestic workers; "relies on liberal use of graphics and photographs for visual information, and voice for providing information normally provided via text"; results emphasised semi-abstracted graphics, voice feedback and a consistent help feature; text-free was strongly preferred. Read via abstract-level summaries **[secondary; check the paper for figures]** [S53].
- **WCAG 2.2 SC 3.1.5 Reading Level (AAA):** when text needs more than lower-secondary reading ability, supplemental content or a simpler version must exist; related techniques G79 "Providing a spoken version of the text" and G103 "Providing visual illustrations, pictures, and symbols" [S51].
- **WCAG 2.2 SC 1.4.2 Audio Control (A):** audio playing automatically for more than 3 seconds needs a pause/stop or volume control [S52].
- **Floor from `frontend-discipline`:** WCAG 2.2 AA, 24 px minimum target (SC 2.5.8 is listed as new at AA; I could not retrieve its exact text this session). For gloved, sweaty hands, plan far larger targets and test on device **[design judgement, not a cited number]**.
- **Do not rely on colour alone** (WCAG SC 1.4.1; not re-fetched this session): pair every level with a pictogram, a numeral and text.
- **Pre-rendered audio, not runtime LLM:** consistent with plan 8.6. Azure Neural TTS has voices for `ar-AE` (Fatima, Hamdan), `hi-IN`, `ur-PK` (Uzma, Asad), `bn-BD` (Nabanita, Pradeep), `ne-NP` (Hemkala, Sagar), `ml-IN`, `fil-PH` [S54]. The Nepali voices carry a footnote: phonemes, custom lexicon and visemes are not supported [S54], so mispronounced safety terms cannot be fixed with a lexicon; native review of every clip is mandatory. That UAE North serves these voices is still **[UNVERIFIED]** (plan E6).
- **Icons:** no UAE heat pictogram standard was researched. Test the pictograms with native-speaker workers before the pilot; claim nothing about comprehension in the demo.

### 8.2 Locale and font table (Google Fonts metadata fetched 2026-11-11 [S50])

| Locale | Script | Font | Last modified | Notes |
|---|---|---|---|---|
| ar | Arabic, RTL | Noto Sans Arabic (variable: wdth 62.5-100, wght 100-900) | 2025-09-17 | `ar_AE` is the WhatsApp variant [S25]. |
| ur | Arabic script, RTL | Noto Nastaliq Urdu (wght 400-700); fallback Noto Naskh Arabic (wght 400-700, 2026-01-28) | 2025-09-02 | Nastaliq needs generous line height and no fixed heights: community reports of clipping and overflow when body `line-height: 1.5` is applied [community reports, secondary]. The W3C Urdu layout note is retired ("MUST NOT be used for further technical work") and gives no Nastaliq-vs-Naskh preference [S59]. I found no readability study; native-speaker review decides. |
| hi | Devanagari | Noto Sans Devanagari | 2026-10-27 | Shared with Nepali. |
| ne | Devanagari | Noto Sans Devanagari | 2026-10-27 | Not a WhatsApp template language [S25]. |
| bn | Bengali | Noto Sans Bengali | 2026-01-28 | |
| ml (optional) | Malayalam | Noto Sans Malayalam | 2025-09-11 | `ml` is a WhatsApp template code [S25]. |
| fil (optional) | Latin | Noto Sans | 2025-09-11 | `fil` is the WhatsApp code; Tagalog is not its own entry [S25]. |
| en | Latin | Noto Sans | 2025-09-11 | |

Self-host fonts so the PWA works offline; confirm the `next/font` self-hosting configuration against the current docs before relying on it.

### 8.3 RTL implementation notes

- shadcn/ui: set `rtl: true` in `components.json`; physical classes (`ml-4`) become logical (`ms-4`); existing components need `migrate rtl`; for new projects the `--rtl` flag exists on `init`/`create`; flippable icons use `rtl:rotate-180` [S48]. One third-party guide reports the migration is not idempotent on repeat runs **[secondary]**, so run it once and diff.
- next-intl's getting-started guide does not show `dir`/`lang` handling [S56]. Set both on `<html>` from a static `{ar: 'rtl', ur: 'rtl'}` map. Do not use `Intl` direction helpers without checking support.
- Numerals: Western digits for safety-critical times and temperatures in all locales, until a native reviewer says otherwise **[design judgement]**.

---

## 9. Risks (ranked)

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Real push does not arrive reliably on target phones (OEM battery killers, iOS Home Screen requirement) | Med / High (demo centrepiece) | Day-1 spike on 2-3 real low-end Android phones; `Urgency: high`; in-app alert and crew relay as non-push fallbacks; record the demo video from a real device early. |
| R2 | Closed-app personal alerts impossible; conflicts with plan 8.8/8.9 and judges notice | High / High | Tiered alerts (1.3 option 1); write the ADR; say the limit openly in "limitations". |
| R3 | Judges or pilot partners read "WhatsApp channel" as ready; policy and language gaps surface in Q and A | Med / High (Responsible AI and commercial viability) | Label adapters "specified, not live-tested"; show the channel inspector; cite the policy line and the Nepali gap ourselves. |
| R4 | Tooling mismatch (TS 7, ESLint 10) breaks lint/a11y gates | High if unpinned / Med | Pin TS 6.0.3, ESLint 9.39.5, record why in the repo. |
| R5 | Serwist + Next 16 + Windows issues eat a day | Med / Med | 3-hour box; fallback hand-written SW and `--webpack`. |
| R6 | Language and audio quality for ur/ne/bn without native review; Nastaliq rendering bugs; RTL regressions after shadcn migration | High / Med | Status label per language (plan 8.6); Playwright visual snapshots for `ar` and `ur`; Naskh fallback. |
| R7 | Worker phone/WhatsApp penetration unknown | High / Med | Mark as assumption; add the three pilot-discovery questions (5.3). |
| R8 | Health data in outbound payloads (WhatsApp, SMS, push endpoints run by third parties) | Low if designed / Critical | Payload = level code + site id only; "unwell" flag only over our own HTTPS API; automated test asserting no individual field leaves via any adapter. |
| R9 | Scope vs 9 days solo | High / High | Cut order below. |
| R10 | Demo URL must stay up 20-30 Nov evaluation window | Med / High | Choose hosting with no sleeping tier; hosting choice not researched here **[UNVERIFIED]**. |

**Cut order if behind (UI platform items only; plan section 7 cuts apply first):** per-locale beyond en/ar/ur/hi/bn/ne, map, Recharts polish, HSE PDF-style report, iOS install card, crew-relay audio sharing. **Never cut:** real push to a real phone, six-language alert screen with audio, "I feel unwell" with offline queue, fake-channel contract tests, axe gates.

---

## 10. Unverified items and open questions

- Whether a crew/site-level heat alert counts as "health related information" under WhatsApp policy or UAE rules.
- Meta category assigned to heat alerts (utility vs marketing); Meta business verification lead time.
- SMS segment count for non-Latin scripts; Twilio volume pricing and carrier fees.
- iOS Home Screen web app autoplay behaviour; Web Share / copy-to-WhatsApp behaviour from the crew-relay panel.
- `@vis.gl/react-maplibre` 8.1.3 with `maplibre-gl` 6.17.0 at runtime; basemap tile source and its usage policy.
- Azure UAE North availability of the seven TTS voices (plan E6).
- Effect of OEM battery managers on Chrome web push for this phone mix.
- Real WhatsApp/BOTIM/IMO usage and phone-on-site rules for the pilot workforce.
- Hosting choice for the live demo URL.
- `frontend-discipline` skill text says Storybook 9 (now 10.6.7); control-plane update pending (living best practices).

---

## 11. Sources (all fetched 2026-11-11 unless noted)

| # | Source |
|---|---|
| S1 | Next.js, "How to build a PWA with Next.js", lastUpdated 2026-07-30: https://nextjs.org/docs/app/guides/progressive-web-apps |
| S2 | Next.js, "How to upgrade to version 16", lastUpdated 2026-11-06: https://nextjs.org/docs/app/guides/upgrading/version-16 |
| S3 | Next.js, TypeScript config, lastUpdated 2026-08-25: https://nextjs.org/docs/app/api-reference/config/typescript |
| S4 | Microsoft, "Announcing TypeScript 7.0" (2026-07-08): https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ |
| S5 | typescript-eslint issue #12518: https://github.com/typescript-eslint/typescript-eslint/issues/12518 |
| S6 | npm registry `latest` + `time` + peer/engines, queried 2026-11-11: https://registry.npmjs.org/ (per package); PyPI JSON for pywebpush and fastapi |
| S7 | WebKit, "Web Push for Web Apps on iOS and iPadOS" (2023-02-16): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| S8 | WebKit, "WebKit Features in Safari 18.4": https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ |
| S9 | WebKit, Tracking Prevention: https://webkit.org/tracking-prevention/ |
| S10 | Chrome, autoplay policy: https://developer.chrome.com/blog/autoplay |
| S11 | web.dev, install criteria: https://web.dev/articles/install-criteria |
| S12 | MDN, `Notification.silent` and option list: https://developer.mozilla.org/en-US/docs/Web/API/Notification/silent |
| S13 | MDN, Background Synchronization API: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API |
| S14 | MDN, Periodic Background Sync: https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API |
| S15 | Chrome, Notification Triggers (status banner): https://developer.chrome.com/docs/web-platform/notification-triggers |
| S16 | RFC 8030 section 5.3, Push Message Urgency: https://www.rfc-editor.org/rfc/rfc8030#section-5.3 |
| S17 | dontkillmyapp.com: https://dontkillmyapp.com/ |
| S18 | Serwist, Next.js with Turbopack: https://serwist.pages.dev/docs/next/turbo |
| S19 | Serwist releases: https://github.com/serwist/serwist/releases |
| S20 | `@ducanh2912/next-pwa` README: https://github.com/DuCanhGH/next-pwa |
| S21 | Meta, WhatsApp Business Platform pricing: https://developers.facebook.com/docs/whatsapp/pricing |
| S22 | Meta rate card, "Cost per message in USD ... effective October 1, 2026", sheet "List rates", UAE row (AED card same workbook family), downloaded from the signed links on S21 (links expire; re-download from S21): Marketing 0.0576, Utility 0.0157, Authentication 0.0157, Authentication-International 0.051, Service 0.0157 |
| S23 | Meta, updates to pricing: https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/ |
| S24 | WhatsApp Business Messaging Policy (last updated 2026-09-23): https://whatsappbusiness.com/policy/ |
| S25 | Meta, supported template languages: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages.md |
| S26 | Meta, template components (media header): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md |
| S27 | Meta, template review: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review.md |
| S28 | Meta, audio messages: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/audio-messages/ |
| S30 | Twilio, UAE SMS guidelines: https://www.twilio.com/en-us/guidelines/ae/sms |
| S31 | Twilio, UAE SMS pricing ("current as of October 2026"): https://www.twilio.com/en-us/sms/pricing/ae |
| S32 | Twilio, UAE voice guidelines: https://www.twilio.com/en-us/guidelines/ae/voice |
| S33 | Twilio, UAE voice pricing: https://www.twilio.com/en-us/voice/pricing/ae |
| S34 | Khaleej Times, WhatsApp calling restricted (2026-05-02): https://www.khaleejtimes.com/uae/whatsapp-in-uae-private-chats-not-exempt-from-laws-5-things-to-know |
| S35 | Khaleej Times, worker accommodation rules (2026-04-30, updated 2026-05-12): https://www.khaleejtimes.com/uae/new-uae-worker-accommodation-rules-explained |
| S36 | StatCounter, UAE mobile OS share (Oct 2026): https://gs.statcounter.com/os-market-share/mobile/united-arab-emirates |
| S37 | DataReportal, Digital 2026 UAE (2025-11-05): https://datareportal.com/reports/digital-2026-united-arab-emirates ; Digital 2025 UAE: https://datareportal.com/reports/digital-2025-united-arab-emirates |
| S38 | ILO, "Use of digital technology in the recruitment of migrant workers" (2021): https://www.ilo.org/sites/default/files/wcmsp5/groups/public/@ed_norm/@ipec/documents/publication/wcms_831814.pdf |
| S39 | GLMM Research Report 1/2019 (Qatar): https://gulfmigration.grc.net/media/pubs/rp/GLMM_EN_2019_RR01.pdf |
| S40 | Mongabay India, Delhi weather warnings (2025-07-22): https://india.mongabay.com/2025/07/how-informal-workers-made-weather-warnings-more-effective-this-summer/ |
| S41 | Verdict, Kenzen (2021-08-10): https://www.verdict.co.uk/kenzen-unveils-cloud-based-heat-monitoring-system-for-worker-safety/ |
| S42 | OHS Online, EGA (2023-08-14): https://ohsonline.com/articles/2023/08/14/emirates-global-aluminum-now-uses-wearable-safety-tech-to-combat-uae-heat.aspx |
| S43 | HRW Q&A (2023-12-03): https://www.hrw.org/news/2023/12/03/questions-and-answers-migrant-worker-abuses-uae-and-cop28 |
| S44 | Google Play Console Help, testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465 |
| S45 | Expo pricing: https://expo.dev/pricing |
| S46 | Expo, push notifications setup: https://docs.expo.dev/push-notifications/push-notifications-setup.md |
| S47 | Apple Developer Forums, enrolment delay threads (user reports, not Apple statements): https://developer.apple.com/forums/thread/822540 and https://developer.apple.com/forums/thread/835246 (surfaced by search; not individually fetched) |
| S48 | shadcn/ui, RTL changelog (Jan 2026): https://ui.shadcn.com/docs/changelog/2026-01-rtl |
| S49 | shadcn/ui, Chart: https://ui.shadcn.com/docs/components/chart |
| S50 | Google Fonts metadata: https://fonts.google.com/metadata/fonts |
| S51 | W3C, Understanding SC 3.1.5: https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html |
| S52 | W3C, WCAG 2.2 (SC 1.4.2): https://www.w3.org/TR/WCAG22/ |
| S53 | Medhi, Sagar, Toyama, ITID 2007 (summaries): https://www.microsoft.com/en-us/research/?p=160568 and https://courses.cs.washington.edu/courses/cse490c/18au/readings/medhi-2007.pdf |
| S54 | Microsoft, Azure Speech language support (TTS table): https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts |
| S55 | bundlephobia API (full-entry sizes): https://bundlephobia.com/api/size?package=<pkg>@<version> |
| S56 | next-intl docs, proxy and getting started: https://next-intl.dev/docs/routing/middleware ; https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing |
| S57 | MDN, Web audio codec guide: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs |
| S58 | Node.js release index: https://nodejs.org/dist/index.json |
| S59 | W3C, Urdu Layout Requirements (retired note): https://www.w3.org/TR/arab-ur-lreq/ |
| S60 | vercel/next.js issue #86431 (Turbopack on Windows, Sass): https://github.com/vercel/next.js/issues/86431 |
| S61 | PyPI, pywebpush 2.5.0: https://pypi.org/project/pywebpush/ |

Notes on source handling: S22 was parsed from Meta's downloadable rate-card workbook (the files are `.csv` links that are actually `.xlsx`); the UAE row and column header were read directly, not from a summary. The W3C Urdu layout requirements page (https://www.w3.org/TR/arab-ur-lreq/) was fetched and is retired; it gave no Nastaliq/Naskh preference. Items tagged **[secondary]** come from search-result summaries or trade articles I could not trace to a primary source in this session.
