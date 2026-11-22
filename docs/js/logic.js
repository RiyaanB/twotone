// Twotone — pure, deterministic, isomorphic game logic.
// No DOM, no Math.random, no Date.now(): everything is seeded so the same
// seed produces the same puzzle in every browser and in Node.
//
// Grid encoding: flat array of length n*n, row-major. 0 = empty, 1 = sun, 2 = moon.
// Edge clues: h[r*(n-1)+c] relates (r,c)-(r,c+1); v[r*n+c] relates (r,c)-(r+1,c).
//             0 = no clue, 1 = SAME ("="), 2 = DIFF ("×").

export const EMPTY = 0, SUN = 1, MOON = 2;
export const NOCLUE = 0, SAME = 1, DIFF = 2;
export const opp = (v) => 3 - v;

export const DIFFICULTIES = {
  easy6: { id: 'easy6', n: 6, label: '6×6 Easy', short: 'Easy', tier: 1, minHard: 0, edgeP: 0.45, edgeBias: 0.2, extra: 2 },
  hard6: { id: 'hard6', n: 6, label: '6×6 Hard', short: 'Hard', tier: 2, minHard: 2, edgeP: 0.45, edgeBias: 0.2 },
  med8: { id: 'med8', n: 8, label: '8×8 Medium', short: 'Medium', tier: 2, minHard: 2, edgeP: 0.45, edgeBias: 0.2 },
  big10: { id: 'big10', n: 10, label: '10×10 Expert', short: 'Expert', tier: 2, minHard: 3, edgeP: 0.45, edgeBias: 0.2 },
};
export const DIFF_ORDER = ['easy6', 'hard6', 'med8', 'big10'];

// ---------------------------------------------------------------- RNG
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  return mulberry32(typeof seed === 'number' ? seed >>> 0 : hashString(String(seed)));
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// ---------------------------------------------------------------- lines
const patternCache = new Map();
/** All valid single-line patterns for size n as bitmasks (bit i set = sun at i). */
export function linePatterns(n) {
  if (patternCache.has(n)) return patternCache.get(n);
  const full = (1 << n) - 1, out = [];
  for (let p = 0; p <= full; p++) {
    if (popcount(p) !== n / 2) continue;
    const q = ~p & full;
    if (p & (p >> 1) & (p >> 2)) continue;
    if (q & (q >> 1) & (q >> 2)) continue;
    out.push(p);
  }
  patternCache.set(n, out);
  return out;
}
function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }

const lineCache = new Map();
/** Lines 0..n-1 are rows, n..2n-1 are columns. Each has cell indices and edge refs. */
export function lineDefs(n) {
  if (lineCache.has(n)) return lineCache.get(n);
  const lines = [];
  for (let r = 0; r < n; r++) {
    const cells = [], edges = [];
    for (let c = 0; c < n; c++) cells.push(r * n + c);
    for (let c = 0; c < n - 1; c++) edges.push(['h', r * (n - 1) + c]);
    lines.push({ kind: 'row', index: r, cells, edges });
  }
  for (let c = 0; c < n; c++) {
    const cells = [], edges = [];
    for (let r = 0; r < n; r++) cells.push(r * n + c);
    for (let r = 0; r < n - 1; r++) edges.push(['v', r * n + c]);
    lines.push({ kind: 'col', index: c, cells, edges });
  }
  lineCache.set(n, lines);
  return lines;
}

/** Every clued edge as {type:'h'|'v', i, a, b, clue}. */
export function edgeList(p) {
  const { n } = p, out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n - 1; c++) {
    const i = r * (n - 1) + c;
    if (p.h[i]) out.push({ type: 'h', i, a: r * n + c, b: r * n + c + 1, clue: p.h[i] });
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    if (p.v[i]) out.push({ type: 'v', i, a: r * n + c, b: (r + 1) * n + c, clue: p.v[i] });
  }
  return out;
}

export function lineName(line) {
  return `${line.kind === 'row' ? 'row' : 'column'} ${line.index + 1}`;
}
const NAME = { 1: 'sun', 2: 'moon' };
const NAMES = { 1: 'suns', 2: 'moons' };

// ---------------------------------------------------------------- solution
/** Random valid full grid (balanced, no three in a row) built row by row. */
export function randomSolution(n, rng) {
  const pats = linePatterns(n);
  const rows = new Array(n);
  const order = () => shuffle(pats.slice(), rng);
  const colSun = new Array(n).fill(0);
  const half = n / 2;

  function colsOk(r, pat) {
    for (let c = 0; c < n; c++) {
      const bit = (pat >> c) & 1;
      const sunCount = colSun[c] + bit;
      const moonCount = r + 1 - sunCount;
      if (sunCount > half || moonCount > half) return false;
      if (r >= 2) {
        const b1 = (rows[r - 1] >> c) & 1, b2 = (rows[r - 2] >> c) & 1;
        if (b1 === bit && b2 === bit) return false;
      }
    }
    return true;
  }
  let budget = 200000;
  function place(r) {
    if (r === n) return true;
    for (const pat of order()) {
      if (--budget < 0) return false;
      if (!colsOk(r, pat)) continue;
      rows[r] = pat;
      for (let c = 0; c < n; c++) colSun[c] += (pat >> c) & 1;
      if (place(r + 1)) return true;
      for (let c = 0; c < n; c++) colSun[c] -= (pat >> c) & 1;
    }
    return false;
  }
  if (!place(0)) return null;
  const g = new Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) g[r * n + c] = ((rows[r] >> c) & 1) ? SUN : MOON;
  return g;
}

// ---------------------------------------------------------------- deductions
// Each deduction: { idx, val, rule, tier, refs:[cell idx], line?, edge?, message }

/** Tier-1 (basic) deductions available from grid g. */
export function basicDeductions(p, g, firstOnly = false) {
  const { n } = p, half = n / 2, out = [];
  const seen = new Set();
  const push = (d) => {
    if (g[d.idx] !== EMPTY || seen.has(d.idx)) return false;
    seen.add(d.idx); out.push(d);
    return firstOnly;
  };

  // 1) edge clues: one side known
  for (const e of edgeList(p)) {
    const va = g[e.a], vb = g[e.b];
    if ((va === EMPTY) === (vb === EMPTY)) continue;
    const [known, target] = va ? [e.a, e.b] : [e.b, e.a];
    const kv = g[known];
    const val = e.clue === SAME ? kv : opp(kv);
    const message = e.clue === SAME
      ? `The = sign means these two match — so this is a ${NAME[val]}.`
      : `The × sign means these two are opposite — so this is a ${NAME[val]}.`;
    if (push({ idx: target, val, rule: e.clue === SAME ? 'same' : 'diff', tier: 1, refs: [known], edge: { type: e.type, i: e.i }, message })) return out;
  }

  const lines = lineDefs(n);
  // 2) no three in a row: pairs and gaps
  for (const line of lines) {
    const cs = line.cells;
    for (let i = 0; i + 2 < n; i++) {
      const a = cs[i], b = cs[i + 1], c = cs[i + 2];
      const va = g[a], vb = g[b], vc = g[c];
      if (va && va === vb && !vc) {
        if (push({ idx: c, val: opp(va), rule: 'pair', tier: 1, refs: [a, b], line: lineRef(line), message: `Two ${NAMES[va]} side by side — the next one must be a ${NAME[opp(va)]} (no three in a row).` })) return out;
      }
      if (vb && vb === vc && !va) {
        if (push({ idx: a, val: opp(vb), rule: 'pair', tier: 1, refs: [b, c], line: lineRef(line), message: `Two ${NAMES[vb]} side by side — the next one must be a ${NAME[opp(vb)]} (no three in a row).` })) return out;
      }
      if (va && va === vc && !vb) {
        if (push({ idx: b, val: opp(va), rule: 'gap', tier: 1, refs: [a, c], line: lineRef(line), message: `A cell between two ${NAMES[va]} must be a ${NAME[opp(va)]} (no three in a row).` })) return out;
      }
    }
  }

  // 3) counting: line already has n/2 of a symbol
  for (const line of lines) {
    let s = 0, m = 0;
    for (const i of line.cells) { if (g[i] === SUN) s++; else if (g[i] === MOON) m++; }
    if (s + m === n) continue;
    let full = 0;
    if (s === half) full = SUN; else if (m === half) full = MOON;
    if (!full) continue;
    const refs = line.cells.filter((i) => g[i] === full);
    for (const i of line.cells) {
      if (g[i] !== EMPTY) continue;
      if (push({ idx: i, val: opp(full), rule: 'count', tier: 1, refs, line: lineRef(line), message: `${cap(lineName(line))} already has ${half} ${NAMES[full]} — the rest must be ${NAMES[opp(full)]}.` })) return out;
    }
  }
  return out;
}

function lineRef(line) { return { kind: line.kind, index: line.index }; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }

/** Valid patterns for one line given known cells and in-line edge clues. */
export function lineCandidates(p, g, line) {
  const { n } = p;
  let sunMask = 0, moonMask = 0, eqMask = 0, xMask = 0;
  for (let i = 0; i < n; i++) {
    const v = g[line.cells[i]];
    if (v === SUN) sunMask |= 1 << i; else if (v === MOON) moonMask |= 1 << i;
  }
  for (let i = 0; i < n - 1; i++) {
    const [t, k] = line.edges[i];
    const clue = t === 'h' ? p.h[k] : p.v[k];
    if (clue === SAME) eqMask |= 1 << i; else if (clue === DIFF) xMask |= 1 << i;
  }
  const out = [];
  for (const pat of linePatterns(n)) {
    if (pat & moonMask) continue;
    if ((pat & sunMask) !== sunMask) continue;
    const d = pat ^ (pat >> 1);
    if (d & eqMask) continue;
    if ((~d) & xMask) continue;
    out.push(pat);
  }
  return out;
}

/** Tier-2 deductions: cells forced in every valid completion of their line. Returns null on contradiction. */
export function lineDeductions(p, g, firstOnly = false) {
  const { n } = p, out = [], seen = new Set();
  const full = (1 << n) - 1;
  for (const line of lineDefs(n)) {
    let empties = 0;
    for (const i of line.cells) if (!g[i]) empties++;
    if (!empties) continue;
    const cands = lineCandidates(p, g, line);
    if (!cands.length) return null;
    let and = full, or = 0;
    for (const c of cands) { and &= c; or |= c; }
    for (let i = 0; i < n; i++) {
      const idx = line.cells[i];
      if (g[idx] || seen.has(idx)) continue;
      let val = 0;
      if ((and >> i) & 1) val = SUN; else if (!((or >> i) & 1)) val = MOON;
      if (!val) continue;
      seen.add(idx);
      out.push({
        idx, val, rule: 'line', tier: 2,
        refs: line.cells.filter((j) => g[j]),
        line: lineRef(line),
        message: `Try it: if this were a ${NAME[opp(val)]}, ${lineName(line)} couldn't be finished without breaking a rule — so it's a ${NAME[val]}.`,
      });
      if (firstOnly) return out;
    }
  }
  return out;
}

/**
 * Logic-only solver. Never guesses. maxTier 1 = basic rules only, 2 = + line analysis.
 * Returns { solved, grid, tier2Rounds, steps (if trace), contradiction }.
 */
export function solve(p, maxTier = 2, opts = {}) {
  const g = (opts.start || p.givens).slice();
  const trace = !!opts.trace;
  const steps = [];
  let tier2Rounds = 0;
  for (;;) {
    let ds = basicDeductions(p, g, trace);
    if (!ds.length && maxTier >= 2) {
      ds = lineDeductions(p, g, trace);
      if (ds === null) return { solved: false, contradiction: true, grid: g, tier2Rounds, steps };
      if (ds.length) tier2Rounds++;
    }
    if (!ds.length) break;
    for (const d of ds) {
      if (g[d.idx] === EMPTY) { g[d.idx] = d.val; if (trace) steps.push(d); }
      else if (g[d.idx] !== d.val) return { solved: false, contradiction: true, grid: g, tier2Rounds, steps };
    }
  }
  const solved = g.every((v) => v !== EMPTY) && findErrors(p, g).any === false;
  return { solved, contradiction: false, grid: g, tier2Rounds, steps };
}

/**
 * Independent exhaustive solution counter (for tests / verification): row-by-row
 * backtracking over all valid row patterns. Shares no code with the logic solver.
 */
export function countSolutions(p, limit = 2) {
  const { n } = p, half = n / 2;
  const rowsCands = [];
  for (let r = 0; r < n; r++) {
    const list = [];
    for (const pat of linePatterns(n)) {
      let ok = true;
      for (let c = 0; c < n && ok; c++) {
        const v = p.givens[r * n + c], bit = (pat >> c) & 1;
        if (v === SUN && !bit) ok = false;
        if (v === MOON && bit) ok = false;
        if (c < n - 1) {
          const clue = p.h[r * (n - 1) + c], nb = (pat >> (c + 1)) & 1;
          if (clue === SAME && nb !== bit) ok = false;
          if (clue === DIFF && nb === bit) ok = false;
        }
      }
      if (ok) list.push(pat);
    }
    rowsCands.push(list);
  }
  const rows = new Array(n), colSun = new Array(n).fill(0);
  const memo = new Map();
  // Number of completions from row r (capped at limit), memoized on the state
  // that matters for the future: last two rows + per-column sun counts.
  function rec(r) {
    if (r === n) return 1;
    const key = r + '|' + (r >= 1 ? rows[r - 1] : -1) + '|' + (r >= 2 ? rows[r - 2] : -1) + '|' + colSun.join(',');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const pat of rowsCands[r]) {
      let ok = true;
      for (let c = 0; c < n && ok; c++) {
        const bit = (pat >> c) & 1;
        const s = colSun[c] + bit;
        if (s > half || r + 1 - s > half) ok = false;
        else if (r >= 1) {
          const up = (rows[r - 1] >> c) & 1, clue = p.v[(r - 1) * n + c];
          if (clue === SAME && up !== bit) ok = false;
          if (clue === DIFF && up === bit) ok = false;
          if (r >= 2 && up === bit && ((rows[r - 2] >> c) & 1) === bit) ok = false;
        }
      }
      if (!ok) continue;
      rows[r] = pat;
      for (let c = 0; c < n; c++) colSun[c] += (pat >> c) & 1;
      total += rec(r + 1);
      for (let c = 0; c < n; c++) colSun[c] -= (pat >> c) & 1;
      if (total >= limit) { total = limit; break; }
    }
    memo.set(key, total);
    return total;
  }
  return rec(0);
}

// ---------------------------------------------------------------- generator
function edgesFromSolution(sol, n) {
  const h = new Array(n * (n - 1)), v = new Array(n * (n - 1));
  for (let r = 0; r < n; r++) for (let c = 0; c < n - 1; c++)
    h[r * (n - 1) + c] = sol[r * n + c] === sol[r * n + c + 1] ? SAME : DIFF;
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n; c++)
    v[r * n + c] = sol[r * n + c] === sol[(r + 1) * n + c] ? SAME : DIFF;
  return { h, v };
}

/**
 * Generate a puzzle with a unique solution that is solvable by logic alone
 * using techniques up to the difficulty's tier. Deterministic for (diffId, seed).
 */
export function generate(diffId, seed) {
  const d = DIFFICULTIES[diffId];
  if (!d) throw new Error('unknown difficulty ' + diffId);
  const { n } = d;
  const rng = makeRng(`${diffId}|${seed}`);
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const sol = randomSolution(n, rng);
    if (!sol) continue;
    const all = edgesFromSolution(sol, n);
    const p = {
      n, diff: diffId, seed: String(seed),
      givens: sol.slice(),
      h: all.h.map((x) => (rng() < d.edgeP ? x : NOCLUE)),
      v: all.v.map((x) => (rng() < d.edgeP ? x : NOCLUE)),
      solution: sol,
    };
    const pool = [];
    for (let i = 0; i < n * n; i++) pool.push(['g', i]);
    p.h.forEach((x, i) => { if (x) pool.push(['h', i]); });
    p.v.forEach((x, i) => { if (x) pool.push(['v', i]); });
    // Bias removal so givens tend to go first: edge clues then carry more of the
    // logic (the signature feel) while a few sun/moon givens remain as anchors.
    const keyed = pool.map((x) => [x, x[0] === 'g' ? rng() : d.edgeBias + rng()]);
    keyed.sort((a, b) => a[1] - b[1]);
    for (const [[kind, i]] of keyed) {
      const arr = kind === 'g' ? p.givens : p[kind];
      const keep = arr[i];
      arr[i] = 0;
      if (!solve(p, d.tier).solved) arr[i] = keep;
    }
    if (d.extra) { // gentler: hand back a few anchors (keeps uniqueness)
      const empties = shuffle(p.givens.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0), rng);
      for (const i of empties.slice(0, d.extra)) p.givens[i] = sol[i];
    }
    const res = solve(p, d.tier);
    if (!res.solved) continue; // should not happen
    p.hardness = res.tier2Rounds;
    p.clueCount = p.givens.filter(Boolean).length + p.h.filter(Boolean).length + p.v.filter(Boolean).length;
    if (d.tier === 1 || res.tier2Rounds >= d.minHard) return finalize(p, attempt);
    if (!best || res.tier2Rounds > best.hardness) best = p;
  }
  return finalize(best, -1);
}

function finalize(p, attempt) {
  p.attempts = attempt;
  p.id = `${p.diff}:${p.seed}`;
  return p;
}

// ---------------------------------------------------------------- validation
/** Rule violations in a (possibly partial) grid. */
export function findErrors(p, g) {
  const { n } = p, half = n / 2;
  const cells = new Set(), edges = [], lines = [], triples = [];
  for (const line of lineDefs(n)) {
    const cs = line.cells;
    for (let i = 0; i + 2 < n; i++) {
      const v = g[cs[i]];
      if (v && v === g[cs[i + 1]] && v === g[cs[i + 2]]) {
        cells.add(cs[i]); cells.add(cs[i + 1]); cells.add(cs[i + 2]);
        triples.push({ kind: line.kind, index: line.index, val: v, cells: [cs[i], cs[i + 1], cs[i + 2]] });
      }
    }
    let s = 0, m = 0;
    for (const i of cs) { if (g[i] === SUN) s++; else if (g[i] === MOON) m++; }
    if (s > half || m > half) {
      const over = s > half ? SUN : MOON;
      lines.push({ kind: line.kind, index: line.index, over, half });
      for (const i of cs) if (g[i] === over) cells.add(i);
    }
  }
  for (const e of edgeList(p)) {
    const va = g[e.a], vb = g[e.b];
    if (!va || !vb) continue;
    if ((e.clue === SAME && va !== vb) || (e.clue === DIFF && va === vb)) {
      edges.push({ type: e.type, i: e.i, clue: e.clue });
      cells.add(e.a); cells.add(e.b);
    }
  }
  return { cells, edges, lines, triples, any: cells.size > 0 || edges.length > 0 };
}

/** One short, friendly sentence describing the first rule break (or ''). */
export function describeErrors(errs) {
  if (errs.triples.length) {
    const t = errs.triples[0];
    return `${t.kind === 'row' ? 'Row' : 'Column'} ${t.index + 1} has three ${NAMES[t.val]} in a row.`;
  }
  if (errs.edges.length) {
    return errs.edges[0].clue === SAME ? 'Cells joined by = must match.' : 'Cells joined by × must be opposite.';
  }
  if (errs.lines.length) {
    const l = errs.lines[0];
    return `${l.kind === 'row' ? 'Row' : 'Column'} ${l.index + 1} has more than ${l.half} ${NAMES[l.over]}.`;
  }
  return '';
}

export function isComplete(g) { return g.every((v) => v !== EMPTY); }

export function isSolved(p, g) {
  for (let i = 0; i < g.length; i++) if (g[i] !== p.solution[i]) return false;
  return true;
}

export function progress(p, g) {
  let filled = 0, total = 0;
  for (let i = 0; i < g.length; i++) if (!p.givens[i]) { total++; if (g[i]) filled++; }
  return total ? filled / total : 1;
}

/**
 * Next hint for the player's grid. Mistakes are reported first (and should
 * be cleared), otherwise the easiest available logical step.
 */
export function findHint(p, g) {
  for (let i = 0; i < g.length; i++) {
    if (g[i] && !p.givens[i] && g[i] !== p.solution[i]) {
      return { kind: 'mistake', idx: i, val: EMPTY, refs: [], message: `This ${NAME[g[i]]} can't be right — it's been cleared. Try again from here.` };
    }
  }
  if (isSolved(p, g)) return null;
  const basic = basicDeductions(p, g);
  if (basic.length) {
    const order = { same: 0, diff: 0, pair: 1, gap: 1, count: 2 };
    basic.sort((a, b) => order[a.rule] - order[b.rule] || a.idx - b.idx);
    return { kind: 'step', ...basic[0] };
  }
  const adv = lineDeductions(p, g, true);
  if (adv && adv.length) return { kind: 'step', ...adv[0] };
  // Fallback (should be unreachable for generated puzzles): reveal a cell.
  const i = g.findIndex((v) => v === EMPTY);
  return { kind: 'step', idx: i, val: p.solution[i], rule: 'reveal', tier: 3, refs: [], message: `This one's a ${NAME[p.solution[i]]}.` };
}

// ---------------------------------------------------------------- input helpers
export function cycle(v) { return (v + 1) % 3; } // empty → sun → moon → empty

// ---------------------------------------------------------------- daily
export const EPOCH = '2026-11-21'; // Daily #1
export const DAILY_ROTATION = ['big10', 'easy6', 'hard6', 'med8', 'hard6', 'med8', 'med8']; // Sun..Sat (big Sunday)

export function dayNumber(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [ey, em, ed] = EPOCH.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ey, em - 1, ed)) / 86400000) + 1;
}

export function dateKeyFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function dailyDiff(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DAILY_ROTATION[dow];
}

export function dailyPuzzle(dateKey) {
  const p = generate(dailyDiff(dateKey), `daily-${dateKey}`);
  p.daily = { dateKey, number: dayNumber(dateKey) };
  return p;
}

/** Streak update: returns new {current, best, lastDay} after solving day `day`. */
export function updateStreak(st, day) {
  const s = { current: st.current || 0, best: st.best || 0, lastDay: st.lastDay ?? null };
  if (s.lastDay === day) return s;
  s.current = s.lastDay === day - 1 ? s.current + 1 : 1;
  s.lastDay = day;
  if (s.current > s.best) s.best = s.current;
  return s;
}

/** Streak as displayed today: broken if the last solve was before yesterday. */
export function liveStreak(st, today) {
  if (st.lastDay == null) return 0;
  return st.lastDay >= today - 1 ? st.current || 0 : 0;
}

export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

export function shareText({ number, ms, hints, diff, streak, url }) {
  const d = DIFFICULTIES[diff];
  const tail = hints ? `💡 ${hints} hint${hints === 1 ? '' : 's'}` : '⭐ no hints';
  const lines = [`Twotone #${number} ☀️🌙 ${formatTime(ms)} ${tail}`];
  const meta = [d ? d.label : null, streak > 1 ? `🔥 ${streak}-day streak` : null].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (url) lines.push(url);
  return lines.join('\n');
}

// ---------------------------------------------------------------- bots
// Computer opponents for "Race the bots". They are bots and always labelled as such.
export const BOTS = [
  { id: 'pip', name: 'Pip', blurb: 'steady', color: '#7FB685', perCell: 5200, hardMult: 2.2, jitter: 0.55 },
  { id: 'nova', name: 'Nova', blurb: 'quick', color: '#E98A6B', perCell: 3500, hardMult: 2.6, jitter: 0.5 },
  { id: 'atlas', name: 'Atlas', blurb: 'sharp', color: '#B48AD8', perCell: 2500, hardMult: 1.8, jitter: 0.45 },
];

/**
 * Deterministic bot run: cumulative timestamps (ms after start) at which the
 * bot fills each empty cell, following the logic solver's step order.
 */
export function botSchedule(p, bot, seed) {
  const rng = makeRng(`bot|${bot.id}|${seed}|${p.id || ''}`);
  const { steps } = solve(p, 2, { trace: true });
  const scale = Math.sqrt(p.n / 6);
  const times = [];
  let t = 1200 + rng() * 1200;
  let prevTier = 1;
  for (const s of steps) {
    let dt = bot.perCell * scale * (1 + bot.jitter * (rng() * 2 - 1));
    if (s.tier >= 2 && prevTier < 2) dt *= bot.hardMult; // a "stuck, think hard" moment
    prevTier = s.tier;
    t += dt;
    times.push(Math.round(t));
  }
  return times;
}

export function botProgressAt(times, ms) {
  if (!times.length) return 1;
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= ms) lo = mid + 1; else hi = mid; }
  return lo / times.length;
}

/** Placement (1-based) of a player finishing at ms against bot schedules. */
export function racePlacement(ms, schedules) {
  let ahead = 0;
  for (const t of schedules) if (t.length && t[t.length - 1] < ms) ahead++;
  return ahead + 1;
}

// ---------------------------------------------------------------- serialization (for multiplayer / persistence)
export function encodeGrid(g) { return g.join(''); }
export function decodeGrid(s) { return s.split('').map(Number); }
