// Stellar Blaze v2-final prototype kit: states, sun mode, the time spine (qaylula slot), proof drawer, prototype menu.
// Plain ES module, no build. Every page: <script type="module"> import { boot } from './assets/kit.js'; boot({...}) </script>
import { RAMP_DARK, RAMP_LIGHT, css } from './heat.js';

export const q = new URLSearchParams(location.search);
export let STATE = q.get('state') || 'ideal';

// ---------- states: elements carry data-when="ideal loading ..." ----------
export function applyStates(root = document) {
  for (const el of root.querySelectorAll('[data-when]')) el.hidden = !el.dataset.when.split(/\s+/).includes(STATE);
}

// ---------- sun mode (DESIGN.md §6): solar elevation at the site, no sensor ----------
export function solarElevationDeg(lat, lon, date) {
  const rad = Math.PI / 180, d = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5;
  const g = 2 * Math.PI / 365 * (d - 1 + (date.getUTCHours() - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const tst = date.getUTCHours() * 60 + date.getUTCMinutes() + eqt + 4 * lon;
  const ha = (tst / 4 - 180) * rad;
  const cz = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / rad;
}
// field surfaces (worker, supervisor phone) follow the sun at the site unless overridden; desk surfaces stay night.
export function setTheme({ surface = 'desk', site = [24.36, 54.5], at = null } = {}) {
  const html = document.documentElement;
  const forced = q.get('theme') || (() => { try { const v = JSON.parse(localStorage.getItem('sb-theme') || 'null'); return v && v.until > Date.now() ? v.theme : null; } catch { return null; } })();
  let theme = 'night', why = 'Night';
  if (surface === 'field') {
    const when = at || new Date();
    const up = solarElevationDeg(site[0], site[1], when) > 0;
    const more = matchMedia('(prefers-contrast: more)').matches;
    theme = up || more ? 'sun' : 'night';
    why = more ? 'High contrast (device setting)' : up ? 'Sun is up at the site' : 'After sunset at the site';
  }
  if (forced) { theme = forced; why = 'Your choice until midnight'; }
  if (theme === 'sun') html.dataset.theme = 'sun'; else delete html.dataset.theme;
  for (const b of document.querySelectorAll('[data-sun-toggle]')) {
    b.innerHTML = theme === 'sun' ? `${ICON.moon}<span>Night</span>` : `${ICON.sun}<span>Sun</span>`;
    b.setAttribute('aria-label', `Switch to ${theme === 'sun' ? 'night' : 'sun'} mode. Now: ${why}`);
    b.onclick = () => { const next = theme === 'sun' ? 'night' : 'sun'; const m = new Date(); m.setHours(24, 0, 0, 0);
      try { localStorage.setItem('sb-theme', JSON.stringify({ theme: next, until: m.getTime() })); } catch {}
      const u = new URL(location.href); u.searchParams.set('theme', next); location.replace(u); };
  }
  return theme;
}

export const ICON = {
  sun: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.5"><path d="M8 0.5v2.2M8 13.3v2.2M0.5 8h2.2M13.3 8h2.2M2.7 2.7l1.6 1.6M11.7 11.7l1.6 1.6M2.7 13.3l1.6-1.6M11.7 4.3l1.6-1.6"/></g></svg>',
  moon: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 1.5a6.5 6.5 0 1 0 4 11.6A6 6 0 0 1 10.5 1.5z" fill="currentColor"/></svg>',
  cross: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="currentColor"/></svg>',
  speaker: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  // ISO 7010-style solid silhouettes (untested; DESIGN.md §9)
  shade: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M1 11 16 3l15 8v2.5H1z" fill="currentColor"/><rect x="3" y="13" width="2.6" height="17" fill="currentColor"/><rect x="26.4" y="13" width="2.6" height="17" fill="currentColor"/><circle cx="14" cy="16.6" r="2.7" fill="currentColor"/><path d="M11.6 20.2h4.8v5.2h4.6l1.2 4.6h-2.7l-.8-2.6h-7.1z" fill="currentColor"/></svg>',
  water: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 5h16l-2.2 23H10.2z" fill="currentColor"/><path d="M10.6 11h10.8l-.3 3H10.9z" fill="var(--ground)"/></svg>',
  buddy: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="10" cy="7" r="3.2" fill="currentColor"/><circle cx="22" cy="7" r="3.2" fill="currentColor"/><path d="M6 12h8v9h-1.6v8h-4.8v-8H6zM18 12h8v9h-1.6v8h-4.8v-8H18z" fill="currentColor"/></svg>',
};

// ---------- the time spine with the qaylula slot (DESIGN.md §2) ----------
// opts: values (by hour, index 0..23), from, to (hours), now (fractional hour or null), ban [12.5, 15] or null,
// orientation 'h' | 'v', height/width, labels (array of {at, text}), theme ('night' | 'sun'), compact
export function spine(el, o) {
  const theme = document.documentElement.dataset.theme === 'sun' ? 'sun' : 'night';
  const ramp = theme === 'sun' ? RAMP_LIGHT : RAMP_DARK;
  const H = o.orientation === 'v';
  const W = o.width || (H ? 300 : 1000), L = o.length || (H ? 520 : 72);
  const span = o.to - o.from, pad = H ? 18 : 22;
  const pos = (t) => pad + (t - o.from) / span * ((H ? L : W) - 2 * pad);
  const band = o.band || (H ? 56 : 26);
  let s = '';
  // hour cells
  for (let h = o.from; h < o.to; h++) {
    const v = o.values?.[h]; const a = pos(h) + 0.75, b = pos(h + 1) - 0.75;
    const fill = v == null ? 'var(--hair)' : css(ramp(v));
    const edge = theme === 'sun' ? ' stroke="var(--edge)" stroke-width="0.75"' : '';
    s += H ? `<rect x="${o.bandX ?? 70}" y="${a}" width="${band}" height="${b - a}" fill="${fill}"${edge}/>`
           : `<rect x="${a}" y="${o.bandY ?? 18}" width="${b - a}" height="${band}" fill="${fill}"${edge}/>`;
  }
  // qaylula slot: recessed band below the ground, framed by two rules
  if (o.ban) {
    const a = pos(o.ban[0]), b = pos(o.ban[1]);
    if (H) { const x0 = (o.bandX ?? 70) - 10, x1 = (o.bandX ?? 70) + band + 10;
      s += `<rect class="r-slot" x="${x0}" y="${a}" width="${x1 - x0}" height="${b - a}"/><line class="r-slot-rule" x1="${x0}" x2="${x1}" y1="${a}" y2="${a}"/><line class="r-slot-rule" x1="${x0}" x2="${x1}" y1="${b}" y2="${b}"/>`;
      s += `<text class="r-label" x="${x1 + 10}" y="${a + 16}">Midday break</text><text class="r-tick" x="${x1 + 10}" y="${a + 32}">${fmt(o.ban[0])} to ${fmt(o.ban[1])}, by law</text>`;
    } else { const y0 = (o.bandY ?? 18) - 8, y1 = (o.bandY ?? 18) + band + 8;
      s += `<rect class="r-slot" x="${a}" y="${y0}" width="${b - a}" height="${y1 - y0}"/><line class="r-slot-rule" x1="${a}" x2="${a}" y1="${y0}" y2="${y1}"/><line class="r-slot-rule" x1="${b}" x2="${b}" y1="${y0}" y2="${y1}"/>`;
      if (!o.compact) s += `<text class="r-label" x="${(a + b) / 2}" y="${y0 - 5}" text-anchor="middle">Midday break</text>`;
    }
  }
  // ticks
  const step = o.tickStep || (span > 14 ? 3 : 2);
  for (let h = Math.ceil(o.from / step) * step; h <= o.to; h += step) {
    if (o.compact && H) continue;
    s += H ? `<text class="r-tick" x="${(o.bandX ?? 70) - 16}" y="${pos(h) + 4}" text-anchor="end">${fmt(h)}</text>`
           : `<text class="r-tick" x="${pos(h)}" y="${(o.bandY ?? 18) + band + 22}" text-anchor="middle">${fmt(h)}</text>`;
  }
  // now line
  if (o.now != null) {
    const p = pos(o.now);
    s += H ? `<line class="r-now" x1="${(o.bandX ?? 70) - 14}" x2="${(o.bandX ?? 70) + band + 14}" y1="${p}" y2="${p}"/>`
           : `<line class="r-now" x1="${p}" x2="${p}" y1="${(o.bandY ?? 18) - 12}" y2="${(o.bandY ?? 18) + band + 6}"/>`;
  }
  for (const lb of o.labels || []) {
    const p = pos(lb.at);
    s += H ? `<text class="r-label" x="${(o.bandX ?? 70) + band + 24}" y="${p + 5}" style="font-size:${lb.size || 15}px;fill:var(--${lb.tone || 'ink'})">${lb.text}</text>`
           : `<text class="r-label" x="${p}" y="${(o.bandY ?? 18) - 16}" text-anchor="middle" style="fill:var(--${lb.tone || 'ink'})">${lb.text}</text>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${H ? W : W} ${H ? L : L}" role="img" aria-label="${o.aria || 'Timeline'}">${s}</svg>`;
}
export const fmt = (h) => { const m = Math.round((h % 1) * 60); return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// ---------- proof drawer: any [data-proof] button ----------
export function proofDrawer() {
  let d = document.getElementById('proof');
  if (!d) { d = document.createElement('dialog'); d.id = 'proof'; d.className = 'drawer'; document.body.appendChild(d); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-proof]'); if (!b) return;
    const p = JSON.parse(b.dataset.proof);
    d.innerHTML = `<div class="panel-h"><h2>Where this number comes from</h2><button class="btn" data-close>Close</button></div>
      <dl><dt>Number</dt><dd>${p.what}</dd><dt>Protocol line</dt><dd>${p.protocol || 'Pre-registered 12 Nov 2026, before 2026 was scored'}</dd>
      <dt>Script</dt><dd class="mono">${p.script || 'backend/eval/policy_scoreboard.py'}</dd><dt>Result file</dt><dd class="mono">${p.file || 'policy_scoreboard.json'}</dd>
      <dt>SHA-256</dt><dd class="mono">${p.sha || 'written by the exporter on 12 Nov'}</dd><dt>Label</dt><dd>${p.label || 'Real weather, scored against station thermometers'}</dd></dl>`;
    d.showModal(); d.querySelector('[data-close]').onclick = () => d.close();
  });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

// ---------- prototype menu (not product) ----------
export function protoMenu(states = ['ideal', 'loading', 'empty', 'error'], extra = '') {
  if (q.has('clean')) return; // ?clean hides the prototype control for screenshots and demos
  const box = document.createElement('div'); box.className = 'proto';
  const link = (k, v, label = v) => { const u = new URL(location.href); u.searchParams.set(k, v); return `<a href="${u.pathname.split('/').pop()}${u.search}" ${q.get(k) === v || (k === 'state' && !q.get(k) && v === 'ideal') ? 'aria-current="true"' : ''}>${label}</a>`; };
  box.innerHTML = `<button type="button" aria-expanded="false">Prototype</button><div class="menu"><p>State</p><div>${states.map((s) => link('state', s)).join('')}</div><p>Theme</p><div>${link('theme', 'night')}${link('theme', 'sun')}</div>${extra}<p><a href="index.html">All views</a> <a href="views.html">View list</a></p></div>`;
  document.body.appendChild(box);
  const btn = box.querySelector('button'); btn.onclick = () => { box.classList.toggle('open'); btn.setAttribute('aria-expanded', box.classList.contains('open')); };
}

// scroll containers must be reachable by keyboard (axe scrollable-region-focusable)
export function focusableScrollers() {
  requestAnimationFrame(() => setTimeout(() => { for (const el of document.querySelectorAll('body *')) { const st = getComputedStyle(el);
    if (/(auto|scroll)/.test(st.overflowX + st.overflowY) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && !el.querySelector('a,button,input,select,textarea,[tabindex]') && !el.hasAttribute('tabindex')) {
      el.tabIndex = 0; if (!el.getAttribute('role')) el.setAttribute('role', 'region'); if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Scrollable content'); } } }, 600));
}

export async function boot({ surface = 'desk', states, at, defaultState } = {}) {
  if (!q.get('state') && defaultState) STATE = defaultState;
  setTheme({ surface, at });
  applyStates();
  proofDrawer();
  focusableScrollers();
  protoMenu(states);
}
