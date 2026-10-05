#!/usr/bin/env node
/**
 * Offline checks for CBD usage sort, Mega forms, items, and Basculegion aliases.
 * Run after `node scripts/build-pokemon-data.mjs --usage-only`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pokemon = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pokemon.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/meta.json'), 'utf8'));

function pct(row) {
  const n = Number.parseFloat(String(row?.usage ?? '').replace(/%/g, ''));
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function isSortedDesc(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (pct(rows[i]) > pct(rows[i - 1]) + 1e-6) return false;
  }
  return true;
}

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    failed += 1;
  } else {
    console.log(`ok   ${msg}`);
  }
}

const byId = new Map(pokemon.map((p) => [p.showdownId, p]));
const garchomp = byId.get('garchomp');
const male = byId.get('basculegion');
const female = byId.get('basculegionf');

check(!!garchomp, 'garchomp record exists');
const gForms = garchomp?.forms || [];
check(
  gForms.some((f) => String(f.formKey || '').includes('mega')),
  `garchomp forms include Mega (got ${gForms.map((f) => f.formKey).join(', ') || 'none'})`,
);

check(!!male, 'basculegion (male) record exists');
check(male?.formKey === 'basculegion-male' || male?.formKey?.includes('male'), `male formKey=${male?.formKey}`);

const maleMoves = male?.vgcDoublesMoves || [];
check(maleMoves.length >= 4, `basculegion-M has ≥4 moves (got ${maleMoves.length})`);
check(isSortedDesc(maleMoves), `basculegion-M moves sorted usage desc: ${maleMoves.map((m) => `${m.nameEn} ${m.usage}`).join(' → ')}`);
check(
  pct(maleMoves[0]) >= 30,
  `basculegion-M top move usage ≥30% (got ${maleMoves[0]?.nameEn} ${maleMoves[0]?.usage}) — rank-1 CSV fallback`,
);

const maleItems = male?.vgcDoublesItems || [];
check(maleItems.length >= 2, `basculegion-M has ≥2 items (got ${maleItems.length})`);
check(isSortedDesc(maleItems), `basculegion-M items sorted desc: ${maleItems.slice(0, 2).map((it) => `${it.nameZh || it.nameEn} ${it.usage}`).join(' · ')}`);

const femaleMoves = female?.vgcDoublesMoves || [];
check(isSortedDesc(femaleMoves), 'basculegion-F moves sorted usage desc');

const gMoves = garchomp?.vgcDoublesMoves || [];
check(isSortedDesc(gMoves), 'garchomp moves sorted usage desc');
const gItems = garchomp?.vgcDoublesItems || [];
check(gItems.length >= 2, `garchomp has ≥2 items (got ${gItems.length})`);

let unsorted = 0;
for (const p of pokemon) {
  if (p.vgcDoublesMoves?.length && !isSortedDesc(p.vgcDoublesMoves)) {
    unsorted += 1;
    if (unsorted <= 5) console.error(`  unsorted moves: ${p.showdownId}`);
  }
}
check(unsorted === 0, `all species moves sorted desc (unsorted=${unsorted})`);

check(!!meta.usageUpdatedAt, `meta.usageUpdatedAt=${meta.usageUpdatedAt}`);
check(/championsbattledata\.com/.test(meta.usageSourceLabel || ''), `source label mentions CBD`);
check(
  /Regulation M-/.test(meta.usageSourceLabel || ''),
  `source label includes regulation (got ${meta.usageSourceLabel})`,
);
check(!!meta.usageSeason && !/^current$/i.test(meta.usageSeason), `usageSeason is explicit folder (got ${meta.usageSeason})`);
check(
  !/^m5$/i.test(String(meta.usageSeason || '')),
  `usageSeason is not stale M5/M-B (got ${meta.usageSeason})`,
);
check(pokemon.length === 262, `pokemon count 262 (got ${pokemon.length})`);

function compactIdent(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[-_ ]+/g, '');
}

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

const floette = byId.get('floette');
check(!!floette, 'floette (Eternal Flower) record exists');
check(
  (floette?.forms || []).some((f) => String(f.formKey || '') === 'floette-mega'),
  `floette forms include Mega (got ${(floette?.forms || []).map((f) => f.formKey).join(', ') || 'none'})`,
);

let missingOwnMega = 0;
for (const p of pokemon) {
  const items = [...(p.vgcDoublesItems || []), ...(p.forms || []).flatMap((f) => f.vgcDoublesItems || [])];
  const own = items.find((it) => itemIsOwnMegaStone(it, p.showdownId, p.formKey) && pct(it) >= 50);
  if (!own) continue;
  const hasMega = (p.forms || []).some((f) => String(f.formKey || '').toLowerCase().includes('mega'));
  if (!hasMega) {
    missingOwnMega += 1;
    console.error(`  ${p.showdownId} has ${own.id} ${own.usage} but forms[] lacks Mega`);
  }
}
check(missingOwnMega === 0, `own mega-stone (≥50%) species have a Mega form (missing=${missingOwnMega})`);

if (failed) {
  console.error(`\n${failed} invariant(s) failed`);
  process.exit(1);
}
console.log('\nAll usage/Mega/item invariants passed.');
