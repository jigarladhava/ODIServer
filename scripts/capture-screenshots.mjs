/**
 * Capture feature screenshots of the ODIServer web console into ./screenshots.
 *
 * Prerequisites:
 *   - ODIServer running (npm run dev) with a live project (e.g. the imported
 *     KEPServerEX project bridged over OPC UA)
 *   - puppeteer-core installed: npm i --no-save puppeteer-core
 *   - A local Chrome or Edge installation (no browser download needed)
 *
 * Usage: node scripts/capture-screenshots.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:8080';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(page, { path, file, theme, before }) {
  await page.evaluateOnNewDocument((t) => {
    window.localStorage.setItem('odiserver-theme', t ?? 'light');
  }, theme ?? null);

  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle0', timeout: 60_000 });
  // Let live values (WebSocket) and deferred grids settle.
  await sleep(3000);
  if (before) await before(page);
  await page.screenshot({ path: `${OUT_DIR}${file}` });
  console.log(`captured ${file}`);
}

async function clickMenu(page, menuLabel, entryLabel) {
  await page.evaluate(
    ([m, e]) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === m);
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    },
    [menuLabel, entryLabel],
  );
  await sleep(300);
  await page.evaluate(
    (e) => {
      const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')].find(
        (el) => el.textContent?.trim() === e,
      );
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    },
    entryLabel,
  );
}

// Each shot: url path, output file, optional theme override and pre-shot action.
const SHOTS = [
  {
    path: '/',
    file: 'connectivity-overview.png',
    // Click the biggest channel row so the grid shows scale + counts.
    before: async (page) => {
      await page.evaluate(() => {
        const cell = [...document.querySelectorAll('td')].find((td) => td.textContent?.trim() === 'Dodka_French_Well_LT');
        cell?.closest('tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await sleep(1200);
    },
  },
  {
    path: '/?node=device:main-balancing-reservoir.incomer1',
    file: 'connectivity-tags.png',
  },
  {
    path: '/?node=device:gidc-oht-ht.incomer1&row=gidc-oht-ht.incomer1.reset-max-demand',
    file: 'tag-editor.png',
    // Wait for the inspector to render the tag editor, then stop (no clicks).
  },
  {
    path: '/?node=device:gidc-oht-ht.incomer1&row=gidc-oht-ht.incomer1.reset-max-demand',
    file: 'write-dialog.png',
    before: async (page) => {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Write…');
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await sleep(500);
      await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="New value"]');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '1');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await sleep(300);
    },
  },
  {
    path: '/?node=channel:gidc-oht-ht',
    file: 'opcua-client-channel.png',
    before: async (page) => {
      await sleep(500);
    },
  },
  {
    path: '/',
    file: 'command-palette.png',
    before: async (page) => {
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyK');
      await page.keyboard.up('Control');
      await sleep(300);
      await page.keyboard.type('reservoir', { delay: 40 });
      await sleep(800);
    },
  },
  {
    path: '/events',
    file: 'event-log.png',
  },
  {
    path: '/mqtt',
    file: 'mqtt-agent.png',
    // Select the demo agent row so its configuration form is visible.
    before: async (page) => {
      await page.evaluate(() => {
        const cell = [...document.querySelectorAll('td')].find((td) => td.textContent?.trim() === 'UNS_Bridge_Demo');
        cell?.closest('tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await sleep(800);
    },
  },
  { path: '/diagnostics', file: 'diagnostics.png' },
  { path: '/settings', file: 'settings.png' },
  {
    path: '/?node=device:main-balancing-reservoir.incomer1',
    file: 'connectivity-tags-dark.png',
    theme: 'dark',
  },
  // Import diff preview: needs a project file upload; scripted below separately.
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
    await capture(page, shot);
  }

  // Import-diff shot: open Project > Open Project, upload a slightly modified
  // copy of the current project (one tag renamed, one device removed) so the
  // diff preview shows added/modified/removed, plus the typed REPLACE guard.
  const exportRes = await fetch(`${BASE_URL}/api/project`);
  const projectJson = await exportRes.json();
  const modified = structuredClone(projectJson);
  const renameTag = modified.tags.find((t) => t.name === 'AVG_CURRENT');
  if (renameTag) renameTag.name = 'AVG_Current_L1';
  const dropDevice = modified.devices.find((d) => d.name === 'MODEM');
  if (dropDevice) {
    modified.devices = modified.devices.filter((d) => d !== dropDevice);
    modified.tags = modified.tags.filter((t) => t.deviceId !== dropDevice.id);
  }
  const tmpProjectPath = `${OUT_DIR}.capture-project.json`;
  writeFileSync(tmpProjectPath, JSON.stringify(modified, null, 2));

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0', timeout: 60_000 });
  await sleep(2000);
  await clickMenu(page, 'Project', 'Open Project…');
  await sleep(500);
  const fileInput = await page.$('input[aria-label="File to import"]');
  await fileInput.uploadFile(tmpProjectPath);
  await sleep(1200);
  // Type REPLACE into the confirmation field to show the guard.
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Type REPLACE to confirm project replacement"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'REPLACE');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(500);
  await page.screenshot({ path: `${OUT_DIR}import-diff.png` });
  console.log('captured import-diff.png');
} finally {
  await browser.close();
}
