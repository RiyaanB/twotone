// Renders docs/og.png (1200x630) and docs/icon-192.png / icon-512.png. Dev-only.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 8838;
const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`http://127.0.0.1:${port}/tools/og.html`);
  await page.waitForSelector('body[data-ready]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/og.png' });
  for (const s of [192, 512]) {
    const p2 = await browser.newPage({ viewport: { width: s, height: s } });
    await p2.setContent(`<body style="margin:0;background:#F5F0E6;display:grid;place-items:center;height:100vh"><img src="http://127.0.0.1:${port}/docs/favicon.svg" style="width:86%;height:86%"></body>`);
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: `docs/icon-${s}.png` });
  }
} finally { await browser.close(); srv.kill(); }
console.log('ok');
