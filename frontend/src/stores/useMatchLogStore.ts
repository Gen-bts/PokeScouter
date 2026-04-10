import { create } from "zustand";
import type {
  BattleEventMessage,
  BattleResultMessage,
  MatchTeamsMessage,
  OcrResult,
  SceneChangeMessage,
  TeamSelectionMessage,
} from "../types";

interface BaseLogEntry {
  timestamp: number;
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
    pokemonId: number | null;
  }>;
}

export interface TeamSelectionLogEntry extends BaseLogEntry {
  kind: "team_selection";
  selectedPositions: number[];
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
  speciesId: number | null;
  moveName: string | null;
  moveId: number | null;
  details: Record<string, unknown>;
}

export type MatchLogEntry =
  | SceneChangeLogEntry
  | MatchTeamsLogEntry
  | TeamSelectionLogEntry
  | BattleResultLogEntry
  | OcrResultLogEntry
  | BattleEventLogEntry;

interface MatchLogState {
  entries: MatchLogEntry[];
  addSceneChange: (msg: SceneChangeMessage) => void;
  addMatchTeams: (msg: MatchTeamsMessage) => void;
  addTeamSelection: (msg: TeamSelectionMessage) => void;
  addBattleResult: (msg: BattleResultMessage) => void;
  addOcrResult: (msg: OcrResult) => void;
  addBattleEvent: (msg: BattleEventMessage) => void;
  clear: () => void;
}

const MAX_ENTRIES = 100;

function append(entries: MatchLogEntry[], entry: MatchLogEntry) {
  const next = [...entries, entry];
  return { entries: next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next };
}

export const useMatchLogStore = create<MatchLogState>((set) => ({
  entries: [],
  addSceneChange: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "scene_change",
        timestamp: Date.now(),
        scene: msg.scene,
        topLevel: msg.top_level,
        subScene: msg.sub_scene,
        confidence: msg.confidence,
      }),
    ),
  addMatchTeams: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "match_teams",
        timestamp: Date.now(),
        playerTeam: msg.player_team,
        opponentTeam: msg.opponent_team.map((p) => ({
          position: p.position,
          name: p.name,
          pokemonId: p.pokemon_id,
        })),
      }),
    ),
  addTeamSelection: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "team_selection",
        timestamp: Date.now(),
        selectedPositions: msg.selected_positions,
      }),
    ),
  addBattleResult: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "battle_result",
        timestamp: Date.now(),
        result: msg.result,
      }),
    ),
  addOcrResult: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "ocr_result",
        timestamp: Date.now(),
        scene: msg.scene,
        regions: msg.regions.map((r) => ({ name: r.name, text: r.text })),
      }),
    ),
  addBattleEvent: (msg) =>
    set((state) =>
      append(state.entries, {
        kind: "battle_event",
        timestamp: Date.now(),
        eventType: msg.event_type,
        side: msg.side,
        rawText: msg.raw_text,
        pokemonName: msg.pokemon_name,
        speciesId: msg.species_id,
        moveName: msg.move_name,
        moveId: msg.move_id,
        details: msg.details,
      }),
    ),
  clear: () => set({ entries: [] }),
}));
