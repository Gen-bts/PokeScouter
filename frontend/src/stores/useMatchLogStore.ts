import { create } from "zustand";
import type {
  BattleResultMessage,
  MatchTeamsMessage,
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

export type MatchLogEntry =
  | SceneChangeLogEntry
  | MatchTeamsLogEntry
  | TeamSelectionLogEntry
  | BattleResultLogEntry;

interface MatchLogState {
  entries: MatchLogEntry[];
  addSceneChange: (msg: SceneChangeMessage) => void;
  addMatchTeams: (msg: MatchTeamsMessage) => void;
  addTeamSelection: (msg: TeamSelectionMessage) => void;
  addBattleResult: (msg: BattleResultMessage) => void;
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
  clear: () => set({ entries: [] }),
}));
