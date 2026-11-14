# Shared brief for the three v2 direction stills (2026-11-11)

Each direction renders the **same content** so Ali compares looks, not copy. Three screens per direction:
`index.html` (judge landing / hero), `worker.html` (worker Today, phone first), `setup.html` (zero-form site setup).
Screenshots at 1440 and 390 go in `<direction>/shots/`. `description.md` holds a plain-English paragraph and the
3 closest real products.

## Hard rules (from the v1 diagnosis, `../../critique/diagnosis.md`)
- Heat colour appears **only on data** (a field, a curve, a cell). Chrome is neutral. Use `RAMP_DARK` on dark grounds
  and `RAMP_LIGHT` on light grounds from `_shared/heat.js` (OKLCH, monotonic lightness, colour-blind safe by
  lightness).
- Danger = **word + position on a thin 4-step scale + a small colour mark**. Never a filled coloured plate, never hatch.
- Pictograms: ISO 7010-style solid silhouettes, ≤ 28 px, always next to words. No emoji, no outline "feature icons"
  in tinted squares, no faces.
- Numbers in tabular figures. No condensed poster type. No cream paper. No purple/indigo gradients. Radius 0-2 px.
- Real data only: `../prototype/data/*.json`. Placeholders for scored numbers say "scored 12 Nov" (the exporter's
  date), never a made-up value.
- WebGL is an enhancement: a 2D fallback, `prefers-reduced-motion` freezes on a frame, `?still&h=14` freezes the
  hour for screenshots, DPR capped at 2 (1.5 on phones). three.js pinned `three@0.186.1` via jsdelivr import map
  (0.187.0 is under two weeks old on 2026-11-11). Fonts from Google Fonts only.

## Content (identical across directions)

**Landing.** Product: Stellar Blaze, heat-stress forecasting for outdoor work in the UAE. Claim: heat levels hour by
hour, legal shift plans, warnings in six languages; summer 2026 replayed against airport thermometers on a summer
the model never trained on. Hero data: 3 Sep 2026 (hottest OMAA day-1 forecast of the summer, illustrative, not the
pre-registered day), IFS 0.25° day-1 forecast, Liljegren WBGT. NIOSH limit for heavy work (415 W) = 26.6 °C WBGT
(computed with the backend's `niosh.rel_wbgt_c`). Scoreboard rows: Midday ban only · Fixed WBGT 32 °C rule · ADOSH
zones on the raw forecast · Stellar Blaze; columns: High-zone hours warned · False alarms · 95 % interval → all
"scored 12 Nov".

**Worker Today** (390 px first; 1440 shows it centred or in a phone-width column). Site "Mussafah M-14 yard",
"Crew B · concrete pour", Thursday 3 Sep, now 11:10. Level now **Red** (product level names: Green, Amber, Orange,
Red), until 17:00; then Orange to 19:00. Midday break by law 12:30 to 15:00. Actions (draft wording, awaiting clinical
review): "Work 20 minutes, rest 40 minutes in shade" · "Drink 1.2 litres of water or more every hour" · "Never work
alone". Hour strip/curve 06:00 to 19:00 from `omaa_2026_ifs_d1_wbgt_hourly.json`, day `2026-09-03`. Controls:
Listen (audio), "I feel unwell" (always reachable, one tap), language one-tap (EN · اردو · हिन्दी · বাংলা · नेपाली ·
العربية), tabs Today · Alerts · My data. Footnote: "Design still: the level is a design state; at build it comes from
the site policy (ADOSH zones). Curve: ECMWF IFS day-1 forecast WBGT at OMAA, 3 Sep 2026."

**Zero-form site setup** (supervisor or HSE). One sentence, typed or spoken: "Two crews, 40 workers, Mussafah,
concrete work this week". The assistant returns a **preview card** with each field and where it came from:
Site = Mussafah (from your sentence, located on the map: 24.36 N 54.50 E, drag to fix) · Crews = 2 (from your
sentence) · Workers = 40, split 20 / 20 (assumed: confirm) · Work = concrete pour → heavy work (inferred) · Dates =
Wed 11 to Sun 15 Nov 2026 (inferred from "this week"; today is Wed 11 Nov; editable) · Midday ban = not in force (the ban runs 15 Jun to
15 Sep, from the ruleset) · Acclimatisation = everyone counted as new (not acclimatised), the protective NIOSH default; one tap
per crew marks experienced workers (a start date alone cannot tell new from experienced: research/friction.md §0). It asks back **one** question: "When does the shift start?" with
chips 06:00 · 07:00 · Other. Then "Add the roster: CSV or a photo" with the note "A photo is read on this phone. Names never
leave it; only crew counts and shift times are sent" (on-device OCR, research/friction.md §11). A badge on the sentence step: "Site details only, no names: may use a
managed AI model (ADR 0010 §8)". Primary action "Create site"; secondary "Edit". No form wall: at most one question
visible at a time.

## Data files
- `prototype/data/uae_ifs025_d1_wbgt_2026-09-03.json`: `wbgt_c[lat][lon][hour]`, 17 × 22 × 24, local hours.
- `prototype/data/omaa_2026_ifs_d1_wbgt_hourly.json`: 139 days × 24 local hours at OMAA.
- `prototype/data/omaa_2026_ifs_d1_wbgt_dailymax.json`, `prototype/data/coast.json` (Natural Earth 10 m).

## Amendment 2026-11-12 (ADR 0038, Proposed)
Any typed sentence, transcript or microphone capture is PERSONAL: self-hosted STT + LLM only, never a managed model. The
setup badge now reads "Read by our own AI on our own server, never sent to another company, deleted once you confirm.
Use crew letters, not names. Prefer a form?". Roster import is CSV only; the name column is dropped in the browser
before upload (photo OCR deferred). On the live URL (no GPU) the mic fails closed: "Voice needs our private server,
which isn't running here. Type in the form instead." Worker voice input is not offered.
