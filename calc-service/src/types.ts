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
  species_id: number;
  name: string;
  types: string[];
  stats: StatsTable;
  ability: string | null;
  item: string | null;
  boosts?: Partial<StatsTable>;
  status?: string;
  is_mega?: boolean;
}

export interface DefenderInput {
  species_id: number;
  name: string;
  types: string[];
  stats: StatsTable;
  ability: string | null;
  item: string | null;
  boosts?: Partial<StatsTable>;
  status?: string;
  cur_hp?: number;
}

export interface MoveInput {
  move_id: number;
  name: string;
  type: string;
  power: number | null;
  damage_class: string;
  makes_contact?: boolean;
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
}

// --- Response Types ---

export interface MoveResult {
  move_id: number;
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
  defender_species_id: number;
  defender_hp: number;
  moves: MoveResult[];
}

export interface DamageResponse {
  results: DefenderResult[];
}
