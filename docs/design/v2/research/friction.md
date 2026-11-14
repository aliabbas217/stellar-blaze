# Friction research for v2: onboarding, install, offline, voice, glare, pictograms, RTL, supervisor glance, judge path, and near-zero-friction agents

**Date:** 2026-11-11 (prototype due 2026-11-20). **Author role:** UX researcher. **Status:** research only; nothing here is built or tested with a worker, supervisor or judge.
**Inputs read first:** ADR 0003, 0004, 0006, 0010 (§8), 0011, 0015, 0031, 0034; `docs/research/2026-11-11-frontend-platform.md` (cited below as **FP**, its sources as FP-S#); `2026-11-11-judges-and-wow-moment.md` (**Judges**); the v1 UX docs `ux/01-04`; `DESIGN.md`; `critique/README.md`; `frontend/messages/*.json`.
**Method:** every number below was taken from a page, PDF or measurement I read or ran today unless it is tagged otherwise. Tags on every claim:

- **[primary]** read from the standard, spec, vendor doc, paper or dataset itself (fetched or measured this session).
- **[secondary]** from a search-result summary, a trade article, a mirror, or a page I could not fetch. Treat as a lead, not a fact.
- **[inference]** my reasoning or arithmetic from the above, with the assumptions stated.

Source IDs `[R#]` are in section 14. Where a fetch was blocked (HTTP 403/404) I say so and do not upgrade the claim.

---

## 0. Where the evidence corrects the brief, the prior research, or v1

Read these first. Each changes a v2 decision.

| # | Premise (source) | What the evidence says | v2 consequence |
|---|---|---|---|
| C1 | The brief says the six languages may be "ml/ta or similar". | The project's six are **en, ar, ur, hi, bn, ne** (`frontend/messages/`: `en ar bn hi ne ur`). Malayalam and Tamil are not in the set. FP §8.2 lists `ml` only as optional. No data in the repo shows which languages the target workforce speaks (FP §5.3: no primary survey). | Keep the six. Make the locale list a registry (config), so adding `ml`, `ta`, `ps`, `fil`, `si` is a content task, not code. Add a language census to the pilot discovery questions. [inference] |
| C2 | "One-tap install" (brief). | `beforeinstallprompt` exists only in Chromium browsers and Samsung Internet 5.0+; Safari and Firefox: `version_added: false`; the feature is flagged `experimental: true, standard_track: false` [R5, primary]. On iOS there is no install prompt at all. | "One tap" is true on Android Chrome only. iOS is a 3-step manual path. Do **not** gate onboarding on install (see §3). |
| C3 | On Android, push requires install (implied by "install first" flows). | FP §4 [FP-S1]: Web Push works in Chromium without install; only iOS requires a Home Screen web app. | On Android ask for push **before** offering install. Install becomes an upgrade (icon, offline reliability), not a prerequisite. [secondary: re-used FP source, not re-fetched] |
| C4 | "iOS 16.4+ Web Push only for installed PWAs" (brief). | Still the published rule: WebKit's push post says Web Push is added "to Home Screen web apps" and permission needs "direct user interaction" [R3, primary]. Safari 26 made **every** Home Screen site open as a web app by default and says "there are now zero requirements for 'installability'" [R1, primary]. I read the WebKit feature posts for Safari 27.0 (two fetch passes covering the whole page), 27.1 and 27.2 for push, notification, Home Screen and installability changes and found none (27.0: one `Notification` URL-parser fix) [R2, primary absence, through the fetch tool's summariser]. | The rule still holds as far as published WebKit notes show. Verify on a real iPhone on iOS 27 before 13 Nov; do not assume. |
| C5 | ISO 9186 criterion "≥ 66.7% / 85%" (brief). | The free ISO 9186-1:**2007** sample I read has **no pass/fail percentage**. It defines the method (≥ 50 respondents per country, response categories 1, 2a, 2b, 3, 4, with 2b = opposite meaning listed separately) and says the body that adopts a symbol "lay[s] down the score" (Note 4) [R14, primary]. 85% correct with ≤ 5% critical confusion is the ANSI figure, quoted from a draft-stage ANSI standard in the IIID protocol [R15, primary for what that document says]. 67% is widely attributed to ISO acceptance in the papers I found; I could not confirm it from the ISO text [secondary]. | Use **85% correct and ≤ 5% critical confusion** for any safety meaning (stricter, and the one I can trace). Cite 66.7% as "commonly attributed to ISO, unverified". |
| C6 | FP §8.3: "Western digits for safety-critical times and temperatures in all locales". | Measured with Node 24.15.0, ICU 78.2, CLDR 48: default numbering system is **latn** for `ar`, `ar-AE`, `ur`, `hi`, **beng** for `bn`, **deva** for `ne` [R28, primary measurement]. So Western digits everywhere is a deliberate **override** for `bn` and `ne` only; it is already CLDR's default for ar, ur, hi. | Keep Western digits for times and temperatures, but record it as an override, make it a per-locale setting, and put "digits" on the native-review checklist for bn and ne. |
| C7 | v1 W5 copy: "an anonymous alert subscription for the site". | A Web Push subscription is a per-device endpoint URL plus keys stored against a site or crew. That is a **pseudonymous** device identifier, not anonymous. [inference; no legal text read] | Say "pseudonymous" in My data. Store site/crew id plus endpoint only; delete on unsubscribe. |
| C8 | v1 "phone-with-cross" pictogram for "I feel unwell". | A handset with a cross can be read as a "no phones" prohibition (ISO prohibition = red circle with bar) or as a cancel mark, instead of "call for medical help". [inference] ISO 9186-1 §6.6 treats an opposite reading (category 2b) as the most important error for safety signs [R14, primary]. | The "unwell" pictogram must be tested for the specific critical confusion "no phones". Prefer the ISO 7010 safe-condition grammar (E004 emergency telephone, E003 first aid; §6). |
| C9 | The brief: "acclimatisation inferred from the worker's start date (NIOSH schedule) rather than asked". | NIOSH distinguishes **new** workers (≤ 20% on day 1, +20% a day) from **experienced** workers (50%, 60%, 80%, 100% on days 1-4), and says a week or more away can mean "significant loss" [R17, primary]. A start date tells you days since start. It cannot tell new from experienced, and it cannot see days away. ADR 0011 P-H8 encodes both distinctions [project]. | Infer what a date can give (day count), ask the two things it cannot with **one tap each**, and default to the protective answer ("new", "away unknown") when unanswered (§11.5). |
| C10 | v1 offline: banner after 3 h, fallback after 48 h. | The 3 h and 48 h thresholds have no stated derivation. [inference from reading `ux/02` F-W3] ADR 0010 rule: tunables derive from data. | Make both ruleset tunables (class b), with defaults derived from the forecast refresh cadence once B2 states it. |
| C11 | v1 story mode idea: "scroll-driven or stepper" (brief). | CSS scroll-driven animations (`animation-timeline`) are in Chrome 115, Safari 26 and Firefox 159 per MDN's browser-compat data [R26, primary]. They are feasible, but a stepper with a URL per step is deterministic, keyboard-operable and deep-linkable. | Stepper is primary, scroll-linking an enhancement (§10). |
| C12 | Brief and Ali's scope addition: "voice input/output" for workers. | Browser speech recognition by default sends audio to a web service [R10, primary]; a worker speaking about symptoms would send health speech to a third party. One tap already replaces typing for "I feel unwell". | **Voice output yes, worker voice input no** in v2 (§5, §11). Supervisor dictation only with on-device recognition. |
| C13 | Ali's scope addition: "agents fill CONFIG only; never compute a warning or a plan". | Workload class (light, moderate, heavy) is a direct input to REL/RAL (M in watts, ADR 0006) and to the 20/40 and 45/15 cycles (ADR 0011). A model that picks it influences the plan. | Compatible only if the model proposes a **closed-enum task** and deterministic ruleset code derives the workload class, defaulting to heavy when unknown, and a human confirms (§11). The ADR 0015 slogan "no LLM touches a warning or a plan" needs rewording (§11.7). |

---

## 1. Summary of the recommended flows

- **Worker:** scan, see today's level (zero fields), optionally two taps to personalise, one tap to enable warnings.
- **Supervisor:** one sentence or a few taps; a preview card with every field pre-filled and labelled "you said / default / from your phone"; one confirm.
- **Judge:** one click from `/` to the scoreboard on its final frame; story stepper with a URL per step; works with the API down.

---

## 2. Worker onboarding without accounts

### Findings

1. **Real products mostly onboard by scanning a site code into a browser form, and the "no account" claim is only clearly documented for one.** Construction sign-in and induction products (HammerTech's help article is titled "Worker Registration and Induction No Login Required"; SiteBook, SaferMe and Online Induction describe scanning a site QR code that opens a web form, with no app) [secondary: search summaries; HammerTech and Online Induction pages returned 403, SaferMe's help page 404] [R30]. The pattern is "site QR to browser, no app". What the worker then enters (name, phone, ID) varies and I could not confirm it.
2. **Samsara's Driver App is an account product, not a model for us.** Drivers receive a Fleet ID, username and password from an administrator; a QR sign-in link exists only if the admin enables it, and (per the search summary) stays valid up to 30 days [secondary: KB article returned 403] [R30]. The driver reference-card PDF returned image data only. So Samsara is a counter-example: identity first.
3. **The best-documented heat-alert reach to low-literacy workers is not an app flow at all** (Delhi: WhatsApp groups via worker representatives, voice notes, colour boards) [FP-S40, secondary journalism]. Our supervisor relay (ADR 0004 §3) is the matching feature.
4. **Almost everything can be done before any personal data.** Under ADR 0004, Tier A is a site/crew level code (not personal) and Tier B is computed on the phone from a locally held profile and never sent. So site level, crew level, the 15-hour forecast band, audio, the "unwell" screen and the push subscription need no name, phone number or ID. [project, primary] The only server-held item is the push endpoint, which is pseudonymous (C7).
5. **Browser APIs reinforce zero-field defaults.** `navigator.languages` is an ordered preference list, but Safari always lists only one language and Chrome incognito likewise [R12, primary]. Geolocation needs a secure context and an explicit permission prompt on first call [R11, primary]. So language and location are good *defaults* and bad *requirements*.
6. **Consent.** UAE PDPL commentary says consent is the default basis, that silence, inactivity and pre-ticked boxes are not valid consent, and that health data is largely carved out to the ICT Health Law (Federal Law No. 2 of 2019) [secondary: law-firm summaries; the official text on uaelegislation.gov.ae returned 403] [R31]. ADR 0011 §7 already records a different basis for planner data ("employment/contract, not consent") [project]. For on-device-only data the legal question may not arise at all. [inference] Needs legal review before any claim.

### Recommendation: a 3-step flow (worker)

| Step | What happens | Taps | Personal data |
|---|---|---|---|
| 1. **Scan** | Site QR (or link in the crew's WhatsApp group) opens `/w/join?s=<site>&c=<crew>`; lands directly on Today showing the **site** level for the next 15 hours, in the language chosen by: crew language set by the supervisor, else `navigator.languages` nearest of the six, else English. A row of six language chips (endonyms) sits in the first fold. Audio and "I feel unwell" are already available. | 0 | none |
| 2. **Personalise (optional, skippable)** | One screen: work type as three pictogram tiles (light, moderate, heavy), then "How long have you worked in this heat?" as four chips (today, this week, 1-2 weeks, longer or not sure) and "Worked outdoors in a UAE summer before?" yes/no. One line plus audio: "This stays on this phone." Stored on device only. | 2-3 | on-device only |
| 3. **Enable warnings** | Big button. Android Chrome: tap triggers the push permission prompt (not on load), then offers install (captured `beforeinstallprompt`). iOS Safari: instruction card (Share, Add to Home Screen, open from Home Screen) then a permission button inside the installed app. | 1 (+ OS prompt) | pseudonymous push endpoint |

- The QR code is a **capability for site/crew alerts, not an identity.** A leaked poster photo lets an outsider subscribe to non-personal alerts; mitigation: crew codes are rotatable by the supervisor and subscription is rate-limited. [inference]
- Consent UI: replace the v1 consent checkbox with a one-tap acknowledgement of "what stays on this phone / what the server keeps", with audio and a pictogram, plus the existing "Remove my data" path (v1 W5). Whether a checkbox is legally required is open (§13).

---

## 3. One-tap install (Android Chrome, iOS Safari), state at 2026-11-11

### Findings

1. **Android Chromium.** `beforeinstallprompt` fires when the PWA meets installation criteria; calling `prompt()` shows a modal install dialog **once per saved event**; `appinstalled` fires "no matter what mechanism is used" [R6, primary]. Support: Chrome 44+, Samsung Internet 5.0+; not Firefox, not Safari [R5, primary]. Treat it as progressive enhancement.
2. **A newer API is in trial, not dependable.** The HTML `<install>` element and Web Install API are in a Chrome/Edge origin trial "versions 148 through 153" (blog dated 12 May 2026) [R4, primary]. Chrome's 4-week cadence puts 153 around late September to October 2026, so the trial has probably ended or been extended; I could not confirm which. [inference] Do not depend on it.
3. **iOS.** No `beforeinstallprompt` (Safari `version_added: false`) [R5]. Safari 26: "every website added to the Home Screen opens as a web app", "zero requirements for installability" [R1]. The Home Screen add is still a manual Share-sheet action. Push permission must be requested "in response to direct user interaction" from the installed web app [R3]. I found no WebKit 27.x note changing this (C4).
4. **iOS storage.** WebKit exempts Home Screen web apps from the 7-day cap on script-writable storage [R7, primary]. MDN's eviction page states the 7-day rule but does not mention the exemption [R8, primary], so cite WebKit for it. Safari-tab visitors lose cached data after 7 days of no interaction.
5. **Reality check.** Android is about 81% of UAE mobile web traffic (StatCounter Oct 2026) for the whole population, not low-wage workers [FP-S36, secondary]. No data exists on this workforce's phones (FP §5.3). In-app browsers (links opened from WhatsApp or Facebook) may not offer install or push; I did not test this. [inference, test on device]

### Recommendation

- **Order on Android:** push permission first (one tap), install offered second (one tap), never blocking. Capture the event, `preventDefault()` the mini-infobar, show our own button in the language chosen, call `prompt()` once per event, listen for `appinstalled` [R6].
- **iOS card:** three numbered pictograms plus audio (Share icon, "Add to Home Screen", "Open from the new icon"), shown only when not in standalone mode (`navigator.standalone` or `display-mode: standalone`) [R6 uses `navigator.standalone`]. After install, the first screen inside the app carries the permission button.
- **Detect in-app browsers** and show one "Open in Chrome / Safari" screen with a copy-link button. Heuristic user-agent matching is fragile; log how often it fires. [inference]
- **Test matrix (one afternoon, 12 Nov):** one real low-end Android, one real iPhone on iOS 27: scan QR in the camera app, scan from inside WhatsApp, install, grant push, airplane-mode reopen. The FP 3-hour push spike already schedules this phone time.

---

## 4. Offline: today's plan and the "I feel unwell" screen

### Findings

1. **Cache eviction is the real offline risk on cheap phones.** Browser storage is best-effort by default and the least-recently-used origin is evicted first under storage pressure, deleting all of an origin's data at once; `navigator.storage.persist()` exempts it; Safari and Chromium decide the request silently from interaction history, with no prompt [R8, primary]. A 32 GB phone full of media is the likely case. [inference]
2. **Background sync is not claimed** (ADR 0004; FP-S13 not Baseline). The unwell *message* is queued in IndexedDB and retried while the app is open.
3. **The unwell screen needs no network.** `tel:` links work offline (v1 F-W4). What must be precached: the route, the chosen language's font subset, the call buttons, the three steps, their audio.
4. **Audio size is small.** A 3-5 s mono clip at about 24 kbps is roughly 9-15 KB; about 25 phrases per language is about 0.25-0.4 MB per language, about 2 MB for all six. [inference arithmetic; MDN notes AAC-in-MP4 is supported by all major browsers, FP-S57]
5. **No primary standard exists for stale-data labels.** I found no authoritative guideline; the v1 rule (banner when old, fallback plan when expired) is sound in structure but its thresholds are un-derived (C10).

### Recommendation

- Precache per chosen locale only (font subset + 25 audio clips) at install and at first language change; precache `/w`, `/w/unwell`, and the last forecast JSON. Test with `next build && next start` (ADR 0003).
- Call `navigator.storage.persist()` after install or after push permission; display the result on My data ("Offline copy protected: yes/no"). If "no", say so in plain language and re-ask on the next install event.
- **Stale label spec:** shows absolute time ("Updated 09:40") **and** age ("3 h ago") plus a clock pictogram, in the worker's language and digits per C6; never colour alone. A stale level is never rendered as the live level: it reads "Last known level" with the hatch overlay of the fallback plan. At expiry the hero becomes the fallback plan (never less protective than the ban, ADR 0011).
- Thresholds are ruleset tunables with ranges (ADR 0010 §4); defaults set from the forecast refresh cadence, not from the current 3 h and 48 h.

---

## 5. Voice-first alerts

### Findings

1. **Audio demonstrably helps non-literate users, in small studies.** Medhi, Sagar and Toyama (ITID 2007) built text-free UIs with ethnographic work among illiterate and semi-literate domestic workers in Bangalore slums. Text-based versions: "participants were totally unable to make any sense of the text-based user interfaces for either application"; no individual or group could navigate them (0% completion). Text-free variants (with and without a help feature): individual completion averaged 50% and 75% and both groups of five completed, though the extracted table does not let me say which variant is which. The help feature shortened task time and was "a constant source of reassurance". Voice feedback in their own language delighted users; the authors say the voice guideline must be "zealously applied". The authors also state "These numbers are admittedly small, and the quantitative results do not achieve statistical significance" (4 individuals and 2 groups of 5 for job search, 3 individuals for the map) [R13, primary]. Population: women domestic workers in India, 2007: not male UAE construction migrants. [inference on transfer]
2. **Delhi 2025:** workers valued "the option to listen" via WhatsApp voice notes [FP-S40, secondary].
3. **TTS quality across our four non-English, non-Arabic languages is unmeasured.** My search found no study ranking neural TTS for Urdu, Hindi, Bengali and Nepali on one scale; the closest are per-language papers and an Indic pairwise-preference study (not read) [secondary: search summary]. FP §8.1 [FP-S54]: Azure has voices for ar-AE, hi-IN, ur-PK, bn-BD, ne-NP, with the Nepali voices carrying a footnote that phonemes, custom lexicon and visemes are unsupported, so mispronounced safety terms cannot be fixed.
4. **The content is a closed set.** Four level statements, three action lines per level, three unwell steps, one stale notice: about 25 phrases per language, 150 clips for six. [inference from `ux/02` and DESIGN.md]
5. **Autoplay.** Playback of media with audio "is generally blocked if programmatically initiated in a tab which has not yet had any user interaction"; the rules vary by browser [R9, primary]. A notification cannot carry the clip (no `sound` option; `vibrate` and `silent` exist, FP-S12). Whether a tap on a notification counts as user activation for the opened page is **unverified**. iOS Home Screen autoplay behaviour is **unverified** (FP §10).
6. **Site noise.** I could not retrieve a primary source for construction-site noise levels (the NIOSH construction-noise page returned 404) or phone loudspeaker output. Whether a phone speaker is audible next to a concrete pump is unmeasured. [inference: treat as unreliable until measured]

### Recommendation

- **Human-recorded clips for the closed set**, one native speaker per language, about 3 minutes of speech per language, with a status label per clip (recorded, TTS draft, native-reviewed) and the date. TTS is allowed only as a labelled draft and for non-safety explanations. Reason: the set is small enough to record, and Nepali TTS errors cannot be patched. [inference]
- **Never audio-only.** Every clip is paired with text, pictogram and vibration (`navigator.vibrate` where supported, `vibrate` in the push). On arrival: attempt playback; on failure show a 56 px Play button in the first fold. After the first tap in a session, later clips may autoplay under the "user has interacted" rule [R9].
- **Controls:** pause/stop and volume for any clip > 3 s (WCAG 1.4.2, FP-S52).
- **Measure on site:** a 20-minute test before the pilot: play the Urdu level clip from two target phones next to recorded site noise at 1 m, record the dB. Until then the crew-relay path (supervisor reads the card aloud, plays on a speaker) is the audio that matters outdoors.
- **Worker voice input: none in v2** (C12). Supervisor dictation is covered in §11 (on-device recognition only).

---

## 6. Glanceability in direct sun (and an "adult, serious" direction)

### Findings

1. **Phone screens are mirrors; the metric is peak luminance over reflectance.** DisplayMate defines the contrast rating for high ambient light as peak brightness divided by average screen reflectance, tests at 0 to 40,000 lux, lists direct sunlight at 120,000 lux, reports 20,000 lux as "barely visible" and 40,000 as "almost invisible" for the phones tested, and notes automatic brightness lowers brightness below 5,000 lux. Measured phones: peak 234-541 cd/m² and reflectance 4.4-15.5% (iPhone 4, HTC Desire, Droid X, Galaxy S) [R23, primary; the phones are 2010-2011 models, so the numbers are a lower bound for today].
2. **Positive polarity (dark text on a light ground) is supported empirically.** Buchner and Baumgartner (Ergonomics 50(7), 2007): dark-on-light text gave better proofreading performance than light-on-dark in both darkness and ordinary lighting, with black-white and blue-yellow schemes [secondary: abstract via a search summary; I could not fetch the paper]. v1 cites Piepenbrock et al. 2014 and a 2017 *Applied Ergonomics* glance-reading paper at summary level [v1 `DESIGN.md` §1.6]; my PubMed fetch for the 2017 paper failed, so I do not re-assert it.
3. **WCAG nominal ratios are measured in the dark; sunlight changes them.** WCAG 1.4.3: 4.5:1, and 3:1 for large text (≥ 18 pt or 14 pt bold) [R21, primary]. It says nothing about ambient light.
4. **My glare model** [inference; assumptions in the table caption]. Effective contrast = (L₁ + L_r)/(L₂ + L_r), with L = Lpeak × relative luminance (+ black floor) and veiling luminance L_r = R × E / π (diffuse reflection of ambient illuminance E). Colours are the v1 tokens; nominal ratios match v1's measured table (17.80, 7.94, 7.37, 3.69, 6.63, 10.82, 6.78, 5.18, 6.16, 1.65, 2.63), which checks my luminance maths against `critique/contrast.mjs`.

| Pair (v1 light tokens) | Nominal | Low-end LCD, 5k lx | Low-end LCD, 20k lx | OLED flagship, 5k lx | OLED flagship, 20k lx |
|---|---|---|---|---|---|
| ink on surface | 17.80 | 4.54 | 1.90 | 11.91 | 3.85 |
| ink-muted on surface | 7.94 | 3.60 | 1.78 | 6.60 | 3.18 |
| white on red fill | 6.63 | 3.45 | 1.79 | 5.74 | 3.09 |
| ink on amber fill | 10.82 | 3.07 | 1.53 | 7.38 | 2.67 |
| ink on orange fill | 6.78 | 2.22 | 1.31 | 4.75 | 1.98 |
| control edge on surface | 3.69 | 2.52 | 1.58 | 3.42 | 2.34 |
| amber fill on surface | 1.65 | 1.48 | 1.25 | 1.61 | 1.44 |

Assumed phones: low-end LCD 500 cd/m² peak, 8% reflectance, 0.4 cd/m² black; OLED 1000 cd/m², 5%, 0 black. These are **my assumptions**, not measurements of the target phones. At 100,000 lux every pair falls below 1.6:1 on both phones.
   **What the table says:** (a) ranking of pairs is preserved, so ink on surface stays best; (b) the margin between ink and ink-muted shrinks in glare, so muted is only safe for non-actionable text; (c) amber and orange fills lose their edge against the page (1.25-1.94 at 20k lx), so the 2 px sign rim and numeral plate carry level identity, which v1 R1 already does; (d) at the extreme, size, weight and simplicity matter more than any palette choice, so the worker route must lean on large simple shapes plus non-visual channels. The model cannot show the polarity advantage (it is symmetric in L₁ and L₂); that advantage is empirical (finding 2).
5. **Text size from visual angle.** The CSS reference pixel subtends about 0.0213° (about 1.28 arcmin) [R22, primary]; user agents are meant to keep that angle at the device's intended distance. Taking cap height ≈ 0.7 em [inference; typical, not measured] and a target cap angle of 20 arcmin (a figure I recall from automotive display practice; I could not read ISO 15008's text, so it is a design target, not a cited threshold), font size ≈ 22 px at the intended viewing distance. v1 body is 16 px (cap ≈ 14-15 arcmin).
   For the supervisor relay screen, a 3 m claim: if the tablet's intended distance is 450-711 mm, a 96 px (5.96rem) numeral subtends about 13-21 arcmin at 3 m, which is borderline. [inference]
6. **No primary study on weight versus glare.** Reasoning from finding 4: strokes thinner than a pixel lose local contrast through anti-aliasing, and Nastaliq has very high stroke contrast between thick and hairline strokes. [inference]
7. **Pictograms and child-likeness.** Medhi found "semiabstract cartoons and more photorealistic graphics" recognised "much better than complex abstract graphics", and that actions need visible action cues (water running from a faucet, steam from a kettle) or are read as static objects [R13, primary]. So the cure for "childish" is not more abstraction; it is **ISO 7010 grammar** (solid silhouettes, no faces) with one concrete action cue.

### Recommendation: what this means for an adult, serious direction

- **Keep:** the Arish Signal direction (flat fills, 2 px corners, Barlow Condensed numerals, sign rim) already reads as signage, not toys. The worker route's positive polarity (R2) stays; the evidence is empirical, not from my model.
- **Text pairs:** on the worker route every text a worker must act on uses **ink on surface or ink on raised surface only**; ink-muted is for metadata (timestamps, source line). No pair under 7:1 nominal for action text.
- **Weight:** minimum 500 (Noto Sans family and Barlow), 600 for Noto Nastaliq Urdu action text (the family spans 400-700, FP §8.2); no weight below 500 on the worker route. [inference]
- **Sizes (worker route):** floor 18 px for any text; action lines 22 px; level numeral ≥ 76 px (existing `numeral` 4.768rem); relay-mode numeral ≥ 9rem if "readable at 3 m" is claimed, else claim 1.5 m. A walk-back test (3 m, shade, the real tablet) decides.
- **Level identity** never rests on hue: hatch, numeral on a plate, word, pictogram, rim (existing). Keep the numeral plate ink-on-light in every level.
- **Targets:** 24 px is the WCAG 2.5.8 minimum (exceptions: spacing, equivalent, inline, user-agent, essential); 2.5.5 uses 44 px [R21, primary]. Worker route keeps 48 px, and 56 px for Play and unwell.
- **Cupping the phone.** A worker's practical glare control is shading the screen with a hand; none of this removes that need. A short first-run hint ("If the screen is hard to read, shade it with your hand") is cheap and testable. [inference]

---

## 7. Low literacy: adult pictograms and comprehension evidence

### Findings

1. **Conventions.** ISO 7010 uses five shape-and-colour classes: prohibition (red circle with bar), mandatory action (blue circle), warning (yellow triangle), safe condition (green square), fire (red square), with code prefixes P, M, W, E, F; current edition 2019 [secondary: Wikipedia; ISO OBP not fetched] [R29]. ISO 3864-1 governs colours and geometry; if no symbol exists, the guidance is to use the general sign (M001, P001, W001) with supplementary text [secondary: Wikipedia citing ISO 3864-2:2016] [R29].
2. **Relevant existing signs** [secondary, Wikipedia list; verify in the ISO OBP]: E003 first aid, E004 emergency telephone, E007 assembly point, E015 drinking water, M014 head protection. **No ISO 7010 sign exists** for "rest in shade", "heat level" or "drink now" (instruction): E015 means "drinking water is available here", not "you must drink". [inference: absence in the list I read]
3. **Cultural variant is built in.** ISO 7010 states a first-aid cross "may be replaced with another element appropriate to cultural requirements", with the crescent as the example for many Muslim-majority countries [secondary: Wikipedia quoting ISO] [R29].
4. **Comprehension testing method (ISO 9186-1:2007):** ≥ 50 respondents per country; respondents must be "a representative sample of the eventual user population", with attention to vulnerable groups for safety symbols; five response categories; category 2b (opposite meaning) recorded separately; a categoriser who is neither respondent nor submitter [R14, primary]. Thresholds are set by the adopting body (C5): ANSI 85% correct, ≤ 5% critical confusion [R15].
5. **What happens when real images are tested on migrant workers.** Hare et al. (2013) tested pictorial hazard and control images on 50 migrant construction workers in the UK against an 85% threshold: **23 images failed** and were revised and retested; European-origin participants identified more images correctly than African- and Indian-origin participants; workers with under 5 years' experience scored lower; conclusion: pictorial aids convey simple hazards, cultural differences distort understanding, images should "add to existing communication methods, not replace them" [R16, primary abstract]. UK sample, not Gulf.
6. **No Gulf or UAE ISO 7010 comprehension study for South Asian workers found.** I searched for one and found none. A Qatar medicine-label study (pictograms plus verbal explanation outperformed pictogram-only for low-literacy migrants) is adjacent [secondary: search summary]. A 2024 *Buildings* study of 513 construction workers reportedly found text-only signs imposed lower cognitive load than pictogram signs, with recall dropping beyond nine items [secondary: search summary; the page returned 403]. Direction: do not stack pictograms.
7. **Culture and direction.** Medhi found that, probably because Urdu is written right to left, Muslim participants read time as flowing right to left, so a start-to-end schedule needed an explicit arrow between the clock faces [R13, primary]. Also "radical" icon errors: a hut read as a village home rather than an apartment.
8. **Emoji and faces are unstable.** Miller et al. (ICWSM 2016): when people saw the same rendering they disagreed on sentiment about a quarter of the time, and more across platforms; one glyph read "blissfully happy" on one platform and "ready to fight" on another [secondary: abstract via search summary] [R30]. The Delhi colour boards used emojis, but for a mixed-platform app that is a risk. [inference]

### Recommendation: pictogram style for v2

1. **Grammar:** ISO 7010 solid silhouettes, one colour on a flat field, human figures **without faces**, no emoji, no gradients, no outlines, no illustrative props beyond one **action cue** (water drops for drink, slatted shade for rest, motion arcs for move). Mandatory-action instructions use the blue circle format; status and level use the existing level system (not an ISO sign class).
2. **Use ISO signs where they exist:** E004 / E003 on the unwell screen (test cross versus crescent with the workers; do not assume either), E007 for muster. Custom pictograms (rest in shade, drink water, never work alone, heat level) are labelled **custom, untested** in the design file and on the audit page until tested.
3. **≤ 4 pictograms per screen**, each paired with a short line and its audio, never alone. Per-screen text carries the meaning; pictograms support (matches Hare's conclusion).
4. **Replace "phone-with-cross"** with a composite built from E004 (handset) and E003 (cross) in safe-condition green, and include "no phones" as an explicit critical confusion in the test.
5. **Test protocol:** adopt ISO 9186-1 structure; criterion 85% correct, ≤ 5% critical confusion; ≥ 50 respondents per language-population is the standard's bar. The pilot-scale 5 workers per language in `ux/01` is a **usability check, not an ISO test**; label it so. Run it outdoors at noon, think-aloud with an interpreter. Not done.

---

## 8. Six languages and RTL

### Findings

1. **Logical properties and mirroring.** FP §8.3 covers shadcn RTL (`ms-4`, `rtl:rotate-180`). Add: mirror directional icons (back, forward, chevrons) [R18, R19]; do **not** mirror clocks, checkmarks, slashes [R19, primary], media playback buttons and media progress, numbers (and numbers "must be localized for languages that use different numerals") [R18, primary, old Material 1 page]. Material 1 also says "most things that relate to time should be depicted as moving from right to left" for linear time. Sources disagree on play: Wikimedia's Codex says mirror media icons [secondary: search summary].
2. **Medhi corroborates a right-to-left time axis** for Urdu readers (§7 finding 7) [R13].
3. **Numbers.** C6: CLDR defaults ar/ur/hi → latn, bn → beng, ne → deva. Example: `Intl.NumberFormat('bn')` renders 1234567.8 as ১২,৩৪,৫৬৭.৮; `ne` renders time 13:05 as १३:०५ [R28, primary measurement].
4. **Nastaliq metrics (measured).** Noto Nastaliq Urdu v23 (the fonts.gstatic.com woff2): 1000 units per em; hhea ascent 1904, descent −596 → content area **2.5 em**; glyph extents yMax 1808, yMin −1382 → ink extent **3.19 em** [R28, primary measurement]. v1 `body-ur` line height 2.1 is therefore below the font's own content area; harmless in plain inline flow, but any `overflow: hidden`, `line-clamp`, fixed `height`, or tight button box clips dots and descenders. FP §8.2 reported community clipping complaints at 1.5 [secondary].
5. **Language switch.** NN/g: flags are a poor symbol for language because "some languages are spoken in many countries" [R20, primary]. `navigator.languages` is weak (Safari lists one language, §2.5), and a phone set to English says little about a worker's preferred language. [inference]
6. **Translation status.** Every non-English message file is a machine draft with a "Draft translation" banner (`shell.draftTranslation` in `en.json`). [project, primary]
7. **WhatsApp template gap** for Nepali is already recorded (FP-S25).

### Recommendation

- Logical properties only; `dir` and `lang` on `<html>`; Latin islands carry `lang="en"` (v1 does this).
- **Shade band and any linear time axis mirror in ar and ur** (hour 06:00 at the right), do not mirror in LTR locales; clocks, play and checkmarks never mirror. Write start and end as words ("from 13:05 to 17:00") in the worker's language beside every arrow; wrap time ranges in a bidi isolate so digits and the colon never reorder. [inference from R13, R18]
- Western digits for times and temperatures in all six remains v1's choice; record it as an override of CLDR for bn and ne, expose a per-locale `digits` setting, and add "digits" to the native-review checklist.
- **Nastaliq rules (testable):** no fixed or max heights on any element that can hold Urdu text; no `overflow: hidden` or `line-clamp` there; min line height 2.1; buttons use `min-height`; a Playwright visual snapshot of the Today and unwell screens in `ur` at 390 px; Naskh fallback available for dense supervisor tables.
- **Language switch without a menu:** six chips with endonyms (English, العربية, اردو, हिन्दी, বাংলা, नेपाली) in the first fold of Today and Unwell, 48 px targets, no flags; selection persists and does not reload the screen. Default order: crew languages set by the supervisor, then device language, then English.
- Locale list as a registry (C1). A shipped status per locale: `source`, `machine draft`, `native-reviewed (date)`; worker safety strings gated on review.

---

## 9. The supervisor in three seconds

### Findings

1. **A single look is 200-250 ms; single features pop out, combinations do not.** Healey's perception reference: tasks done in under 200-250 ms are preattentive; the preattentive list includes hue, intensity, size, orientation, motion direction, velocity, density, number, flicker; a target defined by a combination of non-unique features "normally cannot be detected preattentively" [R24, primary].
2. **Exception-first, colour for the abnormal.** Process-control "high-performance HMI" practice (ISA-101): normal states in grey, colour only for abnormal conditions, hierarchy overview then detail [secondary: trade and vendor articles; ISA's article returned 403] [R30]. Aviation alerting codifies red = warning, amber/yellow = caution, advisory in any colour except red or green, and limits use of red, amber and yellow for non-alerting functions [secondary: 14 CFR 25.1322 text via a search summary of Cornell LII] [R30]. The FAA design guidance page I fetched adds that colours must be verified for chromaticity and discriminability "under the expected lighting levels" [R30, FAA HFDS ch. 4, primary for that sentence].
3. **Samsara and ATC.** I found no primary documentation of Samsara's or ATC's dashboard design principles; I do not cite them.
4. **v1 state:** the supervisor crews list shows level now and plan status; the plan page is about 3,200 px tall at 768 (critique open item).

### Recommendation

- **First fold, one focal answer:** a single sentence in the supervisor's language, e.g. "Crew B: Red from 13:00 (in 42 min)." Beneath it the crews sorted **worst first**, each row: crew label, level sign (numeral + hatch), time of next change, plan status, Stop work. Normal crews in grey ink on surface; saturation only for crews above amber. Exceptions pop by **one** feature (position and size), not by a hue-plus-icon-plus-border combination.
- **Test (not run):** 5-second test with 5 foremen: after 3 seconds ask "which crew stops first, and when?" Pass = ≥ 4 of 5 correct. [inference]
- Stop work stays one tap on every crew screen (v1). Keep the in-page index and collapsed clause table owed by the critique.

---

## 10. Judge path: landing to wow in two clicks, and a robust demo link

### Findings

1. **What judges do.** MLH recommends 4 minutes per project: "2 minutes for presentation + demo", 1 for questions and scoring, 1 for travel [R25, primary]. For this competition, evaluators open each team's submission sections and click a mark per question; no judges are named; the package must "explain itself with nobody in the room"; a screener asks "can I score this in ten minutes?" [Judges §1, vault and inference, secondary]. The organiser FAQ asks for "a working prototype by 20th November, with technical documentation" [`faq_2026-11-06.txt`, project primary].
2. **v1's `/` is a role chooser** with three equal cards and the note "no login, synthetic data" (`messages` `shell.roleChooser`). The wow (replay) is behind a second hop and is not the primary action. [project, primary]
3. **Scroll-driven timelines are supported** (`animation-timeline`: Chrome 115, Safari 26, Firefox 159) [R26, primary], so scroll-linking is possible as an enhancement. A stepper is easier to time (50 s), to deep-link and to operate by keyboard (WCAG 2.2.2: moving content > 5 s needs pause/stop/hide) [R21, primary].
4. **Skip links.** WCAG 2.4.1: "A mechanism is available to bypass blocks of content that are repeated on multiple web pages"; technique G1 is a skip link to the main content [R21, primary].
5. **Hosting robustness.** ADR 0001 sets min replicas 1 for `api` and `web` during 20 Nov-11 Dec (cold start avoided) [project, primary]. Judges §5: "Keep a recorded fallback, because Wi-Fi fails at events" [secondary, vault].
6. **Locale redirects can hurt.** `proxy.ts` with next-intl negotiates locale; a judge whose browser prefers Arabic would land in an RTL page unprompted. [inference]

### Recommendation: the judge path

1. `/` becomes: one sentence, the headline number slot (with its stamp), and one primary button **"See the scoreboard"** → `/replay` on its **final frame** (1 click). Role chooser becomes a secondary row below ("or open as worker, supervisor, HSE").
2. **"Skip to the scoreboard"** is the first focusable element on every demo page (and a visible link on `/`).
3. **Story mode = stepper:** Prev, Next, Play-50-s (pausable), step in the URL (`/replay?step=day`), arrow-key operable, reduced-motion lands on the final frame (matches v1). Scroll-linked season scrubber as enhancement only.
4. **No walls:** no login, no cookie-consent modal, no geolocation or notification prompt on load, no locale redirect (default English; a visible language chip row on every page).
5. **Static and cacheable:** the replay JSON is static, served from the same origin, SSG'd and precached so `/replay` works with the API down and offline after the first visit.
6. **Mobile:** the replay already passes the gate at 390 px (critique). Add a "Copy link to this step" control.
7. **Fallbacks:** recorded 3-minute video link on `/`; README top with the criteria-to-evidence table (Judges §6 action 7).

---

## 11. Near-zero friction: forms replaced by defaults, inference and (bounded) agents

> **Amendment 2026-11-12 (supersedes the data-class column of §11.6 where they differ).** ADR 0038 (Proposed,
> `D:\dev\stellar-blaze\docs\decisions\0038-agentic-workflows-and-voice.md`) fixes that **every microphone capture, transcript,
> typed free-text sentence and OCR output is PERSONAL**, so F1 sentence-to-config runs on a **self-hosted** STT + LLM
> only (Whisper large-v3-turbo + a local 9-12B model in the demo), never a managed model; there is no "NON_PERSONAL
> sentence" path. Roster import is **CSV only**, with the name column dropped in the browser before upload; roster
> **photo OCR is deferred**. Browser Web Speech is banned (server-based by default). On the deployed URL (no GPU) the
> mic and the sentence parser **fail closed** with "Voice needs our private server, which isn't running here. Type in
> the form instead." and the ordinary form appears; the no-LLM baseline (§11.6 row 1) is therefore the path judges
> will actually use live, and the agent is a recorded 15 s video beat. Worker voice input stays cut. The three
> direction stills (`../directions/*/setup.html`) were updated to this wording on 2026-11-12.

*Scope addition from Ali via the architect's session, added 2026-11-11. This section evaluates and designs; it builds nothing.*

### 11.1 Challenge to the premise (rule 0)

- **The goal (no long forms, no surveys) holds.** It also holds without any LLM: location from the QR code or geolocation, shift times from a default or CSV, ban window from the ruleset, acclimatisation from two chips, language from the device or crew. That removes most fields. [inference]
- **An LLM adds one thing: free-text entry** ("two crews, 40 workers, Mussafah, concrete work this week"). That is a convenience and a demo moment, not a requirement.
- **It costs governance.** ADR 0015 cut the copilot and shift drafter and made "no LLM touches a warning or a plan" a pitch point; ADR 0010 §8 says a class is **declared by the code that builds the input, never inferred** and "No PERSONAL-data LLM feature is in demo scope"; ADR 0031 parks the GPU, so no self-hosted route exists in production [project, primary]. A free-text box cannot be declared non-personal by construction: supervisors will type "Ravi's crew".
- **Recommendation:** build the **deterministic card first** (§11.2-11.4, no LLM; about 1.25 days, see the §11.6 summary), then the sentence extractor as an optional accelerator behind a kill-switch flag, only after the ADR in §11.7 is accepted. If the ADR is not accepted, the product loses nothing it needs.

### 11.2 Flow A: zero-form site setup (supervisor or HSE)

**Happy path**

1. **Entry.** Supervisor opens setup (first run after the HSE or supervisor link). One field: "Tell us about your site in one sentence" with an example in their language, a microphone button (§11.6 F2), and below it "or scan the site QR / pick on the map". Demo chip: "two crews, 40 workers, Mussafah, concrete work this week".
2. **Pre-screen on the device.** Client rejects obvious identifiers before any send: runs of 8 or more digits, `@`, strings matching an Emirates ID pattern. [inference]
3. **Draft.** `POST /api/v1/site-setup/drafts {text, locale, geolocation?}`. Server: (i) deterministic pre-parse of numbers, times and a gazetteer lookup; (ii) if `site_setup_extractor_enabled` and the NON_PERSONAL route is up, LLM extraction into `SiteSetupExtraction`; (iii) normaliser builds `SiteConfigDraft` with provenance; (iv) validator computes `missing`.
4. **Preview card** (never a form wall). Sections: *Where* (map pin, "Musaffah, nearest station OMAA, 21 km"), *When* (dates; "midday break 12:30-15:00 applies 15 Jun-15 Sep" from the ruleset), *Crews* (2 × 20, task, workload class), *Shifts* (default legal shift). Every field has a small provenance chip: **you said**, **default**, **from your phone**, and amber **protective default** where the app assumed the safer value.
5. **Ask back only what is missing.** `missing` is computed by code from the schema, so the questions are templated, translated chips and steppers (no LLM): headcount stepper in steps of 5, task tile grid, time chips. For the example sentence only one question remains (how to split 40 across 2 crews: default 20 + 20 shown editable).
6. **Confirm.** One button "Looks right. Start." The confirmed draft is written through the existing audited configuration path (ADR 0011: input-change audit with before, after, actor, reason; reason auto-filled "initial setup"). An unconfirmed draft expires after 24 h and **no planner or alert code reads drafts**.

**Unhappy paths**

| # | Case | Behaviour |
|---|---|---|
| U1 | LLM off, down or route not configured | Deterministic parse runs; the same card appears with more empty fields. No error screen. |
| U2 | Contradiction ("40 workers" but crews 20 + 30) | Card shows a conflict row with the two values as chips; nothing is picked silently. |
| U3 | Place not in the gazetteer | Map pin pre-centred on device location, or manual pin; no external geocoder is called with the typed place name. |
| U4 | Possible personal data in the text (client or server detector, ADR 0010 §8) | Send is blocked: "Please remove names and numbers that identify people. We only need counts." Server writes `llm.pii_blocked` to the audit trail. The text never reaches a managed route. |
| U5 | Speech recognition unavailable or language pack missing | Mic button hidden or disabled; typing path unchanged; no error. |
| U6 | Supervisor lowers a protective default (heavy to light) | Requires a reason code and writes an audit row; ADR 0011's HSE second approver is parked, so at minimum reason and audit. |
| U7 | Offline | Draft cannot be created; the card works as a local editable form with the same defaults and syncs on reconnect. |

### 11.3 JSON schemas

Two schemas, deliberately separate. The **model-emitted** one is liberal (per standing rule: no `minLength` and no tight constraints on model-emitted fields; relax, normalise, fall back in code). The **draft** the card shows is built and validated by code.

`SiteSetupExtraction` (what an LLM fills; Pydantic `extra="forbid"` on our side):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SiteSetupExtraction",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "site_name":        { "type": ["string", "null"] },
    "place_phrase":     { "type": ["string", "null"], "description": "verbatim place words, e.g. 'Mussafah'; geocoding is done by code" },
    "period_phrase":    { "type": ["string", "null"], "description": "verbatim, e.g. 'this week'; date resolution is done by code" },
    "total_headcount":  { "type": ["integer", "null"] },
    "crews": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "headcount":    { "type": ["integer", "null"] },
          "task_phrase":  { "type": ["string", "null"] },
          "task_class": {
            "enum": ["concrete_pour", "rebar_fixing", "formwork_carpentry", "excavation_earthworks",
                     "scaffolding_erection", "masonry_blockwork", "plastering_painting", "roofing_cladding",
                     "road_paving_asphalt", "loading_hauling", "welding_cutting_outdoors",
                     "landscaping_irrigation", "survey_inspection", "plant_operation", "other_unlisted", null]
          },
          "shift_start":  { "type": ["string", "null"], "description": "HH:MM 24h as heard, normalised by code" },
          "shift_end":    { "type": ["string", "null"] },
          "languages":    { "type": "array", "items": { "enum": ["en", "ar", "ur", "hi", "bn", "ne"] } },
          "new_workers":  { "type": ["integer", "null"] }
        },
        "required": ["headcount", "task_phrase", "task_class", "shift_start", "shift_end", "languages", "new_workers"]
      }
    },
    "unparsed": { "type": ["string", "null"], "description": "anything not mappable; shown to the human, never acted on" }
  },
  "required": ["site_name", "place_phrase", "period_phrase", "total_headcount", "crews", "unparsed"]
}
```

`SiteConfigDraft` (built by code; rendered on the card; confirmed by a human before it becomes site configuration):

```json
{
  "draft_id": "uuid",
  "source": "sentence_typed | sentence_voice | qr_only | form",
  "status": "draft | confirmed | expired",
  "site": {
    "name": "string | null",
    "location": {
      "lat": "number", "lon": "number", "accuracy_m": "number | null",
      "source": "qr | device_geolocation | gazetteer | map_pin",
      "nearest_station_id": "string (derived: station gazetteer, e.g. OMAA)",
      "distance_km": "number"
    },
    "timezone": "Asia/Dubai"
  },
  "period": { "start": "date", "end": "date | null", "midday_ban_applies": "boolean (derived from ruleset)" },
  "crews": [{
    "crew_id": "crew-1",
    "label": "string | null (no personal names: validated)",
    "headcount": "integer | null",
    "task_class": "enum (closed list above) | other_unlisted",
    "workload_class": "light | moderate | heavy (DERIVED by ruleset lookup, never model output; unknown -> heavy)",
    "shift": { "start": "HH:MM", "end": "HH:MM", "source": "default_ruleset | roster_import | human | model" },
    "languages": ["en|ar|ur|hi|bn|ne"],
    "new_workers_count": "integer | null (crew-level count only)"
  }],
  "fields": { "<json-pointer>": { "value_source": "model | default_protective | default_ruleset | device | import | human", "span": "[start,end] | null" } },
  "missing": ["/crews/0/headcount"],
  "needs_confirmation": true,
  "extractor": { "route_id": "string", "prompt_version": "string", "input_sha256": "string" }
}
```

Notes: `missing` is computed by validation, so ask-back is deterministic. `contains_possible_personal_name` is deliberately **not** a model field: a self-reported-uncertainty detector never fires on confident errors, so the control is the independent detector (U4), not the model's say-so.

### 11.4 Smart defaults (nothing here is asked)

| Field | Default | Source and class |
|---|---|---|
| Midday ban window and dates | 12:30-15:00, 15 Jun-15 Sep | Ruleset floor (ADR 0010 class c; ADR 0011 P-H1) |
| Timezone | Asia/Dubai | Constant |
| Location | QR site code → device geolocation (on a tap) → gazetteer of UAE industrial areas → map pin | Station gazetteer committed to the repo; no external geocoder call with a typed place name |
| Nearest station | Computed from the gazetteer | Derived (ADR 0005 stations) |
| Shift | Legal default 06:00-11:00 and 15:00-18:00 (ADR 0011 B1/L1) unless a roster is imported | Ruleset default, editable, marked "default" |
| Workload class | Derived from the closed `task_class` by a ruleset table; unknown or `other_unlisted` → **heavy** | Ruleset table; **table values need clinical review** (ADR 0035 label until done) |
| Acclimatisation (worker device) | "new" and "away unknown" unless answered | Protective default (§11.5) |
| Crew languages | Supervisor device language, else English | `navigator.languages` is weak (§2); editable chips |
| Crew split of a total | Even split, editable | Code |

Principle: **when unsure, default to the more protective value and label it.** (ADR 0011: conservative defaults, edits logged, protection-lowering edits flagged.)

### 11.5 Flows B-F

**B. Location and shifts without typing.** QR carries the site code, so location is known. Otherwise a "Use my location" button (never a prompt on load; MDN: the prompt appears on first `getCurrentPosition`) [R11]; accuracy shown; snapped to the gazetteer. *Unhappy:* denied or unavailable → map pin; accuracy worse than 5 km → "Is this the right area?" confirm chip. Shifts: legal default, or **CSV import** with deterministic header matching (synonym lists in the six languages), a preview table, and an ask-back only for unmapped columns. *Unhappy:* encoding or delimiter wrong → show the first rows raw and let the supervisor tap the start-time and end-time columns.

**C. Roster photo (explicit data-class handling).**
- **A roster photo almost always contains worker names, so it is PERSONAL by default and must not reach any managed route.** Under ADR 0010 §8 a PERSONAL call needs a self-hosted route; none runs in production (ADR 0031). So the photo path **must not use an LLM in the v2 demo.**
- **Design: on-device only.** (1) Pick or capture the photo. (2) Re-encode on a canvas in the browser (this drops EXIF, including GPS). (3) On-device OCR in WASM: Tesseract.js v7.0.0 (released 2025-12-15) with `tessdata_fast` models, which exist for `urd`, `hin`, `ben`, `nep`, `ara`, `eng` [R27, primary]. (4) The supervisor taps the **names column**; the app paints it black and **discards that text**; nothing identifying is kept. (5) Remaining numeric cells are parsed deterministically (normalising Arabic-Indic and Urdu digits ٠-٩ / ۰-۹) and **grouped by identical start/end pairs** into candidate crews with headcount = number of rows. (6) The card shows "3 shift patterns found" for confirmation. **Nothing leaves the phone except the confirmed crew-level structure** (no image, no rows, no names).
- *Unhappy:* low OCR confidence, handwriting, skew or mixed scripts → "We could not read this photo. Type the shift times or import a CSV." Handwritten South Asian scripts are the likely failure; accuracy is untested. [inference]
- **Why not strip names client-side and upload the image?** Client-side redaction is user-confirmed, not provable: residual names in margins, ID numbers and handwriting survive, and ADR 0010 requires the class to be *declared by construction*, which a user-driven mask does not give. If a model must see a roster image later, it is a self-hosted PERSONAL route (parked). Alternatively an LLM could read the already-redacted **text** table (NON_PERSONAL after redaction plus the PII detector); I do not recommend it for v2 (F8, parked).
- The planner needs only **crew-level** shift patterns and headcounts; per-worker acclimatisation counters stay employer-held and `Personal` (ADR 0011 §7.7).

**D. Acclimatisation without a form.** On the worker's device: chips for time on the job and one yes/no for prior UAE summer work (§2 step 2). Code computes the NIOSH ramp from the ruleset (new ≤ 20% day 1 then +20% a day; experienced 50%, 60%, 80%, 100%; ADR 0011 P-H8: new 20/40/60/80/100, experienced 50/60/80/100/100; heavy work only after 7 days) [R17; project]. "Not sure" or no answer → **new**. After more than 7 days since the app was last opened, one chip: "Were you away from heat work for a week or more?" (a phone that was simply off is not evidence). *Open conflict:* the worker's on-device answer (Tier B) and the employer's counters (ADR 0011) can disagree; proposal: the worker's own screen shows the **more protective** of the two, the crew plan uses the employer's counters or the crew-level "new workers" count. Needs a decision.

**E. Worker scan-and-go, language, one-tap unwell, voice.** Covered in §2, §5, §8. The unwell button is fixed on every worker screen; the steps appear with audio at once; no typing, no voice input.

**F. Judges, zero setup.** §10.

### 11.6 Agent and automation features: table

DATA CLASS follows ADR 0010 §8 (PERSONAL = names, health, anything identifying: self-hosted model only; NON_PERSONAL = structure and counts without names: managed model allowed). Build cost is my estimate in days on top of the never-cut path. "ADR" says whether an ADR is needed and whether the feature contradicts ADR 0015 or 0010.

| ID | Feature | Input | Output schema | Data class | Model route | Cost (days) | Risk | Fallback without LLM | Demo-visible | ADR |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | Sentence to site-config draft | Typed sentence (supervisor/HSE), locale, optional geolocation | `SiteSetupExtraction` → `SiteConfigDraft` | **Cannot be declared NON_PERSONAL by construction** (free text may contain names). Treated NON_PERSONAL only behind client and server PII gating, with blocked calls audited | NON_PERSONAL managed route from the ADR 0010 route catalog; model chosen by the backend architect via eval; **never** the personal route | 1.0 backend + 0.5 card (reuses `LlmClient` port built for the drafter) | Medium-high: non-Latin names slip a detector (multilingual NER weak, [inference]); mis-extracted counts (human confirm covers); governance optics | Deterministic pre-parse plus the same card with defaults and templated ask-back | Yes, as "propose, then confirm" | **New ADR required.** Does not contradict ADR 0015's decision (copilot and shift drafter stay cut). **Contradicts ADR 0015's slogan "no LLM touches a warning or a plan"** unless reworded, and **strains ADR 0010 §8's "declared, never inferred"** for free text |
| F2 | Voice dictation of the sentence | Supervisor speech | Transcript text into F1's input | Audio and transcript treated PERSONAL until proven otherwise | Browser `SpeechRecognition` with `processLocally = true` only, after `available({langs, processLocally:true})`; default mode sends audio to a web service [R10]; Urdu/Hindi/Bengali/Nepali on-device support **unverified** | 0.25 | Medium: language-pack download, uneven support, noise | Hide mic; type | Optional; only if on-device works on the demo laptop | No new ADR if on-device only; a privacy line in F1's ADR |
| F3 | CSV roster column mapping | CSV file (no names needed) | `crews[].shift`, headcount | NON_PERSONAL if names column is dropped client-side before parse; else PERSONAL and kept on device | **None (deterministic)** | 0.5 | Low | The mapping itself is the fallback; manual column tap | Yes | None |
| F4 | Roster photo to crew shift patterns | Photo | Same as F3 | **PERSONAL by default** (names). No upload | **None. On-device OCR (Tesseract.js) + user-confirmed name mask + deterministic parser**; no LLM in v2 | 1.5 | High: handwriting OCR accuracy untested; scripts and digit forms vary | CSV import or typing times | Demo with a **synthetic** roster photo, stamped SYNTHETIC | No contradiction. Short ADR or an F1-ADR paragraph: "roster photos never leave the device; no LLM in v2" |
| F5 | Acclimatisation from time-on-job chips | Two chips | Worker-device ramp (NIOSH) | PERSONAL; on-device only | None | 0.25 | Low-medium: conflict with employer counters | Defaults to "new" | Yes (worker flow) | Decision on the worker vs employer-counter rule; touches ADR 0011 P-H8 and ADR 0004 Tier B |
| F6 | Language from device or crew, one-tap override | `navigator.languages`, crew languages | Locale | NON_PERSONAL | None | 0.1 | Low | Six chips | Yes | None |
| F7 | Ask-back of missing fields | `missing[]` | Templated question chips | NON_PERSONAL | None | 0.25 (inside card) | Low | n/a | Yes | None |
| F8 | LLM reading of the **redacted** OCR table | Name-free text table | `crews[]` | NON_PERSONAL only after user-confirmed redaction plus PII detector | NON_PERSONAL managed route | 0.5 | High: redaction not provable | Deterministic parser (F4) | No | **Parked.** Would need the F1 ADR extended |
| X1 | Excluded: bulletin text, plan or shift drafting, copilot Q&A, any model computing or editing a level or plan | n/a | n/a | n/a | n/a | n/a | Governance | n/a | No | Cut by ADR 0015; stays cut |

**Five-line summary**
1. Baseline with **no LLM** (QR/geolocation, defaults, card, CSV, chips, language): about 1.25 days, MUST, replaces the form wall.
2. F1 sentence-to-config: about 1.5 days, SHOULD behind a kill-switch, **needs a new ADR** and a reworded pitch line; NON_PERSONAL route only, PII-gated.
3. F4 roster photo: on-device OCR with a user-confirmed name mask, **no LLM**, synthetic demo only; PERSONAL data never uploaded.
4. F2 voice dictation: on-device recognition only (unverified language support), COULD; worker voice input is cut.
5. No feature computes or edits a warning or plan; agents only fill CONFIG that a human confirms, and workload class comes from a deterministic ruleset table defaulting to heavy.

### 11.7 ADR consequences (for the architect)

- **New ADR (proposed title: "Site-setup extraction proposes configuration; humans confirm; rules compute").** Decides: (a) the extractor fills `SiteSetupExtraction` only; (b) workload class and every threshold come from ruleset tables; (c) drafts are unreadable by planner and alert code; (d) the free-text data-class problem: either (i) treat supervisor free text as PERSONAL → self-hosted only → F1 cannot ship live (GPU parked), or (ii) gate with client and server PII detectors and audit blocks, declared NON_PERSONAL by the gating builder, with the "declared, never inferred" wording of ADR 0010 §8 amended accordingly, or (iii) no LLM. **I recommend (iii) as baseline and (ii) as a flagged stretch; never (i) in the demo.**
- **ADR 0015:** its decision stands. Its consequence line "'no LLM touches a warning or a plan' becomes a governance point" is true only if reworded: "no LLM computes or edits a warning or a plan; an LLM may propose site-setup fields that a human confirms."
- **ADR 0010 §8:** the floor "PERSONAL never leaves our infrastructure" is unaffected provided F2 is on-device and F4 uploads nothing.
- **ADR 0011/0004:** the acclimatisation conflict rule (F5) needs an entry.
- Mark every `task_class` to workload table and the acclimatisation defaults "not clinically reviewed" until the ADR 0035 review happens.

---

## 12. Requirements for v2 (numbered, testable, 25)

1. **Landing to scoreboard:** from `/`, in each of the six locales, the scoreboard's final frame is reachable with ≤ 1 click and no login, cookie wall or permission prompt (Playwright counts clicks).
2. **Skip link:** "Skip to the scoreboard" is the first focusable element on every demo page (axe plus a focus-order test; WCAG 2.4.1).
3. **Story stepper:** each step has a URL; Prev/Next/Play-50-s work by keyboard; Play is pausable (WCAG 2.2.2); reduced-motion opens on the final frame; the whole story ≤ 50 s on Play.
4. **Demo resilience:** `/replay` renders its numbers with the API stopped (static JSON precached); works offline after one visit; `min replicas 1` on `api` and `web` 20 Nov-11 Dec; a recorded fallback video is linked from `/`; verified with `next build && next start`.
5. **Worker join:** scanning the site QR fixture lands on Today with the **site** level in ≤ 2 s on throttled 4G, with zero typed fields and no account.
6. **Three-step cap:** scan, optional personalise (≤ 3 taps), enable warnings (1 tap + OS prompt); an e2e test counts taps ≤ 5 from scan to push enabled on Android.
7. **Language:** locale resolves crew language, then `navigator.languages`, then English; six endonym chips (no flags, no menu, 48 px) are visible in the first fold of Today and Unwell; switching keeps the screen state. Locale list is a registry; a locale's review status is shown.
8. **Install:** Android captures `beforeinstallprompt`, shows an in-app button, calls `prompt()` once per event; push permission is requested only from a tap and works without install on Android; iOS shows the 3-step card and the in-app permission button; verified on one real Android and one real iPhone on iOS 27.
9. **Offline:** after one online visit, in airplane mode Today (last forecast), Unwell (working `tel:` links, steps, audio) and the chosen language's font all render; tested on a production build.
10. **Stale label:** shows absolute time, age and a clock pictogram in the worker's language; thresholds are ruleset tunables (not 3 h / 48 h literals); a stale level is labelled "Last known"; at expiry the fallback plan (never less protective than the ban) is shown.
11. **Storage:** `navigator.storage.persist()` is called after install or push permission; My data displays the result.
12. **Audio:** a closed set of ~25 clips per language with a per-clip status (recorded, TTS draft, native-reviewed); Play button ≥ 56 px in the first fold; autoplay is attempted and degrades silently; every clip has text, pictogram and vibration alternatives; pause/stop for clips > 3 s. Site-noise audibility is measured before any claim.
13. **Glare:** every action text on the worker route uses ink on surface (or raised surface), nominal ≥ 7:1; no font weight < 500 (Nastaliq action text ≥ 600); text ≥ 18 px, action lines ≥ 22 px, level numeral ≥ 76 px; relay numeral ≥ 9rem or the "3 m" claim is dropped; a script in CI recomputes pair ratios from tokens.
14. **Level identity** never depends on hue: hatch, numeral on plate, word, pictogram and sign rim are all present on every level sign (existing; add a greyscale snapshot test).
15. **Pictograms:** ISO 7010 grammar (solid silhouette, no faces, no emoji, ≤ 4 per screen, always with text and audio); ISO signs used where they exist; custom ones flagged "custom, untested"; "phone-with-cross" replaced; comprehension test protocol written to ISO 9186-1 structure with ≥ 85% correct and ≤ 5% critical confusion (incl. "no phones") before any pilot claim.
16. **RTL:** logical properties only; linear time axes mirror in `ar`/`ur`, clocks/play/checkmarks never mirror; times are written with from/to words and bidi isolates; digits are a per-locale setting with the bn/ne override recorded; Playwright snapshots for `ar` and `ur` at 390 px.
17. **Nastaliq:** no fixed or max heights, no `overflow: hidden` or `line-clamp` on any element that can hold Urdu text; line height ≥ 2.1; a visual test shows no clipped dots or descenders on Today, Alert and Unwell in `ur`.
18. **Supervisor glance:** the first fold of the crews screen holds one focal sentence ("which crew, what level, when") and crews sorted worst-first; normal crews are grey; exceptions pop by position and size; Stop work is one tap on every crew screen; a 5-second test with 5 foremen (≥ 4 correct) is scheduled.
19. **Zero-form setup (baseline, no LLM):** a supervisor completes the example site ("two crews, 40 workers, Mussafah, concrete work this week") on the preview card with ≤ 6 taps and no keyboard, every field showing a provenance chip, protective defaults in amber, and the ban window never asked.
20. **Agent boundary:** a static import test proves planner, risk and alert code import nothing from the LLM package; an unconfirmed draft cannot be read by them (contract test); workload class is produced only by a ruleset table lookup, unknown → heavy.
21. **Data class:** every LLM call is typed `LlmInput[D]` per ADR 0010 §8; a blocked PII hit writes `llm.pii_blocked` and no managed call is made; a network-capture test shows no roster image and no audio is uploaded in any v2 flow.
22. **Kill switch:** with `site_setup_extractor_enabled = false` (and with the LLM route down) the setup flow still completes via the deterministic parser and card; an e2e test runs with the flag off.
23. **Location:** location comes from the QR code or from a tap on "Use my location" (never a prompt on load), then a gazetteer snap; denial falls back to a map pin; no external geocoder call carries a typed place name (network-capture test).
24. **Acclimatisation:** two chips replace dates; "not sure" or unanswered → "new"; the NIOSH ramp comes from the ruleset; the worker's own screen shows the more protective of device and employer values (rule recorded in an ADR).
25. **Honesty labels:** the worker "My data" page says "pseudonymous" for the push subscription; any pictogram or translation not yet tested or reviewed is labelled as such; the human-run tests owed (ISO-style comprehension test, 5-second supervisor test, on-site audio measurement, native review) are listed on the audit page.

---

## 13. Not verified, and what would settle it

- **ISO 9186 acceptance percentages** and ISO 15008 character-height and contrast numbers: standards text paywalled. Settle with the full texts.
- **UAE PDPL text** (consent article, scope carve-outs): official page returned 403; commentary only. Legal review owed.
- **Samsara, HammerTech, Online Induction, SaferMe** onboarding detail: pages returned 403/404; search summaries only.
- **TTS quality** for ur, hi, bn, ne: no comparable evaluation found; a 6-listener native A/B on the closed phrase set settles it.
- **Phone loudspeaker level versus site noise:** unmeasured.
- **iOS Home Screen audio autoplay** and **notification tap as user activation:** unverified.
- **In-app browser (WhatsApp) install and push behaviour:** untested.
- **Chrome `<install>` trial status after milestone 153:** unconfirmed.
- **On-device `SpeechRecognition` for Urdu, Hindi, Bengali, Nepali:** unverified; use `available()` at runtime.
- **Handwritten Indic roster OCR accuracy:** untested.
- **Piepenbrock 2014 and the 2017 glance-reading paper:** PubMed fetch failed; Buchner and Baumgartner known only through an abstract summary.
- **Healey (2012) full paper:** PDF fetch failed; the NCSU reference page was read instead.
- **Safari 27 release date (14 Sep 2026):** from search summaries; the WebKit feature posts were read directly.
- **Whether a push endpoint is "personal data"** under UAE law: not researched.

---

## 14. Sources

Project documents (primary for what they say): ADR 0001, 0003, 0004, 0005, 0006, 0010, 0011, 0015, 0031, 0034, 0035 in `D:\dev\stellar-blaze\docs\decisions\`; `docs/research/2026-11-11-frontend-platform.md` (FP) and its sources FP-S1, S10, S12, S13, S25, S35, S36, S40, S48, S52, S54, S57; `2026-11-11-judges-and-wow-moment.md`; `docs/research/2026-11-11-deployment-options.md`; `D:\dev\stellar-blaze-f1\docs\design\{DESIGN.md, ux/01-04, critique/README.md, critique/contrast.mjs, tokens/tokens.css}`; `frontend/messages/{en,ar,ur,hi,bn,ne}.json`; `D:\dev\future-health-challenge\research\raw\faq_2026-11-06.txt`.

| ID | Source | Tag |
|---|---|---|
| R1 | WebKit, "WebKit Features in Safari 26.0": https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ | primary |
| R2 | WebKit, features for Safari 27.0, 27.1, 27.2: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ , https://webkit.org/blog/18486/webkit-features-for-safari-27-1/ , https://webkit.org/blog/18515/webkit-features-for-safari-27-2/ | primary (absence of push/installability changes) |
| R3 | WebKit, "Web Push for Web Apps on iOS and iPadOS": https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ | primary |
| R4 | Chrome for Developers, install element origin trial (12 May 2026): https://developer.chrome.com/blog/install-element-ot | primary |
| R5 | MDN browser-compat-data, `BeforeInstallPromptEvent`: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/BeforeInstallPromptEvent.json | primary |
| R6 | web.dev, customise the install prompt: https://web.dev/articles/customize-install | primary |
| R7 | WebKit, Tracking Prevention: https://webkit.org/tracking-prevention/ | primary |
| R8 | MDN, Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria | primary |
| R9 | MDN, Autoplay guide: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay | primary |
| R10 | MDN, Using the Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API | primary |
| R11 | MDN, Geolocation API: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API | primary |
| R12 | MDN, `Navigator.languages`: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages | primary |
| R13 | Medhi, Sagar, Toyama, "Text-Free User Interfaces for Illiterate and Semiliterate Users", ITID 4(1), 2007, 37-50 (full text read): https://ocw.mit.edu/courses/mas-965-nextlab-i-designing-mobile-technologies-for-the-next-billion-users-fall-2008/8ccecb3eacd514b7ea0255f5158de907_MITMAS_965F08_medhi2007.pdf | primary |
| R14 | ISO 9186-1:2007 free sample (full text of sample read): https://cdn.standards.iteh.ai/samples/41090/1cec0f18e945483da1afbc9c837416b3/ISO-9186-1-2007.pdf (the 2014 second edition is current; I did not read it) | primary, edition caveat |
| R15 | IIID, Symbol Comprehension Testing Protocol: https://www.iiid.net/wp-content/uploads/Symbol-Comprehension-Testing-Protocol.pdf | primary for what it states (draft ANSI 85% / ≤ 5%) |
| R16 | Hare, Cameron, Real, Maloney (2013), exploratory case study of pictorial aids for migrant construction workers (abstract page): https://scholars.uky.edu/en/publications/exploratory-case-study-of-pictorial-aids-for-communicating-health/ | primary (abstract) |
| R17 | CDC NIOSH, acclimatization: https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html | primary |
| R18 | Material Design 1, Bidirectionality (old version): https://m1.material.io/usability/bidirectionality.html | primary, old version |
| R19 | Adobe Spectrum, Bi-directionality: https://spectrum.adobe.com/page/bi-directionality | primary |
| R20 | NN/g, "Flags: not a good symbol for languages" (flag problem article): http://www.nngroup.com/articles/flag-problems/ | primary |
| R21 | W3C WCAG 2.2 Understanding: SC 2.5.8 https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html ; SC 2.4.1 https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html ; SC 2.2.2 https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html ; SC 1.4.3 https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | primary |
| R22 | W3C, CSS Values and Units Level 3 (reference pixel): https://www.w3.org/TR/css-values-3/ | primary |
| R23 | DisplayMate, Smartphone Displays Under Bright Ambient Lighting Shoot-Out: https://displaymate.com/Smartphone_Brightness_ShootOut_1.htm | primary (2010-2011 phones) |
| R24 | Healey, perception in visualization (preattentive features): https://www.csc2.ncsu.edu/faculty/healey/PP/ | primary |
| R25 | MLH, Judging Plan: https://guide.mlh.com/general-information/judging-and-submissions/judging-plan | primary |
| R26 | MDN browser-compat-data, `animation-timeline`: https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/animation-timeline.json | primary |
| R27 | Tesseract `tessdata_fast` models (HTTP 200 for urd, hin, ben, nep, ara, eng): https://github.com/tesseract-ocr/tessdata_fast ; Tesseract.js v7.0.0 (2025-12-15): https://github.com/naptha/tesseract.js/releases | primary (queried via GitHub) |
| R28 | My measurements today: Node 24.15.0 `Intl` (ICU 78.2, CLDR 48.0) numbering systems; fontTools on Noto Nastaliq Urdu v23, https://fonts.gstatic.com/s/notonastaliqurdu/v23/LhWNMUPbN-oZdNFcBy1-DJYsEoTq5pudQ9L940pGPkB3Qt_-PK-V2t_8.woff2 ; glare model arithmetic from `critique/contrast.mjs` colour maths | primary (measurement) / inference (glare model) |
| R29 | Wikipedia, ISO 7010 (codes, categories, crescent variant quoting ISO): https://en.wikipedia.org/wiki/ISO_7010 | secondary |
| R30 | Search-summary or blocked-fetch sources: HammerTech https://help.hammertech.com/hc/en-gb/articles/14620460946575-Worker-Registration-and-Induction-No-Login-Required ; Samsara https://kb.samsara.com/hc/en-us/articles/12018015960717-Sign-In-and-Select-Vehicle ; Online Induction https://www.onlineinduction.com/qrcode_checkin ; Miller et al. 2016 https://ojs.aaai.org/index.php/ICWSM/article/view/14757 ; Buchner and Baumgartner 2007 https://doi.org/10.1080/00140130701306413 ; 14 CFR 25.1322 https://www.law.cornell.edu/cfr/text/14/25.1322 ; ISA High Performance HMI https://www.automation.com/article/the-high-performance-hmi ; FAA Human Factors Design Standard ch. 4 §4.6 https://hfcc.dot.gov/publications/docs/GeneralGuidance/zz_FAA_GeneralGuidanceDoc_Chapter_04_Section_06.html | secondary (except the one FAA sentence, primary) |
| R31 | UAE PDPL, Federal Decree-Law 45/2021 (official text, fetch returned 403): https://uaelegislation.gov.ae/en/legislations/1972/download ; commentary via law-firm summaries | secondary |
