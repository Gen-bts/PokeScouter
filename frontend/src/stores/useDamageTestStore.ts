import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PokemonKey, MoveKey, AbilityKey, ItemKey } from "../types";

export type Stat = "atk" | "def" | "spa" | "spd" | "spe";
export type StatKey = "hp" | Stat;
export type StatusKind = "slp" | "psn" | "brn" | "frz" | "par" | "tox";
// 性格補正（攻撃側: atk/spa、防御側: def/spd にわざ種類で振り分け）
export type NatureMultiplier = 0.9 | 1 | 1.1;

export const STAT_KEYS: readonly StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
export const BOOST_STATS: readonly Stat[] = ["atk", "def", "spa", "spd", "spe"] as const;
export const NATURE_MULTIPLIERS: readonly NatureMultiplier[] = [0.9, 1, 1.1] as const;

export interface SideFlags {
  reflect: boolean;
  light_screen: boolean;
  aurora_veil: boolean;
  tailwind: boolean;
}

export interface DamageTestSide {
  pokemonKey: PokemonKey | null;
  evAllocation: Record<StatKey, number>; // each 0-32
  natureMultiplier: NatureMultiplier; // わざ種類に対応する側のステータスにかける
  abilityKey: AbilityKey | null;
  itemKey: ItemKey | null;
  boosts: Partial<Record<Stat, number>>; // -6..+6
  status: StatusKind | null;
  isMegaActive: boolean;
}

export interface DamageTestAttacker extends DamageTestSide {
  moveKeys: (MoveKey | null)[]; // length 4
}

export interface DamageTestField {
  weather: string | null;
  terrain: string | null;
  attackerSide: SideFlags;
  defenderSide: SideFlags;
}

export interface DamageTestMoveResult {
  move_key: string;
  move_name: string;
  damage: { min: number; max: number };
  min_percent: number;
  max_percent: number;
  guaranteed_ko: number;
  type_effectiveness: number;
  description: string;
}

export interface DamageTestResult {
  results: Array<{
    defender_pokemon_key: string;
    defender_hp: number;
    moves: DamageTestMoveResult[];
  }>;
  attacker_stats: Record<StatKey, number>;
  defender_stats: Record<StatKey, number>;
  attacker_pokemon_key: string;
  defender_pokemon_key: string;
}

const emptyEv = (): Record<StatKey, number> => ({
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
});

const emptyFlags = (): SideFlags => ({
  reflect: false,
  light_screen: false,
  aurora_veil: false,
  tailwind: false,
});

const initialSide = (): DamageTestSide => ({
  pokemonKey: null,
  evAllocation: emptyEv(),
  natureMultiplier: 1,
  abilityKey: null,
  itemKey: null,
  boosts: {},
  status: null,
  isMegaActive: false,
});

const initialAttacker = (): DamageTestAttacker => ({
  ...initialSide(),
  moveKeys: [null, null, null, null],
});

const initialField = (): DamageTestField => ({
  weather: null,
  terrain: null,
  attackerSide: emptyFlags(),
  defenderSide: emptyFlags(),
});

export interface DamageTestState {
  attacker: DamageTestAttacker;
  defender: DamageTestSide;
  field: DamageTestField;
  results: DamageTestResult | null;
  loading: boolean;
  error: string | null;

  setAttackerPokemon: (key: PokemonKey | null) => void;
  setDefenderPokemon: (key: PokemonKey | null) => void;
  setAttackerEv: (stat: StatKey, value: number) => void;
  setDefenderEv: (stat: StatKey, value: number) => void;
  setAttackerNatureMultiplier: (m: NatureMultiplier) => void;
  setDefenderNatureMultiplier: (m: NatureMultiplier) => void;
  setAttackerBoost: (stat: Stat, value: number) => void;
  setDefenderBoost: (stat: Stat, value: number) => void;
  setAttackerAbility: (key: AbilityKey | null) => void;
  setDefenderAbility: (key: AbilityKey | null) => void;
  setAttackerItem: (key: ItemKey | null) => void;
  setDefenderItem: (key: ItemKey | null) => void;
  setAttackerMove: (index: number, key: MoveKey | null) => void;
  setAttackerStatus: (status: StatusKind | null) => void;
  setDefenderStatus: (status: StatusKind | null) => void;
  toggleAttackerMega: () => void;
  toggleDefenderMega: () => void;
  setField: (updater: (prev: DamageTestField) => DamageTestField) => void;
  setResults: (r: DamageTestResult | null) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  resetAttacker: () => void;
  resetDefender: () => void;
}

const clampEv = (v: number) => Math.max(0, Math.min(32, Math.floor(v)));
const clampBoost = (v: number) => Math.max(-6, Math.min(6, Math.floor(v)));

export const useDamageTestStore = create<DamageTestState>()(
  persist(
    (set) => ({
      attacker: initialAttacker(),
      defender: initialSide(),
      field: initialField(),
      results: null,
      loading: false,
      error: null,

      setAttackerPokemon: (key) =>
        set((s) => ({
          attacker: {
            ...s.attacker,
            pokemonKey: key,
            abilityKey: null,
            moveKeys: [null, null, null, null],
            isMegaActive: false,
          },
        })),

      setDefenderPokemon: (key) =>
        set((s) => ({
          defender: {
            ...s.defender,
            pokemonKey: key,
            abilityKey: null,
            isMegaActive: false,
          },
        })),

      setAttackerEv: (stat, value) =>
        set((s) => ({
          attacker: {
            ...s.attacker,
            evAllocation: { ...s.attacker.evAllocation, [stat]: clampEv(value) },
          },
        })),

      setDefenderEv: (stat, value) =>
        set((s) => ({
          defender: {
            ...s.defender,
            evAllocation: { ...s.defender.evAllocation, [stat]: clampEv(value) },
          },
        })),

      setAttackerNatureMultiplier: (m) =>
        set((s) => ({ attacker: { ...s.attacker, natureMultiplier: m } })),

      setDefenderNatureMultiplier: (m) =>
        set((s) => ({ defender: { ...s.defender, natureMultiplier: m } })),

      setAttackerBoost: (stat, value) =>
        set((s) => {
          const v = clampBoost(value);
          const next = { ...s.attacker.boosts };
          if (v === 0) delete next[stat];
          else next[stat] = v;
          return { attacker: { ...s.attacker, boosts: next } };
        }),

      setDefenderBoost: (stat, value) =>
        set((s) => {
          const v = clampBoost(value);
          const next = { ...s.defender.boosts };
          if (v === 0) delete next[stat];
          else next[stat] = v;
          return { defender: { ...s.defender, boosts: next } };
        }),

      setAttackerAbility: (key) =>
        set((s) => ({ attacker: { ...s.attacker, abilityKey: key } })),

      setDefenderAbility: (key) =>
        set((s) => ({ defender: { ...s.defender, abilityKey: key } })),

      setAttackerItem: (key) =>
        set((s) => ({
          attacker: {
            ...s.attacker,
            itemKey: key,
            isMegaActive: s.attacker.isMegaActive && key !== null ? s.attacker.isMegaActive : false,
          },
        })),

      setDefenderItem: (key) =>
        set((s) => ({
          defender: {
            ...s.defender,
            itemKey: key,
            isMegaActive: s.defender.isMegaActive && key !== null ? s.defender.isMegaActive : false,
          },
        })),

      setAttackerMove: (index, key) =>
        set((s) => {
          const moves = [...s.attacker.moveKeys];
          moves[index] = key;
          return { attacker: { ...s.attacker, moveKeys: moves } };
        }),

      setAttackerStatus: (status) =>
        set((s) => ({ attacker: { ...s.attacker, status } })),

      setDefenderStatus: (status) =>
        set((s) => ({ defender: { ...s.defender, status } })),

      toggleAttackerMega: () =>
        set((s) => ({
          attacker: { ...s.attacker, isMegaActive: !s.attacker.isMegaActive },
        })),

      toggleDefenderMega: () =>
        set((s) => ({
          defender: { ...s.defender, isMegaActive: !s.defender.isMegaActive },
        })),

      setField: (updater) => set((s) => ({ field: updater(s.field) })),

      setResults: (r) => set({ results: r }),
      setLoading: (v) => set({ loading: v }),
      setError: (msg) => set({ error: msg }),

      resetAttacker: () => set({ attacker: initialAttacker() }),
      resetDefender: () => set({ defender: initialSide() }),
    }),
    {
      name: "pokescouter:damageTest",
      version: 2,
      migrate: (persistedState, version) => {
        // v1 以前は natureUp / natureDown を個別保持していた。
        // v2 で natureMultiplier: 0.9|1|1.1 に統合（細かな割り当ては復元しない）。
        if (version < 2 && persistedState && typeof persistedState === "object") {
          const s = persistedState as Record<string, unknown>;
          for (const side of ["attacker", "defender"] as const) {
            const sd = s[side] as Record<string, unknown> | undefined;
            if (!sd) continue;
            delete sd.natureUp;
            delete sd.natureDown;
            if (typeof sd.natureMultiplier !== "number") sd.natureMultiplier = 1;
          }
        }
        return persistedState;
      },
      partialize: (state) => ({
        attacker: state.attacker,
        defender: state.defender,
        field: state.field,
      }),
    },
  ),
);
