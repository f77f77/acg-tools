#!/usr/bin/env node
/**
 * Run the browser recognize.ts path against Team Preview fixtures.
 * Uses Puppeteer + the Vite recognize-debug.html harness (same code as Pages).
 *
 *   node scripts/match-recognize-browser.mjs
 *   node scripts/match-recognize-browser.mjs --img fixtures/team-preview-user-basculegion-fail.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const LIVE_LATEST = ['froslass', 'garchomp', 'basculegion', 'kingambit', 'sneasler', 'golisopod'];

const EXPECTED = {
  'fixtures/team-preview-live-latest.jpg': LIVE_LATEST,
  'fixtures/team-preview-test-1.jpg': LIVE_LATEST,
  'fixtures/team-preview-test-2.jpg': [
    'chesnaught',
    'mimikyu',
    'ninetalesalola',
    'swampert',
    'typhlosionhisui',
    'greninja',
  ],
  'fixtures/team-preview-test-3.jpg': [
    'slowbrogalar',
    'scizor',
    'eelektross',
    'salamence',
    'rotomwash',
    'gallade',
  ],
  'fixtures/team-preview-test-4.jpg': [
    'salamence',
    'rillaboom',
    'kingambit',
    'sylveon',
    'rotomwash',
    'sneasler',
  ],
  'fixtures/team-preview-user-basculegion-fail.png': LIVE_LATEST,
};

function parseArgs(argv) {
  const imgs = [];
  let port = 5173;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--img' && argv[i + 1]) imgs.push(argv[++i]);
    else if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]);
  }
  if (!imgs.length) {
    const defaults = [
      'fixtures/team-preview-live-latest.jpg',
      'fixtures/team-preview-test-1.jpg',
      'fixtures/team-preview-test-2.jpg',
      'fixtures/team-preview-test-3.jpg',
      'fixtures/team-preview-test-4.jpg',
    ];
    for (const rel of defaults) {
      if (fs.existsSync(path.join(ROOT, 'public', rel))) imgs.push(rel);
    }
    const userFx = path.join(ROOT, 'public/fixtures/team-preview-user-basculegion-fail.png');
    if (fs.existsSync(userFx)) imgs.push('fixtures/team-preview-user-basculegion-fail.png');
  }
  return { imgs, port };
}

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function loadPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch {
    /* install on demand */
  }
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--no-save', 'puppeteer-core'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('npm install puppeteer-core failed'))));
  });
  return require('puppeteer-core');
}

async function main() {
  const { imgs, port } = parseArgs(process.argv.slice(2));
  const puppeteer = await loadPuppeteer();
  const chrome =
    process.env.CHROME_PATH ||
    ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome'].find((p) =>
      fs.existsSync(p),
    );
  if (!chrome) throw new Error('google-chrome not found');

  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/pokemon-champions-assistant/`;
  await waitFor(base);

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);

  let failed = 0;
  const reports = [];
  for (const img of imgs) {
    const url = `${base}recognize-debug.html?img=${encodeURIComponent(img)}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.title === 'recognize-debug-done' || document.title === 'recognize-debug-error',
      { timeout: 120000 },
    );
    const dump = await page.evaluate(() => window.__RECOGNIZE_DEBUG__);
    reports.push({ img, dump });
    const expected = EXPECTED[img];
    console.log(`\n=== ${img} ===`);
    if (!dump?.ok) {
      console.error('harness error', dump?.error || dump);
      failed += 1;
      continue;
    }
    console.log(
      `canvas ${dump.canvas.w}x${dump.canvas.h} templates=${dump.templateCount} speciesOverlay=${dump.generatedSpecies}`,
    );
    console.log(
      `${'slot'.padEnd(5)}${'expected'.padEnd(14)}${'matched'.padEnd(14)}${'find'.padEnd(14)}${'conf'.padStart(7)} ${'margin'.padStart(7)} types            reason           ok`,
    );
    let correct = 0;
    let wrong = 0;
    let unidentified = 0;
    for (let i = 0; i < 6; i++) {
      const row = dump.slots[i];
      const exp = expected?.[i] ?? '?';
      const matched = row.speciesId || '-';
      const find = row.findSpeciesKey || '-';
      const ok =
        expected && row.identified && row.speciesId === exp && row.findSpeciesKey === exp;
      if (expected) {
        if (ok) correct += 1;
        else if (row.speciesId && row.speciesId !== exp) wrong += 1;
        else unidentified += 1;
      }
      const types = (row.detectedTypes || []).join(',') || '-';
      const mark = !expected ? '.' : ok ? 'Y' : row.speciesId && row.speciesId !== exp ? 'W' : 'N';
      console.log(
        `${String(i).padEnd(5)}${exp.padEnd(14)}${String(matched).padEnd(14)}${String(find).padEnd(14)}${Number(row.confidence).toFixed(3).padStart(7)} ${Number(row.margin || 0).toFixed(3).padStart(7)} ${types.padEnd(16)} ${String(row.rejectReason || 'ok').padEnd(16)} ${mark}`,
      );
      if (i === 2 || mark !== 'Y') {
        console.log(
          `      alt=${row.altSpeciesId} ahashHit=${row.ahashHit} typeScores=${JSON.stringify(row.typeScores || [])} top=${JSON.stringify(row.topCandidates?.slice(0, 5))}`,
        );
      }
    }
    if (expected) {
      console.log(`Overall: correct=${correct}/6 wrong=${wrong} null=${unidentified}`);
      const isLive = img.endsWith('live-latest.jpg') || img.endsWith('test-1.jpg');
      const ids = dump.slots.map((s) => s.speciesId);
      if (wrong !== 0 || (isLive && (correct < 6 || ids[2] !== 'basculegion'))) {
        failed += 1;
      } else if (img.includes('test-2') && (ids[1] !== 'mimikyu' || ids[2] !== 'ninetalesalola')) {
        failed += 1;
      } else if (img.includes('test-4') && ids[3] !== 'sylveon') {
        failed += 1;
      } else if (correct < 5) {
        failed += 1;
      }
    }
  }

  // Real App UI: 載入測試圖 → 辨認敵方隊伍 (same getUserMedia canvas path).
  console.log('\n=== App UI 載入測試圖 → 辨認敵方隊伍 ===');
  await page.setViewport({ width: 1600, height: 1100 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('button');
  const clickedLoad = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('載入測試圖'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clickedLoad) {
    console.error('載入測試圖 button missing');
    failed += 1;
  } else {
    await page.waitForFunction(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('辨認敵方隊伍'));
      return !!btn && !btn.disabled;
    });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('辨認敵方隊伍'));
      btn?.click();
    });
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('.panel--enemy .pkmn-card');
      if (cards.length < 6) return false;
      const keys = [...cards].map((c) => c.querySelector('.pkmn-card__species-select')?.value || '');
      return keys.some((k) => k === 'basculegion' || k === 'froslass');
    }, { timeout: 120000 });
    const ui = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.panel--enemy .pkmn-card')];
      return cards.map((c, i) => {
        const sel = c.querySelector('.pkmn-card__species-select');
        const opt = sel?.selectedOptions?.[0];
        return {
          slot: i,
          speciesKey: sel?.value || '',
          label: opt?.textContent?.trim() || '',
          unidentified: c.classList.contains('is-unidentified'),
        };
      });
    });
    console.log(ui.map((r) => `slot ${r.slot} ${r.speciesKey || '未識別'} ${r.label} unidentified=${r.unidentified}`).join('\n'));
    const shot = path.join(ROOT, 'docs/app-ui-basculegion-identified.png');
    await page.screenshot({ path: shot, fullPage: true });
    console.log('Wrote', shot);
    const slot2 = ui[2];
    const wrong = ui.filter((r, i) => {
      const exp = ['froslass', 'garchomp', 'basculegion', 'kingambit', 'sneasler', 'golisopod'][i];
      return r.speciesKey && r.speciesKey !== exp;
    }).length;
    const ok =
      slot2?.speciesKey === 'basculegion' && !slot2.unidentified && wrong === 0 && ui.every((r) => r.speciesKey);
    if (!ok) {
      console.error('App UI did not identify all 6 (slot3 Basculegion-M required)');
      failed += 1;
    } else {
      console.log('App UI: 6/6 including Basculegion-M slot 2');
    }
  }

  await browser.close();
  const outPath = path.join(ROOT, 'docs/match-recognize-browser-results.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(reports, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (failed) {
    console.error(`FAILED (${failed} fixture(s))`);
    process.exit(1);
  }
  console.log('All browser recognize fixtures passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
