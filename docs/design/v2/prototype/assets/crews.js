// Supervisor data layer for the v2-final prototype (S0-S3). Plain ES module; reads only data/*.json via heat.js.
// REAL: the hourly WBGT values (Open-Meteo IFS 0.25 day-1 forecast at OMAA, Thu 3 Sep 2026, Liljegren WBGT).
// ASSUMED (labelled on every screen): the site, the four crews, their tasks, headcounts and shifts.
// PROXY (labelled in "Why?"): the level per hour. The product level comes from the B3 risk policy (ADOSH TWL zones on
// the corrected forecast), which is not in the prototype data. Here the level is the WBGT forecast against workload
// bands. Mapping (ADR 0011 §2.6 wins): Green = Low zone, Amber = Medium, Orange = High (work 20 / rest 40), Red = stop
// work (B3 policy band). Bands chosen so heavy work is Orange 10:00 to 17:00 on 3 Sep. Never shown as a scored number.
import { loadJSON } from './heat.js';

export const REPLAY = { day: '2026-09-03', label: 'Thu 3 Sep 2026', at: new Date(Date.UTC(2026, 8, 3, 7, 10)), now: 11 + 10 / 60 };
export const SITE = { name: 'Mussafah M-14 yard', lat: 24.36, lon: 54.5, ban: [12.5, 15], station: 'OMAA' };
export const LEVELS = ['Green', 'Amber', 'Orange', 'Red'];
export const LV_CLASS = ['lv-green', 'lv-amber', 'lv-orange', 'lv-red'];
// lower bounds (°C WBGT) of Amber, Orange, Red per workload class. Proxy, see header.
export const BANDS = { heavy: [30, 34, 39], moderate: [31.5, 35.5, 40.5], light: [33, 37, 42] };
export const BANDS_TEXT = 'Prototype levels: Green = Low zone (self-paced), Amber = Medium (work 45 / rest 15), Orange = High (work 20 / rest 40), Red = stop work (B3 policy band). Proxy until the policy is scored: IFS WBGT against workload bands (heavy: Amber from 30 °C, Orange from 34, Red from 39; moderate +1.5 °C; light +3 °C).';

export const CREWS = [
  { id: 'A', task: 'Rebar fixing', workload: 'heavy', n: 12, shifts: [[6, 11], [15, 18]], plan: 'Signed 05:40', langs: ['hi', 'ne'] },
  { id: 'B', task: 'Concrete pour', workload: 'heavy', n: 20, shifts: [[6, 18]], plan: 'Unsigned', langs: ['ur', 'hi', 'bn'] },
  { id: 'C', task: 'Formwork', workload: 'moderate', n: 9, shifts: [[6, 18]], plan: 'Changed since signed', langs: ['ur', 'en'] },
  { id: 'D', task: 'Survey and inspection', workload: 'light', n: 4, shifts: [[7, 16]], plan: 'Signed 05:52', langs: ['en', 'ar'] },
];
export const LANG = { en: 'English', ar: 'العربية', ur: 'اردو', hi: 'हिन्दी', bn: 'বাংলা', ne: 'नेपाली' };
export const LANG_EN = { en: 'English', ar: 'Arabic', ur: 'Urdu', hi: 'Hindi', bn: 'Bengali', ne: 'Nepali' };

export async function replayDay() {
  const s = await loadJSON('omaa_2026_ifs_d1_wbgt_hourly.json');
  const i = s.days.indexOf(REPLAY.day);
  if (i < 0) throw new Error(`replay day ${REPLAY.day} missing from the OMAA series`);
  return s.wbgt_c_by_local_hour[i];
}

export const levelOf = (v, workload) => BANDS[workload].reduce((lv, b) => (v >= b ? lv + 1 : lv), 0);
export const onShift = (crew, t) => crew.shifts.some(([a, b]) => t >= a && t < b);
export const inBan = (t) => t >= SITE.ban[0] && t < SITE.ban[1];
export const fmt = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
export const dur = (h) => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };
export const crewById = (id) => CREWS.find((c) => c.id === id) || CREWS[1];

// per-crew status at time t: level now (if working), when it ends, next shift start
export function status(crew, day, t = REPLAY.now) {
  const lvAt = (h) => levelOf(day[Math.floor(h)], crew.workload);
  const working = onShift(crew, t);
  const start = working ? t : (crew.shifts.find(([a]) => a > t) || [null])[0];
  if (start == null) return { working: false, done: true, rank: -1 };
  const lv = lvAt(start);
  let until = Math.floor(start) + 1;
  // hours wholly inside the midday ban do not end a level run (nobody works then)
  while (until < 24 && (inBan(until) && inBan(until + 0.99) || lvAt(until) === lv) && crew.shifts.some(([a, b]) => until >= a && until < b)) until++;
  const end = Math.max(...crew.shifts.map(([, b]) => b));
  const worst = Math.max(...crew.shifts.flatMap(([a, b]) => Array.from({ length: b - a }, (_, k) => a + k)).filter((h) => h + 1 > t && !inBan(h + 0.5)).map(lvAt));
  return { working, start, lv, until: Math.min(until, end), end, worst, rank: lv * 10 + (working ? 1 : 0) };
}
export const ranked = (day) => CREWS.map((c) => ({ crew: c, st: status(c, day) })).sort((a, b) => b.st.rank - a.st.rank || a.crew.id.localeCompare(b.crew.id));

// ---------- rule plan (ADR 0011 §2, simplified for the prototype; 5 min ticks) ----------
// Cycles (ADOSH Table 1, heavy work, as v1 carried them): Amber = Medium zone 45 work / 15 rest; Orange = High zone
// 20 work / 40 rest; Green = Low zone, self-paced; Red = all work stops (ADR 0011 §2.6). Non-heavy crews use the heavy table (protective default
// until the reviewed table lands). Art. 18: a 1 h break inside any run over 5 h, at the hottest hour that keeps both
// sides at or under 5 h; ADOSH rest and ban time are not credited. Midday ban 12:30 to 15:00.
const CYCLE = [null, [45, 15], [20, 40], null];
const ZONE = ['Low', 'Medium', 'High', 'Red'];
const capOf = (lv) => (lv === 3 ? 0 : CYCLE[lv] ? CYCLE[lv][0] : 60);
export const CLAUSE = {
  work: (lv) => (lv === 0 ? 'ADOSH Table 1, Low zone: self-paced work' : `ADOSH Table 1, ${ZONE[lv]} zone, heavy work: ${CYCLE[lv][0]} work / ${CYCLE[lv][1]} rest`),
  rest: (lv) => `ADOSH Table 1, ${ZONE[lv]} zone, heavy work: ${CYCLE[lv][0]} work / ${CYCLE[lv][1]} rest. Rest in shade, paid`,
  art18: () => 'Labour Law Art. 18: a 1 h break so no run passes 5 h. ADOSH rest and ban time not credited (our reading, open question)',
  stop: () => 'Stop-work rule, ADR 0011 §2.6: all work stops while the level is Red (B3 policy band). Stops never wait for sign-off',
  ban: () => 'Midday ban, MR 44/2022: no outdoor work 12:30 to 15:00, 15 Jun to 15 Sep',
};
export function plan(crew, day) {
  const lvAt = (t) => levelOf(day[Math.floor(t)], crew.workload);
  const art18 = [];
  for (const [a, b] of crew.shifts) {
    const segs = [[a, Math.min(b, SITE.ban[0] > a && SITE.ban[0] < b ? SITE.ban[0] : b)], [SITE.ban[1] > a && SITE.ban[1] < b ? SITE.ban[1] : null, b]].filter(([x, y]) => x != null && y > x);
    for (const [x, y] of segs) {
      if (y - x <= 5) continue;
      let best = null;
      for (let s = Math.ceil(x); s + 1 <= y; s++) if (s - x <= 5 && y - (s + 1) <= 5 && (!best || day[s] > day[best])) best = s;
      if (best != null) art18.push([best, best + 1]);
    }
  }
  const ticks = [];
  let mode = 'work', run = 0;
  for (let t = 6; t < 18; t += 1 / 12) {
    const tt = Math.round(t * 12) / 12;
    if (!onShift(crew, tt + 1e-6)) { ticks.push({ t: tt, k: 'off' }); mode = 'work'; run = 0; continue; }
    if (inBan(tt + 1e-6)) { ticks.push({ t: tt, k: 'ban' }); mode = 'work'; run = 0; continue; }
    if (art18.some(([a, b]) => tt + 1e-6 >= a && tt < b)) { ticks.push({ t: tt, k: 'art18', lv: lvAt(tt) }); mode = 'work'; run = 0; continue; }
    const lv = lvAt(tt), c = CYCLE[lv];
    if (lv === 3) { ticks.push({ t: tt, k: 'stop', lv }); mode = 'work'; run = 0; continue; }
    if (!c) { mode = 'work'; run += 5; ticks.push({ t: tt, k: 'work', lv }); continue; }
    if (mode === 'work' && run >= c[0]) { mode = 'rest'; run = 0; }
    else if (mode === 'rest' && run >= c[1]) { mode = 'work'; run = 0; }
    // rolling 60 min cap: the window ending at this tick, capped by the most severe zone worked in it
    if (mode === 'work') {
      const win = ticks.slice(-11).filter((x) => x.k === 'work');
      if ((win.length + 1) * 5 > Math.min(c[0], ...win.map((x) => capOf(x.lv)))) { mode = 'rest'; run = 0; }
    }
    run += 5; ticks.push({ t: tt, k: mode, lv });
  }
  const blocks = [];
  for (const k of ticks) {
    const last = blocks.at(-1);
    if (last && last.k === k.k && (k.k === 'off' || k.k === 'ban' || k.k === 'art18' || k.k === 'stop' || last.lv === k.lv)) last.to = k.t + 1 / 12;
    else blocks.push({ k: k.k, lv: k.lv, from: k.t, to: k.t + 1 / 12 });
  }
  for (const b of blocks) { b.from = Math.round(b.from * 12) / 12; b.to = Math.round(b.to * 12) / 12; }
  return blocks;
}
// independent validator (ADR 0011 §3): its own tick scan, shares only levelOf. Rolling 60 min windows: work minutes
// <= the cap of the most severe zone worked in the window; no work inside the ban.
export function validate(crew, day, blocks) {
  const fails = [];
  const cap = (lv) => [60, 45, 20, 0][lv];
  const work = (t) => blocks.some((b) => b.k === 'work' && t >= b.from - 1e-6 && t < b.to - 1e-6);
  for (let i = 0; i < 144; i++) {
    const t = 6 + i / 12;
    if (work(t) && inBan(t + 1e-6)) { fails.push(`Work at ${fmt(t)} inside the midday ban`); break; }
    const w = []; for (let k = 0; k < 12; k++) { const u = t + k / 12; if (u < 18 && work(u)) w.push(levelOf(day[Math.floor(u + 1e-6)], crew.workload)); }
    if (w.length && w.length * 5 > Math.min(...w.map(cap))) { fails.push(`${w.length * 5} min of work in the hour from ${fmt(t)}; the cap is ${Math.min(...w.map(cap))} min`); break; }
  }
  return fails;
}
// items that need a per-item acknowledgement before sign-off (Medium/High work), grouped by level run
export function ackItems(blocks) {
  const items = [];
  for (const b of blocks.filter((x) => (x.k === 'work' || x.k === 'rest') && x.lv > 0)) {
    const last = items.at(-1);
    if (last && last.lv === b.lv && Math.abs(last.to - b.from) < 1e-6) last.to = b.to;
    else items.push({ lv: b.lv, from: b.from, to: b.to });
  }
  return items.map((i) => ({ ...i, text: `${ZONE[i.lv]} zone work, ${fmt(i.from)} to ${fmt(i.to)}: ${CYCLE[i.lv][0]} work / ${CYCLE[i.lv][1]} rest${i.lv === 3 ? ' (Red)' : ''}` }));
}

// ---------- shared top bar ----------
export function topbar({ back, title, sub } = {}) {
  return `<header class="sbar">
    ${back ? `<a class="back" href="${back.href}" aria-label="Back to ${back.label}"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" fill="none"/></svg></a>` : `<a class="wordmark" href="index.html">Stellar Blaze</a>`}
    <div class="ttl"><p class="t">${title}</p><p class="s">${sub}</p></div>
    <p class="clock" aria-label="Replay time 11:10">11:10</p>
    <button class="sun-toggle" type="button" data-sun-toggle></button>
  </header>`;
}
