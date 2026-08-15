/**
 * Capture feature screenshots of the ODIServer web console into ./screenshots.
 *
 * Prerequisites:
 *   - ODIServer running on http://localhost:8080 (npm run dev)
 *   - puppeteer-core installed: npm i --no-save puppeteer-core
 *   - A local Chrome or Edge installation (no browser download needed)
 *
 * Usage: node scripts/capture-screenshots.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.argv[2] ?? 'http://localhost:8080';
const OUT_DIR = fileURLToPath(new URL('../screenshots/', import.meta.url));

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge installation found.');
  process.exit(1);
}

// Each shot: url path, output file, optional theme override and pre-shot action.
const SHOTS = [
  { path: '/', file: 'connectivity-overview.png' },
  { path: '/?node=device:demo-water-plant.pumpstation-01', file: 'connectivity-tags.png' },
  {
    path: '/mqtt',
    file: 'mqtt-agent.png',
    // Select the agent row so its configuration form is visible.
    before: async (page) => {
      await page.evaluate(() => {
        const cell = [...document.querySelectorAll('td')].find((td) => td.textContent?.trim() === 'MQTT_Test');
        cell?.closest('tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 800));
    },
  },
  { path: '/events', file: 'event-log.png' },
  { path: '/diagnostics', file: 'diagnostics.png' },
  { path: '/settings', file: 'settings.png' },
  { path: '/?node=device:demo-water-plant.pumpstation-01', file: 'connectivity-tags-dark.png', theme: 'dark' },
];

mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=2'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });

  for (const shot of SHOTS) {
    await page.evaluateOnNewDocument((theme) => {
      if (theme) window.localStorage.setItem('odiserver-theme', theme);
      else window.localStorage.setItem('odiserver-theme', 'light');
    }, shot.theme ?? null);

    await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: 'networkidle0', timeout: 30_000 });
    // Let live values (WebSocket) and deferred grids settle.
    await new Promise((r) => setTimeout(r, 2500));
    if (shot.before) await shot.before(page);
    await page.screenshot({ path: `${OUT_DIR}${shot.file}` });
    console.log(`captured ${shot.file}`);
  }
} finally {
  await browser.close();
}
