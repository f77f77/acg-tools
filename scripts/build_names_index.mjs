#!/usr/bin/env node
/**
 * Build hub data/names.json from the Champions allowlist tables.
 *
 * Pokémon / moves / item 繁中+EN come from apps/champions/data (already
 * localized via PokéAPI when that dataset was built). Ability names and
 * item 日文 are filled from an existing data/names.json when present.
 *
 *   node scripts/build_names_index.mjs
 *   node scripts/build_names_index.mjs --fetch
 *
 * --fetch asks PokéAPI for ability + item names (en / zh-Hant / ja).
 * Rate-limited. Safe to re-run; failed ids keep the previous locale fill.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHAMP = path.join(ROOT, "apps", "champions", "data");
const OUT = path.join(ROOT, "data", "names.json");
const FETCH = process.argv.includes("--fetch");
const POKEAPI = "https://pokeapi.co/api/v2";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function joinName(base, extra) {
  if (!extra) return base || "";
  if (!base) return extra;
  if (base === extra) return base;
  return `${base} · ${extra}`;
}

function prettyId(id) {
  return String(id || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pokemonEntry(rec) {
  const names = rec.names || {};
  const form = rec.formNames || {};
  const formEn = form.en && form.en !== "Base" ? form.en : "";
  return {
    kind: "pokemon",
    id: rec.showdownId,
    zh: joinName(names["zh-Hant"], form["zh-Hant"]),
    ja: joinName(names.ja, form.ja && form.ja !== names.ja ? form.ja : ""),
    en: joinName(names.en, formEn),
    dex: rec.nationalDex ?? null,
  };
}

function indexExisting(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  const data = readJson(file);
  for (const entry of data.entries || []) {
    map.set(`${entry.kind}:${entry.id}`, entry);
  }
  return map;
}

function fillFromPrevious(entry, prev) {
  if (!prev) return entry;
  return {
    ...entry,
    zh: entry.zh || prev.zh || "",
    ja: entry.ja || prev.ja || "",
    en: entry.en || prev.en || "",
  };
}

function pickLocale(names) {
  const map = {};
  for (const row of names || []) {
    const lang = row.language && row.language.name;
    if (lang && row.name) map[lang] = row.name;
  }
  return {
    en: map.en || "",
    zh: map["zh-Hant"] || map["zh-hant"] || map["zh-Hans"] || map["zh-hans"] || "",
    ja: map.ja || map["ja-hrkt"] || "",
  };
}

async function fetchLocales(kind, ids) {
  const endpoint = kind === "ability" ? "ability" : "item";
  const found = new Map();
  const queue = ids.slice();
  const concurrency = 6;
  async function one(id) {
    const url = `${POKEAPI}/${endpoint}/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "acg-tools-names/1.0 (+https://github.com/f77f77/acg-tools)",
      },
    });
    if (!res.ok) {
      console.warn(`skip ${kind} ${id}: HTTP ${res.status}`);
      return;
    }
    const body = await res.json();
    found.set(id, pickLocale(body.names));
  }
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        await one(id);
      } catch (err) {
        console.warn(`skip ${kind} ${id}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return found;
}

function needsFetch(entry) {
  return !entry.zh || !entry.ja || !entry.en;
}

async function main() {
  const pokemon = readJson(path.join(CHAMP, "pokemon.json"));
  const moves = readJson(path.join(CHAMP, "moves.json"));
  const previous = indexExisting(OUT);
  const entries = [];
  const seen = new Set();

  function push(entry) {
    const key = `${entry.kind}:${entry.id}`;
    if (!entry.id || seen.has(key)) return;
    seen.add(key);
    entries.push(fillFromPrevious(entry, previous.get(key)));
  }

  for (const rec of pokemon) push(pokemonEntry(rec));

  for (const move of moves) {
    const names = move.names || {};
    push({
      kind: "move",
      id: move.id,
      zh: names["zh-Hant"] || "",
      ja: names.ja || "",
      en: names.en || "",
    });
  }

  const abilityIds = new Set();
  const items = new Map();
  for (const rec of pokemon) {
    for (const id of rec.abilities || []) abilityIds.add(id);
    for (const form of rec.forms || []) {
      for (const id of form.abilities || []) abilityIds.add(id);
    }
    const bags = [rec.vgcDoublesItems || []];
    for (const form of rec.forms || []) bags.push(form.vgcDoublesItems || []);
    for (const bag of bags) {
      for (const item of bag) {
        if (!item || !item.id || items.has(item.id)) continue;
        items.set(item.id, {
          kind: "item",
          id: item.id,
          zh: item.nameZh || "",
          ja: "",
          en: item.nameEn || "",
        });
      }
    }
  }

  for (const id of abilityIds) {
    push({ kind: "ability", id, zh: "", ja: "", en: "" });
  }
  for (const item of items.values()) push(item);

  if (FETCH) {
    for (const kind of ["ability", "item"]) {
      const ids = entries.filter((e) => e.kind === kind && needsFetch(e)).map((e) => e.id);
      console.log(`fetch ${kind}: ${ids.length}`);
      const locales = await fetchLocales(kind, ids);
      for (const entry of entries) {
        if (entry.kind !== kind) continue;
        const loc = locales.get(entry.id);
        if (!loc) continue;
        entry.zh = entry.zh || loc.zh;
        entry.ja = entry.ja || loc.ja;
        entry.en = entry.en || loc.en;
      }
    }
  }

  for (const entry of entries) {
    if (!entry.en) entry.en = prettyId(entry.id);
  }

  const order = { pokemon: 0, move: 1, ability: 2, item: 3 };
  entries.sort((a, b) => {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    return String(a.zh || a.en).localeCompare(String(b.zh || b.en), "zh-Hant");
  });

  const payload = {
    schema: "names.v1",
    generatedAt: new Date().toISOString(),
    source: "apps/champions/data (PokéAPI locales on the Champions allowlist)",
    refresh: "node scripts/build_names_index.mjs [--fetch]",
    note: "繁中優先。特性／道具日文要用 --fetch 向 PokéAPI 補；冇網絡時沿用上一份 names.json。",
    counts: {
      pokemon: entries.filter((e) => e.kind === "pokemon").length,
      move: entries.filter((e) => e.kind === "move").length,
      ability: entries.filter((e) => e.kind === "ability").length,
      item: entries.filter((e) => e.kind === "item").length,
    },
    entries,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log(`wrote ${OUT} (${entries.length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
