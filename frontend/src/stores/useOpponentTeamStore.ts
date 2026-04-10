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
  isSelected: boolean;
  isAlive: boolean;
  hpPercent: number | null;
}

function emptySlots(): OpponentSlot[] {
  return Array.from({ length: 6 }, (_, i) => ({
    position: i + 1,
    pokemonId: null,
    name: null,
    confidence: 0,
    isManual: false,
    candidates: [],
    isSelected: false,
    isAlive: true,
    hpPercent: null,
  }));
}

interface OpponentTeamState {
  slots: OpponentSlot[];
  updateFromMatchTeams: (
    opponentTeam: MatchTeamsMessage["opponent_team"],
  ) => void;
  updateFromPokemonIdentified: (pokemon: PokemonIdentified[]) => void;
  manualSet: (position: number, pokemonId: number, name: string) => void;
  markSentOut: (speciesId: number) => void;
  markFainted: (speciesId: number) => void;
  updateOpponentActive: (speciesId: number, hpPercent: number | null) => void;
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
          const prev = state.slots[idx];
          const same = prev?.pokemonId === p.pokemon_id;
          next[idx] = {
            position: p.position,
            pokemonId: p.pokemon_id,
            name: p.name,
            confidence: p.confidence,
            isManual: false,
            candidates: [],
            isSelected: same ? prev.isSelected : false,
            isAlive: same ? prev.isAlive : true,
            hpPercent: same ? prev.hpPercent : null,
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
          const same = next[idx].pokemonId === p.pokemon_id;
          next[idx] = {
            position: p.position,
            pokemonId: p.pokemon_id,
            name: p.name ?? null,
            confidence: p.confidence,
            isManual: false,
            candidates: p.candidates ?? [],
            isSelected: same ? next[idx].isSelected : false,
            isAlive: same ? next[idx].isAlive : true,
            hpPercent: same ? next[idx].hpPercent : null,
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
        isSelected: false,
        isAlive: true,
        hpPercent: null,
      };
      return { slots: next };
    }),

  markSentOut: (speciesId) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const next = [...state.slots];
      next[idx] = { ...next[idx], isSelected: true, isAlive: true, hpPercent: next[idx].hpPercent ?? 100 };
      return { slots: next };
    }),

  markFainted: (speciesId) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const next = [...state.slots];
      next[idx] = { ...next[idx], isAlive: false, hpPercent: 0 };
      return { slots: next };
    }),

  updateOpponentActive: (speciesId, hpPercent) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const next = [...state.slots];
      next[idx] = {
        ...next[idx],
        isSelected: true,
        isAlive: hpPercent === null || hpPercent > 0,
        hpPercent: hpPercent ?? next[idx].hpPercent,
      };
      return { slots: next };
    }),

  clear: () => set({ slots: emptySlots() }),
}));
