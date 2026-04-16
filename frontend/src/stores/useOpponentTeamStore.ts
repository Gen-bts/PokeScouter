import { create } from "zustand";
import type {
  InferredSpeedBounds,
  MatchTeamsMessage,
  MegaFormDetail,
  PokemonCandidate,
  PokemonIdentified,
  UsageMove,
} from "../types";

/** 耐久配分プリセット（与ダメージ計算用） */
export type DefensePreset = "none" | "h" | "hb" | "hd";

/** 火力配分プリセット（被ダメージ計算用） */
export type OffensePreset = "none" | "a" | "c";

/** 性格補正対象ステータス */
export type NatureBoostStat = "atk" | "def" | "spa" | "spd" | "spe" | null;

export interface OpponentSlot {
  position: number;
  pokemonId: string | null;
  basePokemonKey: string | null;
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
  megaForms: MegaFormDetail[];
  activeMegaIndex: number | null;
  /** 行動順観測から推定した相手のすばやさ（努力・性格の理論レンジに対する補正前の境界）。`useSpeedInferenceStore` と同期 */
  inferredSpeedBounds: InferredSpeedBounds | null;
  /** 耐久配分プリセット（与ダメージ計算用） */
  defensePreset: DefensePreset;
  /** 火力配分プリセット（被ダメージ計算用） */
  offensePreset: OffensePreset;
  /** 性格で 1.1 倍にするステータス */
  natureBoostStat: NatureBoostStat;
}

function emptySlots(): OpponentSlot[] {
  return Array.from({ length: 6 }, (_, i) => ({
    position: i + 1,
    pokemonId: null,
    basePokemonKey: null,
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
    megaForms: [],
    activeMegaIndex: null,
    inferredSpeedBounds: null,
    defensePreset: "none",
    offensePreset: "a",
    natureBoostStat: null,
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
  applyMegaEvolution: (basePokemonKey: string, megaPokemonKey: string) => void;
  setSlotMegaForms: (position: number, megaForms: MegaFormDetail[]) => void;
  cycleMegaForm: (position: number) => void;
  /** `useSpeedInferenceStore.inferredBounds` を各スロットの `pokemonId` に反映（リセット時は `{}`） */
  applyInferredSpeedMap: (map: Record<string, InferredSpeedBounds>) => void;
  /** 耐久配分プリセットを設定 */
  setDefensePreset: (position: number, preset: DefensePreset) => void;
  /** 火力配分プリセットを設定 */
  setOffensePreset: (position: number, preset: OffensePreset) => void;
  /** 性格補正対象ステータスを設定 */
  setNatureBoostStat: (position: number, stat: NatureBoostStat) => void;
  /** 使用率データに基づいて火力配分の初期値を設定（まだ手動変更していない場合のみ） */
  autoSetOffensePresetFromMoves: (
    position: number,
    knownMoves: Array<{ id: string; damageClass?: string | null }>,
    usageMoves: UsageMove[],
  ) => void;
  clear: () => void;
}

function resolveAutoDisplayPosition(slots: OpponentSlot[]): number | null {
  return slots.find((slot) => slot.isSelected && slot.pokemonId !== null)?.position ?? null;
}

/**
 * 判明済み技と使用率技から火力配分プリセットを自動判定する。
 * 判明技を優先し、不足時は使用率技で補完して物理/特殊の比重を見る。
 */
function determineOffensePreset(
  knownMoves: Array<{ id: string; damageClass?: string | null }>,
  usageMoves: UsageMove[],
): OffensePreset {
  let physicalWeight = 0;
  let specialWeight = 0;

  const usageMoveMap = new Map(usageMoves.map((m) => [m.move_key, m]));
  const seenMoveKeys = new Set<string>();

  for (const km of knownMoves) {
    seenMoveKeys.add(km.id);
    const usageInfo = usageMoveMap.get(km.id);
    const damageClass = km.damageClass ?? usageInfo?.damage_class;
    const weight = usageInfo?.usage_percent ?? 10;
    if (damageClass === "physical") {
      physicalWeight += weight;
    } else if (damageClass === "special") {
      specialWeight += weight;
    }
  }

  for (const um of usageMoves) {
    if (seenMoveKeys.has(um.move_key)) continue;
    const damageClass = um.damage_class;
    const weight = um.usage_percent;
    if (damageClass === "physical") {
      physicalWeight += weight;
    } else if (damageClass === "special") {
      specialWeight += weight;
    }
  }

  const total = physicalWeight + specialWeight;
  if (total < 5) return "a";

  const physicalRatio = physicalWeight / total;
  if (physicalRatio >= 0.65) return "a";
  if (physicalRatio <= 0.35) return "c";

  return physicalWeight >= specialWeight ? "a" : "c";
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
          const nextPokemonId = p.pokemon_key ?? p.pokemon_id;
          next[idx] = {
            position: p.position,
            pokemonId: nextPokemonId,
            basePokemonKey: null,
            name: p.name,
            confidence: p.confidence,
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
            megaForms: [],
            activeMegaIndex: null,
            inferredSpeedBounds: null,
            defensePreset: "none",
            offensePreset: "a",
            natureBoostStat: null,
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
            basePokemonKey: same ? slot.basePokemonKey : null,
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
            megaForms: same ? slot.megaForms : [],
            activeMegaIndex: same ? slot.activeMegaIndex : null,
            inferredSpeedBounds: same ? slot.inferredSpeedBounds : null,
            defensePreset: same ? slot.defensePreset : "none",
            offensePreset: same ? slot.offensePreset : "a",
            natureBoostStat: same ? slot.natureBoostStat : null,
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
        basePokemonKey: null,
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
        megaForms: [],
        activeMegaIndex: null,
        inferredSpeedBounds: null,
        defensePreset: "none",
        offensePreset: "a",
        natureBoostStat: null,
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

  applyMegaEvolution: (basePokemonKey, megaPokemonKey) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.pokemonId === basePokemonKey);
      if (idx === -1) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      if (existing.pokemonId === megaPokemonKey) return state;
      const next = [...state.slots];
      // basePokemonKey を保存（未設定の場合のみ）
      const resolvedBaseKey = existing.basePokemonKey ?? basePokemonKey;
      // megaForms からメガキーに一致するインデックスを検索
      const megaIndex = existing.megaForms.findIndex(
        (mf) => mf.pokemon_key === megaPokemonKey,
      );
      next[idx] = {
        ...existing,
        pokemonId: megaPokemonKey,
        basePokemonKey: resolvedBaseKey,
        activeMegaIndex: megaIndex >= 0 ? megaIndex : null,
        inferredSpeedBounds: null,
        // メガシンカで特性が変わるためクリア（検出システムが新特性を拾う）
        ability: null,
        abilityId: null,
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

  setSlotMegaForms: (position, megaForms) =>
    set((state) => {
      const idx = position - 1;
      if (idx < 0 || idx >= 6) return state;
      const existing = state.slots[idx];
      if (!existing) return state;
      const next = [...state.slots];
      // pokemonId が既にメガキー（先行 applyMegaEvolution）の場合、activeMegaIndex を自動設定
      let { activeMegaIndex } = existing;
      if (activeMegaIndex === null && existing.pokemonId != null) {
        const matchIdx = megaForms.findIndex(
          (mf) => mf.pokemon_key === existing.pokemonId,
        );
        if (matchIdx >= 0) {
          activeMegaIndex = matchIdx;
        }
      }
      next[idx] = { ...existing, megaForms, activeMegaIndex };
      return { slots: next };
    }),

  applyInferredSpeedMap: (map) =>
    set((state) => {
      let changed = false;
      const next = state.slots.map((slot) => {
        if (!slot.pokemonId) {
          if (slot.inferredSpeedBounds !== null) {
            changed = true;
            return { ...slot, inferredSpeedBounds: null };
          }
          return slot;
        }
        const b = map[slot.pokemonId];
        if (b === undefined) {
          if (slot.inferredSpeedBounds !== null) {
            changed = true;
            return { ...slot, inferredSpeedBounds: null };
          }
          return slot;
        }
        const prev = slot.inferredSpeedBounds;
        if (prev?.minSpeed === b.minSpeed && prev?.maxSpeed === b.maxSpeed) {
          return slot;
        }
        changed = true;
        return { ...slot, inferredSpeedBounds: b };
      });
      return changed ? { slots: next } : state;
    }),

  cycleMegaForm: (position) =>
    set((state) => {
      const idx = position - 1;
      if (idx < 0 || idx >= 6) return state;
      const existing = state.slots[idx];
      if (!existing || existing.megaForms.length === 0) return state;
      const next = [...state.slots];
      const maxIndex = existing.megaForms.length - 1;
      // null → 0 → (1 if 2形態) → null
      const nextIndex =
        existing.activeMegaIndex === null
          ? 0
          : existing.activeMegaIndex < maxIndex
            ? existing.activeMegaIndex + 1
            : null;
      next[idx] = { ...existing, activeMegaIndex: nextIndex };
      return { slots: next };
    }),

  setDefensePreset: (position, preset) =>
    set((state) => {
      const idx = position - 1;
      if (idx < 0 || idx >= 6) return state;
      const existing = state.slots[idx];
      if (!existing || existing.defensePreset === preset) return state;
      const next = [...state.slots];
      next[idx] = { ...existing, defensePreset: preset };
      return { slots: next };
    }),

  setOffensePreset: (position, preset) =>
    set((state) => {
      const idx = position - 1;
      if (idx < 0 || idx >= 6) return state;
      const existing = state.slots[idx];
      if (!existing || existing.offensePreset === preset) return state;
      const next = [...state.slots];
      next[idx] = { ...existing, offensePreset: preset };
      return { slots: next };
    }),

  setNatureBoostStat: (position, stat) =>
    set((state) => {
      const idx = position - 1;
      if (idx < 0 || idx >= 6) return state;
      const existing = state.slots[idx];
      if (!existing || existing.natureBoostStat === stat) return state;
      const next = [...state.slots];
      next[idx] = { ...existing, natureBoostStat: stat };
      return { slots: next };
    }),

  autoSetOffensePresetFromMoves: (position, knownMoves, usageMoves) =>
    set((state) => {
      const idx = position - 1;
      if (idx < 0 || idx >= 6) return state;
      const existing = state.slots[idx];
      if (!existing) return state;

      const preset = determineOffensePreset(knownMoves, usageMoves);
      if (existing.offensePreset === preset) return state;

      const next = [...state.slots];
      next[idx] = { ...existing, offensePreset: preset };
      return { slots: next };
    }),

  clear: () =>
    set({
      slots: emptySlots(),
      displaySelectedPosition: null,
      displaySelectionMode: "auto",
    }),
}));

/** メガシンカ状態を考慮した実効 pokemonKey を返す. */
export function getEffectivePokemonKey(slot: OpponentSlot): string | null {
  if (slot.activeMegaIndex != null) {
    return slot.megaForms[slot.activeMegaIndex]?.pokemon_key ?? slot.pokemonId;
  }
  return slot.basePokemonKey ?? slot.pokemonId;
}
