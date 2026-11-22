// Dev helper: quick screenshots. node tools/shot.mjs <port> <name> [w h mobile] [script]
import { chromium } from 'playwright';
const [port = '8832', name = 'dev', w = '390', h = '844', mobile = '1', ...rest] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, isMobile: mobile === '1', hasTouch: mobile === '1', deviceScaleFactor: mobile === '1' ? 2 : 1 });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${port}/`);
await page.waitForTimeout(600);
const steps = rest.join(' ');
if (steps) await eval(`(async () => { ${steps} })()`);
await page.waitForTimeout(400);
await page.screenshot({ path: `/tmp/tt-${name}.png` });
console.log('errors:', errs);
await browser.close();
