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
  scene_intervals?: Record<string, number>;
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
  pokemon_id: number;
  name: string;
  confidence: number;
}

export interface PokemonIdentified {
  position: number;
  pokemon_id: number | null;
  name?: string;
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
    pokemon_id: number | null;
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

// --- バトルイベント ---

export interface BattleEventMessage {
  type: "battle_event";
  event_type: string;
  side: "player" | "opponent";
  raw_text: string;
  pokemon_name: string | null;
  species_id: number | null;
  move_name: string | null;
  move_id: number | null;
  details: Record<string, unknown>;
}

// --- 相手アクティブポケモン ---

export interface OpponentActiveMessage {
  type: "opponent_active";
  species_id: number;
  pokemon_name: string;
  hp_percent: number | null;
  confidence: number;
}

// --- パーティ登録 ---

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
    pokemon_id: number | null;
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
  matched_id?: number | null;
  matched_identifier?: string | null;
  move_meta?: MoveMeta | null;
  is_mega_stone?: boolean;
}

export interface MegaFormDetail {
  item_id: number;
  mega_name: string;
  types: string[];
  ability: { name: string; effect: string };
  base_stats: Record<string, number>;
  stat_deltas: Record<string, number> | null;
}

export interface PartySlotData {
  position: number;
  pokemon_id: number | null;
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
    pokemonId: number | null;
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

// --- タイプ一貫性 ---

export interface TypeConsistencyEntry {
  type: string;
  name: string;
  consistent: boolean;
  min_effectiveness: number;
  per_pokemon: Array<{
    pokemon_id: number;
    effectiveness: number;
  }>;
}

export interface TypeConsistencyResult {
  results: TypeConsistencyEntry[];
  pokemon_count: number;
}

// --- ダメージ計算 ---

export interface DamageRange {
  min: number;
  max: number;
}

export interface MoveDamageResult {
  move_id: number;
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
  defender_species_id: number;
  defender_hp: number;
  moves: MoveDamageResult[];
}

export interface DamageCalcResponse {
  results: DefenderDamageResult[];
}
