export type PokemonKey = string;
export type MoveKey = string;
export type ItemKey = string;
export type AbilityKey = string;

export type ConnectionState =
  | "connected"
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "processing";

export interface Region {
  name: string;
  text: string;
  confidence: number;
  elapsed_ms: number;
  x: number;
  y: number;
  w: number;
  h: number;
  crop_b64?: string;
}

export interface DetectionRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  method: string;
}

export interface PokemonIconRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrResult {
  type: "ocr_result";
  regions: Region[];
  elapsed_ms: number;
  scene: string;
  resolution?: { width: number; height: number };
  detection_regions?: DetectionRegion[];
  pokemon_icons?: PokemonIconRegion[];
}

export interface StatusMessage {
  type: "status";
  status: string;
}

export interface WsConfig {
  paused?: boolean;
  debug_crops?: boolean;
  benchmark?: boolean;
}

export interface BenchmarkEngineResult {
  engine: string;
  text: string;
  confidence: number;
  elapsed_ms: number;
}

export interface BenchmarkRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  crop_b64?: string;
  engines: BenchmarkEngineResult[];
}

export interface BenchmarkResult {
  type: "benchmark_result";
  scene: string;
  elapsed_ms: number;
  regions: BenchmarkRegion[];
  resolution?: { width: number; height: number };
}

export interface PokemonCandidate {
  pokemon_key: PokemonKey;
  pokemon_id: PokemonKey;
  name: string;
  confidence: number;
}

export interface PokemonIdentified {
  position: number;
  pokemon_key: PokemonKey | null;
  pokemon_id: PokemonKey | null;
  name?: string | null;
  confidence: number;
  candidates?: PokemonCandidate[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface PokemonIdentifiedResult {
  type: "pokemon_identified";
  pokemon: PokemonIdentified[];
  elapsed_ms: number;
}

export interface SceneChangeMessage {
  type: "scene_change";
  scene: string;
  top_level: string;
  sub_scene: string | null;
  confidence: number;
  interval_ms?: number;
}

export interface MatchTeamsMessage {
  type: "match_teams";
  player_team: Array<{ position: number; name: string }>;
  opponent_team: Array<{
    position: number;
    pokemon_key: PokemonKey | null;
    pokemon_id: PokemonKey | null;
    name: string | null;
    confidence: number;
  }>;
}

export interface TeamSelectionMessage {
  type: "team_selection";
  selected_positions: number[];
}

export interface BattleResultMessage {
  type: "battle_result";
  result: "win" | "lose" | "unknown";
}

export interface BattleEventMessage {
  type: "battle_event";
  event_type: string;
  side: "player" | "opponent";
  raw_text: string;
  pokemon_name: string | null;
  pokemon_key: PokemonKey | null;
  species_id: PokemonKey | null;
  move_name: string | null;
  move_key: MoveKey | null;
  move_id: MoveKey | null;
  details: Record<string, unknown>;
}

export interface OpponentActiveMessage {
  type: "opponent_active";
  pokemon_key: PokemonKey;
  species_id: PokemonKey;
  pokemon_name: string;
  hp_percent: number | null;
  confidence: number;
}

export interface OpponentItemAbilityMessage {
  type: "opponent_item_ability";
  detection_type: "ability" | "item";
  pokemon_name: string;
  pokemon_key: PokemonKey | null;
  species_id: PokemonKey | null;
  trait_name: string;
  trait_key: string;
  trait_id: string;
  confidence: number;
  raw_text: string;
  item_identifier: string | null;
}

export type PartyRegistrationPhase =
  | "idle"
  | "detecting_screen1"
  | "reading_screen1"
  | "detecting_screen2"
  | "reading_screen2"
  | "done";

export interface PartyRegisterProgressMessage {
  type: "party_register_progress";
  state: PartyRegistrationPhase;
}

export interface PartyRegisterScreenMessage {
  type: "party_register_screen";
  screen: number;
  slots: Record<number, Record<string, string>>;
  pokemon: Array<{
    position: number;
    pokemon_key: PokemonKey | null;
    pokemon_id: PokemonKey | null;
    name: string | null;
    confidence: number;
    name_key?: string;
  }>;
  party_name?: string | null;
}

export interface MoveMeta {
  type: string | null;
  power: number | null;
  accuracy: number | null;
  damage_class: string | null;
}

export interface ValidatedField {
  raw: string;
  validated: string | null;
  confidence: number;
  matched_id?: string | null;
  matched_key?: string | null;
  matched_identifier?: string | null;
  move_meta?: MoveMeta | null;
  is_mega_stone?: boolean;
}

export interface TypeEffectivenessEntry {
  type: string;
  multiplier: number;
}

export interface TypeEffectivenessData {
  weak: TypeEffectivenessEntry[];
  resist: TypeEffectivenessEntry[];
  immune: TypeEffectivenessEntry[];
}

export interface MegaFormDetail {
  item_key: ItemKey;
  pokemon_key: PokemonKey;
  mega_name: string;
  types: string[];
  ability: { name: string; effect: string };
  base_stats: Record<string, number>;
  stat_deltas: Record<string, number> | null;
  type_effectiveness?: TypeEffectivenessData;
}

export interface PartySlotData {
  position: number;
  pokemon_key: PokemonKey | null;
  pokemon_id: PokemonKey | null;
  name: string | null;
  fields: Record<string, ValidatedField>;
}

export interface PartyRegisterCompleteMessage {
  type: "party_register_complete";
  party: PartySlotData[];
  party_name?: string | null;
}

export interface SavedParty {
  id: string;
  name: string;
  slots: Array<{
    position: number;
    pokemonId: PokemonKey | null;
    name: string | null;
    fields: Record<string, ValidatedField>;
    megaForm: MegaFormDetail | null;
  }>;
  savedAt: number;
}

export interface PartyRegisterErrorMessage {
  type: "party_register_error";
  message: string;
}

export interface TypeConsistencyEntry {
  type: string;
  name: string;
  consistent: boolean;
  min_effectiveness: number;
  per_pokemon: Array<{
    pokemon_key: PokemonKey;
    pokemon_id: PokemonKey;
    effectiveness: number;
  }>;
}

export interface TypeConsistencyResult {
  results: TypeConsistencyEntry[];
  pokemon_count: number;
}

export interface DamageRange {
  min: number;
  max: number;
}

export interface MoveDamageResult {
  move_key: MoveKey;
  move_id: MoveKey;
  move_name: string;
  damage: DamageRange;
  min_percent: number;
  max_percent: number;
  guaranteed_ko: number;
  type_effectiveness: number;
  description: string;
  annotations?: Record<string, boolean>;
}

export interface DefenderDamageResult {
  defender_pokemon_key: PokemonKey;
  defender_species_id: PokemonKey;
  defender_hp: number;
  moves: MoveDamageResult[];
}

export interface DamageCalcResponse {
  results: DefenderDamageResult[];
}
