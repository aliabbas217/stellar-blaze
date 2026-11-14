/*
 * Prototype runtime (not product code). Vanilla JS, no build step.
 *  - ?state=<name>  shows elements with data-state="<name>" (default: "ideal"). A page lists its
 *                   states in <body data-states="ideal,loading,empty,error,partial">.
 *  - ?theme=light|dark  sets data-theme on <html>. Worker pages (<html data-surface="worker">) default to
 *                   light (DESIGN.md R2, sun-first); every other surface follows the system.
 *  - ?lang=en|ur    sets lang/dir on <html> and swaps text for elements carrying data-t-ur
 *                   (machine-draft Urdu from frontend/messages/ur.json, marked "Draft translation").
 *  - Injects the pictogram sprite, the prototype control bar, copy buttons and the proof drawer.
 */
(() => {
  const params = new URLSearchParams(location.search);
  const html = document.documentElement;
  const body = document.body;

  /* ---------- theme (R2) ---------- */
  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") html.dataset.theme = theme;
  else if (html.dataset.surface === "worker") html.dataset.theme = "light";

  /* ---------- locale ---------- */
  const lang = params.get("lang") === "ur" ? "ur" : "en";
  if (lang === "ur") {
    html.lang = "ur";
    html.dir = "rtl";
    document.querySelectorAll("[data-t-ur]").forEach((el) => {
      el.textContent = el.dataset.tUr;
      el.lang = "ur";
    });
    document.querySelectorAll("[data-aria-ur]").forEach((el) => el.setAttribute("aria-label", el.dataset.ariaUr));
  }

  /* ---------- stamps longer than three words read as sentences, not shouted labels ---------- */
  document.querySelectorAll(".stamp").forEach((el) => {
    if (el.textContent.trim().length > 24) el.classList.add("stamp--long");
  });

  /* ---------- states ---------- */
  const states = (body.dataset.states || "ideal").split(",").map((s) => s.trim());
  const state = states.includes(params.get("state")) ? params.get("state") : states[0];
  document.querySelectorAll("[data-state]").forEach((el) => {
    const list = el.dataset.state.split(/\s+/);
    el.classList.toggle("is-shown", list.includes(state));
  });
  body.dataset.current = state;

  /* ---------- pictogram sprite: 24-unit grid, 2-unit stroke, mitred, square caps ---------- */
  const sprite = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;inline-size:0;block-size:0;overflow:hidden" aria-hidden="true" focusable="false">
 <defs>
  <symbol id="i-green" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M9 12.4 11.2 14.6 15.2 9.8"/><path stroke-linecap="butt" d="M12 1V3.5M12 20.5V23M1 12H3.5M20.5 12H23M4.3 4.3 6 6M18 18 19.7 19.7M19.7 4.3 18 6M6 18 4.3 19.7"/></symbol>
  <symbol id="i-amber" viewBox="0 0 24 24"><path d="M12 2.8 6.5 11.5A6.5 6.5 0 1 0 17.5 11.5Z"/><path d="M9 15.2A3.2 3.2 0 0 0 12 18.2"/></symbol>
  <symbol id="i-orange" viewBox="0 0 24 24"><path d="M2.5 10 6 4.5H18L21.5 10Z"/><path d="M6 10V19.5M18 10V19.5M3 19.5H21"/></symbol>
  <symbol id="i-red" viewBox="0 0 24 24"><path d="M10 21.5 7.5 19V16.5L4.5 13.5 6.3 11.7 7.5 12.9V6.5H10.5V3.5H13.5V5H16.5V8.5H19.5V17.5L16.5 21.5Z"/><path d="M10.5 6.5V12M13.5 5V12M16.5 8.5V12"/></symbol>
  <symbol id="i-unwell" viewBox="0 0 24 24"><path d="M7 2H17V22H7Z"/><path d="M12 8V14M9 11H15"/><path d="M10 19H14"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M1.5 12 6 6.5H18L22.5 12 18 17.5H6Z"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-speaker" viewBox="0 0 24 24"><path d="M3 9H7L12 4.5V19.5L7 15H3Z"/><path d="M15.5 8.5A5 5 0 0 1 15.5 15.5M18.5 5.5A9 9 0 0 1 18.5 18.5"/></symbol>
  <symbol id="i-offline" viewBox="0 0 24 24"><path d="M6 18H18.5A4 4 0 0 0 18.5 10H17.5A6 6 0 0 0 6.2 9 4.5 4.5 0 0 0 6 18Z"/><path d="M3 3 21 21"/></symbol>
  <symbol id="i-today" viewBox="0 0 24 24"><path d="M3 5H21V21H3Z"/><path d="M3 10H21M8 2V7M16 2V7"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M5 17V10A7 7 0 0 1 19 10V17L21 19H3Z"/><path d="M10 21.5H14"/></symbol>
  <symbol id="i-phone" viewBox="0 0 24 24"><path d="M5 2.5H9.5L11 7.5 8.5 9.5A12 12 0 0 0 14.5 15.5L16.5 13 21.5 14.5V19A2.5 2.5 0 0 1 19 21.5 17 17 0 0 1 2.5 5 2.5 2.5 0 0 1 5 2.5Z"/></symbol>
  <symbol id="i-water" viewBox="0 0 24 24"><path d="M7 3H17L15.5 21H8.5Z"/><path d="M7.6 9H16.4"/></symbol>
  <symbol id="i-crew" viewBox="0 0 24 24"><circle cx="8" cy="7" r="3"/><circle cx="16" cy="7" r="3"/><path d="M2 21V16A3 3 0 0 1 5 13H11A3 3 0 0 1 14 16V21M14 13H19A3 3 0 0 1 22 16V21"/></symbol>
  <symbol id="i-cool" viewBox="0 0 24 24"><path d="M12 2V22M3.5 7 20.5 17M20.5 7 3.5 17"/><path d="M9 3.5 12 6 15 3.5M9 20.5 12 18 15 20.5"/></symbol>
  <symbol id="i-proof" viewBox="0 0 24 24"><path d="M5 2H15L19 6V22H5Z"/><path d="M8.5 12.5 11 15 15.5 9.5"/></symbol>
  <symbol id="i-info" viewBox="0 0 24 24"><path d="M2 2H22V22H2Z"/><path d="M12 10V17M12 6.5V7.5"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 2.5 22.5 21H1.5Z"/><path d="M12 9V14.5M12 17V18"/></symbol>
  <symbol id="i-print" viewBox="0 0 24 24"><path d="M6 9V2H18V9M6 17H2V9H22V17H18"/><path d="M6 13H18V22H6Z"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><path d="M8 8H21V21H8Z"/><path d="M16 8V3H3V16H8"/></symbol>
  <symbol id="i-stop" viewBox="0 0 24 24"><path d="M8 2H16L22 8V16L16 22H8L2 16V8Z"/><path d="M8 12H16"/></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M5 5 19 19M19 5 5 19"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M6 3.5 20 12 6 20.5Z"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path d="M6 4H10V20H6ZM14 4H18V20H14Z"/></symbol>
  <symbol id="i-retry" viewBox="0 0 24 24"><path d="M20 12A8 8 0 1 1 17.7 6.3"/><path d="M14 2.5H20V8.5"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><path d="M4 11H20V22H4Z"/><path d="M8 11V7A4 4 0 0 1 16 7V11"/></symbol>
  <symbol id="i-light" viewBox="0 0 24 24"><path d="M4 21H20M12 4V21M12 9 5 14M12 9 19 14"/></symbol>
  <symbol id="i-moderate" viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 7V14L8 21M12 14 16 21M7 10H17"/></symbol>
  <symbol id="i-heavy" viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 7V14L8 21M12 14 16 21M5 8H19M5 6V10M19 6V10"/></symbol>
  <pattern id="ban-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" style="stroke: var(--viz-grid)" stroke-width="1"/></pattern>
 </defs>
</svg>`;
  body.insertAdjacentHTML("afterbegin", sprite);
  document.querySelectorAll("svg.ico").forEach((s) => {
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "square");
    s.setAttribute("stroke-linejoin", "miter");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
  });

  /* ---------- prototype control bar ---------- */
  const link = (key, value, label, current) => {
    const p = new URLSearchParams(location.search);
    p.set(key, value);
    return `<a href="?${p.toString()}"${current ? ' aria-current="true"' : ""}>${label}</a>`;
  };
  const langs = (body.dataset.langs || "en").split(",");
  const bar = document.createElement("nav");
  bar.className = "proto-bar";
  bar.setAttribute("aria-label", "Prototype controls, not part of the product");
  bar.innerHTML =
    `<a href="index.html">Prototype index</a>` +
    `<span>State: ${states.map((s) => link("state", s, s, s === state)).join(" ")}</span>` +
    `<span>Theme: ${["light", "dark"].map((t) => link("theme", t, t, html.dataset.theme === t)).join(" ")}</span>` +
    (langs.length > 1 ? `<span>Lang: ${langs.map((l) => link("lang", l, l, l === lang)).join(" ")}</span>` : "");
  body.insertAdjacentElement("afterbegin", bar);

  /* ---------- keep the current hour of a scrolling band in view ---------- */
  document.querySelectorAll(".band-scroll").forEach((sc) => {
    // axe scrollable-region-focusable: a scrolling band must be reachable by keyboard
    if (!sc.hasAttribute("tabindex")) sc.tabIndex = 0;
    if (!sc.hasAttribute("role")) sc.setAttribute("role", "region");
    if (!sc.hasAttribute("aria-label")) sc.setAttribute("aria-label", html.lang === "ur" ? "گھنٹے کے حساب سے گرمی کی سطح" : "Heat level by hour, scrolls sideways");
    const now = sc.querySelector('[aria-current="time"]');
    if (!now) return;
    const a = sc.getBoundingClientRect(), b = now.getBoundingClientRect();
    sc.scrollLeft += b.left + b.width / 2 - (a.left + a.width / 2);
  });

  /* ---------- copy buttons ---------- */
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.copy); } catch { /* clipboard may be blocked */ }
    const label = btn.querySelector("[data-copy-label]");
    if (label) { const was = label.textContent; label.textContent = "Copied"; setTimeout(() => (label.textContent = was), 1500); }
  });

  /* ---------- proof drawer (injected once when the page has proof chips) ---------- */
  if (document.querySelector(".proof") && !document.getElementById("proof-drawer")) {
    body.insertAdjacentHTML(
      "beforeend",
      `<dialog class="drawer" id="proof-drawer" aria-labelledby="proof-title">
  <div class="drawer__head">
    <h2 class="t-title" id="proof-title">Proof: <span data-proof-title></span></h2>
    <button class="btn btn--sm" type="button" data-close><svg class="ico"><use href="#i-close"/></svg>Close</button>
  </div>
  <div class="drawer__body stack stack-6">
    <p><span class="stamp" data-proof-label></span></p>
    <dl class="stack stack-4">
      <div class="stack stack-1"><dt class="t-label t-muted">Protocol clause that defined it</dt>
        <dd><span class="t-mono">docs/research/2026-11-12-evaluation-protocol.md §⟨clause⟩</span><br>
        <span class="t-label">Commit ⟨sha⟩, committed ⟨date⟩, <strong>before</strong> results were scored</span></dd></div>
      <div class="stack stack-1"><dt class="t-label t-muted">Script and function that computed it</dt>
        <dd class="t-mono">backend/src/…/⟨exporter⟩.py :: ⟨function⟩</dd></div>
      <div class="stack stack-1"><dt class="t-label t-muted">Result file and its SHA-256</dt>
        <dd><span class="t-mono">artifacts/eval/2026/⟨file⟩.json</span><br><span class="t-mono">sha256 ⟨64 hex characters⟩</span></dd></div>
      <div class="stack stack-1"><dt class="t-label t-muted">Reproduce</dt>
        <dd class="cluster"><code class="t-mono">uv run sb-eval ⟨command⟩</code>
        <button class="btn btn--sm" type="button" data-copy="uv run sb-eval ⟨command⟩"><svg class="ico"><use href="#i-copy"/></svg><span data-copy-label>Copy</span></button></dd></div>
    </dl>
    <p class="t-label t-muted measure">Generated from the result file's provenance block, never written by hand. A number without a provenance block is not shown as a result.</p>
  </div>
</dialog>`,
    );
    document.querySelectorAll("#proof-drawer svg.ico").forEach((s) => {
      s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
      s.setAttribute("aria-hidden", "true");
    });
  }
  const drawer = document.getElementById("proof-drawer");
  if (drawer) {
    document.addEventListener("click", (e) => {
      const chip = e.target.closest(".proof");
      if (!chip) return;
      drawer.querySelector("[data-proof-title]").textContent = chip.dataset.metric || "This number";
      drawer.querySelector("[data-proof-label]").textContent = chip.dataset.label || "REAL WEATHER · ASSUMED CREW";
      drawer.showModal();
      drawer.querySelector("[data-close]").focus();
    });
    drawer.addEventListener("click", (e) => {
      if (e.target === drawer || e.target.closest("[data-close]")) drawer.close();
    });
  }

  /* ---------- generic dialogs ---------- */
  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-open]");
    if (opener) document.getElementById(opener.dataset.open)?.showModal();
    const closer = e.target.closest("dialog.modal [data-close]");
    if (closer) closer.closest("dialog").close();
  });
})();
