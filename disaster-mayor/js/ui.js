// DOM UI: HUD stats, incident cards, emergency services, mayor's desk,
// ticker, modals, menus, the end-of-term report — plus the screen reader
// layer: live announcements, focus management and concise semantics.

import { fmtMoney, clamp } from './utils.js';
import { DESK_ACTIONS, UNIT_DEFS, unitsAvailable, unitsTotal, deskCost, isEventActive, sevLevel } from './events.js';
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
let modalOpener = null;      // element to restore focus to when a modal closes

// ---------------------------------------------------------------- announcer
// A small queue over two ARIA live regions. Messages are spaced out so they
// don't clobber each other, deduped, and filtered by the verbosity setting.

const KIND_LEVEL = {
  // minimal: the events you cannot play without
  alert: 0, warn: 0, danger: 0, good: 0, end: 0,
  // standard: player feedback and crew/status updates
  action: 1, status: 1,
  // detailed: everything else
  info: 2,
};
const VERBOSITY_LEVEL = { minimal: 0, standard: 1, detailed: 2 };

let srQueue = [];
let srTimer = null;

export function announce(text, { assertive = false, force = false } = {}) {
  if (!text) return;
  const verb = (cb.getSettings && cb.getSettings().verbosity) || 'standard';
  if (!force && VERBOSITY_LEVEL[verb] === undefined) return;
  if (srQueue.some((q) => q.text === text)) return;
  srQueue.push({ text, assertive });
  if (srQueue.length > 4) {
    const idx = srQueue.findIndex((q) => !q.assertive);
    if (idx >= 0) srQueue.splice(idx, 1); else srQueue.shift();
  }
  if (!srTimer) pumpAnnouncer();
}

function pumpAnnouncer() {
  const next = srQueue.shift();
  if (!next) { srTimer = null; return; }
  const el = $(next.assertive ? 'announce-assertive' : 'announce-polite');
  el.textContent = '';
  setTimeout(() => { el.textContent = next.text; }, 60);
  srTimer = setTimeout(() => pumpAnnouncer(), 1500);
}

function shouldAnnounce(kind) {
  const verb = (cb.getSettings && cb.getSettings().verbosity) || 'standard';
  const lvl = VERBOSITY_LEVEL[verb] ?? 1;
  return (KIND_LEVEL[kind] ?? 2) <= lvl;
}

export function resetAnnouncer() {
  srQueue = [];
  if (srTimer) { clearTimeout(srTimer); srTimer = null; }
  $('announce-polite').textContent = '';
  $('announce-assertive').textContent = '';
}

// ---------------------------------------------------------------- init

export function initUI(callbacks) {
  cb = callbacks;

  $('btn-new').addEventListener('click', () => cb.onNewGame());
  $('btn-continue').addEventListener('click', () => cb.onContinue());
  $('btn-howto').addEventListener('click', (e) => openHowTo(e.currentTarget));
  $('btn-settings').addEventListener('click', (e) => openSettings(e.currentTarget));
  $('btn-credits').addEventListener('click', (e) => openCredits(e.currentTarget));

  $('btn-pause').addEventListener('click', () => cb.onPauseToggle());
  $('btn-speed').addEventListener('click', () => cb.onSpeedToggle());
  $('btn-pause-menu').addEventListener('click', (e) => openPauseMenu(e.currentTarget));
  $('modal-close').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-backdrop') && modalOpen !== 'report') closeModal();
  });
  // focus trap inside the modal
  $('modal-backdrop').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = $('modal-backdrop').querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // quick command bar
  $('cmd-status').addEventListener('click', () => announceStatus());
  $('cmd-incidents').addEventListener('click', () => focusIncidents());
  $('cmd-services').addEventListener('click', () => focusServices());
  $('cmd-desk').addEventListener('click', () => focusDesk());

  // mayor's desk buttons
  const wrap = $('desk-actions');
  for (const act of DESK_ACTIONS) {
    const b = document.createElement('button');
    b.className = 'desk-btn';
    b.innerHTML = `<span class="desk-label">${act.icon} ${act.label}</span>` +
      `<span class="cost ${act.gain ? 'gain' : ''}" data-cost></span>` +
      `<span class="cooldown" style="transform:scaleX(0)"></span>`;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      cb.onDesk(act.id);
    });
    wrap.appendChild(b);
    deskBtns.set(act.id, b);
  }
}

// ---------------------------------------------------------------- commands

export function announceStatus() {
  if (!cb.isInGame || !cb.isInGame()) return;
  announce(cb.getStatusSummary(), { force: true });
}

export function focusIncidents() {
  const first = $('incident-list').querySelector('.card:not(.leaving)');
  if (first) {
    first.focus();
  } else {
    $('incidents-heading').focus();
    announce('No incidents active. Enjoy it while it lasts.', { force: true });
  }
}

export function focusServices() {
  $('services').focus();
}

export function focusDesk() {
  const first = $('desk-actions').querySelector('.desk-btn');
  if (first) first.focus();
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
  const pauseBtn = $('btn-pause');
  pauseBtn.textContent = state.paused ? '▶' : '⏸';
  pauseBtn.setAttribute('aria-label', state.paused ? 'Resume game' : 'Pause game');
  pauseBtn.setAttribute('aria-pressed', String(state.paused));
  const speedBtn = $('btn-speed');
  speedBtn.textContent = state.speed + '×';
  speedBtn.setAttribute('aria-label', `Game speed: ${state.speed === 1 ? 'normal' : 'double'}. Activate to toggle.`);

  const s = state.stats;
  $('num-population').textContent = Math.round(s.population).toLocaleString();
  const bEl = $('num-budget');
  bEl.textContent = fmtMoney(s.budget);
  bEl.classList.toggle('negative', s.budget < 0);
  setBar('bar-happiness', s.happiness);
  setBar('bar-safety', s.safety);
  setBar('bar-infrastructure', s.infrastructure);
  setBar('bar-chaos', s.chaos);
  // visual danger cue on the stat chips
  for (const k of ['happiness', 'safety', 'infrastructure', 'budget', 'chaos']) {
    const el = $('stat-' + k);
    if (el) el.classList.toggle('danger', !!state.dangerFlags[k]);
  }
}

function setBar(id, v) {
  $(id).style.width = clamp(v, 0, 100) + '%';
}

// ---------------------------------------------------------------- incident cards

const phaseText = (inc) => {
  if (inc.state === 'responding') return 'Crew en route';
  if (inc.state === 'working') return 'Crew on site';
  return inc.escalated ? 'Escalated!' : (inc.sev >= 48 ? 'Escalating soon' : 'Growing');
};

function cardSrLabel(inc, state) {
  const lvl = sevLevel(inc.sev);
  let crew;
  if (inc.state === 'responding') crew = `${UNIT_DEFS[inc.unitKind]?.label || 'Crew'} en route.`;
  else if (inc.state === 'working') crew = 'Crew on site, working.';
  else crew = 'No crew assigned.';
  const esc = inc.escalated ? ' Escalated.' : (inc.sev >= 48 && inc.state === 'active' ? ' Escalating soon.' : '');
  return `${inc.def.name}, ${inc.locName} in ${inc.district}. Severity ${lvl} of 5.${esc} ${crew}`;
}

export function updateIncidents(state) {
  const list = $('incident-list');
  const liveUids = new Set(state.incidents.map((i) => i.uid));
  const focusWasInside = list.contains(document.activeElement);

  // remove stale cards; if focus was inside a removed card, move it home
  for (const [uidKey, el] of cards) {
    if (!liveUids.has(uidKey)) {
      const hadFocus = el.contains(document.activeElement);
      el.classList.add('leaving');
      const ref = el;
      setTimeout(() => ref.remove(), 300);
      cards.delete(uidKey);
      if (hadFocus) {
        const next = state.incidents.length ? null : $('incidents-heading');
        if (next) next.focus();
        else if (state.incidents.length) setTimeout(() => focusIncidents(), 0);
        else $('incidents-heading').focus();
      }
    }
  }

  // most urgent first
  const sorted = [...state.incidents].sort((a, b) => b.sev - a.sev);
  for (const inc of sorted) {
    let el = cards.get(inc.uid);
    if (!el) {
      el = buildCard(inc);
      list.appendChild(el);
      cards.set(inc.uid, el);
    }
    syncCard(el, inc, state);
  }
  // reorder DOM to match urgency, unless the user is currently inside the list
  if (!focusWasInside) {
    let prev = null;
    for (const inc of sorted) {
      const el = cards.get(inc.uid);
      if (!el) continue;
      if (prev && prev.nextElementSibling !== el) prev.after(el);
      else if (!prev && list.firstElementChild !== el) list.prepend(el);
      prev = el;
    }
  }

  $('all-clear').style.display = state.incidents.length ? 'none' : '';
  const pill = $('incident-count');
  pill.textContent = state.incidents.length;
  pill.classList.toggle('zero', state.incidents.length === 0);
}

function buildCard(inc) {
  const el = document.createElement('article');
  el.className = 'card';
  el.setAttribute('role', 'listitem');
  el.tabIndex = -1;
  const respBtns = inc.def.responses.map((r, i) =>
    `<button class="resp-btn" data-resp="${i}">${r.icon} ${r.label} <span class="cost ${r.gain ? 'gain' : ''}">${r.gain ? '+' + fmtMoney(r.gain).slice(1) : (r.cost ? fmtMoney(r.cost) : 'Free')}</span></button>`
  ).join('');
  el.innerHTML = `
    <div class="card-top">
      <span class="card-ico" aria-hidden="true">${inc.def.icon}</span>
      <div class="card-title">
        <h3>${inc.def.name}</h3>
        <span class="card-loc" aria-hidden="true">📍 ${inc.locName} · ${inc.district}</span>
      </div>
      <button class="locate-btn" aria-label="Show ${inc.def.name} on the map">🗺️</button>
    </div>
    <p class="card-flavor">${inc.flavor}</p>
    <div class="sev-row" aria-hidden="true">
      <span class="sev-label"></span>
      <div class="sev-track"><div class="sev-fill"></div></div>
    </div>
    <div class="card-status hidden" aria-hidden="true"><span class="spinner"></span><span class="status-text"></span></div>
    <div class="card-actions">
      ${respBtns}
      <button class="resp-btn ignore" data-ignore>🙈 Ignore</button>
    </div>`;

  el.querySelector('.locate-btn').addEventListener('click', () => cb.onLocate(inc.uid));
  el.querySelectorAll('[data-resp]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      cb.onRespond(inc.uid, Number(b.dataset.resp));
      // keep the reader oriented: focus the card summary after acting
      const stillThere = cards.get(inc.uid);
      if (stillThere) stillThere.focus();
      else $('incidents-heading').focus();
    });
  });
  el.querySelector('[data-ignore]').addEventListener('click', () => cb.onIgnore(inc.uid));
  return el;
}

function syncCard(el, inc, state) {
  el.setAttribute('aria-label', cardSrLabel(inc, state));
  const h3 = el.querySelector('h3');
  h3.setAttribute('aria-hidden', 'true'); // the card itself carries the full label

  const fill = el.querySelector('.sev-fill');
  fill.style.width = inc.sev + '%';
  fill.classList.toggle('hot', inc.sev >= 60);
  el.querySelector('.sev-label').textContent = `Severity ${sevLevel(inc.sev)}/5 · ${phaseText(inc)}`;
  el.classList.toggle('escalated', inc.escalated);
  el.classList.toggle('minimized', inc.min);

  const status = el.querySelector('.card-status');
  const stTxt = el.querySelector('.status-text');
  if (inc.state === 'responding') {
    status.classList.remove('hidden');
    stTxt.textContent = `${UNIT_DEFS[inc.unitKind]?.label || 'Crew'} en route…`;
  } else if (inc.state === 'working') {
    status.classList.remove('hidden');
    stTxt.textContent = 'Crew on site, handling it…';
  } else {
    status.classList.add('hidden');
  }

  el.querySelectorAll('[data-resp]').forEach((b) => {
    const i = Number(b.dataset.resp);
    const r = inc.def.responses[i];
    let disabled = inc.state !== 'active' || inc.used.includes(i);
    let reason = '';
    if (!disabled && r.dispatch && unitsAvailable(state, r.dispatch) <= 0) {
      disabled = true;
      reason = ` Unavailable: all ${UNIT_DEFS[r.dispatch].plural} are responding.`;
    } else if (inc.used.includes(i)) {
      reason = ' Already used for this incident.';
    } else if (inc.state !== 'active') {
      reason = ' Crew already assigned.';
    }
    b.setAttribute('aria-disabled', String(disabled));
    b.classList.toggle('is-disabled', disabled);
    const costTxt = r.gain ? `gains $${r.gain}` : (r.cost ? `cost $${r.cost}` : 'free');
    b.setAttribute('aria-label', `${r.label}, ${costTxt}.${disabled ? reason : ''}`);
  });
  const ign = el.querySelector('[data-ignore]');
  ign.textContent = inc.min ? '👀 Watch' : '🙈 Ignore';
  ign.setAttribute('aria-label', inc.min
    ? 'Expand this incident card'
    : 'Ignore incident: collapse this card. It will keep escalating.');
}

// Scroll an incident's card into view, focus and flash it.
export function focusCard(uidKey) {
  const el = cards.get(uidKey);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  el.focus({ preventScroll: true });
  el.style.transition = 'box-shadow .2s';
  el.style.boxShadow = '0 0 0 3px rgba(63, 208, 201, 0.8)';
  setTimeout(() => { el.style.boxShadow = ''; }, 700);
}

// ---------------------------------------------------------------- services

export function updateServices(state) {
  const wrap = $('services');
  let html = '';
  const srParts = [];
  for (const [k, d] of Object.entries(UNIT_DEFS)) {
    const total = unitsTotal(state, k);
    const avail = unitsAvailable(state, k);
    const busy = total - avail;
    let pips = '';
    for (let i = 0; i < total; i++) {
      pips += `<span class="pip ${i < avail ? 'free' : 'busy'}"></span>`;
    }
    const shortName = { fire: 'Fire', police: 'Police', medical: 'Medical', repair: 'Repair' }[k] || d.label;
    html += `<div class="service"><span class="service-ico" aria-hidden="true">${d.icon}</span>` +
      `<span class="service-name">${shortName}</span>` +
      `<span class="pips">${pips}</span>` +
      `<span class="service-n">${avail}/${total}</span></div>`;
    srParts.push(`${d.plural} ${avail === 0 ? 'none available' : `${avail} available`}${busy ? `, ${busy} responding` : ''}`);
  }
  const boostBits = [];
  if (state.boosts.overtime > 0) boostBits.push(`⏱️ Overtime ${Math.ceil(state.boosts.overtime)}s`);
  if (state.boosts.reserves > 0) boostBits.push(`🚨 Reserves ${Math.ceil(state.boosts.reserves)}s`);
  if (boostBits.length) html += `<div class="boosts">${boostBits.join(' · ')}</div>`;
  wrap.innerHTML = html;
  let srLabel = `Emergency services. ${srParts.join('. ')}.`;
  if (state.boosts.overtime > 0) srLabel += ` Overtime active, ${Math.ceil(state.boosts.overtime)} seconds left.`;
  if (state.boosts.reserves > 0) srLabel += ` Reserves active, ${Math.ceil(state.boosts.reserves)} seconds left.`;
  wrap.setAttribute('aria-label', srLabel);
}

// ---------------------------------------------------------------- desk

export function updateDesk(state) {
  const coffee = isEventActive(state, 'coffee');
  for (const act of DESK_ACTIONS) {
    const b = deskBtns.get(act.id);
    if (!b) continue;
    const cd = state.cooldowns[act.id] || 0;
    const cost = deskCost(state, act);
    const disabled = cd > 0 || state.over;
    b.setAttribute('aria-disabled', String(disabled));
    b.classList.toggle('is-disabled', disabled);
    b.classList.toggle('weakened', coffee);
    b.querySelector('[data-cost]').textContent = act.gain ? `+$${act.gain}` : (cost ? fmtMoney(cost) : 'Free');
    b.querySelector('.cooldown').style.transform = `scaleX(${cd > 0 ? cd / (act.cd * (coffee ? 1.5 : 1)) : 0})`;
    const costTxt = act.gain ? '' : (cost ? ` Cost $${cost}.` : '');
    const availTxt = disabled
      ? (state.over ? ' Unavailable.' : ` Available in ${Math.ceil(cd)} seconds.`)
      : ' Available.';
    const coffeeTxt = coffee ? ' Weakened by the coffee crisis.' : '';
    b.setAttribute('aria-label', `${act.label}. ${act.desc}.${costTxt}${availTxt}${coffeeTxt}`);
  }
}

// ---------------------------------------------------------------- ticker + announcements

export function pumpTicker(state) {
  for (const entry of state.log) {
    if (entry.id > lastLogId) {
      lastLogId = entry.id;
      tickerQueue.push(entry);
      if (shouldAnnounce(entry.kind)) {
        const text = entry.sr || entry.msg.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/gu, '');
        announce(text, { assertive: entry.kind === 'danger', force: true });
      }
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
  resetAnnouncer();
}

// ---------------------------------------------------------------- tile popup

export function showPopup(tile, x, y) {
  const p = $('tile-popup');
  p.innerHTML = `
    <span class="p-type">${TYPE_LABEL[tile.type] || 'Mystery'} · ${tile.district}</span>
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

function openModal(title, html, id, opener) {
  modalOpen = id || title;
  modalOpener = opener || document.activeElement;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal-backdrop').classList.remove('hidden');
  $('modal-close').style.display = id === 'report' ? 'none' : '';
  if (cb.onModalOpened) cb.onModalOpened();
  setTimeout(() => $('modal-title').focus(), 50);
  return $('modal-body');
}

export function closeModal() {
  if (modalOpen === null) return;
  modalOpen = null;
  $('modal-backdrop').classList.add('hidden');
  if (modalOpener && document.contains(modalOpener)) {
    modalOpener.focus();
  }
  modalOpener = null;
  if (cb.onModalClosed) cb.onModalClosed();
}

export const isModalOpen = () => modalOpen !== null;

export function openHowTo(opener) {
  openModal('📖 How to Play', `
    <p>You are the newly elected Mayor of <b>Port Fiasco</b>, a city with excellent bagels and catastrophic luck. Survive a <b>${TERM_DAYS}-day term</b> without the place collapsing.</p>
    <h3>The loop</h3>
    <ul>
      <li>🚨 Disasters appear on the map and in the incident panel, most urgent first.</li>
      <li>🚒 Crews are limited — 2 fire engines, 2 police units, 1 medical team, 2 repair crews. A crew stays busy until its incident is done, so prioritise.</li>
      <li>⏳ Ignored incidents <b>escalate</b>, then go catastrophically wrong. Fires spread. Floods wreck nearby roads, slowing your crews.</li>
      <li>🏘️ Districts matter: residential areas take happiness hits harder, Midtown commerce bleeds money, The Works burns hotter, and trouble in the Civic Quarter slows your desk actions.</li>
      <li>🌪️ Keep <b>Chaos</b> down and <b>Happiness</b> up, or your term ends early.</li>
    </ul>
    <h3>You lose if…</h3>
    <ul>
      <li>😡 Happiness hits 0 (riots, strongly worded banners)</li>
      <li>🌪️ Chaos hits 100 (the city becomes abstract art)</li>
      <li>💸 Budget drops below −$500 (they repossess the stapler)</li>
    </ul>
    <h3>Keyboard shortcuts</h3>
    <ul>
      <li><kbd>Space</kbd> pause / resume &nbsp; <kbd>1</kbd>/<kbd>2</kbd> game speed</li>
      <li><kbd>C</kbd> city status summary &nbsp; <kbd>I</kbd> incidents &nbsp; <kbd>S</kbd> services &nbsp; <kbd>M</kbd> Mayor's Desk</li>
      <li><kbd>+</kbd>/<kbd>−</kbd> zoom &nbsp; arrow keys pan (when the map has focus) &nbsp; <kbd>Esc</kbd> menu</li>
    </ul>
    <h3>Screen reader play</h3>
    <p>The quick command bar (Status / Incidents / Services / Desk) jumps straight to each area. New incidents, escalations and crew updates are announced automatically — set the detail level in Settings. Pausing stops all timers, so take your time.</p>
    <p class="hint">Tip: Overtime Shift makes busy crews finish faster. Call In Reserves when everything is on fire at once. Which, eventually, it will be.</p>`,
    null, opener);
}

export function openCredits(opener) {
  openModal('🏆 Credits', `
    <p><b>Disaster Mayor</b> — a city under new, questionable management.</p>
    <ul>
      <li>🏛️ Game design, code &amp; llama choreography: <b>Claude</b></li>
      <li>🦆 Flood duck: himself</li>
      <li>🦅 Falcon Task Force: Susan</li>
      <li>🎭 Stunt mascot: Gerald the Gull (contract pending)</li>
      <li>🚒 Reserve captain: Brambles (retired, undefeated)</li>
      <li>☕ Powered by the City Hall espresso machine (RIP)</li>
    </ul>
    <p class="hint">No pigeons were unionized during development. They organized independently.</p>`,
    null, opener);
}

export function openSettings(opener) {
  const s = cb.getSettings();
  const body = openModal('⚙️ Settings', `
    <div class="setting-row">
      <span class="setting-label" id="lbl-effects"><b>Fancy effects</b><span>Particles, rain, glows. Turn off on older phones.</span></span>
      <button class="toggle" id="set-effects" aria-labelledby="lbl-effects" role="switch" aria-checked="${s.effects === 'high'}"></button>
    </div>
    <div class="setting-row">
      <span class="setting-label" id="lbl-motion"><b>Reduce motion</b><span>Calms pulsing, shake and rapid animation.</span></span>
      <button class="toggle" id="set-motion" aria-labelledby="lbl-motion" role="switch" aria-checked="${s.reduceMotion}"></button>
    </div>
    <div class="setting-row">
      <span class="setting-label" id="lbl-shake"><b>Screen shake</b><span>Wobbles the city when things explode.</span></span>
      <button class="toggle" id="set-shake" aria-labelledby="lbl-shake" role="switch" aria-checked="${s.shake}"></button>
    </div>
    <div class="setting-row">
      <span class="setting-label" id="lbl-autosave"><b>Autosave</b><span>Continuously saves your run for Continue.</span></span>
      <button class="toggle" id="set-autosave" aria-labelledby="lbl-autosave" role="switch" aria-checked="${s.autosave}"></button>
    </div>
    <div class="setting-row">
      <span class="setting-label" id="lbl-verb"><b>Announcement detail</b><span>How much screen readers hear during play.</span></span>
      <div class="seg" role="radiogroup" aria-labelledby="lbl-verb">
        <button class="seg-btn" data-verb="minimal" role="radio" aria-checked="${s.verbosity === 'minimal'}">Minimal</button>
        <button class="seg-btn" data-verb="standard" role="radio" aria-checked="${s.verbosity === 'standard'}">Standard</button>
        <button class="seg-btn" data-verb="detailed" role="radio" aria-checked="${s.verbosity === 'detailed'}">Detailed</button>
      </div>
    </div>
    <div class="modal-btn-row">
      <button class="modal-btn danger" id="set-clear">🗑️ Erase all data</button>
    </div>`, null, opener);

  const wire = (id, keyName, transform) => {
    body.querySelector(id).addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const on = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(on));
      const ns = { ...cb.getSettings() };
      ns[keyName] = transform ? transform(on) : on;
      cb.setSettings(ns);
    });
  };
  wire('#set-effects', 'effects', (on) => (on ? 'high' : 'low'));
  wire('#set-motion', 'reduceMotion');
  wire('#set-shake', 'shake');
  wire('#set-autosave', 'autosave');
  body.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-checked', 'false'));
      btn.setAttribute('aria-checked', 'true');
      const ns = { ...cb.getSettings(), verbosity: btn.dataset.verb };
      cb.setSettings(ns);
      announce(`Announcement detail set to ${btn.dataset.verb}.`, { force: true });
    });
  });
  body.querySelector('#set-clear').addEventListener('click', () => {
    if (confirm('Erase saves, best scores and settings?')) {
      cb.onClearData();
      closeModal();
    }
  });
}

export function openPauseMenu(opener) {
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
    </div>`, 'pause', opener);
  body.querySelector('#pm-resume').addEventListener('click', () => { closeModal(); cb.onResume(); });
  body.querySelector('#pm-howto').addEventListener('click', (e) => openHowTo(e.currentTarget));
  body.querySelector('#pm-settings').addEventListener('click', (e) => openSettings(e.currentTarget));
  body.querySelector('#pm-quit').addEventListener('click', () => { closeModal(); cb.onQuitToMenu(); });
}

export function openReport(outcome, best) {
  const o = outcome;
  const bestHtml = best.length
    ? `<h3>Best runs</h3><ul class="best-list">${best.map((b, i) =>
        `<li><span>${i + 1}. ${b.emoji} ${b.rank}</span><span>${b.score.toLocaleString()} pts · ${b.days}d</span></li>`).join('')}</ul>`
    : '';
  const body = openModal('📜 Mayor’s Report', `
    <div class="report-rank">
      <span class="r-emoji" aria-hidden="true">${o.rank.emoji}</span>
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
  announce(`Your term has ended. ${o.rank.title}. ${o.reasonText} Final score ${o.score.toLocaleString()} points, ${o.resolved} crises resolved, ${o.catastrophes} catastrophes.`,
    { assertive: true, force: true });
  body.querySelector('#rp-again').addEventListener('click', () => { closeModal(); cb.onNewGame(); });
  body.querySelector('#rp-menu').addEventListener('click', () => { closeModal(); cb.onQuitToMenu(); });
}
