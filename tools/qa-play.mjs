// Dev helper: scripted "player" QA sessions with screenshots and measurements.
//   node tools/qa-play.mjs [outDir] [desktop|phone]
// Plays like a person would (taps with pauses, a mistake, hints, races), at
// desktop 1280x800 and phone 390x844. Prints a JSON report of observations.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import * as L from '../docs/js/logic.js';

const { chromium } = await import('playwright');
const OUT = process.argv[2] || '/workspace/arcade-shots/qa/twotone';
mkdirSync(OUT, { recursive: true });

async function freePort() {
  for (let p = 8851; p <= 8869; p++) {
    const ok = await new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))); s.listen(p, '127.0.0.1'); });
    if (ok) return p;
  }
  throw new Error('no port');
}
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '-d', 'docs', '--bind', '127.0.0.1'], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/`;
await new Promise((r) => setTimeout(r, 700));

const report = {};
const ONLY = process.argv[3] || '';
process.on('exit', () => server.kill());
const VPS_ALL = [
  { name: 'desktop', opts: { viewport: { width: 1280, height: 800 } } },
  { name: 'phone', opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];
const VPS = VPS_ALL.filter((v) => !ONLY || v.name === ONLY);

async function readPuzzle(page) {
  const d = await page.evaluate(() => {
    const b = document.querySelector('#board'); const n = +b.dataset.n;
    return { n, cells: [...b.querySelectorAll('.cell')].map((c) => ({ g: c.dataset.given === '1', v: +c.dataset.v })), clues: [...b.querySelectorAll('.clue')].map((c) => ({ t: c.dataset.type, i: +c.dataset.i, c: +c.dataset.clue })) };
  });
  const p = { n: d.n, givens: d.cells.map((c) => (c.g ? c.v : 0)), h: new Array(d.n * (d.n - 1)).fill(0), v: new Array(d.n * (d.n - 1)).fill(0) };
  for (const c of d.clues) p[c.t][c.i] = c.c;
  const res = L.solve(p, 2, { trace: true });
  return { p, sol: res.grid, steps: res.steps, cur: d.cells.map((c) => c.v) };
}
const tap = (page, vp, i) => (vp.opts.hasTouch ? page.tap(`#board .cell[data-i="${i}"]`) : page.click(`#board .cell[data-i="${i}"]`));
const val = async (page, i) => +(await page.getAttribute(`#board .cell[data-i="${i}"]`, 'data-v'));
async function setTo(page, vp, i, v) { let g = 0; while ((await val(page, i)) !== v && g++ < 3) await tap(page, vp, i); }
const status = (page) => page.$eval('#status', (e) => e.textContent.trim());
const metrics = (page) => page.evaluate(() => {
  const b = document.querySelector('#board').getBoundingClientRect();
  const c = document.querySelector('#board .cell').getBoundingClientRect();
  const clue = document.querySelector('#board .clue');
  const tb = document.querySelector('.toolbar').getBoundingClientRect();
  const rs = document.querySelector('#rules-strip');
  return { board: [Math.round(b.left), Math.round(b.top), Math.round(b.width)], cell: Math.round(c.width), clue: clue ? Math.round(clue.getBoundingClientRect().width) : 0, toolbarBottom: Math.round(tb.bottom), vh: innerHeight, rulesVisible: rs && rs.offsetParent !== null, rulesW: rs ? Math.round(rs.scrollWidth) : 0, rulesClient: rs ? Math.round(rs.clientWidth) : 0 };
});

for (const vp of VPS) {
  const R = report[vp.name] = { notes: [] };
  const ctx = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true }).then((b) => b.newContext(vp.opts));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  let k = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/${vp.name}-${String(++k).padStart(2, '0')}-${name}.png` });

  await page.goto(BASE);
  await page.waitForTimeout(900);
  await shot('first-load');
  for (let s = 0; s < 2; s++) { await page.click('#howto-next'); await page.waitForTimeout(400); await shot('howto-' + (s + 2)); }
  if (await page.$('#howto-warmup')) {
    // first-run on-ramp: take the warm-up, use one two-step hint, solve it
    await page.click('#howto-warmup'); await page.waitForTimeout(600);
    R.warmup = { title: await page.$eval('#gt-mode', (e) => e.textContent), tip: await status(page) };
    await shot('warmup-start');
    await page.click('#tool-hint'); await page.waitForTimeout(300);
    R.warmup.hintPress1 = await status(page);
    R.warmup.target = await page.$$eval('#board .cell.target', (c) => c.map((x) => x.dataset.v));
    await shot('warmup-hint-explain');
    await page.click('#tool-hint'); await page.waitForTimeout(300);
    R.warmup.target2 = await page.$$eval('#board .cell.target', (c) => c.map((x) => x.dataset.v));
    let w = await readPuzzle(page);
    for (let i = 0; i < w.sol.length; i++) if (!w.p.givens[i]) await setTo(page, vp, i, w.sol[i]);
    await page.waitForSelector('#result', { timeout: 6000 }); await page.waitForTimeout(600);
    R.warmup.result = await page.$eval('#result', (e) => e.innerText.replace(/\s+/g, ' '));
    await shot('warmup-result');
    await page.click('#result [data-action="home"]'); await page.waitForTimeout(500);
  } else { await page.click('#howto-next'); await page.waitForTimeout(400); }
  await page.waitForTimeout(400);
  await shot('home');

  // ---- daily: play like a person, with a deliberate mistake
  await page.click('#btn-daily'); await page.waitForTimeout(600);
  let { p, sol, steps, cur } = await readPuzzle(page);
  R.daily = { n: p.n, givens: p.givens.filter(Boolean).length, clues: p.h.concat(p.v).filter(Boolean).length, tier2Steps: steps.filter((s) => s.tier >= 2).length, steps: steps.length, metrics: await metrics(page), startStatus: await status(page) };
  await shot('daily-start');
  const t0 = Date.now();
  // follow the solver's order (what a person would find) for the first third
  const order = steps.map((s) => s.idx);
  for (const i of order.slice(0, Math.floor(order.length / 3))) { await setTo(page, vp, i, sol[i]); await page.waitForTimeout(120); }
  // a mistake: put the wrong symbol somewhere that will break a rule
  const wrongIdx = order[Math.floor(order.length / 3)];
  await setTo(page, vp, wrongIdx, 3 - sol[wrongIdx]);
  R.daily.statusRightAfterMistake = await status(page);
  await page.waitForTimeout(900);
  R.daily.statusAfterMistake = await status(page);
  await shot('daily-mistake');
  await page.click('#tool-hint'); await page.waitForTimeout(400);
  R.daily.hint1 = await status(page);
  await shot('daily-hint-mistake');
  await page.click('#tool-hint'); await page.waitForTimeout(400);
  R.daily.hint2 = await status(page);
  await shot('daily-hint-step');
  // reload mid game
  await page.reload(); await page.waitForTimeout(800);
  R.daily.afterReload = { screen: await page.evaluate(() => document.body.dataset.screen), timer: await page.$eval('#timer', (e) => e.textContent) };
  await shot('daily-after-reload');
  await page.click('#btn-daily'); await page.waitForTimeout(600);
  R.daily.resumeStatus = await status(page);
  ({ p, sol, steps, cur } = await readPuzzle(page));
  for (let i = 0; i < sol.length; i++) if (!p.givens[i]) await setTo(page, vp, i, sol[i]);
  R.daily.playMs = Date.now() - t0;
  await page.waitForTimeout(500);
  await shot('daily-win-anim');
  await page.waitForSelector('#result', { timeout: 6000 }); await page.waitForTimeout(600);
  await shot('daily-result');
  R.daily.resultText = await page.$eval('#result', (e) => e.innerText.replace(/\s+/g, ' '));
  await page.click('[data-action="share"]'); await page.waitForTimeout(300);
  R.daily.share = await page.evaluate(() => window.__lastShare);
  R.daily.toast = await page.$eval('#toast', (e) => e.textContent);
  await page.click('#result [data-action="home"]'); await page.waitForTimeout(500);
  await shot('home-after-daily');

  // ---- practice: easy then expert
  await page.click('#btn-practice'); await page.waitForTimeout(400);
  await shot('practice-picker');
  for (const diff of ['easy6', 'big10']) {
    await page.click(`[data-practice="${diff}"]`); await page.waitForTimeout(600);
    ({ p, sol, steps, cur } = await readPuzzle(page));
    R[diff] = { n: p.n, givens: p.givens.filter(Boolean).length, clues: p.h.concat(p.v).filter(Boolean).length, tier2Steps: steps.filter((s) => s.tier >= 2).length, rules: [...new Set(steps.map((s) => s.rule))], metrics: await metrics(page) };
    await shot(`practice-${diff}-start`);
    // drag paint across first row
    // start the drag on the first run of 3 non-given cells in a row
    let start = 0;
    for (let i = 0; i < p.n * p.n - 2; i++) if (i % p.n <= p.n - 3 && !p.givens[i] && !p.givens[i + 1] && !p.givens[i + 2]) { start = i; break; }
    const box = await page.$eval(`#board .cell[data-i="${start}"]`, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; });
    if (!vp.opts.hasTouch) {
      await page.mouse.move(box.x, box.y); await page.mouse.down();
      for (let c = 1; c < 3; c++) await page.mouse.move(box.x + c * box.w * 1.1, box.y, { steps: 4 });
      await page.mouse.up(); await page.waitForTimeout(800);
      R[diff].afterDrag = await status(page);
      await shot(`practice-${diff}-drag`);
      R[diff].dragPainted = await page.$$eval('#board .cell', (els, st) => [0, 1, 2].map((k) => els[st + k].dataset.v), start);
      if (await page.$eval('#tool-undo', (e) => !e.disabled)) { await page.click('#tool-undo'); await page.waitForTimeout(200); }
    }
    // three hints in a row to see explanations
    R[diff].hints = [];
    for (let h = 0; h < 4; h++) { await page.click('#tool-hint'); await page.waitForTimeout(250); R[diff].hints.push(await status(page)); }
    await shot(`practice-${diff}-hint`);
    ({ p, sol, steps, cur } = await readPuzzle(page));
    for (let i = 0; i < sol.length; i++) if (!p.givens[i]) await setTo(page, vp, i, sol[i]);
    await page.waitForSelector('#result', { timeout: 6000 }); await page.waitForTimeout(600);
    R[diff].result = await page.$eval('#result', (e) => e.innerText.replace(/\s+/g, ' '));
    await shot(`practice-${diff}-result`);
    await page.click('#result [data-action="goto-practice"]'); await page.waitForTimeout(400);
  }
  await page.click('#screen-practice [data-action="home"]'); await page.waitForTimeout(400);

  // ---- race: (a) play at a realistic human pace on 6x6 hard, (b) spam hints
  await page.click('#btn-race'); await page.waitForTimeout(400);
  await shot('race-setup');
  R.race = {};
  for (const variant of ['human', 'hintspam']) {
    await page.click('[data-race-size="hard6"]');
    await page.click('#btn-race-start'); await page.waitForTimeout(400);
    if (variant === 'human') await shot('race-countdown');
    await page.waitForSelector('#countdown', { state: 'hidden', timeout: 6000 });
    ({ p, sol, steps, cur } = await readPuzzle(page));
    const schedules = await page.evaluate(() => null);
    const tStart = Date.now();
    if (variant === 'human') {
      // a competent human: ~4 s per cell, longer on hard deductions
      const ord = steps.map((s) => s);
      for (const s of ord) {
        await page.waitForTimeout(s.tier >= 2 ? 4500 : 2200);
        await setTo(page, vp, s.idx, sol[s.idx]);
        if (s === ord[Math.floor(ord.length / 2)]) { R.race.midBars = await page.$$eval('.rb', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' '))); await shot('race-mid'); }
      }
    } else {
      for (let h = 0; h < 90; h++) { if (await page.$('#result')) break; await page.click('#tool-hint').catch(() => {}); await page.waitForTimeout(60); }
    }
    await page.waitForSelector('#result', { timeout: 8000 }); await page.waitForTimeout(600);
    R.race[variant] = { secs: Math.round((Date.now() - tStart) / 1000), result: await page.$eval('#result', (e) => e.innerText.replace(/\s+/g, ' ')) };
    await shot(`race-result-${variant}`);
    await page.click('#result [data-action="goto-race"]'); await page.waitForTimeout(400);
  }
  await page.click('#screen-race [data-action="home"]'); await page.waitForTimeout(300);

  // ---- stats & settings
  await page.click('#screen-home [data-action="stats"]'); await page.waitForTimeout(400); await shot('stats');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.click('#screen-home [data-action="settings"]'); await page.waitForTimeout(400);
  await page.click('[data-theme-set="dark"]'); await page.waitForTimeout(300); await shot('settings-dark');
  await page.keyboard.press('Escape');
  await page.click('#btn-practice'); await page.waitForTimeout(300);
  await page.click('[data-practice="med8"]'); await page.waitForTimeout(500);
  ({ p, sol } = await readPuzzle(page));
  let placed = 0; for (let i = 0; i < sol.length && placed < 20; i++) if (!p.givens[i]) { await setTo(page, vp, i, sol[i]); placed++; }
  R.med8 = { metrics: await metrics(page) };
  await shot('game-dark-med8');
  R.errors = errors;
  await ctx.browser().close();
}
console.log(JSON.stringify(report, null, 1));
server.kill();
