import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../docs/js/logic.js';

const { SUN, MOON, EMPTY, SAME, DIFF } = L;

test('rng is deterministic per seed', () => {
  const a = L.makeRng('hello'), b = L.makeRng('hello'), c = L.makeRng('world');
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  for (const x of xs) assert.ok(x >= 0 && x < 1);
});

test('line patterns are balanced and have no triples', () => {
  const counts = { 6: 14, 8: 34, 10: 84 };
  for (const n of [6, 8, 10]) {
    const pats = L.linePatterns(n);
    assert.equal(pats.length, counts[n], `n=${n}`);
    for (const p of pats) {
      let ones = 0;
      for (let i = 0; i < n; i++) ones += (p >> i) & 1;
      assert.equal(ones, n / 2);
      for (let i = 0; i + 2 < n; i++) {
        const b = [(p >> i) & 1, (p >> (i + 1)) & 1, (p >> (i + 2)) & 1];
        assert.ok(!(b[0] === b[1] && b[1] === b[2]));
      }
    }
  }
});

test('random solutions are valid grids', () => {
  for (const n of [6, 8, 10]) {
    for (let s = 0; s < 10; s++) {
      const g = L.randomSolution(n, L.makeRng(`sol${n}-${s}`));
      const p = { n, givens: g, h: new Array(n * (n - 1)).fill(0), v: new Array(n * (n - 1)).fill(0), solution: g };
      assert.equal(L.findErrors(p, g).any, false);
      assert.ok(L.isComplete(g));
    }
  }
});

test('generator is deterministic', () => {
  for (const d of L.DIFF_ORDER) {
    const a = L.generate(d, 'same-seed'), b = L.generate(d, 'same-seed');
    assert.deepEqual(a.givens, b.givens);
    assert.deepEqual(a.h, b.h);
    assert.deepEqual(a.v, b.v);
    assert.deepEqual(a.solution, b.solution);
  }
  assert.notDeepEqual(L.generate('med8', 'a').solution, L.generate('med8', 'b').solution);
});

const SEEDS = Number(process.env.TT_SEEDS || 60);
for (const d of L.DIFF_ORDER) {
  test(`${d}: ${SEEDS} seeds — unique solution, solvable by logic, graded`, () => {
    const diff = L.DIFFICULTIES[d];
    for (let s = 0; s < SEEDS; s++) {
      const p = L.generate(d, `u${s}`);
      assert.equal(p.n, diff.n);
      // independent brute-force check of uniqueness
      assert.equal(L.countSolutions(p, 2), 1, `${d} seed ${s} not unique`);
      // logic-only solver (no guessing) reaches the solution
      const res = L.solve(p, diff.tier);
      assert.ok(res.solved, `${d} seed ${s} not logic-solvable`);
      assert.deepEqual(res.grid, p.solution);
      // clues agree with the solution
      for (let i = 0; i < p.givens.length; i++) if (p.givens[i]) assert.equal(p.givens[i], p.solution[i]);
      for (const e of L.edgeList(p)) {
        const same = p.solution[e.a] === p.solution[e.b];
        assert.equal(e.clue, same ? SAME : DIFF);
      }
      // grading
      if (diff.tier === 1) assert.equal(res.tier2Rounds, 0);
      if (d === 'hard6') assert.equal(L.solve(p, 1).solved, false, `hard6 seed ${s} solvable by basics only`);
    }
  });
}

test('generation is fast (well under 300 ms per puzzle in Node)', () => {
  for (const d of L.DIFF_ORDER) {
    let worst = 0;
    for (let s = 0; s < 15; s++) {
      const t0 = performance.now();
      L.generate(d, `speed${s}`);
      worst = Math.max(worst, performance.now() - t0);
    }
    assert.ok(worst < 150, `${d} worst ${worst.toFixed(1)}ms`);
  }
});

function tiny() {
  // 6x6 hand-made puzzle around a known solution
  const sol = L.randomSolution(6, L.makeRng('tiny'));
  return { n: 6, givens: new Array(36).fill(0), h: new Array(30).fill(0), v: new Array(30).fill(0), solution: sol };
}

test('basic deductions: pair, gap, count, edges', () => {
  const p = tiny();
  const g = new Array(36).fill(0);
  // pair: row 0 cells 0,1 suns -> cell 2 moon
  g[0] = SUN; g[1] = SUN;
  let ds = L.basicDeductions(p, g);
  assert.ok(ds.some((d) => d.idx === 2 && d.val === MOON && d.rule === 'pair'));
  // gap: row 1 cells 6 and 8 moons -> 7 sun
  g[6] = MOON; g[8] = MOON;
  ds = L.basicDeductions(p, g);
  assert.ok(ds.some((d) => d.idx === 7 && d.val === SUN && d.rule === 'gap'));
  // count: row 5 has three moons at 30, 32, 34 -> others suns
  const g2 = new Array(36).fill(0);
  g2[30] = MOON; g2[32] = MOON; g2[34] = MOON;
  ds = L.basicDeductions(p, g2);
  for (const i of [31, 33, 35]) assert.ok(ds.some((d) => d.idx === i && d.val === SUN));
  assert.match(ds.find((d) => d.rule === 'count').message, /Row 6 already has 3 moons/);
  // edges
  const p2 = tiny();
  p2.h[0] = SAME; // (0,0)=(0,1)
  p2.v[0] = DIFF; // (0,0)x(1,0)
  const g3 = new Array(36).fill(0); g3[0] = MOON;
  ds = L.basicDeductions(p2, g3);
  assert.ok(ds.some((d) => d.idx === 1 && d.val === MOON && d.rule === 'same'));
  assert.ok(ds.some((d) => d.idx === 6 && d.val === SUN && d.rule === 'diff'));
});

test('line analysis catches = pair next to a known cell', () => {
  const p = tiny();
  // row 0: sun at 0, "=" between cells 1 and 2 -> 1,2 cannot both be sun -> both moon
  p.h[1] = SAME;
  const g = new Array(36).fill(0); g[0] = SUN;
  assert.equal(L.basicDeductions(p, g).length, 0);
  const ds = L.lineDeductions(p, g);
  assert.ok(ds.some((d) => d.idx === 1 && d.val === MOON));
  assert.ok(ds.some((d) => d.idx === 2 && d.val === MOON));
});

test('findErrors flags triples, overcounts and broken clues', () => {
  const p = tiny();
  p.h[3] = DIFF; // (0,3)x(0,4)
  const g = new Array(36).fill(0);
  g[0] = SUN; g[1] = SUN; g[2] = SUN; // triple
  let e = L.findErrors(p, g);
  assert.ok(e.any && e.cells.has(0) && e.cells.has(2));
  g[3] = MOON; g[4] = MOON; // breaks the × clue
  e = L.findErrors(p, g);
  assert.equal(e.edges.length, 1);
  const g2 = new Array(36).fill(0);
  g2[0] = MOON; g2[2] = MOON; g2[4] = MOON; g2[5] = MOON; // 4 moons in a row of 6
  e = L.findErrors(p, g2);
  assert.equal(e.lines.length, 1);
  assert.equal(e.lines[0].over, MOON);
  assert.equal(L.findErrors(p, new Array(36).fill(0)).any, false);
});

test('hints: mistakes first, then explained logical steps, until solved', () => {
  const p = L.generate('hard6', 'hint-walk');
  const g = p.givens.slice();
  // introduce a mistake
  const bad = g.findIndex((v) => v === EMPTY);
  g[bad] = L.opp(p.solution[bad]);
  let h = L.findHint(p, g);
  assert.equal(h.kind, 'mistake');
  assert.equal(h.idx, bad);
  g[bad] = EMPTY;
  let guard = 0;
  while (!L.isSolved(p, g)) {
    h = L.findHint(p, g);
    assert.equal(h.kind, 'step');
    assert.notEqual(h.rule, 'reveal', 'hint should always be a logical step');
    assert.equal(h.val, p.solution[h.idx]);
    assert.equal(typeof h.message, 'string');
    g[h.idx] = h.val;
    assert.ok(++guard < 100);
  }
  assert.equal(L.findHint(p, g), null);
});

test('cycle goes empty -> sun -> moon -> empty', () => {
  assert.equal(L.cycle(EMPTY), SUN);
  assert.equal(L.cycle(SUN), MOON);
  assert.equal(L.cycle(MOON), EMPTY);
});

test('daily: numbering, rotation, determinism', () => {
  assert.equal(L.dayNumber('2026-11-21'), 1);
  assert.equal(L.dayNumber('2026-11-22'), 2);
  assert.equal(L.dayNumber('2027-03-15'), 115); // across DST change
  assert.equal(L.dailyDiff('2026-11-21'), 'med8'); // Saturday
  assert.equal(L.dailyDiff('2026-11-22'), 'big10'); // Sunday
  assert.equal(L.dailyDiff('2026-11-23'), 'easy6'); // Monday
  const a = L.dailyPuzzle('2026-12-01'), b = L.dailyPuzzle('2026-12-01');
  assert.deepEqual(a.givens, b.givens);
  assert.equal(a.daily.number, 11);
  assert.equal(L.dateKeyFromParts(2026, 1, 5), '2026-01-05');
});

test('streaks', () => {
  let s = { current: 0, best: 0, lastDay: null };
  s = L.updateStreak(s, 5); assert.equal(s.current, 1);
  s = L.updateStreak(s, 6); assert.equal(s.current, 2);
  s = L.updateStreak(s, 6); assert.equal(s.current, 2);
  assert.equal(L.liveStreak(s, 7), 2);
  assert.equal(L.liveStreak(s, 8), 0);
  s = L.updateStreak(s, 9); assert.equal(s.current, 1); assert.equal(s.best, 2);
});

test('formatTime and shareText', () => {
  assert.equal(L.formatTime(102000), '1:42');
  assert.equal(L.formatTime(5000), '0:05');
  assert.equal(L.formatTime(3723000), '1:02:03');
  assert.equal(L.shareText({ number: 12, ms: 102000, hints: 0, diff: 'med8', streak: 1 }).split('\n')[0], 'Twotone #12 ☀️🌙 1:42 ⭐ no hints');
  const t = L.shareText({ number: 3, ms: 61000, hints: 2, diff: 'easy6', streak: 4, url: 'https://example.com/twotone/' });
  assert.match(t, /💡 2 hints/);
  assert.match(t, /🔥 4-day streak/);
  assert.match(t, /example\.com/);
});

test('bots: deterministic schedules, ordered speeds, placement', () => {
  const p = L.generate('hard6', 'race');
  const empties = p.givens.filter((v) => !v).length;
  const sch = L.BOTS.map((b) => L.botSchedule(p, b, 'r1'));
  for (const s of sch) {
    assert.equal(s.length, empties);
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1]);
  }
  assert.deepEqual(sch[0], L.botSchedule(p, L.BOTS[0], 'r1'));
  // on average the sharp bot beats the steady bot
  let sharpWins = 0;
  for (let k = 0; k < 20; k++) {
    const q = L.generate('med8', 'rk' + k);
    const a = L.botSchedule(q, L.BOTS[0], 'x'), c = L.botSchedule(q, L.BOTS[2], 'x');
    if (c[c.length - 1] < a[a.length - 1]) sharpWins++;
  }
  assert.ok(sharpWins >= 16);
  assert.equal(L.botProgressAt(sch[0], 0), 0);
  assert.equal(L.botProgressAt(sch[0], 1e9), 1);
  assert.equal(L.racePlacement(0, sch), 1);
  assert.equal(L.racePlacement(1e9, sch), 4);
});

test('grid encode/decode roundtrip', () => {
  const g = [0, 1, 2, 2, 1, 0];
  assert.deepEqual(L.decodeGrid(L.encodeGrid(g)), g);
});

test('countSolutions detects ambiguity', () => {
  const p = L.generate('hard6', 'amb');
  const q = { ...p, givens: new Array(36).fill(0), h: new Array(30).fill(0), v: new Array(30).fill(0) };
  assert.equal(L.countSolutions(q, 2), 2);
  // removing every clue except one given is never unique
  q.givens[0] = p.solution[0];
  assert.equal(L.countSolutions(q, 5), 5);
});
