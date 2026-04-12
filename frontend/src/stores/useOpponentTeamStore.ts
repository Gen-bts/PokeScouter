import { create } from "zustand";
import type {
  MatchTeamsMessage,
  PokemonCandidate,
  PokemonIdentified,
} from "../types";

export interface OpponentSlot {
  position: number;
  pokemonId: string | null;
  name: string | null;
  confidence: number;
  isManual: boolean;
  candidates: PokemonCandidate[];
  isSelected: boolean;
  isAlive: boolean;
  hpPercent: number | null;
  boosts: Record<string, number>;
  ability: string | null;
  abilityId: string | null;
  item: string | null;
  itemId: string | null;
  wasSentOut: boolean;
  itemIdentifier: string | null;
  knownMoves: Array<{ name: string; id: string }>;
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
    boosts: {},
    ability: null,
    abilityId: null,
    item: null,
    itemId: null,
    wasSentOut: false,
    itemIdentifier: null,
    knownMoves: [],
  }));
}

interface OpponentTeamState {
  slots: OpponentSlot[];
  displaySelectedPosition: number | null;
  displaySelectionMode: "auto" | "manual";
  updateFromMatchTeams: (
    opponentTeam: MatchTeamsMessage["opponent_team"],
  ) => void;
  updateFromPokemonIdentified: (pokemon: PokemonIdentified[]) => void;
  manualSet: (position: number, pokemonId: string, name: string) => void;
  selectDisplayTarget: (position: number | null) => void;
  syncDisplayTargetToActive: (speciesId: string) => void;
  resetDisplaySelection: () => void;
  markSentOut: (speciesId: string) => void;
  markFainted: (speciesId: string) => void;
  updateOpponentActive: (speciesId: string, hpPercent: number | null) => void;
  applyStatChange: (speciesId: string, stat: string, stages: number) => void;
  setItemAbility: (speciesId: string, detectionType: "ability" | "item", name: string, id: string, identifier?: string | null) => void;
  addKnownMove: (speciesId: string, moveName: string, moveId: string) => void;
  clear: () => void;
}

function resolveAutoDisplayPosition(slots: OpponentSlot[]): number | null {
  return slots.find((slot) => slot.isSelected && slot.pokemonId !== null)?.position ?? null;
}

function resolveDisplaySelection(
  slots: OpponentSlot[],
  mode: "auto" | "manual",
  currentPosition: number | null,
): {
  displaySelectedPosition: number | null;
  displaySelectionMode: "auto" | "manual";
} {
  if (mode === "manual") {
    const selectedSlot = currentPosition != null ? slots[currentPosition - 1] : null;
    if (selectedSlot?.pokemonId != null) {
      return {
        displaySelectedPosition: currentPosition,
        displaySelectionMode: "manual",
      };
    }
  }
  return {
    displaySelectedPosition: resolveAutoDisplayPosition(slots),
    displaySelectionMode: "auto",
  };
}

export const useOpponentTeamStore = create<OpponentTeamState>((set) => ({
  slots: emptySlots(),
  displaySelectedPosition: null,
  displaySelectionMode: "auto",

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
          const nextPokemonId = p.pokemon_key ?? p.pokemon_id;
          const same = prev?.pokemonId === nextPokemonId;
          next[idx] = {
            position: p.position,
            pokemonId: nextPokemonId,
            name: p.name,
            confidence: p.confidence,
            isManual: false,
            candidates: [],
            isSelected: same ? prev.isSelected : false,
            isAlive: same ? prev.isAlive : true,
            hpPercent: same ? prev.hpPercent : null,
            boosts: same ? prev.boosts : {},
            ability: same ? prev.ability : null,
            abilityId: same ? prev.abilityId : null,
            item: same ? prev.item : null,
            itemId: same ? prev.itemId : null,
            wasSentOut: same ? prev.wasSentOut : false,
            itemIdentifier: same ? prev.itemIdentifier : null,
            knownMoves: same ? prev.knownMoves : [],
          };
        }
      }
      return {
        slots: next,
        ...resolveDisplaySelection(
          next,
          state.displaySelectionMode,
          state.displaySelectedPosition,
        ),
      };
    }),

  updateFromPokemonIdentified: (pokemon) =>
    set((state) => {
      const next = [...state.slots];
      for (const p of pokemon) {
        const idx = p.position - 1;
        if (idx < 0 || idx >= 6) continue;
        const slot = next[idx];
        if (!slot) continue;
        // 手動設定済みスロットはスキップ
        if (slot.isManual) continue;
        // より高い信頼度の場合、またはスロットが空の場合に更新
        if (
          (p.pokemon_key ?? p.pokemon_id) !== null &&
          (slot.pokemonId === null || p.confidence > slot.confidence)
        ) {
          const nextPokemonId = p.pokemon_key ?? p.pokemon_id;
          const same = slot.pokemonId === nextPokemonId;
          next[idx] = {
            position: p.position,
            pokemonId: nextPokemonId,
            name: p.name ?? null,
            confidence: p.confidence,
            isManual: false,
            candidates: p.candidates ?? [],
            isSelected: same ? slot.isSelected : false,
            isAlive: same ? slot.isAlive : true,
            hpPercent: same ? slot.hpPercent : null,
            boosts: same ? slot.boosts : {},
            ability: same ? slot.ability : null,
            abilityId: same ? slot.abilityId : null,
            item: same ? slot.item : null,
            itemId: same ? slot.itemId : null,
            wasSentOut: same ? slot.wasSentOut : false,
            itemIdentifier: same ? slot.itemIdentifier : null,
            knownMoves: same ? slot.knownMoves : [],
          };
        }
      }
      return {
        slots: next,
        ...resolveDisplaySelection(
          next,
          state.displaySelectionMode,
          state.displaySelectedPosition,
        ),
      };
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
        boosts: {},
        ability: null,
        abilityId: null,
        item: null,
        itemId: null,
        wasSentOut: false,
        itemIdentifier: null,
        knownMoves: [],
      };
      return {
        slots: next,
        ...resolveDisplaySelection(
          next,
          state.displaySelectionMode,
          state.displaySelectedPosition,
        ),
      };
    }),

  selectDisplayTarget: (position) =>
    set((state) => {
      if (position == null) {
        return {
          displaySelectionMode: "auto",
          displaySelectedPosition: resolveAutoDisplayPosition(state.slots),
        };
      }
      const slot = state.slots[position - 1];
      if (!slot || slot.pokemonId == null) {
        return state;
      }
      return {
        displaySelectionMode: "manual",
        displaySelectedPosition: position,
      };
    }),

  syncDisplayTargetToActive: (speciesId) =>
    set((state) => {
      if (state.displaySelectionMode !== "auto") {
        return state;
      }
      const slot = state.slots.find((entry) => entry.pokemonId === speciesId);
      if (!slot || slot.position === state.displaySelectedPosition) {
        return state;
      }
      return {
        displaySelectedPosition: slot.position,
      };
    }),

  resetDisplaySelection: () =>
    set((state) => ({
      displaySelectionMode: "auto",
      displaySelectedPosition: resolveAutoDisplayPosition(state.slots),
    })),

  markSentOut: (speciesId) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      const next = state.slots.map((slot, i) => {
        if (i === idx) {
          return { ...slot, isSelected: true, wasSentOut: true, isAlive: true, hpPercent: slot.hpPercent ?? 100 };
        }
        // 他のスロットが選択中(場にいた)ならブーストをリセット(交代で消滅)
        if (slot.isSelected) {
          return { ...slot, isSelected: false, boosts: {} };
        }
        return slot;
      });
      return {
        slots: next,
        ...resolveDisplaySelection(
          next,
          state.displaySelectionMode,
          state.displaySelectedPosition,
        ),
      };
    }),

  markFainted: (speciesId) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      if (!existing.isAlive && existing.hpPercent === 0) return state;
      const next = [...state.slots];
      next[idx] = { ...existing, isAlive: false, hpPercent: 0, boosts: {} };
      return {
        slots: next,
        ...resolveDisplaySelection(
          next,
          state.displaySelectionMode,
          state.displaySelectedPosition,
        ),
      };
    }),

  updateOpponentActive: (speciesId, hpPercent) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      const newAlive = hpPercent === null || hpPercent > 0;
      const newHp = hpPercent ?? existing.hpPercent;
      // 変更なしなら state をそのまま返してストア更新を回避
      if (existing.isSelected && existing.wasSentOut && existing.isAlive === newAlive && existing.hpPercent === newHp) {
        return state;
      }
      const next = [...state.slots];
      next[idx] = {
        ...existing,
        isSelected: true,
        wasSentOut: true,
        isAlive: newAlive,
        hpPercent: newHp,
      };
      return {
        slots: next,
        ...resolveDisplaySelection(
          next,
          state.displaySelectionMode,
          state.displaySelectedPosition,
        ),
      };
    }),

  applyStatChange: (speciesId, stat, stages) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      const current = existing.boosts[stat] ?? 0;
      const clamped = Math.max(-6, Math.min(6, current + stages));
      const next = [...state.slots];
      const newBoosts = { ...existing.boosts, [stat]: clamped };
      // 0段階のエントリは削除してクリーンに保つ
      if (clamped === 0) delete newBoosts[stat];
      next[idx] = { ...existing, boosts: newBoosts };
      return { slots: next };
    }),

  setItemAbility: (speciesId, detectionType, name, id, identifier) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      if (detectionType === "ability") {
        if (existing.ability === name && existing.abilityId === id) return state;
      } else {
        if (existing.item === name && existing.itemId === id && existing.itemIdentifier === (identifier ?? null)) return state;
      }
      const next = [...state.slots];
      if (detectionType === "ability") {
        next[idx] = { ...existing, ability: name, abilityId: id };
      } else {
        next[idx] = {
          ...existing,
          item: name,
          itemId: id,
          itemIdentifier: identifier ?? id ?? null,
        };
      }
      return { slots: next };
    }),

  addKnownMove: (speciesId, moveName, moveId) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === speciesId);
      if (idx === -1) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      if (existing.knownMoves.some((m) => m.id === moveId)) return state;
      if (existing.knownMoves.length >= 4) return state;
      const next = [...state.slots];
      next[idx] = {
        ...existing,
        knownMoves: [...existing.knownMoves, { name: moveName, id: moveId }],
      };
      return { slots: next };
    }),

  clear: () =>
    set({
      slots: emptySlots(),
      displaySelectedPosition: null,
      displaySelectionMode: "auto",
    }),
}));
