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
  regions: Record<string, string>;
  pokemon: Array<{
    position: number;
    pokemon_id: number | null;
    name: string | null;
    confidence: number;
    name_key?: string;
  }>;
}

export interface PartySlotData {
  position: number;
  pokemon_id: number | null;
  name: string | null;
  regions: Record<string, string>;
}

export interface PartyRegisterCompleteMessage {
  type: "party_register_complete";
  party: PartySlotData[];
}

export interface PartyRegisterErrorMessage {
  type: "party_register_error";
  message: string;
}
