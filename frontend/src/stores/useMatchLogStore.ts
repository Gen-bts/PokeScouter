import { create } from "zustand";
import type {
  BattleEventMessage,
  BattleResultMessage,
  MatchTeamsMessage,
  OcrResult,
  OpponentItemAbilityMessage,
  ResolvedTurnSummary,
  SceneChangeMessage,
  TeamSelectionMessage,
  TeamSelectionOrderMessage,
} from "../types";

interface BaseLogEntry {
  timestamp: number;
  seq: number | null;
  errorFlagged: boolean;
}

export interface SceneChangeLogEntry extends BaseLogEntry {
  kind: "scene_change";
  scene: string;
  topLevel: string;
  subScene: string | null;
  confidence: number;
}

export interface MatchTeamsLogEntry extends BaseLogEntry {
  kind: "match_teams";
  playerTeam: Array<{ position: number; name: string }>;
  opponentTeam: Array<{
    position: number;
    name: string | null;
    pokemonId: string | null;
  }>;
}

export interface TeamSelectionLogEntry extends BaseLogEntry {
  kind: "team_selection";
  selectedPositions: number[];
}

export interface TeamSelectionOrderLogEntry extends BaseLogEntry {
  kind: "team_selection_order";
  selectionOrder: Record<number, number>;
}

export interface BattleResultLogEntry extends BaseLogEntry {
  kind: "battle_result";
  result: "win" | "lose" | "unknown";
}

export interface OcrResultLogEntry extends BaseLogEntry {
  kind: "ocr_result";
  scene: string;
  regions: Array<{ name: string; text: string }>;
}

export interface BattleEventLogEntry extends BaseLogEntry {
  kind: "battle_event";
  eventType: string;
  side: "player" | "opponent";
  rawText: string;
  pokemonName: string | null;
  speciesId: string | null;
  moveName: string | null;
  moveId: string | null;
  details: Record<string, unknown>;
}

export interface HpChangeLogEntry extends BaseLogEntry {
  kind: "hp_change";
  pokemonName: string;
  fromHp: number;
  toHp: number;
  fromCurrentHp?: number;
  fromMaxHp?: number;
  toCurrentHp?: number;
  toMaxHp?: number;
}

export interface ItemAbilityLogEntry extends BaseLogEntry {
  kind: "item_ability";
  detectionType: "item" | "ability";
  pokemonName: string;
  traitName: string;
  rawText?: string;
}

export interface PokemonCorrectionLogEntry extends BaseLogEntry {
  kind: "pokemon_correction";
  position: number;
  originalPokemonId: string | null;
  originalName: string | null;
  originalConfidence: number | null;
  correctedPokemonId: string;
  correctedName: string;
  source: "candidate" | "manual_input";
}

export interface TurnSummaryLogEntry extends BaseLogEntry {
  kind: "turn_summary";
  turnId: number;
  status: ResolvedTurnSummary["status"];
  firstMover: ResolvedTurnSummary["firstMover"];
  playerPokemonId: string | null;
  opponentPokemonId: string | null;
  inferenceApplied: boolean;
  inferenceNote: string | null;
  closeReason: ResolvedTurnSummary["closeReason"];
}

export type MatchLogEntry =
  | SceneChangeLogEntry
  | MatchTeamsLogEntry
  | TeamSelectionLogEntry
  | TeamSelectionOrderLogEntry
  | BattleResultLogEntry
  | OcrResultLogEntry
  | BattleEventLogEntry
  | HpChangeLogEntry
  | ItemAbilityLogEntry
  | PokemonCorrectionLogEntry
  | TurnSummaryLogEntry;

interface MatchLogState {
  entries: MatchLogEntry[];
  addSceneChange: (msg: SceneChangeMessage) => void;
  addMatchTeams: (msg: MatchTeamsMessage) => void;
  addTeamSelection: (msg: TeamSelectionMessage) => void;
  addTeamSelectionOrder: (msg: TeamSelectionOrderMessage) => void;
  addBattleResult: (msg: BattleResultMessage) => void;
  addOcrResult: (msg: OcrResult) => void;
  addBattleEvent: (msg: BattleEventMessage) => void;
  addHpChange: (pokemonName: string, fromHp: number, toHp: number, actualHp?: { fromCurrent: number; fromMax: number; toCurrent: number; toMax: number }) => void;
  addItemAbility: (msg: OpponentItemAbilityMessage) => void;
  addPokemonCorrection: (
    position: number,
    originalPokemonId: string | null,
    originalName: string | null,
    originalConfidence: number | null,
    correctedPokemonId: string,
    correctedName: string,
    source: "candidate" | "manual_input",
  ) => void;
  addTurnSummary: (summary: ResolvedTurnSummary) => void;
  toggleErrorFlag: (seq: number | null, timestamp: number, kind: string) => void;
  clear: () => void;
}

const MAX_ENTRIES = 100;
const HP_COALESCE_WINDOW_MS = 3000;
const HP_COALESCE_SCAN_LIMIT = 10;

function isSameEntry(a: MatchLogEntry, b: MatchLogEntry): boolean {
  if (a.kind !== b.kind) return false;
  const { timestamp: _a, seq: _sa, errorFlagged: _fa, ...restA } = a;
  const { timestamp: _b, seq: _sb, errorFlagged: _fb, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

function append(entries: MatchLogEntry[], entry: MatchLogEntry) {
  const last = entries[entries.length - 1];
  if (last && isSameEntry(last, entry)) return { entries };
  const next = [...entries, entry];
  return { entries: next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next };
}

export const useMatchLogStore = create<MatchLogState>((set) => ({
  entries: [],
  addSceneChange: (msg) =>
    set((state) => {
      if (msg.scene === "move_select" || msg.scene === "team_confirm") return state;
      return append(state.entries, {
        kind: "scene_change",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        scene: msg.scene,
        topLevel: msg.top_level,
        subScene: msg.sub_scene,
        confidence: msg.confidence,
      });
    }),
  addMatchTeams: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "match_teams",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        playerTeam: msg.player_team,
        opponentTeam: msg.opponent_team.map((p) => ({
          position: p.position,
          name: p.name,
          pokemonId: p.pokemon_key ?? p.pokemon_id,
        })),
      }),
    ),
  addTeamSelection: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "team_selection",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        selectedPositions: msg.selected_positions,
      }),
    ),
  addTeamSelectionOrder: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "team_selection_order",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        selectionOrder: Object.fromEntries(
          Object.entries(msg.selection_order).map(([k, v]) => [Number(k), v]),
        ),
      }),
    ),
  addBattleResult: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "battle_result",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        result: msg.result,
      }),
    ),
  addOcrResult: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "ocr_result",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        scene: msg.scene,
        regions: msg.regions.map((r) => ({ name: r.name, text: r.text })),
      }),
    ),
  addBattleEvent: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "battle_event",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        eventType: msg.event_type,
        side: msg.side,
        rawText: msg.raw_text,
        pokemonName: msg.pokemon_name,
        speciesId: msg.pokemon_key ?? msg.species_id,
        moveName: msg.move_name,
        moveId: msg.move_key ?? msg.move_id,
        details: msg.details,
      }),
    ),
  addHpChange: (pokemonName, fromHp, toHp, actualHp) =>
    set((state) => {
      const now = Date.now();
      const scanStart = Math.max(0, state.entries.length - HP_COALESCE_SCAN_LIMIT);

      for (let i = state.entries.length - 1; i >= scanStart; i--) {
        const candidate = state.entries[i]!;
        if (candidate.kind !== "hp_change") continue;
        if (candidate.pokemonName !== pokemonName) continue;
        if (now - candidate.timestamp > HP_COALESCE_WINDOW_MS) break;

        // 整数現在 HP がある場合はそちらで方向判定（％よりノイズに強い）
        let existingDir: number;
        let newDir: number;
        if (
          actualHp?.toCurrent != null &&
          candidate.toCurrentHp != null &&
          candidate.fromCurrentHp != null
        ) {
          existingDir = Math.sign(candidate.toCurrentHp - candidate.fromCurrentHp);
          newDir = Math.sign(actualHp.toCurrent - candidate.toCurrentHp);
        } else {
          existingDir = Math.sign(candidate.toHp - candidate.fromHp);
          newDir = Math.sign(toHp - candidate.toHp);
        }
        if (newDir !== 0 && existingDir !== 0 && newDir !== existingDir) break;

        const updated = [...state.entries];
        updated[i] = {
          ...candidate,
          timestamp: now,
          toHp,
          ...(actualHp && {
            toCurrentHp: actualHp.toCurrent,
            toMaxHp: actualHp.toMax,
          }),
        };
        return { entries: updated };
      }

      return append(state.entries, {
        kind: "hp_change",
        timestamp: now,
        seq: null,
        errorFlagged: false,
        pokemonName,
        fromHp,
        toHp,
        ...(actualHp && {
          fromCurrentHp: actualHp.fromCurrent,
          fromMaxHp: actualHp.fromMax,
          toCurrentHp: actualHp.toCurrent,
          toMaxHp: actualHp.toMax,
        }),
      });
    }),
  addItemAbility: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "item_ability",
        timestamp: Date.now(),
        seq: msg.seq ?? null,
        errorFlagged: false,
        detectionType: msg.detection_type,
        pokemonName: msg.pokemon_name,
        traitName: msg.trait_name,
        rawText: msg.raw_text,
      }),
    ),
  addPokemonCorrection: (position, originalPokemonId, originalName, originalConfidence, correctedPokemonId, correctedName, source) =>
    set((state) =>
      append(state.entries, {
        kind: "pokemon_correction",
        timestamp: Date.now(),
        seq: null,
        errorFlagged: false,
        position,
        originalPokemonId,
        originalName,
        originalConfidence,
        correctedPokemonId,
        correctedName,
        source,
      }),
    ),
  addTurnSummary: (summary) =>
    set((state) =>
      append(state.entries, {
        kind: "turn_summary",
        timestamp: summary.resolvedAt,
        seq: null,
        errorFlagged: false,
        turnId: summary.turnId,
        status: summary.status,
        firstMover: summary.firstMover,
        playerPokemonId: summary.playerAction?.pokemonKey ?? summary.startSnapshot.player.pokemonKey,
        opponentPokemonId: summary.opponentAction?.pokemonKey ?? summary.startSnapshot.opponent.pokemonKey,
        inferenceApplied: summary.inferenceApplied,
        inferenceNote: summary.inferenceNote,
        closeReason: summary.closeReason,
      }),
    ),
  toggleErrorFlag: (seq, timestamp, kind) =>
    set((state) => {
      const idx = state.entries.findIndex((e) =>
        seq != null ? e.seq === seq : e.timestamp === timestamp && e.kind === kind,
      );
      if (idx === -1) return state;
      const updated = [...state.entries];
      const target = updated[idx]!;
      updated[idx] = Object.assign({}, target, { errorFlagged: !target.errorFlagged }) as MatchLogEntry;
      return { entries: updated };
    }),
  clear: () => set({ entries: [] }),
}));
