import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SnapshotPokemon {
  pokemon_key: string;
  base_species_key: string;
  name: string;
  base_species_name: string;
  forme: string;
  types: string[];
  base_stats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  abilities: {
    normal: string[];
    hidden: string | null;
  };
  required_item: string | null;
  is_base_form: boolean;
  is_preview_form: boolean;
}

export interface SnapshotMove {
  move_key: string;
  name: string;
  type: string;
  power: number | null;
  pp: number | null;
  accuracy: number | null;
  priority: number;
  damage_class: string | null;
  makes_contact: boolean;
}

export interface SnapshotItem {
  item_key: string;
  name: string;
  mega_stone: string | null;
  mega_evolves: string | null;
  effect: string;
}

export interface SnapshotAbility {
  ability_key: string;
  name: string;
  effect: string;
}

export interface SnapshotFormat {
  format_id: string;
  format_name: string;
  mod: string;
  game_type: string;
  team_size: number;
  pick_size: number;
  level_cap: number;
  ruleset: string[];
  legal_base_species_keys: string[];
  legal_pokemon_keys: string[];
  mega_item_map: Record<string, string>;
  forms_by_base_species: Record<string, string[]>;
}

export interface ShowdownSnapshot {
  pokemon: Record<string, SnapshotPokemon>;
  moves: Record<string, SnapshotMove>;
  items: Record<string, SnapshotItem>;
  abilities: Record<string, SnapshotAbility>;
  learnsets: Record<string, string[]>;
  types: {
    types: Record<string, { type_key: string; name: string }>;
    efficacy: Record<string, Record<string, number>>;
  };
  natures: Record<string, { nature_key: string; name: string; plus: string | null; minus: string | null }>;
  format: SnapshotFormat;
}

let cache: ShowdownSnapshot | null = null;

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadSnapshot(): ShowdownSnapshot {
  if (cache) return cache;

  const snapshotDir = resolve(
    process.cwd(),
    "..",
    "data",
    "showdown",
    "champions-bss-reg-ma",
  );

  cache = {
    pokemon: loadJson<Record<string, SnapshotPokemon>>(resolve(snapshotDir, "pokemon.json")),
    moves: loadJson<Record<string, SnapshotMove>>(resolve(snapshotDir, "moves.json")),
    items: loadJson<Record<string, SnapshotItem>>(resolve(snapshotDir, "items.json")),
    abilities: loadJson<Record<string, SnapshotAbility>>(resolve(snapshotDir, "abilities.json")),
    learnsets: loadJson<Record<string, string[]>>(resolve(snapshotDir, "learnsets.json")),
    types: loadJson<ShowdownSnapshot["types"]>(resolve(snapshotDir, "types.json")),
    natures: loadJson<ShowdownSnapshot["natures"]>(resolve(snapshotDir, "natures.json")),
    format: loadJson<SnapshotFormat>(resolve(snapshotDir, "format.json")),
  };
  return cache;
}
