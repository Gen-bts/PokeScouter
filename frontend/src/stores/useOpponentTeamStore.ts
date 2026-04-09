import { create } from "zustand";
import type {
  MatchTeamsMessage,
  PokemonCandidate,
  PokemonIdentified,
} from "../types";

export interface OpponentSlot {
  position: number;
  pokemonId: number | null;
  name: string | null;
  confidence: number;
  isManual: boolean;
  candidates: PokemonCandidate[];
}

function emptySlots(): OpponentSlot[] {
  return Array.from({ length: 6 }, (_, i) => ({
    position: i + 1,
    pokemonId: null,
    name: null,
    confidence: 0,
    isManual: false,
    candidates: [],
  }));
}

interface OpponentTeamState {
  slots: OpponentSlot[];
  updateFromMatchTeams: (
    opponentTeam: MatchTeamsMessage["opponent_team"],
  ) => void;
  updateFromPokemonIdentified: (pokemon: PokemonIdentified[]) => void;
  manualSet: (position: number, pokemonId: number, name: string) => void;
  clear: () => void;
}

export const useOpponentTeamStore = create<OpponentTeamState>((set) => ({
  slots: emptySlots(),

  updateFromMatchTeams: (opponentTeam) =>
    set((state) => {
      const next = emptySlots();
      for (const p of opponentTeam) {
        const idx = p.position - 1;
        if (idx < 0 || idx >= 6) continue;
        // 手動設定済みスロットは保持
        if (state.slots[idx]?.isManual) {
          next[idx] = state.slots[idx];
        } else {
          next[idx] = {
            position: p.position,
            pokemonId: p.pokemon_id,
            name: p.name,
            confidence: p.confidence,
            isManual: false,
            candidates: [],
          };
        }
      }
      return { slots: next };
    }),

  updateFromPokemonIdentified: (pokemon) =>
    set((state) => {
      const next = [...state.slots];
      for (const p of pokemon) {
        const idx = p.position - 1;
        if (idx < 0 || idx >= 6) continue;
        // 手動設定済みスロットはスキップ
        if (next[idx].isManual) continue;
        // より高い信頼度の場合、またはスロットが空の場合に更新
        if (
          p.pokemon_id !== null &&
          (next[idx].pokemonId === null || p.confidence > next[idx].confidence)
        ) {
          next[idx] = {
            position: p.position,
            pokemonId: p.pokemon_id,
            name: p.name ?? null,
            confidence: p.confidence,
            isManual: false,
            candidates: p.candidates ?? [],
          };
        }
      }
      return { slots: next };
    }),

  manualSet: (position, pokemonId, name) =>
    set((state) => {
      const next = [...state.slots];
      const idx = position - 1;
      if (idx < 0 || idx >= 6) return state;
      next[idx] = {
        position,
        pokemonId,
        name,
        confidence: 1,
        isManual: true,
        candidates: [],
      };
      return { slots: next };
    }),

  clear: () => set({ slots: emptySlots() }),
}));
