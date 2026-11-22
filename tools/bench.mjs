import { generate, countSolutions, solve, DIFF_ORDER, edgeList } from '../docs/js/logic.js';
for (const d of DIFF_ORDER) {
  let tmax = 0, tsum = 0, N = 30, givens = 0, edges = 0, hard = 0, uniq = 0, fallback = 0;
  for (let s = 0; s < N; s++) {
    const t0 = performance.now();
    const p = generate(d, 's' + s);
    const dt = performance.now() - t0;
    tmax = Math.max(tmax, dt); tsum += dt;
    givens += p.givens.filter(Boolean).length; edges += edgeList(p).length; hard += p.hardness;
    if (countSolutions(p, 2) === 1) uniq++;
    if (p.attempts < 0) fallback++;
  }
  console.log(d, 'avg ms', (tsum / N).toFixed(1), 'max', tmax.toFixed(1), 'givens', (givens / N).toFixed(1), 'edges', (edges / N).toFixed(1), 'hard', (hard / N).toFixed(1), 'unique', uniq + '/' + N, 'fallback', fallback);
}
