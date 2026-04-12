export type CalcEngine = "smogon" | "pkmn";

// --- Request Types ---

export interface StatsTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface AttackerInput {
  pokemon_key: string;
  stats: StatsTable;
  ability_key?: string | null;
  item_key?: string | null;
  boosts?: Partial<StatsTable>;
  status?: string;
}

export interface DefenderInput {
  pokemon_key: string;
  stats: StatsTable;
  ability_key?: string | null;
  item_key?: string | null;
  boosts?: Partial<StatsTable>;
  status?: string;
  cur_hp?: number;
}

export interface MoveInput {
  move_key: string;
}

export interface SideInput {
  is_reflect?: boolean;
  is_light_screen?: boolean;
  is_aurora_veil?: boolean;
  is_tailwind?: boolean;
  is_helping_hand?: boolean;
}

export interface FieldInput {
  weather?: string | null;
  terrain?: string | null;
  is_doubles?: boolean;
  attacker_side?: SideInput;
  defender_side?: SideInput;
}

export interface DamageRequest {
  attacker: AttackerInput;
  defenders: DefenderInput[];
  moves: MoveInput[];
  field?: FieldInput;
  engine?: CalcEngine;
}

export interface ResolvedPokemonInput {
  pokemon_key: string;
  name: string;
  types: string[];
  stats: StatsTable;
  ability: string | null;
  item: string | null;
  boosts?: Partial<StatsTable>;
  status?: string;
  cur_hp?: number;
}

export interface ResolvedMoveInput {
  move_key: string;
  name: string;
  type: string;
  power: number | null;
  damage_class: string;
  makes_contact?: boolean;
}

// --- Response Types ---

export interface MoveResult {
  move_key: string;
  move_id: string;
  move_name: string;
  damage: { min: number; max: number };
  min_percent: number;
  max_percent: number;
  guaranteed_ko: number;
  type_effectiveness: number;
  description: string;
  annotations?: Record<string, boolean>;
}

export interface DefenderResult {
  defender_pokemon_key: string;
  defender_species_id: string;
  defender_hp: number;
  moves: MoveResult[];
}

export interface DamageResponse {
  results: DefenderResult[];
}
