# Previous Runs issue-time audit: which IFS run feeds `previous_day1`?

Written 2026-11-14 (file name keeps 11-13 as the plan named it). B2 Task 2. This note changes no code and no number. It
is the finding that pre-registration section 0.1 refers to.

## Verdict: (c). The mapping is unverifiable, and pre-registration section 4 stands

The Open-Meteo Single Runs API does not serve `ecmwf_ifs025`, the model the corrector uses, for 2025. Requests for four
different 2025 inits were all refused with HTTP 400:

```
{"error":true,"reason":"The requested model run is not available. Model: ecmwf_ifs025, run: 2025-07-09T12:00Z"}
```

Inits tried (all `models=ecmwf_ifs025`): 2025-07-09T12:00, 2025-07-08T00:00, 2025-07-10T00:00, 2025-07-11T18:00. Each
returned the same "not available" reason (calls 5, 22, 23, 24; call 2 was an earlier attempt at the first init that was
refused for an unrelated reason of mine, see "Mistake made" below). Without those runs there is nothing to compare the `previous_day1` and `previous_day2` values against.

Open-Meteo's own page says this is by design, not an outage (docs page
<https://open-meteo.com/en/docs/single-runs-api>, fetched 2026-11-14, SHA-256 of the fetched HTML
`efb454250860c5a6cdd5e5f48089233f18122a875aa8cd7189ab8fae262dafc9`):

> Archival runs are available from 2nd of April 2026 for most models. ECMWF IFS HRES at native 9 km resolution is
> available from March 14, 2024 (IFS Cycle 49R1 hindcasts).

and its provider table lists only "ECMWF IFS HRES 9 km" with "Available From 2024-03-14"; every other model, which
includes `ecmwf_ifs025`, falls under "Others ... 2026-04-02". The 2026 start date is beyond what this audit may request
(no data call for any 2026 date), so the onset of `ecmwf_ifs025` runs was not probed.

Consequences, stated plainly:

- Pre-registration section 4 stands unchanged: the headline `lead_days = 1` is worded "forecast made about 24 hours
  ahead", and only the `lead_days = 2` numbers may carry the "issued by 18:00 GST the evening before" stamp. The
  amendment that section 0.1 allows (restoring the original wording for `lead_days = 1`) is **not** supported by this
  audit, and the audit also does not contradict section 0.1. Nothing here changes any number.
- The "forecast as issued at 18:00 the evening before" stamp must not be used for `previous_day1`. That is the same
  position the draft already takes.

## What was tried, and why the 9 km proxy does not rescue the audit

`ecmwf_ifs` (IFS HRES 9 km) Single Runs do answer for 2025 (HTTP 200 for all 16 inits 2025-07-08 .. 2025-07-11, 00/06/12/18
UTC; calls 6-21). Two checks show they cannot stand in for `ecmwf_ifs025`:

1. **The Previous Runs API has no 9 km previous-day values for that period.** Call 3 (`models=ecmwf_ifs`, 2025-07-10 ..
   2025-07-12) returned `temperature_2m_previous_day1` and `_previous_day2` as null for 72 of 72 hours, so the 9 km model
   has no `previous_dayN` series to explain.
2. **The `ecmwf_ifs025` previous-day values do not line up with any 9 km init.** The two products are different grids
   (cell 24.5, 54.75 for ifs025 versus 24.4288, 54.6532 for the 9 km product) and different model setups (the 2025 9 km
   runs are labelled hindcasts of a later IFS cycle). Matching `ecmwf_ifs025` `previous_day1` and `previous_day2` against
   the 16 9 km runs at tolerance 0.05 degrees C gave, over the 42 valid hours (3 dates x hours 02-15 UTC):

   | Series | Hours with at least one matching 9 km init | Hours with exactly one | Mean matches per hour |
   |---|---|---|---|
   | `previous_day1` | 21 of 42 | 12 | 0.83 |
   | `previous_day2` | 11 of 42 | 7 | 0.38 |

   The matching inits are scattered over leads from 0 to 97 hours with no concentration at any lead, which is what
   chance coincidences of one-decimal values look like. If the 9 km runs were the same forecasts, nearly every hour would
   match, and at one consistent lead. So no init can be named for any hour, and this proxy result is not evidence for
   or against any mapping.

I did not spend more of the 30-call budget on this, because no further call could change the verdict: the only data that
could decide it (the `ecmwf_ifs025` runs of July 2025) are refused, and the date range that would serve them is the
2026 hold-out.

## Table: publication times from the ECMWF Set I schedule (the part that can be cited)

Source: ECMWF Confluence, "Dissemination schedule" (Data and Charts), fetched 2026-11-14; the page says "last updated by
Yigit Altintas on Oct 07, 2026" and "All times on this page are UTC". SHA-256 of the fetched HTML
`b6615b2e04c43199a32aabdc9650123c464dfbf5c4a957e9deaacccd242ac5f5`. The block used is the one with
`class=od, stream=oper/wave`, "Published as: Set I, Set II", row `oper fc`. The page lists it under the heading
"IFS Medium-range Control Forecast" (`ModelName: ifs-ens-cf`); I did not verify why the oper (high-resolution) forecast
sits under that heading, and I quote the page as it reads. It notes "The 06z and 18z runs are capped at step 144 (Day 6)".
Times are when each step "starts transferring to your server"; windows span the first and last step.

| Init (UTC) | Steps 0-90 hourly | Steps 93-144 | Steps 150-360 | Last step starts | Complete by 14:00 UTC on D-1 (18:00 GST)? |
|---|---|---|---|---|---|
| 00z | 05:45 -> 06:12 | 06:12 -> 06:27 | 06:29 -> 07:34 | 07:34 | yes, if the run is from D-1 or earlier |
| 06z | 11:45 -> 12:12 | 12:12 -> 12:27 | none (capped at 144) | 12:27 | yes, if the run is from D-1 or earlier |
| 12z | 17:45 -> 18:12 | 18:12 -> 18:27 | 18:29 -> 19:34 | 19:34 | **no** for 12z D-1 (starts 17:45 UTC, 3 h 45 min after the cut-off); yes for 12z D-2 |
| 18z | 23:45 -> 00:12 (next day) | 00:12 -> 00:27 (next day) | none (capped at 144) | 00:27 (next day) | **no** for 18z D-1; yes for 18z D-2 (done 00:27 UTC on D-1) |

So at 18:00 GST (14:00 UTC) on D-1 the newest run anyone could hold is 06z D-1, and the 12z D-1 run is not there yet.
This is dissemination to a paying customer (Set I). The pre-registration notes that open data are released at or after
the end of that schedule; I did not re-check that claim.

Two caveats on the schedule, neither of which changes the verdict:

- The page is a 2026-10-07 revision. The July 2025 schedule may have differed; the page has no history I could read.
- **Correction to the draft:** pre-registration section 0.1 quotes the 06 UTC run as disseminated "about 11:45 to 13:34
  UTC". The page shows 11:45 to 12:27 (06z stops at step 144, and 13:34 appears nowhere on it); the 00z and 12z runs
  end at 07:34 and 19:34 because they carry steps 150-360. The 06z end time is earlier than quoted, so the draft's
  conclusion (06z D-1 is in time, 12z D-1 is not) is unchanged. The draft's wording should be fixed by whoever owns it.

## Table: per valid hour, the init behind `previous_day1` (not measurable; shown for the record)

Measured: nothing, so every cell is "unverified". For orientation only, the table gives what Open-Meteo's sentence
("the value predicted 24 hours before valid time") would imply if it means "the latest init at or before valid time minus
24 h". This is a hypothesis taken from the docs text, not a finding of this audit.

| Valid hour on D (UTC / GST) | Init if the 24 h reading holds | Lead | Set I complete by 14:00 UTC D-1? | Measured init |
|---|---|---|---|---|
| 02-05 / 06-09 | 00z D-1 | 26-29 h | yes (07:34 UTC) | unverified |
| 06-11 / 10-15 | 06z D-1 | 24-29 h | yes (12:27 UTC) | unverified |
| 12-15 / 16-19 | 12z D-1 | 24-27 h | **no** (from 17:45 UTC) | unverified |

Under this reading `previous_day1` is available by 18:00 GST for valid hours up to
11 UTC and not for 12-15 UTC, which is the (b) pattern with X = 12. It is shown only because section 0.1 already
asserts it; this audit could not confirm or refute it, so the verdict is (c), not (b).

## Matching tolerance and what was fetched

- Tolerance 0.05 degrees C (Open-Meteo serves temperature at one decimal, so this is equality at 0.1 resolution).
- Station OMAA at 24.4330, 54.6511 (`backend/src/stellar_blaze/domain/weather/stations.py`), `timezone=UTC`, valid dates
  2025-07-10 .. 2025-07-12, hours 02-15 UTC. Previous Runs base URL
  `https://previous-runs-api.open-meteo.com/v1/forecast` (as `backend/.../open_meteo.py`); Single Runs
  `https://single-runs-api.open-meteo.com/v1/forecast` with the `run=` parameter from the docs page above.
- 24 data calls of the 30 allowed, none for a 2026 date; the script refuses one. No 429 occurred. TLS verification is
  httpx2's default. The only other fetches were three documentation pages (not data calls).
- Raw bodies are kept outside the repo, in
  `C:\Users\LEGION\AppData\Local\Temp\claude\c9efb48f6f935e8c\014d9cea-9854-40c1-ad4e-9698e91ae2e0\scratchpad\issue-time-audit\`,
  with `manifest.json` (URL, status, hash per call) and `analysis.json`. Re-analysis without network:
  `cd backend && UV_PYTHON=3.13.15 uv run --frozen python ../docs/research/scripts/issue_time_audit.py --offline --out <that directory>`.

## SHA-256 of every raw response body

All 24 bodies are listed, including the refusals, because the verdict rests on them. Calls 1 and 3 are the Previous Runs
series; the rest are Single Runs.

| # | API | Model | Run (UTC) | HTTP | SHA-256 |
|---|---|---|---|---|---|
| 1 | previous_runs | ecmwf_ifs025 | - | 200 | `39ea45184ff8756c0415f25eba88e91e87514d9978b5e74c24952a4003bafe7d` |
| 2 | single_run | ecmwf_ifs025 | 2025-07-09T12:00 | 400 (start_date set; my mistake) | `e3804bf5dd78f853f82df40dcbfe50494ae53d3851453e380588d89d048a0c3a` |
| 3 | previous_runs | ecmwf_ifs | - | 200 (previous-day values all null) | `225e773141b80ef1cea6ce5298f7a9b436b3e3722745c678baba8df0f079d849` |
| 4 | single_run | ecmwf_ifs | 2025-07-09T12:00 | 400 (start_date set; my mistake) | `9445fb59e32ec3553a9038de3f699e269488be1f1886da4be32968ec3a87609e` |
| 5 | single_run | ecmwf_ifs025 | 2025-07-09T12:00 | 400 not available | `a5338aab1535d59fa3ac6c282964be704beb4bfc1c4ae6e13037892024666d2d` |
| 6 | single_run | ecmwf_ifs | 2025-07-09T12:00 | 200 | `12d896219a9ad5a255f1528daa94f938e888ea449a08fd5980aa9630c6826d83` |
| 7 | single_run | ecmwf_ifs | 2025-07-08T00:00 | 200 | `322cf23a71c70e0a9c312ef0fb304e7998ed0af306ffa7122737542fa2f4646f` |
| 8 | single_run | ecmwf_ifs | 2025-07-08T06:00 | 200 | `c22f2821d4a3ad8041490cab0b83a53303f5b73e333e6dc8c2bc168de58c1784` |
| 9 | single_run | ecmwf_ifs | 2025-07-08T12:00 | 200 | `063042b5ae7a663e61baea5b5de5624c24190dd4e66ed0a6c6a6d63f77fd8144` |
| 10 | single_run | ecmwf_ifs | 2025-07-08T18:00 | 200 | `de85cf5ab01fa3ff579696acaa52259d48e57da9ed6048d8e70c64e0ddfab105` |
| 11 | single_run | ecmwf_ifs | 2025-07-09T00:00 | 200 | `b3450ed4d38a89700549f79d326fd4175bc983ed954ccb3a07cd79497851f7d1` |
| 12 | single_run | ecmwf_ifs | 2025-07-09T06:00 | 200 | `8ca61157c69464aad5e7c6f9e960b5703fbd076f1ab67b2c2a128de3796ec6f9` |
| 13 | single_run | ecmwf_ifs | 2025-07-09T18:00 | 200 | `da40e69c6c9cdc83097db131e89755b8fcae6d9ce4f813bba8be2a78dac89d3c` |
| 14 | single_run | ecmwf_ifs | 2025-07-10T00:00 | 200 | `81bd8719bd6ebe866bc87b53175fed6af838ad6bb71cbe3f49057981fd7e345c` |
| 15 | single_run | ecmwf_ifs | 2025-07-10T06:00 | 200 | `4f7cd136067f549932f15b6ed8e2eff91a979f793a1ef9d23a907481b2cd7fb0` |
| 16 | single_run | ecmwf_ifs | 2025-07-10T12:00 | 200 | `96df9e4adc681e550b4e771a62bee31732877183b92261a51f7124271ba0d636` |
| 17 | single_run | ecmwf_ifs | 2025-07-10T18:00 | 200 | `1330feaf75b73be46cdc9100b0537439ce209d1580321f3634350e7d5e8c32aa` |
| 18 | single_run | ecmwf_ifs | 2025-07-11T00:00 | 200 | `507f18d2993c807bd23d73cc269a7ccb5b32b9b2f8bf92a93e369860b32d56b6` |
| 19 | single_run | ecmwf_ifs | 2025-07-11T06:00 | 200 | `3bd4604814c68275387f84af66ce7bc6f272993e6d68cf9dfcc41cbe328c0adb` |
| 20 | single_run | ecmwf_ifs | 2025-07-11T12:00 | 200 | `47a70246ce5605d8f696770167fe308cf972099d09450927ad85d0c076614b6e` |
| 21 | single_run | ecmwf_ifs | 2025-07-11T18:00 | 200 | `27de1105eaacf9b863dee46c7008348474b55f665abc8c9527884bc2ba85f964` |
| 22 | single_run | ecmwf_ifs025 | 2025-07-08T00:00 | 400 not available | `48f7467d15ae83775224d5aaace68798983c6ec4e5bcbae4f38bd6a565ae3ea4` |
| 23 | single_run | ecmwf_ifs025 | 2025-07-10T00:00 | 400 not available | `e59b250e5babccba9d03936da71dee43982f34b6b5eac96d485e234a59fb99a7` |
| 24 | single_run | ecmwf_ifs025 | 2025-07-11T18:00 | 400 not available | `327a76d94668eb97e2d760f7f74e218c861cee5c4c978004acdece7d496a9869` |

Documentation pages fetched (not data calls): Single Runs docs `efb45425...afc9` (above); Previous Runs docs
<https://open-meteo.com/en/docs/previous-runs-api> `a7da1d29b71fac2d14446870a18c0418c42437660c65837ce41da0d726470412`,
which defines `_previous_day1` as "the value predicted 24 hours before valid time" and does not name the run;
ECMWF schedule `b6615b2e...5ac5f5` (above).

## Mistake made, disclosed

The first two single-run calls (2 and 4) sent `start_date` and `end_date` as the Forecast API does. The Single Runs API
answers `{"reason":"Parameter 'start_date' must not be set","error":true}` (the docs say it "accepts the same parameters",
which is not quite true: the date window is not accepted, the response runs from the init forward 168 h). That cost two
of the 30 calls and is why call 5 repeats a probe. It did not affect the verdict, because the later `ecmwf_ifs025`
probes (5, 22-24) omit the date parameters and are refused for a different, explicit reason.

## What would settle it, parked (not done)

- The mapping can be measured only on a model whose runs are served and which also has previous-day values. For
  `ecmwf_ifs025` that is possible only from 2026-04-02 onwards, which the hold-out rule forbids for this audit. Either the
  controller runs a Single Runs audit on a post-hold-out date range, or Open-Meteo is asked what `previous_day1` means (a
  GitHub discussion on open-meteo/open-meteo). Neither is needed for the demo: section 4 already brackets the issue time
  with `lead_days = 1` (slightly optimistic) and `lead_days = 2` (strict).
- Fix the 06z dissemination end time quoted in section 0.1 (12:27, not 13:34).
