#!/usr/bin/env node
/**
 * Fetch a SMALL allowlist of Champions Battle Data (CBD) menu sprites.
 *
 * SAFETY: refuses to run without --ids or --allowlist. Never downloads the
 * whole dex. Never pulls HOME / official-artwork (PokéAPI / PokeAPI art).
 *
 * Usage:
 *   node scripts/fetch-cbd-templates.mjs --allowlist
 *   node scripts/fetch-cbd-templates.mjs --ids=noivern,lycanroc,politoed
 *   node scripts/fetch-cbd-templates.mjs --ids noivern --ids lycanroc
 *
 * Output (gitignored PNGs by default):
 *   assets/templates/preview-thumbs/{showdownId}.png
 *   assets/templates/preview-thumbs/manifest.jsonl
 *
 * Recognition default remains public/templates/ ROI crops (source: roi-crop).
 * CBD assets are optional secondary — menu-style art often mismatches Team Preview thumbs.
 *
 * API:
 *   GET https://championsbattledata.com/api/pokemon/{showdownId}
 *   → summary.primary.image_path | summary.sprite
 *   → https://championsbattledata.com/{image_path}
 *   equivalently .../pokemon_champions_assets/pokemon/{SavedName}.png
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets/templates/preview-thumbs');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.jsonl');
const CBD_ORIGIN = 'https://championsbattledata.com';
const RATE_LIMIT_MS = 600;
/** Hard cap — even with flags, refuse absurd allowlists (full-dex guard). */
const MAX_IDS = 64;

/** Default allowlist: top-50 CBD Doubles ∪ seed ∪ test-fixture species. Used with --allowlist. */
const DEFAULT_ALLOWLIST = [
  'kingambit',
  'garchomp',
  'sneasler',
  'basculegion',
  'whimsicott',
  'sinistcha',
  'incineroar',
  'farigiraf',
  'charizard',
  'staraptor',
  'sylveon',
  'raichu',
  'archaludon',
  'tyranitar',
  'pelipper',
  'milotic',
  'aerodactyl',
  'venusaur',
  'froslass',
  'swampert',
  'delphox',
  'dragonite',
  'gholdengo',
  'grimmsnarl',
  'torkoal',
  'blastoise',
  'floette',
  'mausholdfour',
  'sableye',
  'ninetalesalola',
  'excadrill',
  'glimmora',
  'metagross',
  'arcaninehisui',
  'talonflame',
  'gengar',
  'mawile',
  'scovillain',
  'scizor',
  'politoed',
  'annihilape',
  'rotomwash',
  'tsareena',
  'primarina',
  'kangaskhan',
  'kommoo',
  'corviknight',
  'gardevoir',
  'meowscarada',
  'blaziken',
  'noivern',
  'lycanroc',
  'rotom',
  'hippowdon',
  'zoroark',
  'bellibolt',
];

function usage(exitCode = 1) {
  console.error(`Usage:
  node scripts/fetch-cbd-templates.mjs --allowlist
  node scripts/fetch-cbd-templates.mjs --ids=noivern,lycanroc
  node scripts/fetch-cbd-templates.mjs --ids noivern --ids lycanroc

Refuses to run without --ids or --allowlist (no whole-dex crawl).
Never downloads HOME / official-artwork — CBD pokemon/ sprites only.
Max ${MAX_IDS} ids per run. Rate limit ${RATE_LIMIT_MS}ms between requests.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const ids = [];
  let allowlist = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage(0);
    if (a === '--allowlist') {
      allowlist = true;
      continue;
    }
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--ids' || a.startsWith('--ids=')) {
      const raw = a.startsWith('--ids=') ? a.slice('--ids='.length) : argv[++i];
      if (!raw) {
        console.error('Missing value for --ids');
        usage(1);
      }
      for (const part of raw.split(',')) {
        const id = part.trim().toLowerCase();
        if (id) ids.push(id);
      }
      continue;
    }
    console.error(`Unknown arg: ${a}`);
    usage(1);
  }
  return { ids, allowlist, dryRun };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'pokemon-champions-assistant-template-fetch/0.1' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Resolve CBD image_path + saved_name for a showdownId.
 * Prefers summary.primary.image_path; falls back to summary.sprite.
 */
async function resolveCbdSprite(showdownId) {
  const data = await fetchJson(`${CBD_ORIGIN}/api/pokemon/${encodeURIComponent(showdownId)}`);
  const summary = data.summary || {};
  const primary = summary.primary || {};
  const imagePath =
    primary.image_path ||
    summary.sprite ||
    (Array.isArray(summary.forms) && summary.forms[0] && summary.forms[0].image_path) ||
    null;
  const savedName =
    primary.saved_name ||
    (imagePath && path.basename(imagePath, '.png')) ||
    data.battleName ||
    data.name ||
    null;

  if (!imagePath) {
    throw new Error(`No image_path/sprite for showdownId=${showdownId}`);
  }
  // Guard: only CBD pokemon/ folder — never HOME / official-artwork / pokeapi
  const normalized = String(imagePath).replace(/^\/+/, '');
  if (!normalized.startsWith('pokemon_champions_assets/pokemon/')) {
    throw new Error(
      `Refusing non-CBD pokemon asset path for ${showdownId}: ${imagePath}`,
    );
  }
  if (/official-artwork|home\/|pokeapi\.co|raw\.githubusercontent\.com\/PokeAPI/i.test(normalized)) {
    throw new Error(`Refusing HOME/official-artwork URL for ${showdownId}`);
  }

  const urlSafe = `${CBD_ORIGIN}/${normalized
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;

  return {
    showdownId,
    savedName,
    imagePath: normalized,
    url: urlSafe,
    name: data.name || savedName,
    showdownName: data.showdownName || null,
  };
}

async function downloadPng(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pokemon-champions-assistant-template-fetch/0.1' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const ctype = res.headers.get('content-type') || '';
  if (ctype && !ctype.includes('image') && !ctype.includes('octet-stream')) {
    throw new Error(`Unexpected content-type ${ctype} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    // loose PNG magic check
    if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
      throw new Error(`Not a PNG (${buf.length} bytes) from ${url}`);
    }
  }
  fs.writeFileSync(dest, buf);
  return buf.length;
}

function loadExistingManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return new Map();
  const map = new Map();
  for (const line of fs.readFileSync(MANIFEST_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.showdownId) map.set(row.showdownId, row);
    } catch {
      /* skip bad line */
    }
  }
  return map;
}

function writeManifest(map) {
  const lines = [...map.values()]
    .sort((a, b) => String(a.showdownId).localeCompare(String(b.showdownId)))
    .map((row) => JSON.stringify(row));
  fs.writeFileSync(MANIFEST_PATH, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

async function main() {
  const { ids: rawIds, allowlist, dryRun } = parseArgs(process.argv.slice(2));
  if (!allowlist && rawIds.length === 0) {
    console.error('Refusing to run: pass --ids=... or --allowlist (no bulk dex crawl by default).');
    usage(1);
  }

  const ids = [...new Set(allowlist ? [...DEFAULT_ALLOWLIST, ...rawIds] : rawIds)];
  if (ids.length === 0) {
    console.error('Empty id list.');
    usage(1);
  }
  if (ids.length > MAX_IDS) {
    console.error(`Refusing ${ids.length} ids (max ${MAX_IDS}). Pass a small allowlist only.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = loadExistingManifest();
  let downloaded = 0;
  let skipped = 0;
  const results = [];

  console.log(`CBD fetch: ${ids.length} id(s) → ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`Rate limit: ${RATE_LIMIT_MS}ms; dryRun=${dryRun}`);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (i > 0) await sleep(RATE_LIMIT_MS);
    try {
      const meta = await resolveCbdSprite(id);
      const dest = path.join(OUT_DIR, `${id}.png`);
      console.log(`[${i + 1}/${ids.length}] ${id} → ${meta.imagePath}`);
      let bytes = 0;
      if (dryRun) {
        console.log(`  dry-run would GET ${meta.url}`);
      } else {
        bytes = await downloadPng(meta.url, dest);
        downloaded += 1;
        console.log(`  wrote ${path.relative(ROOT, dest)} (${bytes} bytes)`);
      }
      const row = {
        showdownId: id,
        source: 'cbd',
        savedName: meta.savedName,
        imagePath: meta.imagePath,
        url: meta.url,
        file: `${id}.png`,
        fetchedAt: new Date().toISOString(),
        bytes: dryRun ? null : bytes,
        note: 'CBD menu sprite — optional secondary; prefer public/templates/ ROI crops for Team Preview match',
      };
      manifest.set(id, row);
      results.push(row);
    } catch (err) {
      skipped += 1;
      console.error(`  FAIL ${id}: ${err.message || err}`);
      results.push({ showdownId: id, source: 'cbd', error: String(err.message || err) });
    }
  }

  if (!dryRun) writeManifest(manifest);

  console.log(`Done. downloaded=${downloaded} failed=${skipped} manifest=${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log('No bulk crawl: only the explicitly listed allowlist was requested.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
