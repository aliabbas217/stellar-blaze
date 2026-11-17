// Judge-surface helpers (landing + judge-season/day/proof/next). Owned by the landing builder, not part of the kit.
// Every value drawn here comes from data/*.json; scored results are PENDING until the exporter writes them.
import { RAMP_DARK, css, DATA } from './heat.js';
import { fmt } from './kit.js';

export const LIMIT = 26.6;                 // NIOSH REL, heavy work (415 W), acclimatised, WBGT °C
export const BAN = { from: '2026-06-15', to: '2026-09-15', h: [12.5, 15] }; // UAE midday break, ruleset
export const WORK = [6, 19];               // working hours counted on the landing: hour starts 06..18

// story order (journeys §6.3 / P7): problem → scoreboard → day → proof → product → next
export const STEPS = [
  { id: 'problem', label: 'The problem', href: 'index.html?step=problem' },
  { id: 'scoreboard', label: 'Scoreboard', href: 'judge-season.html' },
  { id: 'day', label: 'One day', href: 'judge-day.html' },
  { id: 'proof', label: 'Proof', href: 'judge-proof.html' },
  { id: 'product', label: 'The product', href: 'index.html?step=product' },
  { id: 'next', label: "What's next", href: 'judge-next.html' },
];

// fetch a data file once, keep its bytes so the proof drawer can show a real SHA-256 of what was drawn
const cache = new Map();
export function loadData(name) {
  if (!cache.has(name)) cache.set(name, (async () => {
    const r = await fetch(new URL(name, DATA));
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return { json: JSON.parse(new TextDecoder().decode(buf)), buf, bytes: buf.byteLength };
  })());
  return cache.get(name);
}
export async function sha256(buf) {
  if (!crypto?.subtle) return null;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- facts, derived from the hourly file (never typed in) ----------
export function seasonFacts(s) {
  const W = s.wbgt_c_by_local_hour, D = s.days;
  const i0 = D.indexOf(BAN.from), i1 = D.indexOf(BAN.to);
  let n = 0, over = 0, inBan = 0;
  const peaks = W.map((row) => Math.max(...row.filter((v) => v != null)));
  const perDay = W.map((row, i) => { let o = 0; for (let h = WORK[0]; h < WORK[1]; h++) { const v = row[h]; if (v == null) continue; n++; if (v > LIMIT) { o++; over++; if (i >= i0 && i <= i1 && h >= 12 && h <= 14) inBan++; } } return o; });
  const pk = Math.max(...peaks), pkI = peaks.indexOf(pk), lo = Math.min(...peaks), loI = peaks.indexOf(lo);
  const daysOver = peaks.filter((p) => p > LIMIT).length;
  return { n, over, inBan, outside: over - inBan, peaks, perDay, pk, pkI, pkH: W[pkI].indexOf(pk), lo, loI, daysOver, N: D.length, i0, i1 };
}

export const nf = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayLabel = (iso, wd = false) => { const d = new Date(iso + 'T12:00:00Z'); return `${wd ? WD[d.getUTCDay()] + ' ' : ''}${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

// ---------- one shared tooltip ----------
let tip;
export function tooltip(html, x, y) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'j-tip'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); }
  if (html == null) { tip.hidden = true; return; }
  tip.hidden = false; tip.innerHTML = html;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x + 14))}px`;
  tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
}

// ---------- the season ribbon: 139 daily peaks as a hypsometric silhouette with 1 °C isotherms ----------
// opts: height, upto (index of the last day revealed, for Play), notes (bool), compact (bool), onDay(i)
export function seasonRibbon(el, s, f, o = {}) {
  const w = Math.max(280, el.clientWidth), small = w < 640;
  const H = o.height || (small ? 220 : 300), padL = small ? 30 : 40, padR = small ? 8 : 16, top = o.compact ? 14 : (small ? 44 : 56);
  const VMIN = 24, VMAX = 40, base = H - 58, plotH = base - top;
  const N = s.days.length, X = (i) => padL + i / (N - 1) * (w - padL - padR), Y = (v) => base - (v - VMIN) / (VMAX - VMIN) * plotH;
  const upto = o.upto ?? N - 1;
  const pts = f.peaks.slice(0, upto + 1).map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const area = `M${X(0)},${base} L${pts.join(' L')} L${X(upto).toFixed(1)},${base} Z`;
  const id = 'rb' + Math.random().toString(36).slice(2, 7);
  let g = `<defs><clipPath id="${id}"><path d="${area}"/></clipPath></defs><g clip-path="url(#${id})">`;
  for (let k = VMIN; k < VMAX; k++) g += `<rect x="${padL}" y="${Y(k + 1)}" width="${w - padL - padR}" height="${Y(k) - Y(k + 1) + 0.5}" fill="${css(RAMP_DARK(k + 0.5))}"/>`;
  for (let k = VMIN + 1; k < VMAX; k++) g += `<line x1="${padL}" x2="${w - padR}" y1="${Y(k)}" y2="${Y(k)}" stroke="var(--ground-deep)" stroke-opacity="${k % 5 ? 0.35 : 0.7}" stroke-width="${k % 5 ? 0.75 : 1}"/>`;
  g += '</g>';
  // y ticks every 4 °C, recessive
  for (const v of [28, 32, 36, 40]) g += `<text class="j-tick" x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  g += `<text class="j-tick" x="${padL - 6}" y="${Y(40) - 14}" text-anchor="end">°C</text>`;
  // the NIOSH limit, dashed, labelled once
  g += `<line x1="${padL}" x2="${w - padR}" y1="${Y(LIMIT)}" y2="${Y(LIMIT)}" stroke="var(--ink-2)" stroke-dasharray="4 3"/>`;
  if (!o.compact) g += `<text class="j-lab" x="${w - padR}" y="${Y(LIMIT) - 6}" text-anchor="end">Heavy-work limit 26.6 °C</text>`;
  // ground + the qaylula slot cut below it for the ban period
  const sx0 = X(f.i0) - 0.5 * (X(1) - X(0)), sx1 = X(f.i1) + 0.5 * (X(1) - X(0));
  g += `<rect class="j-slot" x="${sx0}" y="${base + 1}" width="${sx1 - sx0}" height="22"/><line class="j-slot-rule" x1="${sx0}" x2="${sx0}" y1="${base + 1}" y2="${base + 23}"/><line class="j-slot-rule" x1="${sx1}" x2="${sx1}" y1="${base + 1}" y2="${base + 23}"/>`;
  g += `<text class="j-slot-lab" x="${(sx0 + sx1) / 2}" y="${base + 16}" text-anchor="middle">${small ? 'Midday break in force' : 'Midday break in force, 15 Jun to 15 Sep, 12:30 to 15:00'}</text>`;
  g += `<line x1="${padL}" x2="${w - padR}" y1="${base}" y2="${base}" stroke="var(--edge)"/>`;
  // month ticks
  for (const [d, t] of [['2026-05-15', '15 May'], ['2026-06-01', 'Jun'], ['2026-07-01', 'Jul'], ['2026-08-01', 'Aug'], ['2026-09-01', 'Sep'], ['2026-09-30', '30 Sep']]) {
    const i = s.days.indexOf(d); if (small && (t === 'Jun' || t === 'Aug')) continue;
    const a = i === 0 ? 'start' : i === N - 1 ? 'end' : 'middle';
    g += `<line x1="${X(i)}" x2="${X(i)}" y1="${base + 24}" y2="${base + 30}" stroke="var(--edge)"/><text class="j-tick" x="${X(i)}" y="${base + 44}" text-anchor="${a}">${t}</text>`;
  }
  // direct annotations
  if (o.notes !== false && upto >= f.pkI) {
    const x = X(f.pkI), y = Y(f.pk), lx = small ? x - 8 : x - 18;
    g += `<circle cx="${x}" cy="${y}" r="3" fill="var(--ink)"/><path d="M${x},${y - 4} L${x},${top - 4} L${lx},${top - 4}" fill="none" stroke="var(--ink-2)"/>`;
    g += `<text class="j-lab" x="${lx - 4}" y="${top}" text-anchor="end"><tspan font-weight="600" fill="var(--ink)">${f.pk.toFixed(1)} °C</tspan> ${dayLabel(s.days[f.pkI])}, ${String(f.pkH).padStart(2, '0')}:00${small ? '' : ', the hottest forecast'}</text>`;
  }
  if (o.notes !== false && !o.compact && !small && upto >= f.loI) {
    const x = X(f.loI), y = Y(f.lo);
    g += `<circle cx="${x}" cy="${y}" r="3" fill="var(--ink)"/><path d="M${x},${y - 4} L${x},${top + 30} L${x + 14},${top + 30}" fill="none" stroke="var(--ink-2)"/><text class="j-lab" x="${x + 18}" y="${top + 34}">Coolest day still peaked at ${f.lo.toFixed(1)} °C, ${dayLabel(s.days[f.loI])}</text>`;
  }
  if (o.upto != null && o.upto < N - 1) g += `<line x1="${X(upto)}" x2="${X(upto)}" y1="${top - 6}" y2="${base}" stroke="var(--ink)" stroke-width="2"/>`;
  el.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${o.aria || `Daily peak forecast WBGT at Abu Dhabi airport, ${N} days, 15 May to 30 Sep 2026. Every day peaks above the 26.6 °C heavy-work limit; lowest peak ${f.lo.toFixed(1)}, highest ${f.pk.toFixed(1)} on ${dayLabel(s.days[f.pkI])}. Midday break in force 15 Jun to 15 Sep.`}">${g}<rect class="j-hit" x="${padL}" y="${top}" width="${w - padL - padR}" height="${base - top}" fill="transparent"/></svg>`;
  const hit = el.querySelector('.j-hit');
  hit.addEventListener('pointermove', (e) => {
    const r = el.querySelector('svg').getBoundingClientRect(), i = Math.max(0, Math.min(upto, Math.round((e.clientX - r.left - padL) / (w - padL - padR) * (N - 1))));
    tooltip(`<b>${dayLabel(s.days[i], true)}</b><br>Peak ${f.peaks[i].toFixed(1)} °C<br>${f.perDay[i]} of 13 working hours over 26.6 °C${i >= f.i0 && i <= f.i1 ? '<br>Midday break in force' : ''}`, e.clientX, e.clientY);
  });
  hit.addEventListener('pointerleave', () => tooltip(null));
  return { X, Y, base };
}

// ---------- the problem: days × working hours, the slot cut in ----------
export function heatCalendar(el, s, f) {
  const w = Math.max(300, el.clientWidth), small = w < 640;
  const padL = small ? 34 : 44, padT = small ? 8 : 10, ch = small ? 15 : 22, rows = WORK[1] - WORK[0];
  const N = s.days.length, cw = (w - padL - 4) / N, H = padT + rows * ch + 40;
  const X = (i) => padL + i * cw, Y = (h) => padT + (h - WORK[0]) * ch;
  let g = '';
  s.wbgt_c_by_local_hour.forEach((row, i) => { for (let h = WORK[0]; h < WORK[1]; h++) { const v = row[h];
    g += `<rect x="${X(i).toFixed(2)}" y="${Y(h)}" width="${Math.max(0.6, cw - (cw > 4 ? 1 : 0.35)).toFixed(2)}" height="${ch - 1}" fill="${v > LIMIT ? css(RAMP_DARK(v)) : 'var(--raised)'}"/>`; } });
  // the qaylula slot, recessed: the hours the law already stops
  const sx0 = X(f.i0), sx1 = X(f.i1 + 1), sy0 = Y(BAN.h[0]), sy1 = Y(BAN.h[1]);
  g += `<rect class="j-slot" x="${sx0}" y="${sy0}" width="${sx1 - sx0}" height="${sy1 - sy0}" fill-opacity="0.86"/><line class="j-slot-rule" x1="${sx0}" x2="${sx1}" y1="${sy0}" y2="${sy0}"/><line class="j-slot-rule" x1="${sx0}" x2="${sx1}" y1="${sy1}" y2="${sy1}"/>`;
  g += `<text class="j-slot-lab" x="${(sx0 + sx1) / 2}" y="${(sy0 + sy1) / 2 + 4}" text-anchor="middle">${small ? 'Midday break' : `Midday break: ${nf(f.inBan)} of the hot hours`}</text>`;
  for (const h of [6, 9, 12, 15, 18]) g += `<text class="j-tick" x="${padL - 8}" y="${Y(h) + ch / 2 + 4}" text-anchor="end">${String(h).padStart(2, '0')}:00</text>`;
  for (const [d, t] of [['2026-05-15', '15 May'], ['2026-06-15', '15 Jun'], ['2026-07-15', '15 Jul'], ['2026-08-15', '15 Aug'], ['2026-09-15', '15 Sep']]) {
    const i = s.days.indexOf(d), x = X(i) + cw / 2; if (small && (t === '15 Jul' || t === '15 Aug')) continue;
    g += `<line x1="${x}" x2="${x}" y1="${Y(WORK[1]) + 2}" y2="${Y(WORK[1]) + 8}" stroke="var(--edge)"/><text class="j-tick" x="${x}" y="${Y(WORK[1]) + 22}" text-anchor="${i === 0 ? 'start' : 'middle'}">${t}</text>`;
  }
  el.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="Every working hour, 06:00 to 19:00, of ${N} days from 15 May to 30 Sep 2026, forecast at Abu Dhabi airport. ${nf(f.over)} of ${nf(f.n)} hours are above the 26.6 °C heavy-work limit; the midday break covers ${nf(f.inBan)} of them.">${g}<rect class="j-hit" x="${padL}" y="${padT}" width="${N * cw}" height="${rows * ch}" fill="transparent"/></svg>`;
  const hit = el.querySelector('.j-hit');
  hit.addEventListener('pointermove', (e) => {
    const r = el.querySelector('svg').getBoundingClientRect(), i = Math.max(0, Math.min(N - 1, Math.floor((e.clientX - r.left - padL) / cw))), h = Math.max(WORK[0], Math.min(WORK[1] - 1, WORK[0] + Math.floor((e.clientY - r.top - padT) / ch)));
    const v = s.wbgt_c_by_local_hour[i][h], ban = i >= f.i0 && i <= f.i1 && h >= 12 && h <= 14;
    tooltip(`<b>${dayLabel(s.days[i], true)}, ${String(h).padStart(2, '0')}:00</b><br>${v.toFixed(1)} °C forecast${v > LIMIT ? ', over the limit' : ', under the limit'}${ban ? '<br>Inside the midday break window' : ''}`, e.clientX, e.clientY);
  });
  hit.addEventListener('pointerleave', () => tooltip(null));
}

// ---------- one day: hours on x, raw forecast dashed, the slot below the ground ----------
// pending: list of series that are not computed yet (drawn in the legend only, never as marks)
export function dayChart(el, values, o = {}) {
  const w = Math.max(280, el.clientWidth), small = w < 640;
  const from = o.from ?? 5, to = o.to ?? 20, H = o.height || (small ? 260 : 360);
  const padL = small ? 32 : 44, padR = small ? 10 : 20, top = 30, base = H - 64, VMIN = 24, VMAX = 40;
  const X = (h) => padL + (h - from) / (to - from) * (w - padL - padR), Y = (v) => base - (v - VMIN) / (VMAX - VMIN) * (base - top);
  let g = '';
  for (const v of [28, 32, 36, 40]) g += `<line x1="${padL}" x2="${w - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--hair)"/><text class="j-tick" x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  g += `<text class="j-tick" x="${padL - 6}" y="${top - 14}" text-anchor="end">°C</text>`;
  // ban edges through the plot (hairlines), the slot itself below the ground
  if (o.ban) {
    const a = X(o.ban[0]), b = X(o.ban[1]);
    g += `<line x1="${a}" x2="${a}" y1="${top}" y2="${base}" stroke="var(--edge)" stroke-dasharray="1 3"/><line x1="${b}" x2="${b}" y1="${top}" y2="${base}" stroke="var(--edge)" stroke-dasharray="1 3"/>`;
    g += `<rect class="j-slot" x="${a}" y="${base + 1}" width="${b - a}" height="22"/><line class="j-slot-rule" x1="${a}" x2="${a}" y1="${base + 1}" y2="${base + 23}"/><line class="j-slot-rule" x1="${b}" x2="${b}" y1="${base + 1}" y2="${base + 23}"/>`;
    g += `<text class="j-slot-lab" x="${(a + b) / 2}" y="${base + 16}" text-anchor="middle">${small ? 'Break' : 'Midday break'}</text>`;
  }
  g += `<line x1="${padL}" x2="${w - padR}" y1="${Y(LIMIT)}" y2="${Y(LIMIT)}" stroke="var(--ink-2)" stroke-dasharray="4 3"/><text class="j-lab" x="${w - padR}" y="${Y(LIMIT) + 16}" text-anchor="end">Heavy-work limit 26.6 °C</text>`;
  g += `<line x1="${padL}" x2="${w - padR}" y1="${base}" y2="${base}" stroke="var(--edge)"/>`;
  for (let h = from; h <= to; h += small ? 3 : 2) g += `<text class="j-tick" x="${X(h)}" y="${base + 40}" text-anchor="middle">${fmt(h)}</text>`;
  // raw IFS forecast: dashed line + hour dots (the only drawn series)
  const pts = []; for (let h = from; h <= to; h++) pts.push([X(h), Y(values[h])]);
  g += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="var(--viz-raw)" stroke-width="2" stroke-dasharray="6 4"/>`;
  for (const [x, y] of pts) g += `<circle cx="${x}" cy="${y}" r="3" fill="var(--ground)" stroke="var(--ink-3)" stroke-width="1.5"/>`;
  const pk = Math.max(...values.slice(from, to + 1)), pkH = values.indexOf(pk);
  const flip = X(pkH) > w * 0.55; g += `<text class="j-lab" x="${X(pkH) + (flip ? -8 : 8)}" y="${Y(pk) - 8}" text-anchor="${flip ? 'end' : 'start'}"><tspan fill="var(--ink)" font-weight="600">${pk.toFixed(1)} °C</tspan> at ${fmt(pkH)}${small ? '' : ', raw forecast'}</text>`;
  if (o.now != null) g += `<line x1="${X(o.now)}" x2="${X(o.now)}" y1="${top}" y2="${base + 6}" stroke="var(--ink)" stroke-width="2"/>`;
  el.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${o.aria || ''}">${g}<rect class="j-hit" x="${padL}" y="${top}" width="${w - padL - padR}" height="${base - top}" fill="transparent"/></svg>`;
  const hit = el.querySelector('.j-hit');
  hit.addEventListener('pointermove', (e) => { const r = el.querySelector('svg').getBoundingClientRect(); const h = Math.round(from + (e.clientX - r.left - padL) / (w - padL - padR) * (to - from));
    if (h < from || h > to) return; tooltip(`<b>${fmt(h)}</b><br>Raw forecast ${values[h].toFixed(1)} °C<br>Ours and station truth: added by the scoring run`, e.clientX, e.clientY); });
  hit.addEventListener('pointerleave', () => tooltip(null));
}

// ---------- story footer on inner judge pages: chapter n of 6, Prev, Next (the page's primary action) ----------
export function storyNav(el, id) {
  const i = STEPS.findIndex((s) => s.id === id), prev = STEPS[i - 1], next = STEPS[i + 1];
  el.innerHTML = `<p class="j-chap">Chapter ${i + 1} of ${STEPS.length} · <b>${STEPS[i].label}</b></p>
    <ol class="j-dots" aria-label="Story chapters">${STEPS.map((s, k) => `<li><a href="${s.href}" ${k === i ? 'aria-current="step"' : ''} aria-label="Chapter ${k + 1}: ${s.label}"><span>${s.label}</span></a></li>`).join('')}</ol>
    <div class="j-pn">${prev ? `<a class="btn" href="${prev.href}" rel="prev">Back</a>` : ''}${next ? `<a class="btn primary" href="${next.href}" rel="next">Next: ${next.label.toLowerCase()}</a>` : `<a class="btn primary" href="judge-season.html">Back to the scoreboard</a>`}</div>`;
}

// pending cell glyph (used in scoreboards and counters); the reason lives in the caption, not in each cell
export const PENDING = '<span class="pend">not yet scored</span>';
// one banner per table: the reason once, with the proof chip (never a glyph per cell)
export const pendingBanner = (what = 'These scores', file = 'policy_scoreboard.json', script = 'backend/eval/policy_scoreboard.py') => `<div class="notice j-pending"><p><strong>Not yet scored.</strong> Scores fill from the single scoring run; protocol fixed before 2026 was scored.</p><button class="proof" type="button" data-proof='${JSON.stringify({ what, file, script, label: 'Not yet written: the single scoring run writes this file once' }).replace(/'/g, '&#39;')}'>Proof</button></div>`;
