// DOM UI: HUD stats, incident cards, mayor's desk, ticker, modals,
// main menu and the end-of-term report.

import { fmtMoney, clamp } from './utils.js';
import { DESK_ACTIONS } from './events.js';
import { TYPE_LABEL, tileBlurb } from './citygen.js';
import { TERM_DAYS } from './state.js';

const $ = (id) => document.getElementById(id);

let cb = {};
let cards = new Map();       // incident uid -> card element
let deskBtns = new Map();
let tickerQueue = [];
let tickerBusy = false;
let lastLogId = 0;
let modalOpen = null;

export function initUI(callbacks) {
  cb = callbacks;

  $('btn-new').addEventListener('click', () => cb.onNewGame());
  $('btn-continue').addEventListener('click', () => cb.onContinue());
  $('btn-howto').addEventListener('click', () => openHowTo());
  $('btn-settings').addEventListener('click', () => openSettings());
  $('btn-credits').addEventListener('click', () => openCredits());

  $('btn-pause').addEventListener('click', () => cb.onPauseToggle());
  $('btn-speed').addEventListener('click', () => cb.onSpeedToggle());
  $('btn-pause-menu').addEventListener('click', () => openPauseMenu());
  $('modal-close').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-backdrop') && modalOpen !== 'report') closeModal();
  });

  // mayor's desk buttons
  const wrap = $('desk-actions');
  for (const act of DESK_ACTIONS) {
    const b = document.createElement('button');
    b.className = 'desk-btn';
    b.innerHTML = `${act.icon} ${act.label}<br><span class="cost ${act.gain ? 'gain' : ''}">${act.gain ? '+' + fmtMoney(act.gain).slice(1) : fmtMoney(act.cost)}</span><span class="cooldown" style="transform:scaleX(0)"></span>`;
    b.setAttribute('aria-label', `${act.label}, ${act.gain ? 'gains' : 'costs'} ${fmtMoney(act.gain || act.cost)}`);
    b.addEventListener('click', () => cb.onDesk(act.id));
    wrap.appendChild(b);
    deskBtns.set(act.id, b);
  }
}

// ---------------------------------------------------------------- screens

export function showMenu(hasSave, best) {
  $('menu').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('panel').classList.add('hidden');
  $('btn-continue').disabled = !hasSave;
  const b = best && best[0];
  $('menu-best').textContent = b
    ? `🏆 Best run: ${b.emoji} ${b.rank} — ${b.score.toLocaleString()} pts`
    : 'No terms served yet. The city awaits its hero. Or at least a volunteer.';
}

export function showGame() {
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('panel').classList.remove('hidden');
  closeModal();
  cards.forEach((el) => el.remove());
  cards.clear();
  hidePopup();
}

// ---------------------------------------------------------------- HUD

export function updateHUD(state, night) {
  $('hud-day').textContent = state.over ? 'Term over' : `Day ${Math.min(state.day, TERM_DAYS)} / ${TERM_DAYS}`;
  $('hud-clock').textContent = night ? '🌙' : '☀️';
  $('btn-pause').textContent = state.paused ? '▶' : '⏸';
  $('btn-speed').textContent = state.speed + '×';

  const s = state.stats;
  $('num-population').textContent = Math.round(s.population).toLocaleString();
  const bEl = $('num-budget');
  bEl.textContent = fmtMoney(s.budget);
  bEl.classList.toggle('negative', s.budget < 0);
  setBar('bar-happiness', s.happiness);
  setBar('bar-safety', s.safety);
  setBar('bar-infrastructure', s.infrastructure);
  setBar('bar-chaos', s.chaos);
}

function setBar(id, v) {
  $(id).style.width = clamp(v, 0, 100) + '%';
}

// ---------------------------------------------------------------- incident cards

export function updateIncidents(state) {
  const list = $('incident-list');
  const liveUids = new Set(state.incidents.map((i) => i.uid));

  // remove stale cards
  for (const [uidKey, el] of cards) {
    if (!liveUids.has(uidKey)) {
      el.classList.add('leaving');
      const ref = el;
      setTimeout(() => ref.remove(), 300);
      cards.delete(uidKey);
    }
  }

  for (const inc of state.incidents) {
    let el = cards.get(inc.uid);
    if (!el) {
      el = buildCard(inc);
      list.appendChild(el);
      cards.set(inc.uid, el);
    }
    syncCard(el, inc, state);
  }

  $('all-clear').style.display = state.incidents.length ? 'none' : '';
  const pill = $('incident-count');
  pill.textContent = state.incidents.length;
  pill.classList.toggle('zero', state.incidents.length === 0);
}

function buildCard(inc) {
  const el = document.createElement('article');
  el.className = 'card';
  const respBtns = inc.def.responses.map((r, i) => {
    const costTxt = r.gain
      ? `<span class="cost gain">+${fmtMoney(r.gain).slice(1)}</span>`
      : `<span class="cost">${r.cost ? fmtMoney(r.cost) : 'Free'}</span>`;
    return `<button class="resp-btn" data-resp="${i}">${r.icon} ${r.label} ${costTxt}</button>`;
  }).join('');
  el.innerHTML = `
    <button class="card-top" aria-label="Locate ${inc.def.name} on map">
      <span class="card-ico">${inc.def.icon}</span>
      <span class="card-title">
        <h3>${inc.def.name}</h3>
        <span class="card-loc">📍 ${inc.locName}</span>
      </span>
    </button>
    <p class="card-flavor">${inc.flavor}</p>
    <div class="sev-track"><div class="sev-fill"></div></div>
    <div class="card-status hidden"><span class="spinner"></span><span class="status-text"></span></div>
    <div class="card-actions">
      ${respBtns}
      <button class="resp-btn ignore" data-ignore aria-label="Minimize this incident">🙈 Ignore</button>
    </div>`;

  el.querySelector('.card-top').addEventListener('click', () => cb.onLocate(inc.uid));
  el.querySelectorAll('[data-resp]').forEach((b) => {
    b.addEventListener('click', () => cb.onRespond(inc.uid, Number(b.dataset.resp)));
  });
  el.querySelector('[data-ignore]').addEventListener('click', () => cb.onIgnore(inc.uid));
  return el;
}

function syncCard(el, inc, state) {
  const fill = el.querySelector('.sev-fill');
  fill.style.width = inc.sev + '%';
  fill.classList.toggle('hot', inc.sev >= 60);
  el.classList.toggle('escalated', inc.escalated);
  el.classList.toggle('minimized', inc.min);

  const status = el.querySelector('.card-status');
  const stTxt = el.querySelector('.status-text');
  if (inc.state === 'responding') {
    status.classList.remove('hidden');
    stTxt.textContent = 'Crew en route…';
  } else if (inc.state === 'working') {
    status.classList.remove('hidden');
    stTxt.textContent = 'Crew on site, handling it…';
  } else {
    status.classList.add('hidden');
  }

  el.querySelectorAll('[data-resp]').forEach((b) => {
    const i = Number(b.dataset.resp);
    b.disabled = inc.state !== 'active' || inc.used.includes(i);
  });
  const ign = el.querySelector('[data-ignore]');
  ign.textContent = inc.min ? '👀 Watch' : '🙈 Ignore';
}

// Scroll an incident's card into view and flash it (used when tapping a map marker).
export function focusCard(uidKey) {
  const el = cards.get(uidKey);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  el.style.transition = 'box-shadow .2s';
  el.style.boxShadow = '0 0 0 3px rgba(63, 208, 201, 0.8)';
  setTimeout(() => { el.style.boxShadow = ''; }, 700);
}

// ---------------------------------------------------------------- desk

export function updateDesk(state) {
  for (const act of DESK_ACTIONS) {
    const b = deskBtns.get(act.id);
    if (!b) continue;
    const cd = state.cooldowns[act.id] || 0;
    b.disabled = cd > 0 || state.over;
    b.querySelector('.cooldown').style.transform = `scaleX(${cd > 0 ? cd / act.cd : 0})`;
  }
}

// ---------------------------------------------------------------- ticker

export function pumpTicker(state) {
  for (const entry of state.log) {
    if (entry.id > lastLogId) {
      lastLogId = entry.id;
      tickerQueue.push(entry);
    }
  }
  if (tickerQueue.length > 3) tickerQueue = tickerQueue.slice(-2);
  if (!tickerBusy && tickerQueue.length) showNextTicker();
}

function showNextTicker() {
  const entry = tickerQueue.shift();
  if (!entry) { tickerBusy = false; return; }
  tickerBusy = true;
  const t = $('ticker');
  t.classList.remove('hidden', 'out');
  t.innerHTML = entry.msg;
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => {
      t.classList.add('hidden');
      showNextTicker();
    }, 380);
  }, 3400);
}

export function resetTicker() {
  tickerQueue = [];
  lastLogId = 0;
  tickerBusy = false;
  $('ticker').classList.add('hidden');
}

// ---------------------------------------------------------------- tile popup

export function showPopup(tile, x, y) {
  const p = $('tile-popup');
  p.innerHTML = `
    <span class="p-type">${TYPE_LABEL[tile.type] || 'Mystery'}</span>
    <h3>${tile.name || locFallback(tile)}</h3>
    <p>${tileBlurb(tile)}</p>`;
  p.classList.remove('hidden');
  const stage = $('stage').getBoundingClientRect();
  const w = 240, h = 120;
  p.style.left = clamp(x - w / 2, 8, stage.width - w - 8) + 'px';
  p.style.top = clamp(y - h - 20, 8, stage.height - h - 8) + 'px';
}

function locFallback(tile) {
  if (tile.type === 'road') return 'City street';
  if (tile.type === 'grass') return 'Vacant lot';
  if (tile.type === 'rubble') return 'Former building';
  return 'Somewhere in Port Fiasco';
}

export function hidePopup() {
  $('tile-popup').classList.add('hidden');
}

// ---------------------------------------------------------------- modals

function openModal(title, html, id) {
  modalOpen = id || title;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal-backdrop').classList.remove('hidden');
  $('modal-close').style.display = id === 'report' ? 'none' : '';
  return $('modal-body');
}

export function closeModal() {
  modalOpen = null;
  $('modal-backdrop').classList.add('hidden');
  if (cb.onModalClosed) cb.onModalClosed();
}

export const isModalOpen = () => modalOpen !== null;

export function openHowTo() {
  openModal('📖 How to Play', `
    <p>You are the newly elected Mayor of <b>Port Fiasco</b>, a city with excellent bagels and catastrophic luck. Survive a <b>${TERM_DAYS}-day term</b> without the place collapsing.</p>
    <h3>The loop</h3>
    <ul>
      <li>🚨 Disasters appear on the map and in the incident panel.</li>
      <li>🚒 Pick a response — dispatch crews, spend money, or spin the press.</li>
      <li>⏳ Ignored incidents <b>escalate</b>, then go catastrophically wrong.</li>
      <li>🌪️ Keep <b>Chaos</b> down and <b>Happiness</b> up, or your term ends early.</li>
    </ul>
    <h3>You lose if…</h3>
    <ul>
      <li>😡 Happiness hits 0 (riots, strongly worded banners)</li>
      <li>🌪️ Chaos hits 100 (the city becomes abstract art)</li>
      <li>💸 Budget drops below −$500 (they repossess the stapler)</li>
    </ul>
    <h3>Controls</h3>
    <ul>
      <li>🖱️ Drag to pan, scroll or pinch to zoom, tap things to inspect them</li>
      <li><kbd>Space</kbd> pause &nbsp; <kbd>1</kbd>/<kbd>2</kbd> game speed &nbsp; <kbd>+</kbd>/<kbd>−</kbd> zoom &nbsp; <kbd>Esc</kbd> menu</li>
    </ul>
    <p class="hint">Tip: the Mayor's Desk actions have cooldowns but no incident required. A well-timed press conference hides many sins.</p>`);
}

export function openCredits() {
  openModal('🏆 Credits', `
    <p><b>Disaster Mayor</b> — a city under new, questionable management.</p>
    <ul>
      <li>🏛️ Game design, code &amp; llama choreography: <b>Claude</b></li>
      <li>🦆 Flood duck: himself</li>
      <li>🦅 Falcon Task Force: Susan</li>
      <li>🎭 Stunt mascot: Gerald the Gull (contract pending)</li>
      <li>☕ Powered by the City Hall espresso machine (RIP)</li>
    </ul>
    <p class="hint">No pigeons were unionized during development. They organized independently.</p>`);
}

export function openSettings() {
  const s = cb.getSettings();
  const body = openModal('⚙️ Settings', `
    <div class="setting-row">
      <span class="setting-label"><b>Fancy effects</b><span>Particles, rain, glows. Turn off on older phones.</span></span>
      <button class="toggle" id="set-effects" aria-pressed="${s.effects === 'high'}" aria-label="Toggle fancy effects"></button>
    </div>
    <div class="setting-row">
      <span class="setting-label"><b>Screen shake</b><span>Wobbles the city when things explode.</span></span>
      <button class="toggle" id="set-shake" aria-pressed="${s.shake}" aria-label="Toggle screen shake"></button>
    </div>
    <div class="setting-row">
      <span class="setting-label"><b>Autosave</b><span>Continuously saves your run for Continue.</span></span>
      <button class="toggle" id="set-autosave" aria-pressed="${s.autosave}" aria-label="Toggle autosave"></button>
    </div>
    <div class="modal-btn-row">
      <button class="modal-btn danger" id="set-clear">🗑️ Erase all data</button>
    </div>`);

  const wire = (id, keyName, transform) => {
    body.querySelector(id).addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      const ns = { ...cb.getSettings() };
      ns[keyName] = transform ? transform(on) : on;
      cb.setSettings(ns);
    });
  };
  wire('#set-effects', 'effects', (on) => (on ? 'high' : 'low'));
  wire('#set-shake', 'shake');
  wire('#set-autosave', 'autosave');
  body.querySelector('#set-clear').addEventListener('click', () => {
    if (confirm('Erase saves, best scores and settings?')) {
      cb.onClearData();
      closeModal();
    }
  });
}

export function openPauseMenu() {
  if (!cb.isInGame()) return;
  cb.onForcePause();
  const body = openModal('⏸ Paused', `
    <p style="text-align:center">The disasters have agreed to a short intermission.</p>
    <div class="modal-btn-row">
      <button class="modal-btn primary" id="pm-resume">▶️ Resume</button>
    </div>
    <div class="modal-btn-row">
      <button class="modal-btn" id="pm-howto">📖 How to Play</button>
      <button class="modal-btn" id="pm-settings">⚙️ Settings</button>
    </div>
    <div class="modal-btn-row">
      <button class="modal-btn" id="pm-quit">🚪 Save &amp; Quit to Menu</button>
    </div>`, 'pause');
  body.querySelector('#pm-resume').addEventListener('click', () => { closeModal(); cb.onResume(); });
  body.querySelector('#pm-howto').addEventListener('click', openHowTo);
  body.querySelector('#pm-settings').addEventListener('click', openSettings);
  body.querySelector('#pm-quit').addEventListener('click', () => { closeModal(); cb.onQuitToMenu(); });
}

export function openReport(outcome, best) {
  const o = outcome;
  const bestHtml = best.length
    ? `<ul class="best-list">${best.map((b, i) =>
        `<li><span>${i + 1}. ${b.emoji} ${b.rank}</span><span>${b.score.toLocaleString()} pts · ${b.days}d</span></li>`).join('')}</ul>`
    : '';
  const body = openModal('📜 Mayor’s Report', `
    <div class="report-rank">
      <span class="r-emoji">${o.rank.emoji}</span>
      <h3>${o.rank.title}</h3>
      <p class="r-sub">${o.rank.sub}</p>
    </div>
    <p style="text-align:center">${o.reasonText}</p>
    <div class="report-grid">
      <div class="report-cell"><span class="rc-num">${o.score.toLocaleString()}</span><span class="rc-label">Score</span></div>
      <div class="report-cell"><span class="rc-num">${o.days}</span><span class="rc-label">Days in office</span></div>
      <div class="report-cell"><span class="rc-num">${o.resolved}</span><span class="rc-label">Crises resolved</span></div>
      <div class="report-cell"><span class="rc-num">${o.catastrophes}</span><span class="rc-label">Catastrophes</span></div>
      <div class="report-cell"><span class="rc-num">${Math.round(o.stats.happiness)}%</span><span class="rc-label">Final happiness</span></div>
      <div class="report-cell"><span class="rc-num">${fmtMoney(o.stats.budget)}</span><span class="rc-label">Treasury</span></div>
    </div>
    ${bestHtml}
    <div class="modal-btn-row">
      <button class="modal-btn primary" id="rp-again">🔁 Run Again</button>
      <button class="modal-btn" id="rp-menu">🏛️ Main Menu</button>
    </div>`, 'report');
  body.querySelector('#rp-again').addEventListener('click', () => { closeModal(); cb.onNewGame(); });
  body.querySelector('#rp-menu').addEventListener('click', () => { closeModal(); cb.onQuitToMenu(); });
}
