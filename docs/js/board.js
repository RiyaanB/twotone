// Board view: renders a puzzle grid with edge clues and turns pointer input
// into paint gestures. Holds no game rules — the controller owns the grid.
import { edgeList, SAME } from './logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON = { 1: '#i-sun', 2: '#i-moon' };

function icon(href) {
  const s = document.createElementNS(SVG_NS, 'svg');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', href);
  s.appendChild(u);
  return s;
}

function clueIcon(clue) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('d', clue === SAME ? 'M4.5 7.2h11M4.5 12.8h11' : 'M5.5 5.5l9 9M14.5 5.5l-9 9');
  s.appendChild(path);
  return s;
}

export class Board {
  constructor(el, wrap, handlers) {
    this.el = el; this.wrap = wrap; this.h = handlers;
    this.cells = []; this.clues = new Map();
    this.p = null; this.gesture = null; this.cursor = -1;
    this.marks = [];
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('lostpointercapture', (e) => this.onUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    if ('ResizeObserver' in window) new ResizeObserver(() => this.layout()).observe(wrap);
    window.addEventListener('resize', () => this.layout());
  }

  load(p, grid) {
    this.p = p;
    const { n } = p;
    this.el.innerHTML = '';
    this.el.classList.remove('won', 'locked');
    this.el.style.setProperty('--n', n);
    this.el.dataset.n = n;
    this.cells = [];
    for (let i = 0; i < n * n; i++) {
      const b = document.createElement('button');
      b.className = 'cell';
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.i = i;
      b.dataset.given = p.givens[i] ? '1' : '0';
      b.style.setProperty('--d', Math.floor(i / n) + (i % n));
      b.setAttribute('role', 'gridcell');
      b.appendChild(icon('#i-sun'));
      this.el.appendChild(b);
      this.cells.push(b);
      this.paint(i, grid[i], false);
    }
    this.clues = new Map();
    for (const e of edgeList(p)) {
      const d = document.createElement('div');
      d.className = 'clue';
      d.dataset.type = e.type; d.dataset.i = e.i; d.dataset.clue = e.clue;
      d.dataset.a = e.a; d.dataset.b = e.b;
      d.setAttribute('aria-hidden', 'true');
      d.appendChild(clueIcon(e.clue));
      this.el.appendChild(d);
      this.clues.set(`${e.type}${e.i}`, d);
    }
    this.layout();
  }

  layout() {
    if (!this.p) return;
    const { n } = this.p;
    const cs = getComputedStyle(this.wrap);
    const w = this.wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let h = this.wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    // other in-flow children (e.g. the rules strip) share the column
    const gapPx = parseFloat(cs.rowGap) || 0;
    for (const ch of this.wrap.children) {
      if (ch === this.el || getComputedStyle(ch).position === 'absolute' || ch.hidden) continue;
      const hh = ch.getBoundingClientRect().height;
      if (hh > 0) h -= hh + gapPx;
    }
    const S = Math.max(160, Math.min(w, h, 620));
    const gap = Math.max(3, Math.min(7, Math.round(S / (n * 11))));
    const cell = Math.floor((S - (n + 1) * gap) / n);
    const clue = Math.round(Math.max(14, Math.min(22, cell * 0.38)));
    this.el.style.setProperty('--cell', cell + 'px');
    this.el.style.setProperty('--gap', gap + 'px');
    this.el.style.setProperty('--clue', clue + 'px');
    for (const d of this.clues.values()) {
      const t = d.dataset.type, i = +d.dataset.i;
      let x, y;
      if (t === 'h') {
        const r = Math.floor(i / (n - 1)), c = i % (n - 1);
        x = gap + (c + 1) * cell + c * gap + gap / 2;
        y = gap + r * (cell + gap) + cell / 2;
      } else {
        const r = Math.floor(i / n), c = i % n;
        x = gap + c * (cell + gap) + cell / 2;
        y = gap + (r + 1) * cell + r * gap + gap / 2;
      }
      d.style.left = x + 'px'; d.style.top = y + 'px';
    }
  }

  paint(i, v, animate = true) {
    const b = this.cells[i]; if (!b) return;
    const prev = b.dataset.v;
    b.dataset.v = v;
    if (v) b.firstChild.firstChild.setAttribute('href', ICON[v]);
    const label = `Row ${Math.floor(i / this.p.n) + 1}, column ${(i % this.p.n) + 1}: ${v === 1 ? 'sun' : v === 2 ? 'moon' : 'empty'}${this.p.givens[i] ? ' (given)' : ''}`;
    b.setAttribute('aria-label', label);
    if (animate && String(v) !== prev) {
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    }
  }

  shake(i) {
    const b = this.cells[i]; if (!b) return;
    b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
  }

  cellAt(x, y) {
    const t = document.elementFromPoint(x, y);
    const c = t && t.closest && t.closest('.cell');
    return c && this.el.contains(c) ? +c.dataset.i : -1;
  }

  onDown(e) {
    if (e.button !== undefined && e.button > 0) return;
    const i = this.cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    this.h.onInteract && this.h.onInteract();
    const ok = this.h.onPaintStart(i);
    if (!ok) return;
    this.gesture = { id: e.pointerId, last: i };
    try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  onMove(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const i = this.cellAt(e.clientX, e.clientY);
    if (i < 0 || i === g.last) return;
    g.last = i;
    this.h.onPaintMove(i);
  }

  onUp(e) {
    const g = this.gesture;
    if (!g || (e.pointerId !== undefined && e.pointerId !== g.id)) return;
    this.gesture = null;
    this.h.onPaintEnd();
  }

  setCursor(i) {
    if (this.cursor >= 0 && this.cells[this.cursor]) this.cells[this.cursor].classList.remove('cursor');
    this.cursor = i;
    if (i >= 0 && this.cells[i]) this.cells[i].classList.add('cursor');
  }

  showErrors(errs) {
    this.cells.forEach((b, i) => b.classList.toggle('err', !!errs && errs.cells.has(i)));
    for (const d of this.clues.values()) d.classList.remove('err');
    if (errs) for (const e of errs.edges) { const d = this.clues.get(`${e.type}${e.i}`); if (d) d.classList.add('err'); }
  }

  showHint(h) {
    this.clearHint();
    if (!h) return;
    const add = (el, cls) => { el.classList.add(cls); this.marks.push([el, cls]); };
    const { n } = this.p;
    if (h.line) {
      for (let k = 0; k < n; k++) {
        const idx = h.line.kind === 'row' ? h.line.index * n + k : k * n + h.line.index;
        add(this.cells[idx], 'lineglow');
      }
    }
    for (const r of h.refs || []) add(this.cells[r], 'ref');
    if (h.edge) { const d = this.clues.get(`${h.edge.type}${h.edge.i}`); if (d) add(d, 'ref'); }
    if (h.idx >= 0) add(this.cells[h.idx], 'target');
  }

  clearHint() {
    for (const [el, cls] of this.marks) el.classList.remove(cls);
    this.marks = [];
  }

  lock(on) { this.el.classList.toggle('locked', on); }

  celebrate() {
    this.el.classList.remove('won'); void this.el.offsetWidth; this.el.classList.add('won');
  }
}
