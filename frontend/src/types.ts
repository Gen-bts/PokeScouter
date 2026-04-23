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
  seq?: number;
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
  seq?: number;
  scene: string;
  top_level: string;
  sub_scene: string | null;
  confidence: number;
  interval_ms?: number;
}

export interface MatchTeamsMessage {
  type: "match_teams";
  seq?: number;
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
  seq?: number;
  selected_positions: number[];
}

export interface TeamSelectionOrderMessage {
  type: "team_selection_order";
  seq?: number;
  selection_order: Record<string, number>;
}

export interface BattleResultMessage {
  type: "battle_result";
  seq?: number;
  result: "win" | "lose" | "unknown";
}

export interface BattleEventMessage {
  type: "battle_event";
  seq?: number;
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
  seq?: number;
  pokemon_key: PokemonKey;
  species_id: PokemonKey;
  pokemon_name: string;
  hp_percent: number | null;
  confidence: number;
}

export interface PlayerActiveMessage {
  type: "player_active";
  seq?: number;
  pokemon_key: PokemonKey;
  species_id: PokemonKey;
  pokemon_name: string;
  current_hp: number | null;
  max_hp: number | null;
  hp_percent: number | null;
  confidence: number;
}

export interface OpponentItemAbilityMessage {
  type: "opponent_item_ability";
  seq?: number;
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
  ability: { key?: string; name: string; effect: string; effect_en?: string };
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

export interface DamageVariantRange {
  min_percent: number;
  max_percent: number;
  best_ko: number;
  worst_ko: number;
  factors: string[];
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
  range?: DamageVariantRange;
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

export interface UsageMove {
  move_key: string;
  move_name: string;
  usage_percent: number | null;
  damage_class?: string | null;
}

export interface MoveDetail {
  move_key: string;
  move_name: string;
  move_name_ja: string;
  type: string;
  type_name_ja: string;
  damage_class: string;
  damage_class_name_ja: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  target: string | null;
  makes_contact: boolean;
  short_desc: string;
  short_desc_ja: string;
}

export interface UsageItem {
  item_key: string;
  item_name: string;
  usage_percent: number;
}

export interface UsageAbility {
  ability_key: string;
  ability_name: string;
  usage_percent: number;
}

export interface UsageNature {
  nature_key: string;
  nature_name: string;
  plus: string | null;
  minus: string | null;
  usage_percent: number;
}

export interface EvSpreadEntry {
  spread: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  usage_percent: number;
}

export interface UsageTeammate {
  pokemon_key: string;
  pokemon_name: string;
  rank: number | null;
  usage_percent: number | null;
}

export interface ActualStatValues {
  max: number;
  semi_max?: number;
  no_invest?: number;
  min: number;
}

export interface ActualStats {
  hp: ActualStatValues;
  atk: ActualStatValues;
  def: ActualStatValues;
  spa: ActualStatValues;
  spd: ActualStatValues;
  spe: ActualStatValues;
}

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface PokemonUsage {
  pokemon_key: string;
  usage_percent: number;
  moves: UsageMove[];
  items: UsageItem[];
  abilities: UsageAbility[];
  natures?: UsageNature[];
  ev_spreads?: EvSpreadEntry[];
  teammates?: UsageTeammate[];
  base_stats?: BaseStats | null;
  actual_stats?: ActualStats | null;
}

export interface FieldStateSideMessage {
  reflect: boolean;
  light_screen: boolean;
  aurora_veil: boolean;
  tailwind: boolean;
  stealth_rock: boolean;
  spikes: number;
  toxic_spikes: number;
}

export interface FieldStateMessage {
  type: "field_state";
  weather: string | null;
  terrain: string | null;
  trick_room: boolean;
  player_side: FieldStateSideMessage;
  opponent_side: FieldStateSideMessage;
}

export type BattleTurnSide = "player" | "opponent";

export type BattleTurnStartReason = "scene_transition" | "event_fallback";

export type BattleTurnCloseReason =
  | "returned_to_neutral"
  | "battle_end"
  | "battle_result"
  | "match_teams"
  | "reset"
  | "disconnect";

export type ResolvedTurnStatus =
  | "resolved"
  | "incomplete"
  | "priority_mismatch"
  | "aborted";

export interface FieldSnapshot {
  weather: string | null;
  terrain: string | null;
  trickRoom: boolean;
  playerTailwind: boolean;
  opponentTailwind: boolean;
}

export interface SpeedContext {
  pokemonKey: string | null;
  name: string | null;
  actualSpeed: number | null;
  speedStatPoints: number | null;
  baseSpeed: number | null;
  speBoost: number;
  abilityId: string | null;
  itemId: string | null;
  itemIdentifier: string | null;
  tailwind: boolean;
  isMegaEvolved: boolean;
  megaPokemonKey: string | null;
  megaBaseSpeed: number | null;
}

export interface TurnStartSnapshot {
  field: FieldSnapshot;
  player: SpeedContext;
  opponent: SpeedContext;
}

export interface TurnAction {
  side: BattleTurnSide;
  pokemonKey: string;
  pokemonName: string | null;
  moveKey: string | null;
  moveName: string | null;
  priority: number;
  order: number;
}

export interface OpenTurnState {
  turnId: number;
  startedAt: number;
  startedBy: BattleTurnStartReason;
  phase: string;
  playerAction: TurnAction | null;
  opponentAction: TurnAction | null;
  actionOrder: BattleTurnSide[];
  startSnapshot: TurnStartSnapshot;
}

export interface ResolvedTurnSummary {
  turnId: number;
  startedAt: number;
  resolvedAt: number;
  startedBy: BattleTurnStartReason;
  closeReason: BattleTurnCloseReason;
  status: ResolvedTurnStatus;
  phase: string;
  firstMover: BattleTurnSide | null;
  playerAction: TurnAction | null;
  opponentAction: TurnAction | null;
  startSnapshot: TurnStartSnapshot;
  inferenceApplied: boolean;
  inferenceNote: string | null;
}

export interface SpeedObservation {
  turnId: number;
  opponentPokemonKey: string;
  firstMover: BattleTurnSide;
  playerBaseSpeed: number;
  playerSpeedContext: SpeedContext;
  opponentSpeedContext: SpeedContext;
  fieldSnapshotAtTurnStart: FieldSnapshot;
}

export interface InferredSpeedBounds {
  minSpeed: number | null;
  maxSpeed: number | null;
}

export interface SceneDebugDetection {
  scene: string;
  matched: boolean;
  confidence: number;
  region_name: string;
  elapsed_ms: number;
}

export interface SceneDebugStateMachine {
  top_level: string;
  sub_scene: string | null;
  scene_key: string;
  confidence: number;
  candidates: string[];
  pending_top: string | null;
  pending_top_count: number;
  pending_sub: string | null;
  pending_sub_count: number;
  no_sub_count: number;
  force_cooldown_active: boolean;
}

export interface SceneDebugResult {
  type: "scene_debug_result";
  error?: string;
  state_machine: SceneDebugStateMachine;
  detections: SceneDebugDetection[];
  scenes_tested: string[];
}
