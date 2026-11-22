// End-to-end test: plays every mode start to finish at desktop and phone sizes
// in headless Chrome, asserts zero console errors, saves screenshots.
//   node tests/e2e.mjs            (serves docs/ on a free port 8831-8839)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import * as L from '../docs/js/logic.js';

const PW = 'playwright';
const { chromium } = await import(PW);
const SHOTS = process.env.SHOTS || '/workspace/arcade-shots/twotone';
mkdirSync(SHOTS, { recursive: true });

async function freePort() {
  for (let p = 8831; p <= 8839; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port in 8831-8839');
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '-d', 'docs', '--bind', '127.0.0.1'], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/`;
await new Promise((r) => setTimeout(r, 700));

let pass = 0, fail = 0;
const failures = [];
const results = {};
function check(cond, msg) {
  if (cond) pass++; else { fail++; failures.push(msg); console.log('  ✖', msg); }
}

const VIEWPORTS = [
  { name: 'desktop', opts: { viewport: { width: 1280, height: 800 } } },
  { name: 'phone', opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];

/** Read the puzzle shown on screen and solve it with the pure logic module. */
async function readAndSolve(page) {
  const data = await page.evaluate(() => {
    const b = document.querySelector('#board');
    const n = +b.dataset.n;
    const cells = [...b.querySelectorAll('.cell')].map((c) => ({ given: c.dataset.given === '1', v: +c.dataset.v }));
    const clues = [...b.querySelectorAll('.clue')].map((c) => ({ type: c.dataset.type, i: +c.dataset.i, clue: +c.dataset.clue }));
    return { n, cells, clues };
  });
  const { n } = data;
  const p = { n, givens: data.cells.map((c) => (c.given ? c.v : 0)), h: new Array(n * (n - 1)).fill(0), v: new Array(n * (n - 1)).fill(0) };
  for (const c of data.clues) p[c.type][c.i] = c.clue;
  const res = L.solve(p, 2);
  check(res.solved, `puzzle on screen (n=${n}) is solvable by logic alone`);
  check(L.countSolutions(p, 2) === 1, `puzzle on screen (n=${n}) has a unique solution`);
  return { n, solution: res.grid, current: data.cells.map((c) => c.v), givens: p.givens };
}

async function tapCell(page, vp, i) {
  const sel = `#board .cell[data-i="${i}"]`;
  if (vp.opts.hasTouch) await page.tap(sel); else await page.click(sel);
}
async function cellVal(page, i) { return +(await page.getAttribute(`#board .cell[data-i="${i}"]`, 'data-v')); }

/** Fill cells to match the solution by tapping (1 tap = sun, 2 = moon). */
async function fillTo(page, vp, sol, current, givens, { upto = 1, skip = new Set() } = {}) {
  const todo = [];
  for (let i = 0; i < sol.length; i++) if (!givens[i] && current[i] !== sol[i] && !skip.has(i)) todo.push(i);
  const count = Math.floor(todo.length * upto);
  for (const i of todo.slice(0, count)) {
    let v = await cellVal(page, i), guard = 0;
    while (v !== sol[i] && guard++ < 3) { await tapCell(page, vp, i); v = await cellVal(page, i); }
    current[i] = v;
  }
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, sh: document.documentElement.scrollHeight, h: innerHeight }));
  check(o.sw <= o.w + 1 && o.sh <= o.h + 1, `${label}: no page overflow (${o.sw}x${o.sh} in ${o.w}x${o.h})`);
}

async function boardFits(page, label) {
  const r = await page.evaluate(() => {
    const b = document.querySelector('#board').getBoundingClientRect();
    const t = document.querySelector('.toolbar').getBoundingClientRect();
    const cell = document.querySelector('#board .cell').getBoundingClientRect();
    return { b: { l: b.left, r: b.right, t: b.top, btm: b.bottom }, tb: t.top, tbb: t.bottom, w: innerWidth, h: innerHeight, cell: cell.width };
  });
  check(r.b.l >= 0 && r.b.r <= r.w && r.b.t >= 0, `${label}: board inside viewport`);
  check(r.tbb <= r.h + 1, `${label}: toolbar inside viewport`);
  check(r.cell >= 28, `${label}: cells are tappable (${r.cell.toFixed(0)}px)`);
}

async function waitResult(page, mode) {
  await page.waitForSelector(`#result[data-mode="${mode}"]`, { timeout: 8000 });
  await page.waitForTimeout(700); // let the card + particles settle
}

async function runViewport(browser, vp) {
  console.log(`\n▶ ${vp.name}`);
  const ctx = await browser.newContext({ ...vp.opts });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${vp.name}-${name}.png` });

  // --- first load: onboarding
  await page.goto(BASE);
  await page.waitForSelector('#howto-next', { timeout: 5000 });
  await page.waitForTimeout(450);
  await shot('01-howto-step1');
  await page.click('#howto-next'); await page.waitForTimeout(350);
  await shot('02-howto-step2');
  await page.click('#howto-next'); await page.waitForTimeout(350);
  await shot('03-howto-step3');
  check(await page.isVisible('#howto-warmup'), `${vp.name}: first visit offers an easy warm-up`);
  await page.click('#howto-skip');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForTimeout(300);
  await shot('04-title');
  await noOverflow(page, `${vp.name} title`);
  const extLinks = await page.evaluate(() => [...document.querySelectorAll('link[href], script[src], img[src]')].map((e) => e.href || e.src).filter((u) => !u.startsWith(location.origin)));
  check(extLinks.length === 0, `${vp.name}: no external resources (${extLinks.join(', ')})`);
  check(await page.getAttribute('a[href="../arcade/"]', 'href') === '../arcade/', `${vp.name}: More games link`);

  if (vp.name === 'phone') {
    // generation speed with a 4x CPU slowdown (approximates a mid-range phone)
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const times = await page.evaluate(async () => {
      const L = await import('./js/logic.js');
      const out = {};
      for (const d of L.DIFF_ORDER) {
        let worst = 0;
        for (let k = 0; k < 6; k++) { const t = performance.now(); L.generate(d, 'perf' + k); worst = Math.max(worst, performance.now() - t); }
        out[d] = Math.round(worst);
      }
      return out;
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    results.genMs = times;
    check(Object.values(times).every((t) => t < 300), `phone (4x CPU throttle): worst generation time < 300 ms ${JSON.stringify(times)}`);
  }

  // --- DAILY
  await page.click('#btn-daily');
  await page.waitForSelector('#screen-game:not([hidden]) #board .cell');
  await page.waitForTimeout(300);
  await boardFits(page, `${vp.name} daily`);
  let s = await readAndSolve(page);
  // a wrong tap then undo
  const firstEmpty = s.givens.findIndex((v) => !v);
  await tapCell(page, vp, firstEmpty);
  await tapCell(page, vp, firstEmpty);
  check((await cellVal(page, firstEmpty)) === 2, `${vp.name}: tap cycles empty → sun → moon`);
  await page.click('#tool-undo');
  check((await cellVal(page, firstEmpty)) === 1, `${vp.name}: undo restores previous value`);
  await page.click('#tool-undo');
  check((await cellVal(page, firstEmpty)) === 0, `${vp.name}: undo back to empty`);
  s.current[firstEmpty] = 0;
  await fillTo(page, vp, s.solution, s.current, s.givens, { upto: 0.5 });
  await page.waitForTimeout(300);
  await shot('05-daily-midgame');
  await noOverflow(page, `${vp.name} daily mid-game`);
  // reload mid-game: progress should persist
  await page.reload();
  await page.waitForSelector('#btn-daily');
  const sub = await page.textContent('#daily-sub');
  check(/Continue/.test(sub), `${vp.name}: home shows "Continue" for in-progress daily (${sub.trim()})`);
  await page.click('#btn-daily');
  await page.waitForSelector('#screen-game:not([hidden]) #board .cell');
  const resumed = await page.$$eval('#board .cell[data-given="0"]', (cs) => cs.filter((c) => c.dataset.v !== '0').length);
  check(resumed > 0, `${vp.name}: daily progress restored after reload (${resumed} cells)`);
  s = await readAndSolve(page);
  await fillTo(page, vp, s.solution, s.current, s.givens);
  await waitResult(page, 'daily');
  await shot('06-daily-end');
  await noOverflow(page, `${vp.name} daily end`);
  await page.click('[data-action="share"]');
  await page.waitForTimeout(250);
  const shareText = await page.evaluate(() => window.__lastShare || '');
  check(/^Twotone #\d+ ☀️🌙 \d+:\d\d ⭐ no hints/.test(shareText), `${vp.name}: share text format (${shareText.split('\n')[0]})`);
  results[`${vp.name}-share`] = shareText;
  const toastText = await page.textContent('#toast');
  check(/copied/i.test(toastText), `${vp.name}: copy toast shown`);
  await page.click('#modal [data-action="home"]');
  await page.waitForSelector('#screen-home:not([hidden])');
  const doneSub = await page.textContent('#daily-sub');
  check(/Solved/.test(doneSub), `${vp.name}: home shows daily solved`);
  const streak = await page.textContent('#daily-side');
  check(/1/.test(streak), `${vp.name}: streak shows 1`);
  // re-opening the solved daily shows the result again
  await page.click('#btn-daily');
  await waitResult(page, 'daily');
  await page.click('#modal [data-action="home"]');

  // --- PRACTICE (all four sizes on desktop, two on phone)
  const diffs = vp.name === 'desktop' ? L.DIFF_ORDER : ['easy6', 'big10'];
  await page.click('#btn-practice');
  await page.waitForSelector('#screen-practice:not([hidden]) [data-practice]');
  await page.waitForTimeout(250);
  await shot('07-practice-picker');
  await noOverflow(page, `${vp.name} practice picker`);
  let usedDrag = false;
  for (const [k, d] of diffs.entries()) {
    if (k > 0) { await page.click('#modal [data-action="goto-practice"]'); await page.waitForSelector('#screen-practice:not([hidden]) [data-practice]'); }
    await page.click(`[data-practice="${d}"]`);
    await page.waitForSelector('#screen-game:not([hidden]) #board .cell');
    await page.waitForTimeout(200);
    await boardFits(page, `${vp.name} practice ${d}`);
    s = await readAndSolve(page);
    // drag-to-fill: find two horizontally adjacent empties whose solution is the same
    if (!usedDrag) {
      const n = s.n;
      for (let i = 0; i < n * n - 1 && !usedDrag; i++) {
        if (i % n === n - 1) continue;
        if (!s.givens[i] && !s.givens[i + 1] && s.solution[i] === 1 && s.solution[i + 1] === 1) {
          const a = await page.$(`#board .cell[data-i="${i}"]`), b = await page.$(`#board .cell[data-i="${i + 1}"]`);
          const ba = await a.boundingBox(), bb = await b.boundingBox();
          await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2);
          await page.mouse.down();
          await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
          await page.mouse.up();
          check((await cellVal(page, i)) === 1 && (await cellVal(page, i + 1)) === 1, `${vp.name}: drag paints two cells`);
          s.current[i] = 1; s.current[i + 1] = 1;
          usedDrag = true;
        }
      }
    }
    // use a hint and verify it explains and fills a correct cell
    const before = await page.$$eval('#board .cell[data-given="0"]', (cs) => cs.map((c) => +c.dataset.v));
    await page.click('#tool-hint');
    await page.waitForTimeout(150);
    const status = await page.textContent('#status');
    check(status.length > 20, `${vp.name}: hint explains itself ("${status.trim().slice(0, 60)}…")`);
    const mid = await page.$$eval('#board .cell[data-given="0"]', (cs) => cs.map((c) => +c.dataset.v));
    const target = await page.$$eval('#board .cell.target', (cs) => cs.length);
    check(target === 1 && mid.every((v, k) => v === before[k] || before[k] !== s.solution[k]), `${vp.name}: first hint press points at a cell without filling it`);
    await page.click('#tool-hint'); // second press fills it in
    await page.waitForTimeout(150);
    const after = await page.$$eval('#board .cell', (cs) => cs.map((c) => +c.dataset.v));
    const ids = await page.$$eval('#board .cell[data-given="0"]', (cs) => cs.map((c) => +c.dataset.i));
    let changed = -1;
    ids.forEach((id, k) => { if (before[k] !== after[id]) changed = id; });
    check(changed >= 0 && after[changed] === s.solution[changed], `${vp.name}: hint fills a correct cell`);
    if (changed >= 0) s.current[changed] = after[changed];
    if (d === 'easy6' || (d === 'big10' && vp.name === 'phone')) {
      // rule-break highlighting: paint three suns in a row, expect a highlight + explanation
      const n = s.n;
      let run = -1;
      for (let r = 0; r < n && run < 0; r++) for (let c = 0; c + 2 < n; c++) {
        const ids = [r * n + c, r * n + c + 1, r * n + c + 2];
        if (ids.every((i) => !s.givens[i] && !s.current[i])) { run = ids[0]; break; }
      }
      if (run >= 0) {
        for (const i of [run, run + 1, run + 2]) await tapCell(page, vp, i);
        await page.waitForTimeout(900);
        const errCells = await page.$$eval('#board .cell.err', (e) => e.length);
        const st = await page.$eval('#status', (e) => ({ cls: e.className, text: e.textContent }));
        check(errCells >= 3 && /warn/.test(st.cls) && /three suns in a row/i.test(st.text), `${vp.name}: three in a row is highlighted and explained ("${st.text.trim()}")`);
        await shot(`08b-rule-break-${d}`);
        for (let k = 0; k < 3; k++) await page.click('#tool-undo');
        await page.waitForTimeout(100);
        const left = await page.$$eval('#board .cell.err', (e) => e.length);
        check(left === 0, `${vp.name}: undo clears the highlight`);
      }
    }
    if (d === 'big10') { await fillTo(page, vp, s.solution, s.current, s.givens, { upto: 0.4 }); await shot(`08-practice-${d}-midgame`); }
    if (d === 'easy6' && vp.name === 'desktop') {
      // keyboard: move cursor and place via keys on the first empty cell
      const cur = s.current;
      const idx = s.givens.findIndex((v, i) => !v && !cur[i]);
      if (idx >= 0) {
        await page.keyboard.press('ArrowRight'); // shows the cursor
        await page.keyboard.press('ArrowLeft');
        const at = await page.$eval('#board .cell.cursor', (c) => +c.dataset.i);
        const r = Math.floor(idx / s.n), c = idx % s.n, r0 = Math.floor(at / s.n), c0 = at % s.n;
        for (let k = r0; k < r; k++) await page.keyboard.press('ArrowDown');
        for (let k = r; k < r0; k++) await page.keyboard.press('ArrowUp');
        for (let k = c0; k < c; k++) await page.keyboard.press('ArrowRight');
        for (let k = c; k < c0; k++) await page.keyboard.press('ArrowLeft');
        await page.keyboard.press(s.solution[idx] === 1 ? 's' : 'm');
        check((await cellVal(page, idx)) === s.solution[idx], 'desktop: keyboard places a symbol');
        cur[idx] = s.solution[idx];
      }
    }
    await fillTo(page, vp, s.solution, s.current, s.givens);
    await waitResult(page, 'practice');
    if (k === 0) await shot(`09-practice-${d}-end`);
  }
  await page.click('#modal [data-action="home"]');
  await page.waitForSelector('#screen-home:not([hidden])');

  // --- RACE THE BOTS
  await page.click('#btn-race');
  await page.waitForSelector('#screen-race:not([hidden]) [data-race-size]');
  await page.click('[data-race-size="hard6"]');
  await page.waitForTimeout(200);
  await shot('10-race-setup');
  const botLabels = await page.$$eval('#race-roster .tag-bot', (e) => e.length);
  check(botLabels === 3, `${vp.name}: all 3 bots labelled BOT on setup`);
  await page.click('#btn-race-start');
  await page.waitForSelector('#countdown:not([hidden])');
  await page.waitForTimeout(400);
  await shot('11-race-countdown');
  await page.waitForSelector('#countdown', { state: 'hidden', timeout: 6000 });
  s = await readAndSolve(page);
  // hints cost time in a race, so spamming them can't win
  const secs = (t) => { const [m, x] = t.split(':').map(Number); return m * 60 + x; };
  const tBefore = secs(await page.textContent('#timer'));
  await page.click('#tool-hint'); await page.waitForTimeout(150);
  const tAfter = secs(await page.textContent('#timer'));
  check(tAfter - tBefore >= 15, `${vp.name}: race hint adds a 15 s penalty (${tBefore}s → ${tAfter}s)`);
  check(/\+15/.test(await page.textContent('#status')), `${vp.name}: race hint says it costs +15 s`);
  await page.click('#tool-hint'); await page.waitForTimeout(150); // second press fills it in, no extra cost
  const tFill = secs(await page.textContent('#timer'));
  check(tFill - tAfter < 15, `${vp.name}: filling a hinted cell costs nothing extra (${tAfter}s → ${tFill}s)`);
  await fillTo(page, vp, s.solution, s.current, s.givens, { upto: 0.5 });
  await page.waitForTimeout(400);
  const barLabels = await page.$$eval('#race-bars .rb em', (e) => e.map((x) => x.textContent));
  check(barLabels.length === 3 && barLabels.every((t) => t === 'BOT'), `${vp.name}: race bars label bots as BOT`);
  await shot('12-race-midgame');
  await boardFits(page, `${vp.name} race`);
  await fillTo(page, vp, s.solution, s.current, s.givens);
  await waitResult(page, 'race');
  await shot('13-race-end');
  const title = await page.textContent('#modal-title');
  check(/won|placed/.test(title), `${vp.name}: race result shows placement ("${title}")`);
  await page.click('#modal [data-action="home"]');

  // --- stats & settings screens
  await page.click('[data-action="stats"]');
  await page.waitForTimeout(300);
  await shot('14-stats');
  const statsText = await page.textContent('#modal-card');
  check(/Solved/.test(statsText) && /Races/.test(statsText), `${vp.name}: stats modal renders`);
  await page.click('[data-action="close-modal"]');
  await page.click('[data-action="settings"]');
  await page.waitForTimeout(250);
  await page.click('[data-theme-set="dark"]');
  await page.waitForTimeout(250);
  await shot('15-settings-dark');
  await page.click('[data-action="close-modal"]');
  await page.waitForTimeout(200);
  await shot('16-title-dark');
  await page.click('#btn-practice');
  await page.click('[data-practice="med8"]');
  await page.waitForSelector('#screen-game:not([hidden]) #board .cell');
  s = await readAndSolve(page);
  await fillTo(page, vp, s.solution, s.current, s.givens, { upto: 0.45 });
  await page.waitForTimeout(250);
  await shot('17-game-dark');

  // --- browser back button walks up the app instead of leaving it
  await page.goBack();
  await page.waitForTimeout(250);
  if (await page.isVisible('[data-action="leave-now"]')) await page.click('[data-action="leave-now"]');
  await page.waitForTimeout(250);
  check(await page.isVisible('#screen-practice'), `${vp.name}: back from a game returns to the picker`);
  await page.goBack();
  await page.waitForTimeout(250);
  check(await page.isVisible('#screen-home') && page.url().startsWith(BASE), `${vp.name}: back from the picker returns home`);

  // --- persistence across reload
  await page.reload();
  await page.waitForSelector('#btn-daily');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('twotone:v1')));
  check(persisted.dailySolved === 1 && persisted.streak.current === 1, `${vp.name}: daily stats persisted`);
  check(persisted.race.played === 1, `${vp.name}: race stats persisted`);
  check(persisted.settings.theme === 'dark', `${vp.name}: theme persisted`);
  check(!(await page.isVisible('#howto-next')), `${vp.name}: how-to not shown again after first visit`);

  check(errors.length === 0, `${vp.name}: zero console errors (${errors.join(' | ')})`);
  results[vp.name] = { consoleErrors: errors.length };
  await ctx.close();
}

async function landscape(browser) {
  console.log('\n▶ landscape 960x540');
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('twotone:v1', JSON.stringify({ seenHowTo: true })));
  await page.goto(BASE);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/landscape-01-title.png` });
  await noOverflow(page, 'landscape title');
  await page.click('#btn-race');
  await page.click('[data-race-size="med8"]');
  await page.click('#btn-race-start');
  await page.waitForSelector('#countdown', { state: 'hidden', timeout: 6000 });
  const s = await readAndSolve(page);
  await fillTo(page, { opts: {} }, s.solution, s.current, s.givens, { upto: 0.3 });
  await page.screenshot({ path: `${SHOTS}/landscape-02-race.png` });
  await boardFits(page, 'landscape race');
  await noOverflow(page, 'landscape race');
  await fillTo(page, { opts: {} }, s.solution, s.current, s.givens);
  await waitResult(page, 'race');
  await page.screenshot({ path: `${SHOTS}/landscape-03-race-end.png` });
  check(errors.length === 0, `landscape: zero console errors (${errors.join(' | ')})`);
  results.landscape = { consoleErrors: errors.length };
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
try {
  for (const vp of VIEWPORTS) await runViewport(browser, vp);
  await landscape(browser);
} catch (e) {
  fail++; failures.push('exception: ' + (e && e.stack || e));
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
console.log(`\nE2E: ${pass} passed, ${fail} failed`);
console.log('console errors:', JSON.stringify(Object.fromEntries(Object.entries(results).filter(([k]) => !k.endsWith('share') && k !== 'genMs').map(([k, v]) => [k, v.consoleErrors]))));
console.log('generation worst-case ms at 4x CPU throttle:', JSON.stringify(results.genMs));
console.log('share sample:\n' + (results['phone-share'] || results['desktop-share'] || ''));
if (failures.length) console.log('failures:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
