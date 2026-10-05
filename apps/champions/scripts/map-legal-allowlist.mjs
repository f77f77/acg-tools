#!/usr/bin/env node
/**
 * Map official Champions legal allowlist (nationalDex + form) → Showdown / CBD ids
 * via PokéAPI form_order (Champions form ≈ form_order - 1).
 *
 * Usage:
 *   node scripts/map-legal-allowlist.mjs
 *   node scripts/map-legal-allowlist.mjs --legal=data/legal-allowlist.json --out=data/allowlist.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POKEAPI = 'https://pokeapi.co/api/v2';
const RATE_LIMIT_MS = 350;
const UA = 'pokemon-champions-assistant-data-build/0.1 (+https://github.com/f77f77/pokemon-champions-assistant)';

/** PokéAPI pokemon / form name → CBD / Showdown id */
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
  'maushold-family-of-four': 'mausholdfour',
  'maushold-family-of-three': 'maushold',
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
  'vivillon-poke-ball': 'vivillonpokeball',
  'vivillon-meadow': 'vivillon',
  'vivillon-jungle': 'vivillonjungle',
  'pyroar-male': 'pyroar',
  'pyroar-female': 'pyroarf',
  'aegislash-shield': 'aegislash',
  'mimikyu-disguised': 'mimikyu',
  'morpeko-full-belly': 'morpeko',
  'palafin-zero': 'palafin',
  'mr-mime': 'mrmime',
  'mr-rime': 'mrrime',
  'florges-red': 'florges',
  'furfrou-natural': 'furfrou',
  'polteageist-phony': 'polteageist',
  'sinistcha-unremarkable': 'sinistcha',
  'alcremie-vanilla-cream-strawberry-sweet': 'alcremie',
  'maushold-family-of-four': 'maushold',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  let legalPath = path.join(ROOT, 'data/legal-allowlist.json');
  let outPath = path.join(ROOT, 'data/allowlist.json');
  let docsPath = path.join(ROOT, 'docs/legal-allowlist-mapping.md');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--legal=')) legalPath = path.resolve(ROOT, a.slice(8));
    else if (a === '--legal') legalPath = path.resolve(ROOT, argv[++i]);
    else if (a.startsWith('--out=')) outPath = path.resolve(ROOT, a.slice(6));
    else if (a === '--out') outPath = path.resolve(ROOT, argv[++i]);
    else if (a.startsWith('--docs=')) docsPath = path.resolve(ROOT, a.slice(7));
    else if (a === '--docs') docsPath = path.resolve(ROOT, argv[++i]);
  }
  return { legalPath, outPath, docsPath };
}

let lastFetch = 0;
async function rateLimitedJson(url) {
  const wait = RATE_LIMIT_MS - (Date.now() - lastFetch);
  if (wait > 0) await sleep(wait);
  lastFetch = Date.now();
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function pokeapiNameToShowdownId(pokeName) {
  if (POKEAPI_TO_SHOWDOWN[pokeName]) return POKEAPI_TO_SHOWDOWN[pokeName];
  // plumage / breed / regional already covered; generic: strip hyphens
  return String(pokeName).replace(/-/g, '');
}

/** Cache: nationalDex → list of { formOrder, formName, pokemonName, isMega, isBattleOnly, isGmax } */
const speciesFormsCache = new Map();

async function loadSpeciesForms(nationalDex) {
  if (speciesFormsCache.has(nationalDex)) return speciesFormsCache.get(nationalDex);
  const species = await rateLimitedJson(`${POKEAPI}/pokemon-species/${nationalDex}`);
  const forms = [];
  for (const v of species.varieties || []) {
    const pokemonName = v?.pokemon?.name;
    if (!pokemonName) continue;
    const pokemon = await rateLimitedJson(v.pokemon.url);
    for (const f of pokemon.forms || []) {
      const fd = await rateLimitedJson(f.url);
      const formName = fd.name || f.name;
      const isGmax = String(formName).includes('-gmax') || String(pokemonName).includes('-gmax');
      forms.push({
        formOrder: Number(fd.form_order) || 0,
        formName,
        pokemonName,
        isMega: Boolean(fd.is_mega),
        isBattleOnly: Boolean(fd.is_battle_only),
        isGmax,
        isDefault: Boolean(fd.is_default),
        speciesKey: species.name,
        speciesNames: species.names,
      });
    }
  }
  speciesFormsCache.set(nationalDex, { species, forms });
  return speciesFormsCache.get(nationalDex);
}

function pickForm(forms, championsForm) {
  const targetOrder = championsForm + 1;
  const candidates = forms.filter((f) => f.formOrder === targetOrder && !f.isGmax);
  if (!candidates.length) {
    // fallback: variety index == championsForm among non-gmax non-mega
    const nonCosmetic = forms.filter((f) => !f.isGmax);
    // dedupe by pokemonName keeping first form per variety
    const byPoke = [];
    const seen = new Set();
    for (const f of nonCosmetic) {
      if (seen.has(f.pokemonName)) continue;
      seen.add(f.pokemonName);
      byPoke.push(f);
    }
    if (byPoke[championsForm]) return byPoke[championsForm];
    return null;
  }
  // Prefer non-mega / non-battle-only when legal list is base forms
  const preferred =
    candidates.find((f) => !f.isMega && !f.isBattleOnly) ||
    candidates.find((f) => !f.isGmax) ||
    candidates[0];
  return preferred;
}

function pickNames(nameEntries) {
  const byLang = new Map();
  for (const n of nameEntries || []) byLang.set(n.language.name, n.name);
  return {
    en: byLang.get('en') || null,
    'zh-Hant': byLang.get('zh-hant') || byLang.get('zh-Hant') || null,
    ja: byLang.get('ja') || byLang.get('ja-Hrkt') || null,
  };
}

async function main() {
  const { legalPath, outPath, docsPath } = parseArgs(process.argv.slice(2));
  const legal = JSON.parse(fs.readFileSync(legalPath, 'utf8'));
  const pokemon = Array.isArray(legal.pokemon) ? legal.pokemon : [];
  console.log(`Mapping ${pokemon.length} legal entries from ${path.relative(ROOT, legalPath)}`);

  const entries = [];
  const unmapped = [];
  let i = 0;
  for (const row of pokemon) {
    i += 1;
    const nationalDex = Number(row.nationalDex);
    const form = Number(row.form) || 0;
    const id = row.id || `${String(nationalDex).padStart(4, '0')}-${String(form).padStart(3, '0')}`;
    process.stdout.write(`[${i}/${pokemon.length}] ${id} ${row.zhHant || ''}… `);
    try {
      const { species, forms } = await loadSpeciesForms(nationalDex);
      const matched = pickForm(forms, form);
      if (!matched) {
        console.log('UNMAPPED');
        unmapped.push({ id, nationalDex, form, zhHant: row.zhHant, reason: 'no form_order match' });
        continue;
      }
      const showdownId =
        POKEAPI_TO_SHOWDOWN[matched.formName] ||
        POKEAPI_TO_SHOWDOWN[matched.pokemonName] ||
        pokeapiNameToShowdownId(matched.pokemonName);
      const names = pickNames(species.names);
      const entry = {
        id,
        nationalDex,
        form,
        zhHant: row.zhHant || names['zh-Hant'],
        showdownId,
        formKey: matched.formName,
        pokemonSlug: matched.pokemonName,
        speciesKey: matched.speciesKey || species.name,
        pokeapiFormOrder: matched.formOrder,
      };
      entries.push(entry);
      console.log(`→ ${showdownId} (${matched.formName})`);
    } catch (err) {
      console.log(`ERROR ${err.message || err}`);
      unmapped.push({ id, nationalDex, form, zhHant: row.zhHant, reason: String(err.message || err) });
    }
  }

  // Dedupe showdownIds keeping first (legal list order) but warn
  const seenIds = new Set();
  const showdownIds = [];
  const dupes = [];
  for (const e of entries) {
    if (seenIds.has(e.showdownId)) {
      dupes.push(e);
      continue;
    }
    seenIds.add(e.showdownId);
    showdownIds.push(e.showdownId);
  }

  const payload = {
    description:
      'Champions legal forms (official event allowlist) mapped to Showdown/CBD ids via PokéAPI form_order. Refresh mapping: node scripts/map-legal-allowlist.mjs. Daily CBD usage: node scripts/build-pokemon-data.mjs',
    source: legal.source || null,
    legalSource: path.relative(ROOT, legalPath).replace(/\\/g, '/'),
    format: 'Doubles',
    mappedAt: new Date().toISOString(),
    count: entries.length,
    unmappedCount: unmapped.length,
    duplicateShowdownIds: dupes.map((d) => ({ id: d.id, showdownId: d.showdownId })),
    entries,
    showdownIds,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`wrote ${path.relative(ROOT, outPath)} mapped=${entries.length} uniqueShowdownIds=${showdownIds.length} unmapped=${unmapped.length} dupes=${dupes.length}`);

  const md = [
    '# Legal allowlist → Showdown mapping',
    '',
    `Generated: ${payload.mappedAt}`,
    `Legal source: ${legal.source || '(unknown)'}`,
    `Mapped: **${entries.length}** / ${pokemon.length}`,
    `Unique showdownIds: **${showdownIds.length}**`,
    `Unmapped: **${unmapped.length}**`,
    `Duplicate showdownIds skipped in showdownIds[]: **${dupes.length}**`,
    '',
    '## Method',
    '',
    '- Champions `form` index maps to PokéAPI `pokemon-form.form_order - 1`.',
    '- Gmax forms skipped; megas preferred only if no non-mega candidate shares the form_order.',
    '- Showdown ids from explicit map + hyphen-strip fallback (aligned with CBD where possible).',
    '',
    '## Unmapped',
    '',
  ];
  if (!unmapped.length) md.push('_None._', '');
  else {
    md.push('| id | nationalDex | form | zhHant | reason |', '| --- | ---: | ---: | --- | --- |');
    for (const u of unmapped) {
      md.push(`| ${u.id} | ${u.nationalDex} | ${u.form} | ${u.zhHant || ''} | ${u.reason} |`);
    }
    md.push('');
  }
  if (dupes.length) {
    md.push('## Duplicate showdownIds (kept first occurrence)', '');
    for (const d of dupes) md.push(`- ${d.id} → ${d.showdownId} (${d.zhHant || ''})`);
    md.push('');
  }
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.writeFileSync(docsPath, md.join('\n') + '\n', 'utf8');
  console.log(`wrote ${path.relative(ROOT, docsPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
