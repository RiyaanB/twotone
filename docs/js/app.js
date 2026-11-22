// Twotone — UI controller. All rules live in logic.js (pure); this file wires
// screens, input, timers, persistence, sound and the result flow.
import * as L from './logic.js';
import { Board } from './board.js';
import { sfx } from './audio.js';
import * as store from './store.js';

const $ = (s) => document.querySelector(s);
const S = store.get();
const SUN = L.SUN, MOON = L.MOON;
const RACE_HINT_PENALTY = 15000; // a hint in a race adds 15 s to your time

// ------------------------------------------------------------------ utils
function todayKey(d = new Date()) { return L.dateKeyFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const ico = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function randomSeed() {
  const a = new Uint32Array(2);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : (a[0] = Date.now(), a[1] = 7);
  return (a[0].toString(36) + a[1].toString(36)).slice(0, 10);
}
function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'); }

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ settings
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function applySound() {
  sfx.setMuted(!S.settings.sound);
  document.querySelectorAll('.sound-btn use').forEach((u) => u.setAttribute('href', S.settings.sound ? '#i-sound' : '#i-mute'));
  document.querySelectorAll('.sound-btn').forEach((b) => b.setAttribute('aria-pressed', String(S.settings.sound)));
}
function toggleSound() {
  S.settings.sound = !S.settings.sound; store.save(); applySound();
  if (S.settings.sound) sfx.ui();
  toast(S.settings.sound ? 'Sound on' : 'Sound off', 1200);
}

// ------------------------------------------------------------------ screens
let screen = 'home';
function show(name, push = true) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
  if (name !== screen) { clearTimeout(toastTimer); $('#toast').classList.remove('show'); }
  document.body.dataset.screen = name;
  if (push && name !== 'home' && screen === 'home') history.pushState({ s: name }, '');
  screen = name;
  if (name === 'home') renderHome();
  if (name === 'game') requestAnimationFrame(() => board.layout());
}

// Hardware/browser back: go up one level inside the app. While away from home we
// keep one extra history entry so "back" never leaves the game by surprise.
window.addEventListener('popstate', () => {
  if (!$('#modal').hidden) { if (modalCanClose) closeModal(); }
  else if (screen === 'game') confirmLeave();
  else if (screen !== 'home') show('home', false);
  if (screen !== 'home' || !$('#modal').hidden) history.pushState({ s: screen }, '');
});

// ------------------------------------------------------------------ modal
let modalCanClose = true, modalOnClose = null;
function openModal(html, { closable = true, onClose = null, cls = '' } = {}) {
  const m = $('#modal'), c = $('#modal-card');
  c.className = 'modal-card ' + cls;
  c.innerHTML = (closable ? `<button class="icon-btn modal-close" data-action="close-modal" aria-label="Close">${ico('i-x')}</button>` : '') + html;
  m.hidden = false;
  modalCanClose = closable; modalOnClose = onClose;
  if (screen === 'game' && G && !G.done) pauseClock();
  const f = c.querySelector('[data-autofocus]') || c.querySelector('button');
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
}
function closeModal() {
  const m = $('#modal');
  if (m.hidden) return;
  m.hidden = true;
  $('#modal-card').innerHTML = '';
  clearInterval(countdownTimer);
  const cb = modalOnClose; modalOnClose = null;
  if (cb) cb();
  if (screen === 'game' && G && !G.done && !G.counting && !document.hidden && $('#modal').hidden) startClock();
}
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && modalCanClose) closeModal(); });

// ------------------------------------------------------------------ how to play
const demoCell = (v, given = false) => `<span class="cell" data-v="${v}" data-given="${given ? 1 : 0}"><svg><use href="${v === 2 ? '#i-moon' : '#i-sun'}"/></svg></span>`;
const demoClue = (c) => `<span class="demo-clue"><svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="${c === 1 ? 'M4.5 7.2h11M4.5 12.8h11' : 'M5.5 5.5l9 9M14.5 5.5l-9 9'}"/></svg></span>`;
const HOWTO = [
  {
    ill: `<div class="demo-row">${[1, 2, 1, 2, 2, 1].map((v) => demoCell(v)).join('')}</div>
          <div class="demo-count"><span style="color:var(--sun-ink)">${ico('i-sun')} 3</span><span style="color:var(--moon-ink)">${ico('i-moon')} 3</span></div>`,
    text: `Fill every cell with a <b>sun</b> or a <b>moon</b>. Each row and column holds <b>the same number of each</b>.<small>Tap a cell to cycle sun → moon → empty. Drag to paint.</small>`,
  },
  {
    ill: `<div class="demo-row">${demoCell(1)}${demoCell(1)}${demoCell(2)}<span class="mark ok">${ico('i-check')}</span></div>
          <div class="demo-row">${demoCell(2)}${demoCell(2)}${demoCell(2)}<span class="mark no">${ico('i-x')}</span></div>`,
    text: `<b>No three in a row.</b> At most two of the same may sit side by side, across or down.`,
  },
  {
    ill: `<div class="demo-row">${demoCell(1)}${demoClue(1)}${demoCell(1)}<span style="width:22px"></span>${demoCell(2)}${demoClue(1)}${demoCell(2)}</div>
          <div class="demo-row">${demoCell(1)}${demoClue(2)}${demoCell(2)}<span style="width:22px"></span>${demoCell(2)}${demoClue(2)}${demoCell(1)}</div>`,
    text: `<b>=</b> means the two cells match. <b>×</b> means they’re opposite.<small>Every puzzle has exactly one solution — you never need to guess.</small>`,
  },
];
let firstRun = false;
function showHowTo(step = 0, onDone = null) {
  const s = HOWTO[step], last = step === HOWTO.length - 1;
  const warm = last && firstRun;
  openModal(`
    <h2 id="modal-title">How to play</h2>
    <p class="modal-sub">Step ${step + 1} of ${HOWTO.length}</p>
    <div class="howto-step"><div class="howto-ill">${s.ill}</div><p>${s.text}</p></div>
    <div class="dots">${HOWTO.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
    <div class="modal-actions"><div class="row">
      ${warm
    ? `<button class="btn btn-ghost" id="howto-skip" data-howto="done">Skip</button>
      <button class="btn btn-primary" id="howto-warmup" data-howto="warmup" data-autofocus>Try an easy one</button>`
    : `<button class="btn btn-ghost" data-howto="${step - 1}" ${step === 0 ? 'disabled style="opacity:.4"' : ''}>Back</button>
      <button class="btn btn-primary" id="howto-next" data-howto="${last ? 'done' : step + 1}" data-autofocus>${last ? 'Let’s play' : 'Next'}</button>`}
    </div></div>`, { onClose: () => { if (!S.seenHowTo) { S.seenHowTo = true; store.save(); } if (onDone) onDone(); } });
}

// ------------------------------------------------------------------ home
function renderHome() {
  const key = todayKey(), num = L.dayNumber(key), diff = L.DIFFICULTIES[L.dailyDiff(key)];
  const rec = S.daily[key];
  const today = num;
  const streak = L.liveStreak(S.streak, today);
  $('#daily-num').textContent = `#${num}`;
  let sub;
  if (rec && rec.done) sub = `${ico('i-check')} Solved in ${L.formatTime(rec.finalMs)}${rec.hints ? '' : ' · ⭐'}`;
  else if (rec && rec.ms > 1000) sub = `Continue · ${diff.label} · ${L.formatTime(rec.ms)}`;
  else sub = `${DOW[new Date().getDay()]} · ${diff.label}`;
  $('#daily-sub').innerHTML = rec && rec.done ? `<span class="done-pill">${sub}</span>` : sub;
  const anySolved = S.dailySolved > 0 || Object.values(S.practice).some((p) => p && p.solved > 0);
  $('#btn-warmup').hidden = anySolved || L.dailyDiff(key) === 'easy6';
  $('#daily-side').innerHTML = streak > 0
    ? `<span class="streak-pill" title="Daily streak">${ico('i-flame')} ${streak}</span>`
    : `<svg class="chev"><use href="#i-arrow"/></svg>`;
}

function renderPractice() {
  const list = $('#practice-list');
  list.innerHTML = L.DIFF_ORDER.map((id) => {
    const d = L.DIFFICULTIES[id], st = S.practice[id];
    return `<button class="diff-card" data-practice="${id}">
      ${miniPreview(id)}
      <span class="diff-name">${d.label}</span>
      <span class="diff-meta">${st && st.best ? `Best ${L.formatTime(st.best)} · ${st.solved} solved` : 'Not played yet'}</span>
    </button>`;
  }).join('');
}

const previewCache = {};
function miniPreview(id) {
  if (!previewCache[id]) {
    const p = L.generate(id, 'preview');
    const { n } = p;
    const show = L.makeRng('pv' + id);
    previewCache[id] = `<span class="mini" style="grid-template-columns:repeat(${n},1fr)">${p.solution.map((v) => `<i class="${show() < 0.55 ? (v === SUN ? 's' : 'm') : ''}"></i>`).join('')}</span>`;
  }
  return previewCache[id];
}

let raceDiff = 'hard6';
function renderRace() {
  $('#race-roster').innerHTML = L.BOTS.map((b) => `
    <div class="roster-row">
      <span class="bot-badge" style="background:${b.color}">${ico('i-bot')}</span>
      <span class="who"><span class="tag-bot">BOT</span>${esc(b.name)}<small>Computer player · ${esc(b.blurb)}</small></span>
    </div>`).join('');
  $('#race-sizes').innerHTML = L.DIFF_ORDER.map((id) => {
    const d = L.DIFFICULTIES[id];
    return `<button class="chip" role="radio" aria-checked="${id === raceDiff}" data-race-size="${id}">${d.n}×${d.n}<small>${d.short}</small></button>`;
  }).join('');
}

// ------------------------------------------------------------------ game state
const board = new Board($('#board'), $('#board-wrap'), {
  onInteract: () => sfx.unlock(),
  onPaintStart: (i) => paintStart(i),
  onPaintMove: (i) => paintMove(i),
  onPaintEnd: () => paintEnd(),
});

let G = null; // current game
let rafId = 0;

function newGame(mode, p, extra = {}) {
  G = {
    mode, p,
    grid: extra.grid ? extra.grid.slice() : p.givens.slice(),
    undo: [], hints: extra.hints || 0,
    elapsedBefore: extra.ms || 0, startedAt: 0, running: false,
    done: false, moves: 0, paint: null, cursor: -1,
    schedules: extra.schedules || null, botDone: new Set(),
    seed: extra.seed || p.seed, doneLines: new Set(),
  };
  board.load(p, G.grid);
  board.setCursor(-1);
  shownErr = new Set(); clearTimeout(errTimer);
  // lines already complete on load (resumed daily) shouldn't re-celebrate
  for (let k = 0; k < p.n; k++) { G.doneLines.add('r' + k); G.doneLines.add('c' + k); }
  celebrateLines([]);
  const d = L.DIFFICULTIES[p.diff];
  if (mode === 'daily') { $('#gt-mode').textContent = `Daily #${p.daily.number}`; $('#gt-sub').textContent = d.label; }
  else if (mode === 'race') { $('#gt-mode').textContent = 'Race the bots'; $('#gt-sub').textContent = `${d.label} · vs 3 bots`; }
  else { $('#gt-mode').textContent = 'Practice'; $('#gt-sub').textContent = d.label; }
  renderRaceBars();
  renderRules(p.n);
  setStatus(defaultStatus());
  updateTools();
  refreshErrors(false);
  show('game');
  updateTimer();
}

function renderRules(n) {
  const cl = (c) => `<span class="cl"><svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" d="${c === 1 ? 'M4.5 7.2h11M4.5 12.8h11' : 'M5.5 5.5l9 9M14.5 5.5l-9 9'}"/></svg></span>`;
  $('#rules-strip').innerHTML = `
    <span class="rule-chip" title="Each row and column has ${n / 2} suns and ${n / 2} moons">${n / 2}<span class="s">${ico('i-sun')}</span>${n / 2}<span class="m">${ico('i-moon')}</span>per line</span>
    <span class="rule-chip">No 3 in a row</span>
    <span class="rule-chip">${cl(1)} same&nbsp;${cl(2)} opposite</span>`;
}

function defaultStatus() {
  if (!G) return '';
  if (G.mode === 'race') return 'First to fill the grid correctly wins. Each hint adds +15 s. Bots are computer players.';
  return matchMedia('(hover: hover)').matches
    ? 'Click to cycle, drag to paint. Keys: arrows, S, M, Space.'
    : 'Tap: sun → moon → empty. Drag to paint several cells.';
}

function elapsed() { return G ? G.elapsedBefore + (G.running ? performance.now() - G.startedAt : 0) : 0; }
function startClock() {
  if (!G || G.running || G.done) return;
  G.startedAt = performance.now(); G.running = true;
  $('#timer').classList.remove('paused');
  loop();
}
function pauseClock() {
  if (!G || !G.running) return;
  G.elapsedBefore = elapsed(); G.running = false;
  $('#timer').classList.add('paused');
  saveDaily();
}
function loop() {
  cancelAnimationFrame(rafId);
  const tick = () => {
    if (!G || !G.running) return;
    updateTimer();
    if (G.mode === 'race') updateRaceBars();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}
let lastTimerText = '';
function updateTimer() {
  const t = L.formatTime(elapsed());
  if (t !== lastTimerText) { $('#timer').textContent = t; lastTimerText = t; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseClock();
  else if (G && !G.done && screen === 'game' && !G.counting && $('#modal').hidden) startClock();
});

// ------------------------------------------------------------------ painting & undo
function canEdit(i) { return G && !G.done && !G.counting && !G.p.givens[i]; }

function paintStart(i) {
  if (!G || G.done || G.counting) return false;
  if (G.p.givens[i]) { board.shake(i); sfx.locked(); return false; }
  setCursor(i, false);
  const val = L.cycle(G.grid[i]);
  G.paint = { val, changes: [], count: 0 };
  applyPaint(i, val);
  return true;
}
function paintMove(i) {
  if (!G || !G.paint || !canEdit(i)) return;
  if (G.grid[i] === G.paint.val) return;
  applyPaint(i, G.paint.val);
}
function applyPaint(i, val) {
  const from = G.grid[i];
  G.grid[i] = val;
  G.paint.changes.push({ i, from, to: val });
  board.paint(i, val);
  const step = G.paint.count++;
  if (val === SUN) sfx.sun(step); else if (val === MOON) sfx.moon(step); else sfx.clear();
  afterChange();
}
function paintEnd() {
  if (!G || !G.paint) return;
  const changes = G.paint.changes;
  if (changes.length) { G.undo.push(changes); G.moves++; }
  G.paint = null;
  celebrateLines(changes.map((c) => c.i));
  updateTools();
  checkComplete();
}

function setCell(i, val, record = true) {
  if (!canEdit(i) || G.grid[i] === val) return;
  const from = G.grid[i];
  G.grid[i] = val;
  board.paint(i, val);
  if (record) { G.undo.push([{ i, from, to: val }]); G.moves++; }
  if (val === SUN) sfx.sun(0); else if (val === MOON) sfx.moon(0); else sfx.clear();
  afterChange();
  celebrateLines([i]);
  updateTools();
  checkComplete();
}

function undo() {
  if (!G || G.done || G.counting || !G.undo.length) return;
  const changes = G.undo.pop();
  for (let k = changes.length - 1; k >= 0; k--) {
    const { i, from } = changes[k];
    G.grid[i] = from; board.paint(i, from);
  }
  sfx.undo();
  afterChange();
  celebrateLines(changes.map((c) => c.i));
  setStatus('Undone.');
  updateTools();
}

function clearBoard() {
  if (!G || G.done || G.counting) return;
  const changes = [];
  G.grid.forEach((v, i) => { if (v && !G.p.givens[i]) changes.push({ i, from: v, to: 0 }); });
  if (!changes.length) { setStatus('The board is already clear.'); return; }
  for (const c of changes) { G.grid[c.i] = 0; board.paint(c.i, 0); }
  G.undo.push(changes);
  sfx.undo();
  afterChange();
  setStatus('Cleared your cells. Undo brings them back.');
  updateTools();
}

function afterChange() {
  board.clearHint();
  G.pendingHint = null;
  if (G.statusKind === 'hint' || G.statusKind === 'warn') setStatus(defaultStatus());
  refreshErrors(true);
  if (!G.running && !G.done && !G.counting) startClock();
  saveDaily();
  if (G.mode === 'race') updateRaceBars();
}

let errTimer = 0, shownErr = new Set();
function errKeySet(errs) {
  const s = new Set();
  for (const i of errs.cells) s.add('c' + i);
  for (const e of errs.edges) s.add(e.type + e.i);
  return s;
}
function refreshErrors(withFeedback) {
  if (!G) return;
  clearTimeout(errTimer);
  const errs = L.findErrors(G.p, G.grid);
  if (!S.settings.errors) { board.showErrors(null); shownErr = new Set(); return; }
  const keys = errKeySet(errs);
  const fresh = [...keys].some((k) => !shownErr.has(k));
  if (!fresh || !withFeedback) {
    // fixes (and silent refreshes) show immediately
    board.showErrors(errs); shownErr = keys;
    if (!keys.size && G.statusKind === 'warn') setStatus(defaultStatus());
    return;
  }
  // New rule break: keep showing only the old ones for a beat — the player may
  // just be cycling sun → moon — then highlight it with a gentle buzz.
  const still = { cells: new Set([...errs.cells].filter((i) => shownErr.has('c' + i))), edges: errs.edges.filter((e) => shownErr.has(e.type + e.i)) };
  board.showErrors(still);
  const g = G;
  errTimer = setTimeout(() => {
    if (G !== g || G.done) return;
    const now = L.findErrors(G.p, G.grid);
    board.showErrors(now); shownErr = errKeySet(now);
    if (now.any) { sfx.error(); setStatus(L.describeErrors(now), 'warn'); }
  }, 650);
}

/** Gentle ripple + chime when a row/column fills up with no rule breaks. */
function celebrateLines(changed) {
  if (!G || G.done) return;
  const { n } = G.p;
  const errs = L.findErrors(G.p, G.grid);
  const lines = new Set();
  for (const i of changed) { lines.add('r' + Math.floor(i / n)); lines.add('c' + (i % n)); }
  let k = 0;
  for (const id of lines) {
    const idx = +id.slice(1);
    const cells = [];
    for (let j = 0; j < n; j++) cells.push(id[0] === 'r' ? idx * n + j : j * n + idx);
    if (cells.some((c) => !G.grid[c] || errs.cells.has(c))) continue;
    if (G.doneLines.has(id)) continue;
    G.doneLines.add(id);
    cells.forEach((c, j) => { const el = board.cells[c]; el.style.setProperty('--k', j); el.classList.remove('line-done'); void el.offsetWidth; el.classList.add('line-done'); });
    k++;
  }
  if (k) sfx.line();
  // forget lines that were emptied again
  for (const id of [...G.doneLines]) {
    const idx = +id.slice(1);
    for (let j = 0; j < n; j++) { const c = id[0] === 'r' ? idx * n + j : j * n + idx; if (!G.grid[c]) { G.doneLines.delete(id); break; } }
  }
}

function checkComplete() {
  if (!G || G.done || G.paint) return;
  if (!L.isComplete(G.grid)) return;
  if (L.isSolved(G.p, G.grid)) { win(); return; }
  const errs = L.findErrors(G.p, G.grid);
  board.showErrors(errs);
  setStatus(errs.any ? `Not quite — ${L.describeErrors(errs).replace(/^./, (c) => c.toLowerCase())}` : 'Not quite — something doesn’t fit.', 'warn');
  sfx.error();
}

// ------------------------------------------------------------------ hints
function hint() {
  if (!G || G.done || G.counting) return;
  const h = L.findHint(G.p, G.grid);
  if (!h) return;
  if (!G.running) startClock();
  const key = `${h.kind}:${h.idx}:${h.val}`;
  // Second press on the same step: fill it in (already paid for).
  if (h.kind === 'step' && G.pendingHint === key) {
    G.pendingHint = null;
    const from = G.grid[h.idx];
    G.grid[h.idx] = h.val; board.paint(h.idx, h.val);
    G.undo.push([{ i: h.idx, from, to: h.val }]); G.moves++;
    refreshErrors(false);
    board.showHint(h);
    setStatus(h.message, 'hint');
    sfx.hint();
    celebrateLines([h.idx]);
    afterHint(h);
    return;
  }
  G.hints++;
  let penalty = '';
  if (G.mode === 'race') {
    G.elapsedBefore += RACE_HINT_PENALTY; G.penaltyMs = (G.penaltyMs || 0) + RACE_HINT_PENALTY;
    penalty = '<b class="penalty">+15 s</b> ';
    flashTimer();
    updateTimer();
  }
  if (h.kind === 'mistake') {
    const from = G.grid[h.idx];
    G.grid[h.idx] = 0; board.paint(h.idx, 0);
    G.undo.push([{ i: h.idx, from, to: 0 }]);
    refreshErrors(false);
    board.showHint({ idx: h.idx, refs: [] });
    setStatus(penalty + h.message, 'hint');
    G.pendingHint = null;
  } else {
    // First press: explain and point, but let the player place it.
    board.showHint(h);
    setStatus(`${penalty}${h.message} <small class="hint-more">Tap Hint again to fill it in.</small>`, 'hint');
    G.pendingHint = key;
  }
  sfx.hint();
  afterHint(h);
}
function afterHint(h) {
  saveDaily();
  updateTools();
  if (G.mode === 'race') updateRaceBars();
  setCursor(h.idx, false);
  checkComplete();
}

// ------------------------------------------------------------------ status & tools
function setStatus(html, kind = '') {
  const el = $('#status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.innerHTML = `<span class="status-msg">${html}</span>`;
  if (G) G.statusKind = kind;
}
function updateTools() {
  $('#tool-undo').disabled = !G || G.done || !G.undo.length;
  $('#tool-hint').disabled = !G || G.done;
  $('#tool-restart').disabled = !G || G.done;
  const e = $('#tool-errors');
  e.setAttribute('aria-pressed', String(S.settings.errors));
  e.querySelector('use').setAttribute('href', S.settings.errors ? '#i-eye' : '#i-eye-off');
  const hintLabel = $('#tool-hint span');
  hintLabel.textContent = G && G.mode === 'race' ? 'Hint +15s' : G && G.hints ? `Hint · ${G.hints}` : 'Hint';
  $('#tool-errors').disabled = !G || G.done;
}
function toggleErrors() {
  if (G && G.done) return;
  S.settings.errors = !S.settings.errors; store.save();
  updateTools(); refreshErrors(false);
  setStatus(S.settings.errors ? 'Rule checks on: breaks are highlighted as you play.' : 'Rule checks off: you’ll only hear about mistakes when the grid is full.');
  sfx.ui();
}

function flashTimer() {
  const t = $('#timer');
  t.classList.remove('penalized'); void t.offsetWidth; t.classList.add('penalized');
}

// keyboard cursor
function setCursor(i, visible = true) {
  if (!G) return;
  G.cursor = i;
  board.setCursor(visible ? i : -1);
}

// ------------------------------------------------------------------ daily persistence
function saveDaily() {
  if (!G || G.mode !== 'daily' || G.done) return;
  const key = G.p.daily.dateKey;
  const rec = S.daily[key] || (S.daily[key] = {});
  rec.grid = L.encodeGrid(G.grid); rec.ms = Math.round(elapsed()); rec.hints = G.hints;
  store.save();
}

// ------------------------------------------------------------------ race
function renderRaceBars() {
  const el = $('#race-bars');
  if (!G || G.mode !== 'race') { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const rows = [{ id: 'you', name: 'You', color: 'var(--accent)', you: true }, ...L.BOTS];
  el.innerHTML = rows.map((r) => `
    <div class="rb ${r.you ? 'you' : ''}" data-bot="${r.id}">
      <span class="nm">${r.you ? ico('i-sun') : ico('i-bot')}${r.you ? '' : '<em>BOT</em>'}${esc(r.name)}</span>
      <span class="track"><span class="fill" style="background:${r.color}"></span></span>
      <span class="pct">0%</span>
    </div>`).join('');
  updateRaceBars();
}
function updateRaceBars() {
  if (!G || G.mode !== 'race') return;
  const ms = elapsed();
  const set = (id, frac, label, done) => {
    const row = document.querySelector(`.rb[data-bot="${id}"]`); if (!row) return;
    row.querySelector('.fill').style.width = (frac * 100).toFixed(1) + '%';
    const pct = row.querySelector('.pct'); if (pct.textContent !== label) pct.textContent = label;
    row.classList.toggle('done', !!done);
  };
  const youFrac = L.progress(G.p, G.grid);
  set('you', youFrac, G.done ? L.formatTime(G.finalMs) : Math.round(youFrac * 100) + '%', G.done);
  L.BOTS.forEach((b, k) => {
    const t = G.schedules[k];
    const frac = L.botProgressAt(t, ms);
    const done = frac >= 1;
    set(b.id, frac, done ? L.formatTime(t[t.length - 1]) : Math.round(frac * 100) + '%', done);
    if (done && !G.botDone.has(b.id) && !G.done) {
      G.botDone.add(b.id);
      sfx.botDone();
      toast(`🤖 ${b.name} (bot) finished in ${L.formatTime(t[t.length - 1])}`);
    }
  });
}
function raceCountdown(then) {
  const el = $('#countdown');
  G.counting = true;
  el.hidden = false;
  let k = 3;
  const step = () => {
    if (!G || !G.counting) { el.hidden = true; return; }
    if (k === 0) {
      el.hidden = true; G.counting = false; sfx.count(true);
      setStatus('Go! Fill the grid before the bots do.');
      then(); return;
    }
    el.innerHTML = `<span>${k}</span>`;
    sfx.count(false);
    k--;
    G.countTimer = setTimeout(step, 800);
  };
  step();
}

// ------------------------------------------------------------------ win & results
function win() {
  G.done = true;
  G.finalMs = Math.round(elapsed());
  G.running = false;
  cancelAnimationFrame(rafId);
  updateTimer();
  $('#timer').textContent = L.formatTime(G.finalMs);
  board.clearHint(); board.showErrors(null); board.setCursor(-1);
  board.lock(true);
  board.celebrate();
  sfx.win();
  burst();
  updateTools();
  setStatus(`<b>Solved!</b> Every row and column is in balance. <button class="link-btn" data-action="show-result">See result</button>`, 'good');
  const result = recordResult();
  G.lastResult = result;
  if (G.mode === 'race') updateRaceBars();
  const g = G;
  setTimeout(() => { if (G === g && screen === 'game') showResult(result); }, 1300);
}

function recordResult() {
  const ms = G.finalMs, hints = G.hints;
  const r = { mode: G.mode, ms, hints, diff: G.p.diff };
  if (G.mode === 'daily') {
    const key = G.p.daily.dateKey, num = G.p.daily.number;
    const rec = S.daily[key] || (S.daily[key] = {});
    if (!rec.done) {
      rec.done = true; rec.finalMs = ms; rec.hints = hints; rec.grid = L.encodeGrid(G.grid); rec.ms = ms;
      S.dailySolved++;
      if (!hints) S.dailyNoHint++;
      S.streak = L.updateStreak(S.streak, num);
    }
    r.number = num; r.streak = L.liveStreak(S.streak, num); r.best = S.streak.best;
  } else if (G.mode === 'practice') {
    const st = S.practice[G.p.diff] || (S.practice[G.p.diff] = { solved: 0, best: 0, totalMs: 0 });
    r.prevBest = st.best;
    st.solved++; st.totalMs += ms;
    r.newBest = !hints && (!st.best || ms < st.best);
    if (r.newBest) st.best = ms;
    r.best = st.best; r.solved = st.solved;
    r.warmup = !!G.warmup;
  } else if (G.mode === 'race') {
    const place = L.racePlacement(ms, G.schedules);
    r.penaltyMs = G.penaltyMs || 0;
    S.race.played++;
    if (place === 1) S.race.wins++;
    if (place <= 3) S.race.podiums++;
    r.place = place;
  }
  store.save();
  return r;
}

function shareUrl() {
  const u = location.href.split('#')[0].split('?')[0];
  return /^https?:/.test(u) ? u : '';
}

let countdownTimer = 0;
function nextDailyIn() {
  const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function showResult(r) {
  const time = `<div class="big-time" id="result-time">${L.formatTime(r.ms)}</div>`;
  const hintBadge = r.hints ? `<span class="badge">${ico('i-hint')} ${r.hints} hint${r.hints === 1 ? '' : 's'}</span>` : `<span class="badge gold">⭐ No hints</span>`;
  let html = '', actions = '';
  if (r.mode === 'daily') {
    html = `
      <div class="result-hero"><svg><use href="#logo"/></svg></div>
      <h2 id="modal-title">Daily #${r.number} solved!</h2>
      <p class="modal-sub">${L.DIFFICULTIES[r.diff].label}</p>
      ${time}
      <div class="badges">${hintBadge}${r.streak > 0 ? `<span class="badge flame">${ico('i-flame')} ${r.streak}-day streak</span>` : ''}</div>
      <div class="next-daily">Next daily in <b id="next-daily">${nextDailyIn()}</b></div>`;
    actions = `<button class="btn btn-sun btn-wide" data-action="share" data-autofocus>${ico('i-share')} Copy result</button>
      <div class="row"><button class="btn btn-ghost" data-action="goto-practice">Practice</button><button class="btn btn-ghost" data-action="home">Home</button></div>`;
  } else if (r.mode === 'practice') {
    html = `
      <div class="result-hero"><svg><use href="#logo"/></svg></div>
      <h2 id="modal-title">Solved!</h2>
      <p class="modal-sub">${L.DIFFICULTIES[r.diff].label}</p>
      ${time}
      <div class="badges">${hintBadge}${r.newBest ? `<span class="badge new">New best!</span>` : r.best ? `<span class="badge">Best ${L.formatTime(r.best)}</span>` : ''}</div>
      ${r.hints && !r.best && !r.warmup ? '<p class="next-daily">Solve without hints to set a best time.</p>' : ''}`;
    if (r.warmup) html += `<p class="next-daily">Nice! You’re ready for today’s daily.</p>`;
    actions = r.warmup
      ? `<button class="btn btn-sun btn-wide" data-action="goto-daily" data-autofocus>Play Daily #${L.dayNumber(todayKey())} ${ico('i-arrow')}</button>
      <div class="row"><button class="btn btn-ghost" data-action="practice-again">One more</button><button class="btn btn-ghost" data-action="home">Home</button></div>`
      : `<button class="btn btn-primary btn-wide" data-action="practice-again" data-autofocus>Next puzzle ${ico('i-arrow')}</button>
      <div class="row"><button class="btn btn-ghost" data-action="goto-practice">Change size</button><button class="btn btn-ghost" data-action="home">Home</button></div>`;
  } else {
    const rows = [{ name: 'You', you: true, t: r.ms, final: true }].concat(L.BOTS.map((b, k) => {
      const t = G.schedules[k]; const fin = t[t.length - 1];
      return { name: b.name, bot: b, t: fin, final: fin <= r.ms };
    })).sort((a, b) => a.t - b.t);
    const medal = ['🥇', '🥈', '🥉', '4'];
    // how close was it? compare with the nearest bot
    const botsRows = rows.filter((x) => !x.you);
    const ahead = botsRows.filter((x) => x.t < r.ms).pop();
    const behind = botsRows.find((x) => x.t >= r.ms);
    const gap = (ms) => { const sec = Math.max(1, Math.round(ms / 1000)); return sec < 60 ? `${sec} s` : L.formatTime(sec * 1000); };
    const margin = r.place === 1
      ? (behind ? `${gap(behind.t - r.ms)} ahead of ${esc(behind.name)} (bot)` : '')
      : (ahead ? `${gap(r.ms - ahead.t)} behind ${esc(ahead.name)} (bot)` : '');
    html = `
      <div class="result-hero"><svg><use href="#logo"/></svg></div>
      <h2 id="modal-title">${r.place === 1 ? 'You won the race!' : `You placed ${ordinal(r.place)}`}</h2>
      <p class="modal-sub">${L.DIFFICULTIES[r.diff].label} · vs 3 bots</p>
      ${time}
      ${margin ? `<p class="race-margin">${margin}</p>` : ''}
      <div class="badges">${hintBadge}${r.penaltyMs ? `<span class="badge warn-badge">+${Math.round(r.penaltyMs / 1000)} s hint penalty</span>` : ''}</div>
      <div class="standings">${rows.map((x, k) => `
        <div class="standing ${x.you ? 'you' : ''}">
          <span class="pl">${medal[k]}</span>
          <span class="who">${x.you ? ico('i-sun') : `${ico('i-bot')}<span class="tag-bot">BOT</span>`}${esc(x.name)}</span>
          <span class="t">${L.formatTime(x.t)}${x.final ? '' : '<small>projected</small>'}</span>
        </div>`).join('')}</div>`;
    actions = `<button class="btn btn-primary btn-wide" data-action="race-again" data-autofocus>Race again ${ico('i-arrow')}</button>
      <div class="row"><button class="btn btn-ghost" data-action="goto-race">Change size</button><button class="btn btn-ghost" data-action="home">Home</button></div>`;
  }
  openModal(`<div id="result" data-mode="${r.mode}">${html}<div class="modal-actions">${actions}</div></div>`, { cls: 'result-card' });
  G.lastResult = r;
  if (r.mode === 'daily') {
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => { const el = $('#next-daily'); if (el) el.textContent = nextDailyIn(); else clearInterval(countdownTimer); }, 1000);
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

async function share() {
  const r = G && G.lastResult;
  if (!r || r.mode !== 'daily') return;
  const text = L.shareText({ number: r.number, ms: r.ms, hints: r.hints, diff: r.diff, streak: r.streak, url: shareUrl() });
  const ok = await copyText(text);
  window.__lastShare = text;
  toast(ok ? 'Result copied — paste it anywhere!' : 'Couldn’t copy automatically');
  sfx.ui();
}

function burst() {
  const fx = $('#fx');
  const rect = $('#board').getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let k = 0; k < 28; k++) {
    const d = document.createElement('div');
    d.className = 'particle';
    const isSun = k % 2 === 0;
    d.style.color = isSun ? 'var(--sun)' : 'var(--moon)';
    d.innerHTML = `<svg><use href="${isSun ? '#i-sun' : '#i-moon'}"/></svg>`;
    d.style.left = cx - 13 + 'px'; d.style.top = cy - 13 + 'px';
    const size = 0.5 + Math.random() * 0.9;
    fx.appendChild(d);
    const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * Math.max(rect.width, 260) * 0.7;
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 60;
    const anim = d.animate([
      { transform: `translate(0,0) scale(${size * 0.3}) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${dx * 0.6}px,${dy * 0.6}px) scale(${size}) rotate(${ang * 90}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${dx}px,${dy + 140}px) scale(${size * 0.8}) rotate(${ang * 200}deg)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 700, easing: 'cubic-bezier(.2,.7,.4,1)', delay: Math.random() * 150 });
    anim.onfinish = () => d.remove();
  }
}

// ------------------------------------------------------------------ starting modes
function startDaily() {
  const key = todayKey();
  const p = L.dailyPuzzle(key);
  const rec = S.daily[key];
  if (rec && rec.done) {
    newGame('daily', p, { grid: p.solution, ms: rec.finalMs, hints: rec.hints });
    G.done = true; G.finalMs = rec.finalMs;
    board.lock(true); updateTools();
    setStatus(`<b>Solved</b> in ${L.formatTime(rec.finalMs)}. New puzzle at midnight. <button class="link-btn" data-action="show-result">See result</button>`, 'good');
    G.lastResult = { mode: 'daily', ms: rec.finalMs, hints: rec.hints, diff: p.diff, number: p.daily.number, streak: L.liveStreak(S.streak, p.daily.number) };
    showResult(G.lastResult);
    return;
  }
  if (!rec) { S.daily[key] = { grid: L.encodeGrid(p.givens), ms: 0, hints: 0 }; S.dailyPlayed++; store.save(); }
  const r = S.daily[key];
  let grid = p.givens.slice();
  try { const g = L.decodeGrid(r.grid || ''); if (g.length === p.givens.length) grid = g.map((v, i) => (p.givens[i] || v)); } catch (e) { /* fresh */ }
  newGame('daily', p, { grid, ms: r.ms || 0, hints: r.hints || 0 });
  if (r.ms > 0) setStatus(`Welcome back — picking up at ${L.formatTime(r.ms)}.`);
  startClock();
}

let practiceDiff = 'easy6';
function startPractice(diff, { warmup = false } = {}) {
  practiceDiff = diff;
  const seed = randomSeed();
  const p = L.generate(diff, seed);
  newGame('practice', p, { seed });
  if (warmup) {
    G.warmup = true;
    $('#gt-mode').textContent = 'Warm-up';
    setStatus('Look for an <b>=</b> or <b>×</b> beside a filled cell, or two of a kind side by side. Stuck? Tap <b>Hint</b>.', 'tip');
  }
  startClock();
}

function startRace(diff) {
  raceDiff = diff;
  const seed = randomSeed();
  const p = L.generate(diff, seed);
  const schedules = L.BOTS.map((b) => L.botSchedule(p, b, seed));
  newGame('race', p, { seed, schedules });
  $('#timer').textContent = '0:00';
  raceCountdown(() => startClock());
}

function leaveGame(fromPop = false) {
  if (G) {
    clearTimeout(G.countTimer);
    G.counting = false;
    $('#countdown').hidden = true;
    pauseClock();
  }
  closeModal();
  const back = G && G.mode === 'practice' && !G.warmup ? 'practice' : G && G.mode === 'race' ? 'race' : 'home';
  G = null;
  cancelAnimationFrame(rafId);
  if (back === 'practice') renderPractice();
  if (back === 'race') renderRace();
  show(back, false);
  if (!fromPop && history.state && history.state.s) { /* keep history simple */ }
}

function confirmLeave() {
  if (G && !G.done && G.mode !== 'daily' && G.moves > 0) {
    pauseClock();
    openModal(`<h2 id="modal-title">Leave this puzzle?</h2><p class="modal-sub">Your progress on this ${G.mode === 'race' ? 'race' : 'puzzle'} won’t be saved.</p>
      <div class="modal-actions"><div class="row"><button class="btn btn-ghost" data-action="close-modal" data-autofocus>Keep playing</button><button class="btn btn-primary" data-action="leave-now">Leave</button></div></div>`);
    return;
  }
  leaveGame();
}

// ------------------------------------------------------------------ stats & settings
function showStats() {
  const key = todayKey(), today = L.dayNumber(key);
  const rows = L.DIFF_ORDER.map((id) => {
    const st = S.practice[id];
    const solved = st ? st.solved : 0;
    return `<tr><td>${L.DIFFICULTIES[id].label}<small class="muted-s"> · ${solved} solved</small></td><td class="${st && st.best ? '' : 'muted'}">${st && st.best ? L.formatTime(st.best) : '—'}</td></tr>`;
  }).join('');
  openModal(`
    <h2 id="modal-title">Statistics</h2>
    <div class="section-h">Daily</div>
    <div class="stat-grid">
      <div class="stat"><b>${S.dailySolved}</b><span>Solved</span></div>
      <div class="stat"><b>${S.dailyNoHint}</b><span>No hints</span></div>
      <div class="stat"><b>${L.liveStreak(S.streak, today)}</b><span>Streak</span></div>
      <div class="stat"><b>${S.streak.best}</b><span>Best streak</span></div>
    </div>
    <div class="section-h">Practice best times <small style="text-transform:none;letter-spacing:0">(no hints)</small></div>
    <table class="best-table">${rows}</table>
    <div class="section-h">Race the bots</div>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><b>${S.race.played}</b><span>Races</span></div>
      <div class="stat"><b>${S.race.wins}</b><span>Wins</span></div>
      <div class="stat"><b>${S.race.podiums}</b><span>Top 3</span></div>
    </div>
    <p class="credits">Stats are stored only on this device.</p>`);
}

function showSettings() {
  const sw = (id, on) => `<button class="switch" role="switch" aria-checked="${on}" data-setting="${id}" aria-label="${id}"></button>`;
  const th = S.settings.theme;
  openModal(`
    <h2 id="modal-title">Settings</h2>
    <div class="setting"><span>Sound<small>Soft generated tones</small></span>${sw('sound', S.settings.sound)}</div>
    <div class="setting"><span>Rule checks<small>Highlight breaks as you play</small></span>${sw('errors', S.settings.errors)}</div>
    <div class="setting"><span>Theme</span><span class="seg" role="group" aria-label="Theme">
      ${['auto', 'light', 'dark'].map((t) => `<button data-theme-set="${t}" aria-pressed="${th === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    </span></div>
    <div class="setting"><span>How to play</span><button class="btn btn-ghost" style="min-height:40px;padding:8px 14px" data-action="help">Show</button></div>
    <div class="setting"><span>Reset statistics<small>Streaks, best times, daily records</small></span><button class="link-btn danger-link" data-action="reset">Reset</button></div>
    <p class="credits">Twotone · MIT licensed · no tracking, no ads.<br>Keys: arrows move · S/1 sun · M/2 moon · Space cycle · Z undo · H hint · E checks</p>`);
}

// ------------------------------------------------------------------ events
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  sfx.unlock();
  const a = t.dataset.action;
  if (t.dataset.howto !== undefined) {
    const v = t.dataset.howto;
    sfx.ui();
    if (v === 'warmup') { firstRun = false; closeModal(); startPractice('easy6', { warmup: true }); return; }
    if (v === 'done') { firstRun = false; closeModal(); } else showHowTo(+v, null);
    return;
  }
  if (t.dataset.practice) { sfx.ui(); startPractice(t.dataset.practice); return; }
  if (t.dataset.raceSize) {
    raceDiff = t.dataset.raceSize; sfx.ui();
    document.querySelectorAll('[data-race-size]').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.raceSize === raceDiff)));
    return;
  }
  if (t.dataset.setting) {
    const k = t.dataset.setting;
    S.settings[k] = !S.settings[k]; store.save();
    t.setAttribute('aria-checked', String(S.settings[k]));
    if (k === 'sound') applySound();
    if (k === 'errors') { updateTools(); refreshErrors(false); }
    sfx.ui();
    return;
  }
  if (t.dataset.themeSet) {
    S.settings.theme = t.dataset.themeSet; store.save(); applyTheme();
    t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    sfx.ui();
    return;
  }
  switch (a) {
    case 'help': sfx.ui(); showHowTo(0); break;
    case 'stats': sfx.ui(); showStats(); break;
    case 'settings': sfx.ui(); showSettings(); break;
    case 'sound': toggleSound(); break;
    case 'close-modal': closeModal(); break;
    case 'home': closeModal(); if (screen === 'game') leaveGame(); show('home', false); break;
    case 'leave': confirmLeave(); break;
    case 'leave-now': modalOnClose = null; closeModal(); leaveGame(); break;
    case 'share': share(); break;
    case 'show-result': if (G && G.lastResult) showResult(G.lastResult); break;
    case 'goto-practice': closeModal(); if (screen === 'game') { G = null; } renderPractice(); show('practice', screen === 'home'); break;
    case 'goto-race': closeModal(); G = null; renderRace(); show('race', false); break;
    case 'practice-again': closeModal(); startPractice(practiceDiff); break;
    case 'race-again': closeModal(); startRace(raceDiff); break;
    case 'goto-daily': closeModal(); G = null; show('home', false); startDaily(); break;
    case 'reset':
      if (t.dataset.armed) { store.reset(); Object.assign(S, store.get()); closeModal(); toast('Statistics reset'); renderHome(); location.reload(); }
      else { t.dataset.armed = '1'; t.textContent = 'Tap again to confirm'; }
      break;
    default: break;
  }
});

$('#btn-daily').addEventListener('click', () => { sfx.ui(); startDaily(); });
$('#btn-practice').addEventListener('click', () => { sfx.ui(); renderPractice(); show('practice'); });
$('#btn-race').addEventListener('click', () => { sfx.ui(); renderRace(); show('race'); });
$('#btn-warmup').addEventListener('click', () => { sfx.ui(); startPractice('easy6', { warmup: true }); });
$('#btn-race-start').addEventListener('click', () => { sfx.ui(); startRace(raceDiff); });
$('#tool-undo').addEventListener('click', undo);
$('#tool-hint').addEventListener('click', hint);
$('#tool-errors').addEventListener('click', toggleErrors);
$('#tool-restart').addEventListener('click', clearBoard);

document.addEventListener('keydown', (e) => {
  if (e.altKey || e.metaKey) return;
  const k = e.key;
  if (!$('#modal').hidden) {
    if (k === 'Escape' && modalCanClose) { e.preventDefault(); closeModal(); }
    else if ((k === 'ArrowRight' || k === 'ArrowLeft') && $('#howto-next')) {
      const cur = +($('#modal-card .dots .on') ? [...$('#modal-card .dots').children].indexOf($('#modal-card .dots .on')) : 0);
      const nx = cur + (k === 'ArrowRight' ? 1 : -1);
      if (nx >= 0 && nx < HOWTO.length) { e.preventDefault(); showHowTo(nx); }
    }
    return;
  }
  if (k === '?' ) { showHowTo(0); return; }
  if ((k === 'm' || k === 'M') && screen !== 'game') { toggleSound(); return; }
  if (screen !== 'game' || !G) {
    if (k === 'Escape' && screen !== 'home') show('home', false);
    return;
  }
  if (e.ctrlKey && (k === 'z' || k === 'Z')) { e.preventDefault(); undo(); return; }
  if (e.ctrlKey) return;
  const n = G.p.n;
  let c = G.cursor < 0 ? 0 : G.cursor;
  const move = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
  if (k in move) {
    e.preventDefault();
    if (G.cursor < 0) { setCursor(0); return; }
    const r = Math.floor(c / n), col = c % n;
    if (k === 'ArrowLeft' && col === 0) return;
    if (k === 'ArrowRight' && col === n - 1) return;
    if (k === 'ArrowUp' && r === 0) return;
    if (k === 'ArrowDown' && r === n - 1) return;
    setCursor(c + move[k]);
    return;
  }
  const lower = k.toLowerCase();
  if (k === 'Escape') { confirmLeave(); return; }
  if (lower === 'h') { hint(); return; }
  if (lower === 'z' || lower === 'u') { undo(); return; }
  if (lower === 'e') { toggleErrors(); return; }
  if (lower === 'r') { clearBoard(); return; }
  if (G.done || G.counting) return;
  if (G.cursor < 0) { setCursor(0); }
  c = G.cursor;
  let val = null;
  if (k === ' ' || k === 'Enter') val = L.cycle(G.grid[c]);
  else if (lower === 's' || k === '1') val = SUN;
  else if (lower === 'm' || k === '2') val = MOON;
  else if (k === 'Backspace' || k === 'Delete' || k === '0' || k === '.') val = 0;
  if (val === null) return;
  e.preventDefault();
  sfx.unlock();
  setCursor(c);
  if (G.p.givens[c]) { board.shake(c); sfx.locked(); return; }
  setCell(c, val);
});

// Portrait phones have spare height: keep the status line under the board (so
// hints sit next to what they explain) instead of pinned above the toolbar.
const portraitMQ = matchMedia('(orientation: portrait) and (max-width: 699px)');
function placeStatus() {
  const st = $('#status');
  const home = portraitMQ.matches ? $('#board-wrap') : $('.game-foot');
  if (st.parentElement === home) return;
  if (portraitMQ.matches) home.insertBefore(st, $('#countdown')); else home.insertBefore(st, home.firstChild);
  board.layout();
}
portraitMQ.addEventListener ? portraitMQ.addEventListener('change', placeStatus) : portraitMQ.addListener(placeStatus);
placeStatus();

// ------------------------------------------------------------------ boot
applyTheme();
applySound();
renderHome();
show('home', false);
if (!S.seenHowTo) { firstRun = true; setTimeout(() => showHowTo(0), 350); }
