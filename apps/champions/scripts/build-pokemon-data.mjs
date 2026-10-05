#!/usr/bin/env node
/**
 * Build offline Pokémon / move JSON for the Champions assistant.
 *
 * Sources:
 *   - Allowlist: data/allowlist.json (legal Champions forms / showdownIds;
 *                 build via scripts/map-legal-allowlist.mjs from data/legal-allowlist.json)
 *   - CBD index: https://championsbattledata.com/api/index
 *                (Doubles usage rank → --update-allowlist --top=N)
 *   - CBD API:   https://championsbattledata.com/api/pokemon/{showdownId}
 *   - CBD battle: https://championsbattledata.com/api/battle/Doubles/{showdownId}?season={latest}
 *                 (latest = /api/index battleDataFolders[0] / dailyDataFolders[0], e.g. M6 = Regulation M-C)
 *                 (+ ?days=7 fallback when Current CSV omits rank-1 moves)
 *   - PokéAPI:   national dex, classic base stats, types, abilities, forms, locales
 *
 * Outputs (canonical under data/, mirrored to public/data/ for Vite):
 *   data/pokemon.json  — array; nationalDex + forms[] (incl. Mega) + vgcDoublesMoves/Items
 *   data/moves.json    — move records referenced by allowlisted Pokémon
 *   data/meta.json     — schemaVersion, generatedAt, sources, counts
 *
 * Usage:
 *   node scripts/build-pokemon-data.mjs
 *   node scripts/build-pokemon-data.mjs --usage-only
 *   node scripts/build-pokemon-data.mjs --update-allowlist --top=50
 *   node scripts/build-pokemon-data.mjs --allowlist=data/allowlist.json
 *   node scripts/build-pokemon-data.mjs --dry-run
 *
 * See assets/CREDITS.md. Rate-limits PokéAPI / CBD politely. No bulk image scrape.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = 2;
const POKEAPI = 'https://pokeapi.co/api/v2';
const CBD_ORIGIN = 'https://championsbattledata.com';
const RATE_LIMIT_MS = 350;
const UA = 'pokemon-champions-assistant-data-build/0.1 (+https://github.com/f77f77/pokemon-champions-assistant)';

/** Explicit showdownId → PokéAPI species + default form pokemon endpoint. */
const SHOWDOWN_OVERRIDES = {
  lycanroc: { species: 'lycanroc', pokemon: 'lycanroc-midday' },
  lycanrocmidnight: { species: 'lycanroc', pokemon: 'lycanroc-midnight' },
  lycanrocdusk: { species: 'lycanroc', pokemon: 'lycanroc-dusk' },
  rotomwash: { species: 'rotom', pokemon: 'rotom-wash' },
  rotomheat: { species: 'rotom', pokemon: 'rotom-heat' },
  rotomfrost: { species: 'rotom', pokemon: 'rotom-frost' },
  rotomfan: { species: 'rotom', pokemon: 'rotom-fan' },
  rotommow: { species: 'rotom', pokemon: 'rotom-mow' },
  basculegion: { species: 'basculegion', pokemon: 'basculegion-male' },
  basculegionf: { species: 'basculegion', pokemon: 'basculegion-female' },
  mausholdfour: { species: 'maushold', pokemon: 'maushold-family-of-four' },
  maushold: { species: 'maushold', pokemon: 'maushold-family-of-four' },
  ninetalesalola: { species: 'ninetales', pokemon: 'ninetales-alola' },
  raichualola: { species: 'raichu', pokemon: 'raichu-alola' },
  persianalola: { species: 'persian', pokemon: 'persian-alola' },
  arcaninehisui: { species: 'arcanine', pokemon: 'arcanine-hisui' },
  kommoo: { species: 'kommo-o', pokemon: 'kommo-o' },
  vivillonfancy: { species: 'vivillon', pokemon: 'vivillon' },
  vivillon: { species: 'vivillon', pokemon: 'vivillon' },
  pyroar: { species: 'pyroar', pokemon: 'pyroar-male' },
  aegislash: { species: 'aegislash', pokemon: 'aegislash-shield' },
  mimikyu: { species: 'mimikyu', pokemon: 'mimikyu-disguised' },
  morpeko: { species: 'morpeko', pokemon: 'morpeko-full-belly' },
  palafin: { species: 'palafin', pokemon: 'palafin-zero' },
  mrmime: { species: 'mr-mime', pokemon: 'mr-mime' },
  mrrime: { species: 'mr-rime', pokemon: 'mr-rime' },
  floette: { species: 'floette', pokemon: 'floette-eternal' },
  meowstic: { species: 'meowstic', pokemon: 'meowstic-male' },
  meowsticf: { species: 'meowstic', pokemon: 'meowstic-female' },
  indeedee: { species: 'indeedee', pokemon: 'indeedee-male' },
  indeedeef: { species: 'indeedee', pokemon: 'indeedee-female' },
  toxtricity: { species: 'toxtricity', pokemon: 'toxtricity-amped' },
  toxtricitylowkey: { species: 'toxtricity', pokemon: 'toxtricity-low-key' },
  gourgeist: { species: 'gourgeist', pokemon: 'gourgeist-average' },
  gourgeistsmall: { species: 'gourgeist', pokemon: 'gourgeist-small' },
  gourgeistlarge: { species: 'gourgeist', pokemon: 'gourgeist-large' },
  gourgeistsuper: { species: 'gourgeist', pokemon: 'gourgeist-super' },
  squawkabilly: { species: 'squawkabilly', pokemon: 'squawkabilly-green-plumage' },
  squawkabillyblue: { species: 'squawkabilly', pokemon: 'squawkabilly-blue-plumage' },
  squawkabillyyellow: { species: 'squawkabilly', pokemon: 'squawkabilly-yellow-plumage' },
  squawkabillywhite: { species: 'squawkabilly', pokemon: 'squawkabilly-white-plumage' },
  taurospaldeacombat: { species: 'tauros', pokemon: 'tauros-paldea-combat-breed' },
  taurospaldeablaze: { species: 'tauros', pokemon: 'tauros-paldea-blaze-breed' },
  taurospaldeaaqua: { species: 'tauros', pokemon: 'tauros-paldea-aqua-breed' },
  slowbrogalar: { species: 'slowbro', pokemon: 'slowbro-galar' },
  slowkinggalar: { species: 'slowking', pokemon: 'slowking-galar' },
  stunfiskgalar: { species: 'stunfisk', pokemon: 'stunfisk-galar' },
  zoroarkhisui: { species: 'zoroark', pokemon: 'zoroark-hisui' },
  goodrahisui: { species: 'goodra', pokemon: 'goodra-hisui' },
  samurotthisui: { species: 'samurott', pokemon: 'samurott-hisui' },
  decidueyehisui: { species: 'decidueye', pokemon: 'decidueye-hisui' },
  avalugghisui: { species: 'avalugg', pokemon: 'avalugg-hisui' },
  typhlosionhisui: { species: 'typhlosion', pokemon: 'typhlosion-hisui' },
  vivillonfancy: { species: 'vivillon', pokemon: 'vivillon' },
  vivillon: { species: 'vivillon', pokemon: 'vivillon' },
};

/** PokéAPI pokemon name → CBD / Showdown id (best-effort). */
const POKEAPI_TO_SHOWDOWN = {
  'lycanroc-midday': 'lycanroc',
  'lycanroc-midnight': 'lycanrocmidnight',
  'lycanroc-dusk': 'lycanrocdusk',
  'rotom-wash': 'rotomwash',
  'rotom-heat': 'rotomheat',
  'rotom-frost': 'rotomfrost',
  'rotom-fan': 'rotomfan',
  'rotom-mow': 'rotommow',
  'basculegion-male': 'basculegion',
  'basculegion-female': 'basculegionf',
  'maushold-family-of-four': 'maushold',
  'maushold-family-of-three': 'mausholdthree',
  'ninetales-alola': 'ninetalesalola',
  'raichu-alola': 'raichualola',
  'persian-alola': 'persianalola',
  'arcanine-hisui': 'arcaninehisui',
  'kommo-o': 'kommoo',
  'floette-eternal': 'floette',
  'meowstic-male': 'meowstic',
  'meowstic-female': 'meowsticf',
  'indeedee-male': 'indeedee',
  'indeedee-female': 'indeedeef',
  'toxtricity-amped': 'toxtricity',
  'toxtricity-low-key': 'toxtricitylowkey',
  'gourgeist-average': 'gourgeist',
  'gourgeist-small': 'gourgeistsmall',
  'gourgeist-large': 'gourgeistlarge',
  'gourgeist-super': 'gourgeistsuper',
  'squawkabilly-green-plumage': 'squawkabilly',
  'squawkabilly-blue-plumage': 'squawkabillyblue',
  'squawkabilly-yellow-plumage': 'squawkabillyyellow',
  'squawkabilly-white-plumage': 'squawkabillywhite',
  'tauros-paldea-combat-breed': 'taurospaldeacombat',
  'tauros-paldea-blaze-breed': 'taurospaldeablaze',
  'tauros-paldea-aqua-breed': 'taurospaldeaaqua',
  'slowbro-galar': 'slowbrogalar',
  'slowking-galar': 'slowkinggalar',
  'stunfisk-galar': 'stunfiskgalar',
  'zoroark-hisui': 'zoroarkhisui',
  'goodra-hisui': 'goodrahisui',
  'samurott-hisui': 'samurotthisui',
  'decidueye-hisui': 'decidueyehisui',
  'avalugg-hisui': 'avalugghisui',
  'typhlosion-hisui': 'typhlosionhisui',
  'vivillon-fancy': 'vivillonfancy',
  'charizard-mega-x': 'charizard',
  'charizard-mega-y': 'charizard',
  'blastoise-mega': 'blastoise',
  'venusaur-mega': 'venusaur',
  'gengar-mega': 'gengar',
  'kangaskhan-mega': 'kangaskhan',
  'scizor-mega': 'scizor',
  'mawile-mega': 'mawile',
  'gardevoir-mega': 'gardevoir',
  'swampert-mega': 'swampert',
  'blaziken-mega': 'blaziken',
  'aerodactyl-mega': 'aerodactyl',
  'tyranitar-mega': 'tyranitar',
  'metagross-mega': 'metagross',
  'floette-mega': 'floette',
  'pyroar-mega': 'pyroar',
};


/** YYYY-MM-DD in Asia/Hong_Kong for usage source line. */
function formatUsageDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * CBD folder codes → Champions regulation names (site copy).
 * M4 = Regulation M-A, M5 = M-B, M6 = M-C, M7 = M-D, …
 * Never hardcode M5; resolve the latest folder from /api/index.
 */
function cbdFolderToRegulation(seasonCode) {
  const raw = String(seasonCode || '').trim();
  if (!raw || /^current$/i.test(raw)) return '';
  const m = raw.match(/^M(\d+)$/i);
  if (!m) return raw;
  const n = Number(m[1]);
  if (n >= 4 && n <= 26) return `Regulation M-${String.fromCharCode(64 + n - 3)}`;
  return `M${n}`;
}

function isNumberedCbdSeason(s) {
  return /^M\d+$/i.test(String(s || '').trim());
}

/** Newest regulation folder from /api/index — dailyDataFolders[0] or battleDataFolders[0] (M6 today). */
function pickLatestCbdSeason(index) {
  const daily = Array.isArray(index?.dailyDataFolders) ? index.dailyDataFolders : [];
  const folders = Array.isArray(index?.battleDataFolders) ? index.battleDataFolders : [];
  const seasons = Array.isArray(index?.seasons) ? index.seasons : [];
  const fromDaily = String(daily[0] || '').split('/')[0];
  return (
    (isNumberedCbdSeason(fromDaily) && fromDaily) ||
    folders.find(isNumberedCbdSeason) ||
    seasons.find(isNumberedCbdSeason) ||
    String(index?.defaultSeason || 'Current')
  );
}

const cbdSeason = {
  season: '',
  regulation: '',
  defaultSeason: '',
  resolved: false,
};

async function ensureCbdSeason() {
  if (cbdSeason.resolved) return cbdSeason;
  const index = await rateLimitedJson(`${CBD_ORIGIN}/api/index`);
  const season = pickLatestCbdSeason(index);
  cbdSeason.season = season;
  cbdSeason.regulation = cbdFolderToRegulation(season);
  cbdSeason.defaultSeason = String(index?.defaultSeason || '');
  cbdSeason.resolved = true;
  console.log(
    `CBD regulation: season=${season} (${cbdSeason.regulation || 'unmapped'}) · index.defaultSeason=${cbdSeason.defaultSeason} · battleDataFolders[0]=${(index.battleDataFolders || [])[0]} · daily[0]=${(index.dailyDataFolders || [])[0]}`,
  );
  if (/^current$/i.test(cbdSeason.defaultSeason) && isNumberedCbdSeason(season)) {
    console.log(
      '  note: defaultSeason Current currently matches the latest numbered folder row-for-row; we still pass ?season= so M-B/M5 is never implied.',
    );
  }
  return cbdSeason;
}

function formatUsageSourceLabel(d = new Date()) {
  const reg = cbdSeason.regulation ? ` · ${cbdSeason.regulation}` : '';
  return `VGC Doubles (2v2 / 6-pick-4)${reg} · championsbattledata.com · 更新 ${formatUsageDate(d)}`;
}

function doublesBattleUrl(showdownId, { days } = {}) {
  const params = new URLSearchParams();
  if (cbdSeason.season) params.set('season', cbdSeason.season);
  if (days) params.set('days', String(days));
  const q = params.toString();
  return `${CBD_ORIGIN}/api/battle/Doubles/${encodeURIComponent(showdownId)}${q ? `?${q}` : ''}`;
}

function usageSourceUrls() {
  const seasonQ = cbdSeason.season ? `?season=${encodeURIComponent(cbdSeason.season)}` : '';
  const daysQ = cbdSeason.season
    ? `?season=${encodeURIComponent(cbdSeason.season)}&days=7`
    : '?days=7';
  return {
    cbdDoublesBattle: `${CBD_ORIGIN}/api/battle/Doubles/{showdownId}${seasonQ}`,
    cbdDoublesBattleDays: `${CBD_ORIGIN}/api/battle/Doubles/{showdownId}${daysQ}`,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  let allowlistPath = path.join(ROOT, 'data/allowlist.json');
  let dryRun = false;
  let updateAllowlist = false;
  let usageOnly = false;
  let flavorOnly = false;
  let topN = 50;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--update-allowlist') updateAllowlist = true;
    else if (a === '--usage-only') usageOnly = true;
    else if (a === '--flavor-only') flavorOnly = true;
    else if (a === '--top' || a.startsWith('--top=')) {
      const raw = a.startsWith('--top=') ? a.slice('--top='.length) : argv[++i];
      topN = Math.max(1, Number(raw) || 50);
    } else if (a === '--allowlist' || a.startsWith('--allowlist=')) {
      const raw = a.startsWith('--allowlist=') ? a.slice('--allowlist='.length) : argv[++i];
      allowlistPath = path.resolve(ROOT, raw);
    } else if (a === '--help' || a === '-h') {
      console.log(
        `Usage: node scripts/build-pokemon-data.mjs [--allowlist=data/allowlist.json] [--update-allowlist] [--top=50] [--usage-only] [--flavor-only] [--dry-run]`,
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return { allowlistPath, dryRun, updateAllowlist, usageOnly, flavorOnly, topN };
}

/**
 * Allowlist shapes:
 *  - string[] / { showdownIds: string[] }
 *  - { entries: [{ showdownId, pokemonSlug?, formKey?, nationalDex?, ... }] }
 * Returns { ids: string[], entryById: Map<string, object> }
 */
function readAllowlist(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const entryById = new Map();
  if (Array.isArray(raw?.entries)) {
    for (const e of raw.entries) {
      const sid = String(e.showdownId || '').trim().toLowerCase();
      if (!sid) continue;
      if (!entryById.has(sid)) entryById.set(sid, e);
    }
  }
  const ids = Array.isArray(raw)
    ? raw
    : raw.showdownIds || raw.ids || [...entryById.keys()];
  const cleaned = [...new Set(ids.map((id) => String(id).trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) throw new Error(`Empty allowlist: ${filePath}`);
  // Ensure entryById covers plain id lists
  for (const id of cleaned) {
    if (!entryById.has(id)) entryById.set(id, { showdownId: id });
  }
  return { ids: cleaned, entryById };
}

async function fetchJson(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        await sleep(RATE_LIMIT_MS * (attempt + 2));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await sleep(RATE_LIMIT_MS * (attempt + 2));
    }
  }
  throw lastErr || new Error(`HTTP retry exhausted for ${url}`);
}

let lastFetch = 0;
async function rateLimitedJson(url) {
  const wait = RATE_LIMIT_MS - (Date.now() - lastFetch);
  if (wait > 0) await sleep(wait);
  lastFetch = Date.now();
  return fetchJson(url);
}

async function rateLimitedJsonOptional(url) {
  try {
    return await rateLimitedJson(url);
  } catch (err) {
    console.warn(`  optional miss: ${err.message || err}`);
    return null;
  }
}

/** PokéAPI language name → output locale key. */
function pickFlavor(entries) {
  const byLang = { en: null, 'zh-Hant': null, ja: null };
  for (const e of entries || []) {
    const lang = e.language?.name;
    const text = String(e.flavor_text || '')
      .replace(/\f/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    if (lang === 'en') byLang.en = text;
    else if (lang === 'zh-Hant' || lang === 'zh-hant') byLang['zh-Hant'] = text;
    else if (lang === 'ja' || lang === 'ja-Hrkt' || lang === 'ja-hrkt') byLang.ja = text;
  }
  return byLang;
}

function pickNames(nameEntries) {
  const byLang = new Map();
  for (const n of nameEntries || []) {
    byLang.set(n.language.name, n.name);
  }
  return {
    en: byLang.get('en') || null,
    'zh-Hant': byLang.get('zh-hant') || byLang.get('zh-Hant') || null,
    ja: byLang.get('ja') || byLang.get('ja-Hrkt') || byLang.get('ja-hrkt') || null,
  };
}

function mapStats(statsArr) {
  const get = (n) => statsArr.find((s) => s.stat.name === n)?.base_stat ?? 0;
  return {
    hp: get('hp'),
    atk: get('attack'),
    def: get('defense'),
    spa: get('special-attack'),
    spd: get('special-defense'),
    spe: get('speed'),
  };
}

function resolvePokeapiTargets(showdownId) {
  const o = SHOWDOWN_OVERRIDES[showdownId];
  if (o) return o;
  // Heuristic: ninetalesalola → try ninetales-alola via hyphenation of known suffixes
  return { species: showdownId, pokemon: showdownId };
}

function pokeapiNameToShowdownId(pokeName) {
  if (POKEAPI_TO_SHOWDOWN[pokeName]) return POKEAPI_TO_SHOWDOWN[pokeName];
  // mega-x/y / regional: strip hyphens for showdown-ish id
  return String(pokeName).replace(/-/g, '');
}

function isSkippedVariety(pokeName) {
  const n = String(pokeName).toLowerCase();
  return n.includes('-gmax') || n.includes('-totem') || n.includes('-battle-bond');
}

/** "Dragon Pulse" / "Double-Edge" → pokeapi slug */
function toPokeapiMoveSlug(displayName) {
  return String(displayName)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Showdown-style move id: dragonpulse */
function toShowdownMoveId(displayName) {
  return String(displayName)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

async function pushMegaVariety(forms, have, vName, parentShowdownId, doublesCache) {
  const key = String(vName || '').toLowerCase();
  if (!key || have.has(key)) return false;
  try {
    const formEntry = await loadFormEntry(vName, parentShowdownId, doublesCache);
    formEntry.formNames = megaFormLabel(vName);
    formEntry.isDefault = false;
    formEntry.showdownId = parentShowdownId;
    forms.push(formEntry);
    have.add(key);
    console.log(`  + mega form ${vName}`);
    return true;
  } catch (err) {
    console.warn(`  mega skip ${vName}: ${err.message || err}`);
    return false;
  }
}

async function attachMegaForms(forms, species, parentShowdownId, doublesCache, parentFormKey, megaStoneHint = false) {
  const varieties = Array.isArray(species?.varieties) ? species.varieties : [];
  const have = new Set(forms.map((f) => String(f.formKey || '').toLowerCase()));
  const parentKey = parentFormKey || forms[0]?.formKey || '';
  for (const v of varieties) {
    const vName = v?.pokemon?.name;
    if (!vName || !isMegaPokemonName(vName) || have.has(vName.toLowerCase())) continue;
    if (!megaBelongsToForm(vName, parentKey)) continue;
    await pushMegaVariety(forms, have, vName, parentShowdownId, doublesCache);
  }
  // Own mega stone in CBD usage but forms[] still lacks Mega (Eternal Flower / Pyroar-M).
  if (!recordHasMegaForm(forms) && megaStoneHint) {
    const speciesName = String(species?.name || parentShowdownId || '').toLowerCase();
    const guesses = [`${speciesName}-mega`, `${parentKey}-mega`].filter(Boolean);
    for (const g of guesses) {
      if (have.has(g)) continue;
      const ok = await pushMegaVariety(forms, have, g, parentShowdownId, doublesCache);
      if (ok) break;
    }
  }
}

async function localizeItemRows(itemRows, itemCache) {
  if (!Array.isArray(itemRows) || !itemRows.length) return itemRows || [];
  const out = [];
  for (const row of itemRows) {
    const slug = row.id || toPokeapiMoveSlug(row.nameEn);
    let rec = itemCache.get(slug);
    if (!rec) {
      try {
        const data = await rateLimitedJson(`${POKEAPI}/item/${encodeURIComponent(slug)}`);
        rec = { slug, names: pickNames(data.names) };
      } catch {
        rec = { slug, names: { en: row.nameEn, 'zh-Hant': null, ja: null } };
      }
      itemCache.set(slug, rec);
    }
    out.push({
      ...row,
      nameZh: rec.names?.['zh-Hant'] || row.nameEn,
    });
  }
  return out;
}

async function fetchCbdPokemon(showdownId) {
  try {
    return await rateLimitedJson(`${CBD_ORIGIN}/api/pokemon/${encodeURIComponent(showdownId)}`);
  } catch (err) {
    console.warn(`  CBD miss for ${showdownId}: ${err.message || err}`);
    return null;
  }
}

function parsePct(row) {
  const usageRaw = row?.percentage_value ?? row?.percentage;
  if (typeof usageRaw === 'number' && Number.isFinite(usageRaw)) return usageRaw;
  if (usageRaw != null && String(usageRaw).trim()) {
    const n = Number.parseFloat(String(usageRaw).replace(/%/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n.toFixed(1).replace(/\.0$/, '')}%`;
}

function categoryRows(data, category) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return rows.filter((r) => r && r.category === category && r.name);
}

function movesLookComplete(moveRows) {
  if (!moveRows.length) return false;
  const ranks = moveRows.map((r) => Number(r.rank) || 99);
  return Math.min(...ranks) <= 1;
}

function toUsageRows(raw, { asItem = false, limit = 6 } = {}) {
  const mapped = raw.map((r) => {
    const pct = parsePct(r);
    const nameEn = String(r.name);
    return {
      id: asItem ? toPokeapiMoveSlug(nameEn) : toShowdownMoveId(nameEn),
      nameEn,
      usage: formatPct(pct),
      rank: Number(r.rank) || null,
      _pct: pct ?? Number.NEGATIVE_INFINITY,
    };
  });
  mapped.sort((a, b) => b._pct - a._pct || (a.rank ?? 99) - (b.rank ?? 99));
  return mapped.slice(0, limit).map(({ _pct, ...rest }) => rest);
}

function megaFormLabel(pokemonName) {
  const n = String(pokemonName).toLowerCase();
  if (n.endsWith('-mega-x')) return { en: 'Mega X', 'zh-Hant': 'Mega X', ja: 'メガX' };
  if (n.endsWith('-mega-y')) return { en: 'Mega Y', 'zh-Hant': 'Mega Y', ja: 'メガY' };
  return { en: 'Mega', 'zh-Hant': 'Mega', ja: 'メガ' };
}

function isMegaPokemonName(name) {
  const n = String(name || '').toLowerCase();
  return n.includes('-mega') && !n.includes('-gmax') && !n.includes('-z');
}

const REGIONAL_FORM_RE = /-(alola|galar|hisui|paldea)(?:-|$)/;

/** Mega X/Y/base must belong to this form slug (do not hang Kanto megas on Alolan records). */
function megaBelongsToForm(megaName, parentFormKey) {
  const mega = String(megaName || '').toLowerCase();
  const parent = String(parentFormKey || '').toLowerCase();
  if (!parent || !mega) return false;
  if (mega === `${parent}-mega` || mega.startsWith(`${parent}-mega-`)) return true;
  // Species-level mega (floette-mega, pyroar-mega) attaches to the Champions
  // legal form (floette-eternal, pyroar-male) — not to regional siblings.
  const megaBase = mega.replace(/-mega(?:-x|-y)?$/, '');
  if (!megaBase || megaBase === mega) return false;
  if (REGIONAL_FORM_RE.test(parent) && !REGIONAL_FORM_RE.test(mega)) return false;
  return parent === megaBase || parent.startsWith(`${megaBase}-`);
}

function compactIdent(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[-_ ]+/g, '');
}

/** Floettite → floette, Pyroarite → pyroar. Ignore another species' stone (e.g. Greninjite on Simisear). */
function itemIsOwnMegaStone(item, speciesKey, formKey) {
  const id = compactIdent(item?.id || item?.nameEn || '');
  if (!id || /eviolite/.test(id)) return false;
  const stems = new Set();
  for (const raw of [speciesKey, formKey]) {
    const compact = compactIdent(raw);
    if (!compact) continue;
    stems.add(compact);
    const stripped = compact.replace(/(male|female|eternal|midday|midnight|dusk|alola|galar|hisui|paldea)$/, '');
    if (stripped.length >= 4) stems.add(stripped);
  }
  for (const stem of stems) {
    if (stem.length < 4) continue;
    if (id === `${stem}ite` || id.startsWith(`${stem}ite`)) return true;
  }
  return false;
}

function recordHasMegaForm(forms) {
  return (forms || []).some((f) => isMegaPokemonName(f.formKey));
}

function recordMegaStoneHint(rec) {
  const items = [...(rec?.vgcDoublesItems || []), ...(rec?.forms || []).flatMap((f) => f.vgcDoublesItems || [])];
  return items.some((it) => itemIsOwnMegaStone(it, rec.showdownId, rec.formKey));
}

/**
 * VGC Doubles (2v2 / 6-pick-4) top moves + held items from CBD battle API.
 * Current CSVs sometimes omit ranks 1–5 (right-column only). When that happens,
 * fall back to the newest ?days=7 snapshot that still has a rank-1 move.
 * Always sort by usage % descending — table `rank` is column position, not %.
 */
async function fetchCbdDoublesUsage(showdownId, { moveLimit = 6, itemLimit = 10 } = {}) {
  try {
    await ensureCbdSeason();
    const current = await rateLimitedJsonOptional(doublesBattleUrl(showdownId));
    let chosen = current;
    let chosenMoves = categoryRows(current, 'move');
    if (!movesLookComplete(chosenMoves)) {
      const dailyPack = await rateLimitedJsonOptional(doublesBattleUrl(showdownId, { days: 7 }));
      const days = Array.isArray(dailyPack?.daily) ? dailyPack.daily : [];
      for (const day of days) {
        const m = categoryRows(day, 'move');
        if (movesLookComplete(m)) {
          chosen = day;
          chosenMoves = m;
          console.log(
            `  Doubles fallback ${showdownId}: ${day.date || day.source || 'daily'} (${cbdSeason.season} CSV missing rank-1 moves)`,
          );
          break;
        }
      }
    }
    if (!chosen) return { moves: [], items: [], meta: null };
    const items = categoryRows(chosen, 'held_item');
    return {
      moves: toUsageRows(chosenMoves, { limit: moveLimit }),
      items: toUsageRows(items, { asItem: true, limit: itemLimit }),
      meta: {
        source: 'championsbattledata.com',
        format: 'Doubles',
        season: chosen.season ?? cbdSeason.season ?? current?.season ?? 'Current',
        regulation: cbdSeason.regulation || null,
        battleSource: chosen.source ?? current?.source ?? null,
        usageSnapshot: chosen.date || 'current',
        label: formatUsageSourceLabel(new Date()),
      },
    };
  } catch (err) {
    console.warn(`  CBD Doubles battle miss for ${showdownId}: ${err.message || err}`);
    return { moves: [], items: [], meta: null };
  }
}

async function fetchCbdDoublesTopMoves(showdownId, limit = 6) {
  const { moves, items, meta } = await fetchCbdDoublesUsage(showdownId, { moveLimit: limit });
  return { moves, items, meta };
}

/**
 * Top-N showdownIds by CBD Current Doubles usage position from /api/index.
 * No image scrape — JSON index only.
 */
async function fetchTopDoublesFromCbdIndex(topN) {
  console.log(`Fetching CBD /api/index for top ${topN} Doubles…`);
  const index = await rateLimitedJson(`${CBD_ORIGIN}/api/index`);
  const rows = [];
  for (const p of index.pokemon || []) {
    const bs = p?.summary?.battleSummary?.Current?.Doubles;
    const pos = bs?.position;
    if (pos == null) continue;
    const sid = String(p.showdownId || '').trim().toLowerCase();
    if (!sid) continue;
    rows.push({
      rank: Number(pos),
      showdownId: sid,
      name: p.name || p.showdownName || sid,
    });
  }
  rows.sort((a, b) => a.rank - b.rank);
  const seen = new Set();
  const ranked = [];
  for (const r of rows) {
    if (seen.has(r.showdownId)) continue;
    seen.add(r.showdownId);
    ranked.push(r);
    if (ranked.length >= topN) break;
  }
  return ranked;
}

function writeAllowlist(filePath, ranked, topN) {
  const payload = {
    description:
      'Champions / Showdown IDs — top N by CBD Doubles (Current) usage position. Refresh: node scripts/build-pokemon-data.mjs --update-allowlist --top=50. Usage % from CBD Doubles (2v2 / 6-pick-4).',
    source: `${CBD_ORIGIN}/api/index → summary.battleSummary.Current.Doubles.position`,
    format: 'Doubles',
    topN,
    ranked,
    showdownIds: ranked.map((r) => r.showdownId),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`wrote allowlist ${path.relative(ROOT, filePath)} (${ranked.length} ids)`);
}

async function loadFormEntry(varietyPokemonName, cbdShowdownId, doublesCache) {
  const pokemonData = await rateLimitedJson(
    `${POKEAPI}/pokemon/${encodeURIComponent(varietyPokemonName)}`,
  );
  let formNames = { en: null, 'zh-Hant': null, ja: null };
  const formUrl = pokemonData.forms?.[0]?.url;
  if (formUrl) {
    try {
      const form = await rateLimitedJson(formUrl);
      formNames = pickNames(form.form_names);
      if (!formNames.en && !formNames['zh-Hant'] && !formNames.ja) {
        // Derive a readable label from the pokemon name suffix
        const suffix = varietyPokemonName.includes('-')
          ? varietyPokemonName.split('-').slice(1).join(' ')
          : 'Base';
        formNames = {
          en: suffix.replace(/\b\w/g, (c) => c.toUpperCase()),
          'zh-Hant': null,
          ja: null,
        };
      }
    } catch (err) {
      console.warn(`  form names skip (${varietyPokemonName}): ${err.message || err}`);
    }
  }

  let vgcDoublesMoves;
  let vgcDoublesItems;
  let vgcDoublesMeta;
  if (cbdShowdownId) {
    if (!doublesCache.has(cbdShowdownId)) {
      doublesCache.set(cbdShowdownId, await fetchCbdDoublesUsage(cbdShowdownId));
    }
    const { moves, items, meta } = doublesCache.get(cbdShowdownId);
    if (moves?.length) {
      vgcDoublesMoves = moves;
      vgcDoublesMeta = meta;
    }
    if (items?.length) vgcDoublesItems = items;
  }

  return {
    showdownId: cbdShowdownId || pokeapiNameToShowdownId(varietyPokemonName),
    pokeapiId: pokemonData.id,
    formKey: pokemonData.name,
    formNames,
    types: (pokemonData.types || [])
      .sort((a, b) => a.slot - b.slot)
      .map((t) => t.type.name),
    baseStats: mapStats(pokemonData.stats || []),
    abilities: (pokemonData.abilities || [])
      .sort((a, b) => a.slot - b.slot)
      .map((a) => a.ability.name),
    isDefault: Boolean(pokemonData.is_default),
    ...(vgcDoublesMoves ? { vgcDoublesMoves, vgcDoublesMeta } : {}),
    ...(vgcDoublesItems ? { vgcDoublesItems } : {}),
  };
}

async function buildPokemonRecord(showdownId, doublesCache, entryHint = null) {
  let speciesSlug;
  let pokemonSlug;
  if (entryHint?.pokemonSlug) {
    pokemonSlug = entryHint.pokemonSlug;
    speciesSlug = entryHint.speciesKey || resolvePokeapiTargets(showdownId).species;
  } else {
    ({ species: speciesSlug, pokemon: pokemonSlug } = resolvePokeapiTargets(showdownId));
  }
  console.log(`  PokéAPI species=${speciesSlug} pokemon=${pokemonSlug}`);

  let species = await rateLimitedJsonOptional(
    `${POKEAPI}/pokemon-species/${encodeURIComponent(speciesSlug)}`,
  );
  let pokemonData = await rateLimitedJsonOptional(
    `${POKEAPI}/pokemon/${encodeURIComponent(pokemonSlug)}`,
  );

  // Fallback: try hyphenated regional / form guesses if identity mapping 404'd
  if (!pokemonData && !SHOWDOWN_OVERRIDES[showdownId]) {
    const guesses = [];
    // trailing regional tokens
    for (const [suffix, hyph] of [
      ['alola', '-alola'],
      ['galar', '-galar'],
      ['hisui', '-hisui'],
      ['paldea', '-paldea'],
    ]) {
      if (showdownId.endsWith(suffix) && showdownId.length > suffix.length) {
        guesses.push(showdownId.slice(0, -suffix.length) + hyph);
      }
    }
    for (const g of guesses) {
      pokemonData = await rateLimitedJsonOptional(`${POKEAPI}/pokemon/${encodeURIComponent(g)}`);
      if (pokemonData) {
        const spUrl = pokemonData.species?.url;
        if (spUrl) species = await rateLimitedJsonOptional(spUrl);
        break;
      }
    }
  }

  if (!pokemonData || !species) {
    throw new Error(`PokéAPI resolve failed for showdownId=${showdownId}`);
  }

  const cbdData = await fetchCbdPokemon(showdownId);

  let formNames = { en: null, 'zh-Hant': null, ja: null };
  const preferredFormKey = entryHint?.formKey || null;
  let formUrl = null;
  if (preferredFormKey) {
    const hit = (pokemonData.forms || []).find((f) => f.name === preferredFormKey);
    formUrl = hit?.url || `${POKEAPI}/pokemon-form/${encodeURIComponent(preferredFormKey)}`;
  } else {
    formUrl = pokemonData.forms?.[0]?.url;
  }
  if (formUrl) {
    try {
      const form = await rateLimitedJson(formUrl);
      formNames = pickNames(form.form_names);
      if (!formNames.en && !formNames['zh-Hant'] && !formNames.ja) {
        formNames = { en: null, 'zh-Hant': null, ja: null };
      }
    } catch (err) {
      console.warn(`  form names skip: ${err.message || err}`);
    }
  }

  const names = pickNames(species.names);
  if (entryHint?.zhHant) {
    const zh = String(entryHint.zhHant);
    const m = zh.match(/^[^(（]+\s*[（(](.+?)[)）]\s*$/);
    const baseZh = zh.replace(/\s*[（(].*$/, '').trim();
    if (baseZh) names['zh-Hant'] = baseZh;
    if (m && m[1] && !formNames['zh-Hant']) {
      formNames = { ...formNames, 'zh-Hant': m[1].trim() };
    }
  }
  const formKey = preferredFormKey || pokemonData.name;
  const speciesKey = species.name;
  const nationalDex = species.id;

  const record = {
    showdownId,
    nationalDex,
    pokeapiId: pokemonData.id,
    speciesKey,
    formKey,
    names,
    formNames,
    types: (pokemonData.types || [])
      .sort((a, b) => a.slot - b.slot)
      .map((t) => t.type.name),
    baseStats: mapStats(pokemonData.stats || []),
    abilities: (pokemonData.abilities || [])
      .sort((a, b) => a.slot - b.slot)
      .map((a) => a.ability.name),
    // Allowlist membership (this record exists because the id is legal).
    // CBD fetch may fail; that only omits vgcDoublesMoves — never hide from pickers.
    championsLegal: true,
  };

  const moveNames = Array.isArray(cbdData?.learnableMoveNames)
    ? [...cbdData.learnableMoveNames]
    : (pokemonData.moves || []).map((m) => m.move.name);

  if (!doublesCache.has(showdownId)) {
    doublesCache.set(showdownId, await fetchCbdDoublesUsage(showdownId));
  }
  const { moves: doublesMoves, items: doublesItems, meta: doublesMeta } = doublesCache.get(showdownId);
  if (doublesMoves.length) {
    record.vgcDoublesMoves = doublesMoves;
    record.vgcDoublesMeta = doublesMeta;
    for (const m of doublesMoves) {
      if (m.nameEn && !moveNames.includes(m.nameEn)) moveNames.push(m.nameEn);
    }
  }
  if (doublesItems?.length) record.vgcDoublesItems = doublesItems;

  // Forms list: skip full variety crawl in legal-form mode (entry has pokemonSlug) for speed.
  // Still attach a single self form so UI form metadata stays available.
  const forms = [];
  if (entryHint?.pokemonSlug) {
    try {
      const formEntry = await loadFormEntry(pokemonData.name, showdownId, doublesCache);
      if (entryHint.formKey) formEntry.formKey = entryHint.formKey;
      forms.push(formEntry);
    } catch (err) {
      console.warn(`  self-form skip: ${err.message || err}`);
    }
  } else {
    const varieties = Array.isArray(species.varieties) ? species.varieties : [];
    for (const v of varieties) {
      const vName = v?.pokemon?.name;
      if (!vName || isSkippedVariety(vName)) continue;
      try {
        const cbdId = pokeapiNameToShowdownId(vName);
        const formEntry = await loadFormEntry(vName, cbdId, doublesCache);
        forms.push(formEntry);
        if (formEntry.vgcDoublesMoves) {
          for (const m of formEntry.vgcDoublesMoves) {
            if (m.nameEn && !moveNames.includes(m.nameEn)) moveNames.push(m.nameEn);
          }
        }
      } catch (err) {
        console.warn(`  variety skip ${vName}: ${err.message || err}`);
      }
    }
  }
  await attachMegaForms(
    forms,
    species,
    showdownId,
    doublesCache,
    record.formKey,
    recordMegaStoneHint(record),
  );
  if (forms.length) {
    record.forms = forms;
  }
  if (entryHint?.id) record.championsId = entryHint.id;
  if (entryHint?.zhHant && !record.names['zh-Hant']) {
    record.names['zh-Hant'] = entryHint.zhHant;
  }

  return {
    record,
    moveNames,
    fromCbdMoves: Boolean(cbdData?.learnableMoveNames),
    doublesCount: doublesMoves.length,
  };
}

async function buildMoveRecord(displayOrSlug, cache) {
  const slug =
    displayOrSlug.includes('-') && !displayOrSlug.includes(' ')
      ? displayOrSlug
      : toPokeapiMoveSlug(displayOrSlug);
  const moveId =
    displayOrSlug.includes(' ') || /[A-Z]/.test(displayOrSlug)
      ? toShowdownMoveId(displayOrSlug)
      : slug.replace(/-/g, '');

  if (cache.has(moveId)) return cache.get(moveId);

  try {
    const data = await rateLimitedJson(`${POKEAPI}/move/${encodeURIComponent(slug)}`);
    const rec = {
      id: data.name.replace(/-/g, ''),
      pokeapiId: data.id,
      names: pickNames(data.names),
      type: data.type?.name ?? null,
      category: data.damage_class?.name ?? null,
      power: data.power,
      accuracy: data.accuracy,
      pp: data.pp,
      flavor: pickFlavor(data.flavor_text_entries),
    };
    cache.set(rec.id, rec);
    return rec;
  } catch (err) {
    console.warn(`  move miss ${slug}: ${err.message || err}`);
    const rec = {
      id: moveId,
      pokeapiId: null,
      names: { en: displayOrSlug, 'zh-Hant': null, ja: null },
      type: null,
      category: null,
      power: null,
      accuracy: null,
      pp: null,
      flavor: { en: null, 'zh-Hant': null, ja: null },
    };
    cache.set(rec.id, rec);
    return rec;
  }
}

function writeOutputs({ pokemon, moves, meta }, dryRun) {
  const payloads = {
    'pokemon.json': pokemon,
    'moves.json': moves,
    'meta.json': meta,
  };
  const targets = [path.join(ROOT, 'data'), path.join(ROOT, 'public/data')];
  for (const dir of targets) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, value] of Object.entries(payloads)) {
      const out = path.join(dir, name);
      const text = JSON.stringify(value, null, 2) + '\n';
      if (dryRun) {
        console.log(`dry-run would write ${path.relative(ROOT, out)} (${text.length} bytes)`);
      } else {
        fs.writeFileSync(out, text, 'utf8');
        console.log(`wrote ${path.relative(ROOT, out)}`);
      }
    }
  }
}

async function localizeAllItems(pokemon) {
  const cache = new Map();
  for (const rec of pokemon) {
    if (rec.vgcDoublesItems) rec.vgcDoublesItems = await localizeItemRows(rec.vgcDoublesItems, cache);
    if (Array.isArray(rec.forms)) {
      for (const f of rec.forms) {
        if (f.vgcDoublesItems) f.vgcDoublesItems = await localizeItemRows(f.vgcDoublesItems, cache);
      }
    }
  }
}

async function applyUsageToRecord(rec, doublesCache, speciesCache) {
  const sid = rec.showdownId;
  if (!doublesCache.has(sid)) doublesCache.set(sid, await fetchCbdDoublesUsage(sid));
  const usage = doublesCache.get(sid);
  if (usage.moves.length) rec.vgcDoublesMoves = usage.moves;
  if (usage.items.length) rec.vgcDoublesItems = usage.items;
  if (usage.meta) rec.vgcDoublesMeta = usage.meta;
  if (Array.isArray(rec.forms)) {
    for (const f of rec.forms) {
      const fsid = f.showdownId || sid;
      if (!doublesCache.has(fsid)) doublesCache.set(fsid, await fetchCbdDoublesUsage(fsid));
      const u = doublesCache.get(fsid) || usage;
      if (u.moves.length) f.vgcDoublesMoves = u.moves;
      if (u.items.length) f.vgcDoublesItems = u.items;
      if (u.meta) f.vgcDoublesMeta = u.meta;
    }
  }
  const speciesKey = rec.speciesKey || sid;
  let species = speciesCache.get(speciesKey);
  if (!species) {
    species = await rateLimitedJsonOptional(`${POKEAPI}/pokemon-species/${encodeURIComponent(speciesKey)}`);
    speciesCache.set(speciesKey, species);
  }
  if (!rec.forms) rec.forms = [];
  await attachMegaForms(
    rec.forms,
    species,
    sid,
    doublesCache,
    rec.formKey,
    recordMegaStoneHint(rec),
  );
}

async function refreshUsageOnly({ dryRun, allowlistPath }) {
  const pokemonPath = path.join(ROOT, 'data/pokemon.json');
  const movesPath = path.join(ROOT, 'data/moves.json');
  const pokemon = JSON.parse(fs.readFileSync(pokemonPath, 'utf8'));
  const existingMoves = JSON.parse(fs.readFileSync(movesPath, 'utf8'));
  console.log(`usage-only: ${pokemon.length} pokemon from ${path.relative(ROOT, pokemonPath)}`);
  await ensureCbdSeason();
  const doublesCache = new Map();
  const speciesCache = new Map();
  const moveNameSet = new Map();
  const usageFetchedAt = new Date();
  let i = 0;
  for (const rec of pokemon) {
    i += 1;
    console.log(`[usage ${i}/${pokemon.length}] ${rec.showdownId}`);
    try {
      await applyUsageToRecord(rec, doublesCache, speciesCache);
    } catch (err) {
      console.error(`  FAILED ${rec.showdownId}: ${err.message || err}`);
    }
    for (const m of rec.vgcDoublesMoves || []) {
      if (m.nameEn && !moveNameSet.has(m.id)) moveNameSet.set(m.id, m.nameEn);
    }
  }
  await localizeAllItems(pokemon);
  const moveCache = new Map();
  for (const m of existingMoves) if (m?.id) moveCache.set(m.id, m);
  const moves = [...existingMoves];
  for (const [, label] of moveNameSet) {
    const rec = await buildMoveRecord(label, moveCache);
    if (!moves.find((m) => m.id === rec.id)) moves.push(rec);
  }
  moves.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const generatedAt = new Date();
  const usageUpdatedAt = formatUsageDate(usageFetchedAt);
  const battleUrls = usageSourceUrls();
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    updatedAt: formatUsageDate(generatedAt),
    usageUpdatedAt,
    usageSourceLabel: formatUsageSourceLabel(usageFetchedAt),
    usageSeason: cbdSeason.season || null,
    usageRegulation: cbdSeason.regulation || null,
    sources: {
      pokeapi: POKEAPI,
      cbd: `${CBD_ORIGIN}/api/pokemon/{showdownId}`,
      cbdDoublesBattle: battleUrls.cbdDoublesBattle,
      cbdDoublesBattleDays: battleUrls.cbdDoublesBattleDays,
      cbdIndex: `${CBD_ORIGIN}/api/index`,
      allowlist: path.relative(ROOT, allowlistPath).replace(/\\/g, '/'),
      legalAllowlist: 'data/legal-allowlist.json',
      notes:
        'Classic PokéAPI base stats + nationalDex + forms[] including Mega (not CBD screen-scaled). Move/item usage % from CBD VGC Doubles (2v2 / 6-pick-4) for the latest regulation folder from /api/index (battleDataFolders[0] / dailyDataFolders[0], currently M6 = Regulation M-C). Explicit ?season= on battle URLs (Current matches that folder today; M5 is Regulation M-B). Sorted highest-first; rank-1 gaps filled from newest complete daily snapshot. Locale keys: en / zh-Hant / ja. See assets/CREDITS.md.',
    },
    pokemonCount: pokemon.length,
    movesCount: moves.length,
    allowlistCount: pokemon.length,
    usageMode: 'usage-only',
  };
  writeOutputs({ pokemon, moves, meta }, dryRun);
  console.log(`Done (usage-only). pokemon=${pokemon.length} moves=${moves.length}`);
}

async function refreshFlavorOnly({ dryRun }) {
  const movesPath = path.join(ROOT, 'data/moves.json');
  const metaPath = path.join(ROOT, 'data/meta.json');
  const moves = JSON.parse(fs.readFileSync(movesPath, 'utf8'));
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  console.log(`flavor-only: ${moves.length} moves from ${path.relative(ROOT, movesPath)}`);
  let i = 0;
  let filled = 0;
  for (const rec of moves) {
    i += 1;
    const key = rec.pokeapiId || rec.id;
    if (i % 25 === 1 || i === moves.length) {
      console.log(`  [${i}/${moves.length}] ${rec.id} (${key})`);
    }
    try {
      const data = await rateLimitedJson(`${POKEAPI}/move/${encodeURIComponent(key)}`);
      rec.flavor = pickFlavor(data.flavor_text_entries);
      if (rec.flavor?.['zh-Hant'] || rec.flavor?.en) filled += 1;
      if (!rec.pokeapiId && data.id) rec.pokeapiId = data.id;
    } catch (err) {
      if (!rec.flavor) rec.flavor = { en: null, 'zh-Hant': null, ja: null };
      console.warn(`  flavor miss ${rec.id}: ${err.message || err}`);
    }
  }
  const generatedAt = new Date();
  meta.generatedAt = generatedAt.toISOString();
  meta.updatedAt = formatUsageDate(generatedAt);
  meta.movesCount = moves.length;
  meta.sources = {
    ...(meta.sources || {}),
    pokeapi: POKEAPI,
    notes: `${meta.sources?.notes || ''} Move flavor_text from PokéAPI (zh-Hant / en / ja).`.trim(),
  };
  writeOutputs({ pokemon: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pokemon.json'), 'utf8')), moves, meta }, dryRun);
  console.log(`Done (flavor-only). moves=${moves.length} withFlavor=${filled}`);
}

async function main() {
  const { allowlistPath, dryRun, updateAllowlist, usageOnly, flavorOnly, topN } = parseArgs(process.argv.slice(2));

  if (updateAllowlist) {
    const ranked = await fetchTopDoublesFromCbdIndex(topN);
    if (ranked.length < topN) {
      console.warn(`Only found ${ranked.length} ranked Doubles species (requested ${topN})`);
    }
    if (!dryRun) writeAllowlist(allowlistPath, ranked, topN);
    else console.log(`dry-run allowlist top${topN}: ${ranked.map((r) => r.showdownId).join(', ')}`);
  }

  if (usageOnly) {
    await refreshUsageOnly({ dryRun, allowlistPath });
    return;
  }

  if (flavorOnly) {
    await refreshFlavorOnly({ dryRun });
    return;
  }

  const { ids: showdownIds, entryById } = readAllowlist(allowlistPath);
  await ensureCbdSeason();
  console.log(`Allowlist (${showdownIds.length}): ${showdownIds.slice(0, 12).join(', ')}${showdownIds.length > 12 ? ', …' : ''}`);
  console.log(`Rate limit ${RATE_LIMIT_MS}ms; dryRun=${dryRun}; schema=${SCHEMA_VERSION}`);

  const pokemon = [];
  const moveNameSet = new Map();
  const doublesCache = new Map();
  const usageFetchedAt = new Date();

  for (const id of showdownIds) {
    console.log(`[pokemon] ${id}`);
    try {
      const { record, moveNames, fromCbdMoves, doublesCount } = await buildPokemonRecord(
        id,
        doublesCache,
        entryById.get(id) || null,
      );
      pokemon.push(record);
      const formCount = record.forms?.length || 0;
      console.log(
        `  → #${record.nationalDex} ${record.names['zh-Hant'] || record.names.en} types=${record.types.join('/')} BST=${Object.values(record.baseStats).reduce((a, b) => a + b, 0)} forms=${formCount} movesSrc=${fromCbdMoves ? 'cbd' : 'pokeapi'} (${moveNames.length}) doublesTop=${doublesCount}`,
      );
      for (const mn of moveNames) {
        const key = toShowdownMoveId(mn);
        if (!moveNameSet.has(key)) moveNameSet.set(key, mn);
      }
    } catch (err) {
      console.error(`  FAILED ${id}: ${err.message || err}`);
    }
  }

  console.log(`[moves] fetching ${moveNameSet.size} unique move(s)…`);
  const moveCache = new Map();
  const moves = [];
  let i = 0;
  for (const [, label] of moveNameSet) {
    i += 1;
    if (i % 25 === 1 || i === moveNameSet.size) {
      console.log(`  [${i}/${moveNameSet.size}] ${label}`);
    }
    const rec = await buildMoveRecord(label, moveCache);
    if (!moves.find((m) => m.id === rec.id)) moves.push(rec);
  }
  moves.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  await localizeAllItems(pokemon);

  const generatedAt = new Date();
  const usageUpdatedAt = formatUsageDate(usageFetchedAt);
  const battleUrls = usageSourceUrls();
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    updatedAt: formatUsageDate(generatedAt),
    usageUpdatedAt,
    usageSourceLabel: formatUsageSourceLabel(usageFetchedAt),
    usageSeason: cbdSeason.season || null,
    usageRegulation: cbdSeason.regulation || null,
    sources: {
      pokeapi: POKEAPI,
      cbd: `${CBD_ORIGIN}/api/pokemon/{showdownId}`,
      cbdDoublesBattle: battleUrls.cbdDoublesBattle,
      cbdDoublesBattleDays: battleUrls.cbdDoublesBattleDays,
      cbdIndex: `${CBD_ORIGIN}/api/index`,
      allowlist: path.relative(ROOT, allowlistPath).replace(/\\/g, '/'),
      legalAllowlist: 'data/legal-allowlist.json',
      notes:
        'Classic PokéAPI base stats + nationalDex + forms[] including Mega (not CBD screen-scaled). Move/item names from PokéAPI; usage % from CBD VGC Doubles (2v2 / 6-pick-4) for the latest regulation folder from /api/index (explicit ?season=, currently M6 = Regulation M-C). Current CSV rank-1 gaps filled from newest complete daily snapshot (?days=7). Locale keys: en / zh-Hant / ja. Legal Champions forms via map-legal-allowlist.mjs. See assets/CREDITS.md.',
    },
    pokemonCount: pokemon.length,
    movesCount: moves.length,
    allowlistCount: showdownIds.length,
  };

  writeOutputs({ pokemon, moves, meta }, dryRun);
  console.log(`Done. pokemon=${pokemon.length} moves=${moves.length} allowlist=${showdownIds.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
