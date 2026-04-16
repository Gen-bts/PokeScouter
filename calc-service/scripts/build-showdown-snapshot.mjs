import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import showdownPkg from "pokemon-showdown";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..", "..");
const outputDir = resolve(rootDir, "data", "showdown", "champions-bss-reg-ma");
const namesDir = resolve(rootDir, "data", "names");
const legacyBaseDir = resolve(rootDir, "data", "base");
const templatesDir = resolve(rootDir, "templates", "pokemon");

const FORMAT_NAME = "[Gen 9 Champions] BSS Reg M-A";
const TEAM_SIZE = 6;
const PICK_SIZE = 3;
const LEVEL_CAP = 50;

const pkg = showdownPkg?.default ?? showdownPkg;
const Dex = pkg.Dex;
const TeamValidator = pkg.TeamValidator;
const toID = pkg.toID;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function getPinnedCommit() {
  const packageJson = readJson(resolve(rootDir, "calc-service", "package.json"));
  const dep = packageJson.dependencies?.["pokemon-showdown"];
  const match = typeof dep === "string" ? dep.match(/#([0-9a-f]{7,40})$/i) : null;
  return match?.[1] ?? "unknown";
}

function isPreviewForm(species) {
  return !species.battleOnly && !species.isMega && !species.isPrimal;
}

function buildPokemonEntry(species) {
  const normalAbilities = [];
  if (species.abilities?.["0"]) normalAbilities.push(toID(species.abilities["0"]));
  if (species.abilities?.["1"]) normalAbilities.push(toID(species.abilities["1"]));

  return {
    pokemon_key: species.id,
    base_species_key: toID(species.baseSpecies || species.name),
    name: species.name,
    base_species_name: species.baseSpecies || species.name,
    forme: species.forme || "",
    types: species.types.map((type) => toID(type)),
    base_stats: {
      hp: species.baseStats.hp,
      atk: species.baseStats.atk,
      def: species.baseStats.def,
      spa: species.baseStats.spa,
      spd: species.baseStats.spd,
      spe: species.baseStats.spe,
    },
    abilities: {
      normal: normalAbilities,
      hidden: species.abilities?.H ? toID(species.abilities.H) : null,
    },
    height_m: species.heightm ?? null,
    weight_kg: species.weightkg ?? null,
    num: species.num ?? null,
    sprite_id: species.spriteid || null,
    battle_only: species.battleOnly ? toID(species.battleOnly) : null,
    changes_from: species.changesFrom ? toID(species.changesFrom) : null,
    required_item: species.requiredItem ? toID(species.requiredItem) : null,
    required_items: Array.isArray(species.requiredItems)
      ? species.requiredItems.map((item) => toID(item))
      : [],
    is_base_form: species.id === toID(species.baseSpecies || species.name),
    is_mega: Boolean(species.isMega),
    is_primal: Boolean(species.isPrimal),
    is_preview_form: isPreviewForm(species),
    is_nonstandard: species.isNonstandard ?? null,
    tags: Array.isArray(species.tags) ? species.tags : [],
  };
}

function buildMoveEntry(move) {
  return {
    move_key: move.id,
    name: move.name,
    type: toID(move.type),
    power: move.basePower ?? null,
    pp: move.pp ?? null,
    accuracy: typeof move.accuracy === "number" ? move.accuracy : null,
    priority: move.priority ?? 0,
    damage_class: move.category ? move.category.toLowerCase() : null,
    target: move.target ?? null,
    makes_contact: Boolean(move.flags?.contact),
    is_nonstandard: move.isNonstandard ?? null,
    short_desc: move.shortDesc ?? "",
  };
}

function buildItemEntry(item) {
  let megaStoneKey = null;
  let megaEvolvesKey = null;
  if (item.megaStone && typeof item.megaStone === "object") {
    const baseSpecies = Object.keys(item.megaStone)[0];
    const megaSpecies = Object.values(item.megaStone)[0];
    megaStoneKey = megaSpecies ? toID(megaSpecies) : null;
    megaEvolvesKey = baseSpecies ? toID(baseSpecies) : null;
  } else if (typeof item.megaStone === "string" && item.megaStone) {
    megaStoneKey = toID(item.megaStone);
    megaEvolvesKey = item.megaEvolves ? toID(item.megaEvolves) : null;
  }
  return {
    item_key: item.id,
    name: item.name,
    is_nonstandard: item.isNonstandard ?? null,
    short_desc: item.shortDesc ?? "",
    effect: item.desc ?? "",
    mega_stone: megaStoneKey,
    mega_evolves: megaEvolvesKey,
  };
}

function buildAbilityEntry(ability) {
  return {
    ability_key: ability.id,
    name: ability.name,
    short_desc: ability.shortDesc ?? "",
    effect: ability.desc ?? "",
    is_nonstandard: ability.isNonstandard ?? null,
  };
}

function buildNatureEntry(nature) {
  return {
    nature_key: nature.id,
    name: nature.name,
    plus: nature.plus ? toID(nature.plus) : null,
    minus: nature.minus ? toID(nature.minus) : null,
  };
}

function effectivenessFromDamageTaken(code) {
  if (code === 1) return 2;
  if (code === 2) return 0.5;
  if (code === 3) return 0;
  return 1;
}

function buildTypeSnapshot(dex) {
  const types = {};
  const efficacy = {};
  for (const type of dex.types.all()) {
    if (!type.exists) continue;
    const typeKey = toID(type.name);
    types[typeKey] = {
      type_key: typeKey,
      name: type.name,
    };
  }

  for (const defender of dex.types.all()) {
    if (!defender.exists) continue;
    const defenderKey = toID(defender.name);
    for (const attacker of dex.types.all()) {
      if (!attacker.exists) continue;
      const attackerKey = toID(attacker.name);
      efficacy[attackerKey] ??= {};
      efficacy[attackerKey][defenderKey] = effectivenessFromDamageTaken(
        defender.damageTaken?.[attacker.name] ?? 0,
      );
    }
  }

  return { types, efficacy };
}

function buildLearnsets(dex, pokemonEntries) {
  const learnsets = {};
  for (const pokemonKey of Object.keys(pokemonEntries)) {
    const learnsetData = dex.data.Learnsets?.[pokemonKey];
    const learnset = learnsetData?.learnset ? Object.keys(learnsetData.learnset).sort() : [];
    if (learnset.length > 0) {
      learnsets[pokemonKey] = learnset;
    }
  }
  return learnsets;
}

function buildProbeSet(species, learnsets, dex) {
  const moves = learnsets[species.id] ?? learnsets[toID(species.baseSpecies || species.name)] ?? [];
  if (moves.length === 0) return null;

  const firstMove = dex.moves.get(moves[0]);
  if (!firstMove.exists) return null;

  const firstAbility = species.abilities?.["0"] ?? Object.values(species.abilities ?? {})[0];
  if (!firstAbility) return null;

  return {
    name: species.baseSpecies || species.name,
    species: species.name,
    item: "",
    ability: firstAbility,
    moves: [firstMove.name],
    nature: "Serious",
    evs: { hp: 1, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    level: 50,
  };
}

function buildLegalPools(dex, learnsets) {
  const validator = new TeamValidator(FORMAT_NAME);
  const legalBaseSpeciesKeys = [];

  for (const species of dex.species.all()) {
    if (!species.exists) continue;
    if (toID(species.baseSpecies || species.name) !== species.id) continue;
    if (species.isMega || species.isPrimal || species.battleOnly) continue;
    if (species.isNonstandard && species.isNonstandard !== "Past") continue;

    const probe = buildProbeSet(species, learnsets, dex);
    if (!probe) continue;

    const problems = validator.validateSet(probe, {});
    if (!problems) {
      legalBaseSpeciesKeys.push(species.id);
    }
  }

  const legalSet = new Set(legalBaseSpeciesKeys);
  const legalPokemonKeys = dex.species.all()
    .filter((species) =>
      species.exists &&
      isPreviewForm(species) &&
      legalSet.has(toID(species.baseSpecies || species.name)))
    .map((species) => species.id)
    .sort();

  return {
    legalBaseSpeciesKeys: legalBaseSpeciesKeys.sort(),
    legalPokemonKeys,
  };
}

function buildFormatSnapshot(format, legalPools, pokemonEntries, items) {
  const megaItemMap = {};
  for (const [itemKey, item] of Object.entries(items)) {
    if (item.mega_stone) {
      megaItemMap[itemKey] = item.mega_stone;
    }
  }

  const formsByBaseSpecies = {};
  for (const [pokemonKey, pokemon] of Object.entries(pokemonEntries)) {
    const baseKey = pokemon.base_species_key;
    formsByBaseSpecies[baseKey] ??= [];
    if (pokemon.is_preview_form) {
      formsByBaseSpecies[baseKey].push(pokemonKey);
    }
  }
  for (const value of Object.values(formsByBaseSpecies)) {
    value.sort();
  }

  return {
    _meta: {
      source: "pokemon-showdown",
      showdown_commit: getPinnedCommit(),
      generated_at: new Date().toISOString(),
    },
    format_id: format.id,
    format_name: format.name,
    mod: format.mod,
    game_type: format.gameType,
    team_size: TEAM_SIZE,
    pick_size: PICK_SIZE,
    level_cap: LEVEL_CAP,
    ruleset: [...format.ruleset],
    legal_base_species_keys: legalPools.legalBaseSpeciesKeys,
    legal_pokemon_keys: legalPools.legalPokemonKeys,
    mega_item_map: megaItemMap,
    forms_by_base_species: formsByBaseSpecies,
  };
}

function updateNamesFiles(snapshotPokemon, snapshotMoves, snapshotItems, snapshotAbilities) {
  if (!existsSync(namesDir) || !existsSync(legacyBaseDir)) return;

  const legacyPokemon = readJson(resolve(legacyBaseDir, "pokemon.json"));
  const legacyMoves = readJson(resolve(legacyBaseDir, "moves.json"));
  const legacyItems = readJson(resolve(legacyBaseDir, "items.json"));
  const legacyAbilities = readJson(resolve(legacyBaseDir, "abilities.json"));

  const speciesIdToPokemonKey = {};
  for (const [key, value] of Object.entries(snapshotPokemon)) {
    if (value.is_base_form) {
      speciesIdToPokemonKey[value.num] = key;
    }
  }

  const moveIdToKey = {};
  for (const [legacyId, value] of Object.entries(legacyMoves)) {
    if (legacyId === "_meta") continue;
    if (snapshotMoves[value.identifier]) {
      moveIdToKey[legacyId] = value.identifier;
    }
  }

  const itemIdToKey = {};
  for (const [legacyId, value] of Object.entries(legacyItems)) {
    if (legacyId === "_meta") continue;
    if (snapshotItems[toID(value.name)] || snapshotItems[value.identifier]) {
      itemIdToKey[legacyId] = snapshotItems[value.identifier] ? value.identifier : toID(value.name);
    }
  }

  const abilityIdToKey = {};
  for (const [legacyId, value] of Object.entries(legacyAbilities)) {
    if (legacyId === "_meta") continue;
    if (snapshotAbilities[value.identifier]) {
      abilityIdToKey[legacyId] = value.identifier;
    }
  }

  for (const file of readdirSync(namesDir)) {
    if (!file.endsWith(".json")) continue;
    const path = resolve(namesDir, file);
    const original = readJson(path);
    const next = {
      ...original,
      _meta: {
        ...(original._meta ?? {}),
        key_format: "showdown",
        last_updated: new Date().toISOString().slice(0, 10),
      },
      pokemon: {},
      moves: {},
      items: {},
      abilities: {},
    };

    for (const [name, value] of Object.entries(original.pokemon ?? {})) {
      if (typeof value === "string") {
        next.pokemon[name] = value;
      } else if (speciesIdToPokemonKey[value]) {
        next.pokemon[name] = speciesIdToPokemonKey[value];
      }
    }
    for (const [name, value] of Object.entries(original.moves ?? {})) {
      if (typeof value === "string") {
        next.moves[name] = value;
      } else if (moveIdToKey[value]) {
        next.moves[name] = moveIdToKey[value];
      }
    }
    for (const [name, value] of Object.entries(original.items ?? {})) {
      if (typeof value === "string") {
        next.items[name] = value;
      } else if (itemIdToKey[value]) {
        next.items[name] = itemIdToKey[value];
      }
    }
    for (const [name, value] of Object.entries(original.abilities ?? {})) {
      if (typeof value === "string") {
        next.abilities[name] = value;
      } else if (abilityIdToKey[value]) {
        next.abilities[name] = abilityIdToKey[value];
      }
    }

    writeJson(path, next);
  }
}

function writeSpriteManifest(snapshotPokemon) {
  if (!existsSync(templatesDir) || !existsSync(legacyBaseDir)) return;

  const manifestPath = resolve(templatesDir, "manifest.json");
  const legacyPokemon = readJson(resolve(legacyBaseDir, "pokemon.json"));
  const identifierToFile = {};

  for (const [legacyId, value] of Object.entries(legacyPokemon)) {
    if (legacyId === "_meta") continue;
    identifierToFile[toID(value.identifier)] = `${legacyId}.png`;
  }

  const sprites = {};
  for (const pokemonKey of Object.keys(snapshotPokemon)) {
    const keyFile = `${pokemonKey}.png`;
    if (existsSync(resolve(templatesDir, keyFile))) {
      sprites[pokemonKey] = keyFile;
      continue;
    }
    const legacyFile = identifierToFile[pokemonKey];
    if (legacyFile && existsSync(resolve(templatesDir, legacyFile))) {
      sprites[pokemonKey] = legacyFile;
    }
  }

  writeJson(manifestPath, {
    _meta: {
      generated_at: new Date().toISOString(),
      key_format: "showdown",
    },
    sprites,
  });
}

function main() {
  mkdirSync(outputDir, { recursive: true });

  const format = Dex.formats.get(FORMAT_NAME);
  const dex = Dex.mod(format.mod);

  const pokemon = {};
  for (const species of dex.species.all()) {
    if (!species.exists) continue;
    pokemon[species.id] = buildPokemonEntry(species);
  }

  const moves = {};
  for (const move of dex.moves.all()) {
    if (!move.exists) continue;
    moves[move.id] = buildMoveEntry(move);
  }

  const items = {};
  for (const item of dex.items.all()) {
    if (!item.exists) continue;
    items[item.id] = buildItemEntry(item);
  }

  const abilities = {};
  for (const ability of dex.abilities.all()) {
    if (!ability.exists) continue;
    abilities[ability.id] = buildAbilityEntry(ability);
  }

  const natures = {};
  for (const nature of dex.natures.all()) {
    if (!nature.exists) continue;
    natures[nature.id] = buildNatureEntry(nature);
  }

  const types = buildTypeSnapshot(dex);
  const learnsets = buildLearnsets(dex, pokemon);
  const legalPools = buildLegalPools(dex, learnsets);
  const formatSnapshot = buildFormatSnapshot(format, legalPools, pokemon, items);

  writeJson(resolve(outputDir, "pokemon.json"), {
    _meta: { source: "pokemon-showdown", showdown_commit: getPinnedCommit() },
    ...pokemon,
  });
  writeJson(resolve(outputDir, "moves.json"), {
    _meta: { source: "pokemon-showdown", showdown_commit: getPinnedCommit() },
    ...moves,
  });
  writeJson(resolve(outputDir, "items.json"), {
    _meta: { source: "pokemon-showdown", showdown_commit: getPinnedCommit() },
    ...items,
  });
  writeJson(resolve(outputDir, "abilities.json"), {
    _meta: { source: "pokemon-showdown", showdown_commit: getPinnedCommit() },
    ...abilities,
  });
  writeJson(resolve(outputDir, "learnsets.json"), {
    _meta: { source: "pokemon-showdown", showdown_commit: getPinnedCommit() },
    ...learnsets,
  });
  writeJson(resolve(outputDir, "natures.json"), {
    _meta: { source: "pokemon-showdown", showdown_commit: getPinnedCommit() },
    ...natures,
  });
  writeJson(resolve(outputDir, "types.json"), {
    _meta: { source: "pokemon-showdown", showdown_commit: getPinnedCommit() },
    ...types,
  });
  writeJson(resolve(outputDir, "format.json"), formatSnapshot);

  updateNamesFiles(pokemon, moves, items, abilities);
  writeSpriteManifest(pokemon);

  console.log(`Showdown snapshot written to ${outputDir}`);
  console.log(`Legal base species: ${formatSnapshot.legal_base_species_keys.length}`);
  console.log(`Legal preview forms: ${formatSnapshot.legal_pokemon_keys.length}`);
}

main();
