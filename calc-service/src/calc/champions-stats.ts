/**
 * Champions ステータス計算式.
 *
 * NCP VGC Calculator 準拠:
 *   HP:    floor((2 * base + 31) * 50 / 100 + 50 + 10) + stat_points
 *   Other: floor((2 * base + 31) * 50 / 100 + 5)       + stat_points
 *   Nature: ×1.1 (boost) / ×0.9 (reduce) を Other に適用
 *
 * - Level = 50 固定
 * - IV 廃止 → 計算式上は 31 相当
 * - stat_points: 各 0〜32、合計 66
 */

import type { StatsTable } from "../types.js";

const LEVEL = 50;
const FIXED_IV = 31;

/** HP 実数値を計算する. */
export function calcChampionsHP(base: number, statPoints: number): number {
  // Shedinja 特殊ケース
  if (base === 1) return 1;
  return Math.floor((2 * base + FIXED_IV) * LEVEL / 100 + LEVEL + 10) + statPoints;
}

/** HP 以外のステータス実数値を計算する. */
export function calcChampionsStat(
  base: number,
  statPoints: number,
  natureMod: number = 1.0,
): number {
  const raw = Math.floor((2 * base + FIXED_IV) * LEVEL / 100 + 5) + statPoints;
  return Math.floor(raw * natureMod);
}

export interface NatureModifiers {
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** 性格名から各ステータスの倍率を返す. */
export function getNatureModifiers(nature?: string | null): NatureModifiers {
  const mods: NatureModifiers = { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };
  if (!nature) return mods;

  const NATURE_MAP: Record<string, { plus: keyof NatureModifiers; minus: keyof NatureModifiers }> = {
    Lonely:  { plus: "atk", minus: "def" },
    Adamant: { plus: "atk", minus: "spa" },
    Naughty: { plus: "atk", minus: "spd" },
    Brave:   { plus: "atk", minus: "spe" },
    Bold:    { plus: "def", minus: "atk" },
    Impish:  { plus: "def", minus: "spa" },
    Lax:     { plus: "def", minus: "spd" },
    Relaxed: { plus: "def", minus: "spe" },
    Modest:  { plus: "spa", minus: "atk" },
    Mild:    { plus: "spa", minus: "def" },
    Rash:    { plus: "spa", minus: "spd" },
    Quiet:   { plus: "spa", minus: "spe" },
    Calm:    { plus: "spd", minus: "atk" },
    Gentle:  { plus: "spd", minus: "def" },
    Careful: { plus: "spd", minus: "spa" },
    Sassy:   { plus: "spd", minus: "spe" },
    Timid:   { plus: "spe", minus: "atk" },
    Hasty:   { plus: "spe", minus: "def" },
    Jolly:   { plus: "spe", minus: "spa" },
    Naive:   { plus: "spe", minus: "spd" },
  };

  const entry = NATURE_MAP[nature];
  if (entry) {
    mods[entry.plus] = 1.1;
    mods[entry.minus] = 0.9;
  }
  return mods;
}

/** 全ステータスを一括計算する. */
export function calcAllStats(
  baseStats: StatsTable,
  statPoints: Partial<StatsTable>,
  nature?: string | null,
): StatsTable {
  const mods = getNatureModifiers(nature);
  const sp = (key: keyof StatsTable) => statPoints[key] ?? 0;

  return {
    hp:  calcChampionsHP(baseStats.hp, sp("hp")),
    atk: calcChampionsStat(baseStats.atk, sp("atk"), mods.atk),
    def: calcChampionsStat(baseStats.def, sp("def"), mods.def),
    spa: calcChampionsStat(baseStats.spa, sp("spa"), mods.spa),
    spd: calcChampionsStat(baseStats.spd, sp("spd"), mods.spd),
    spe: calcChampionsStat(baseStats.spe, sp("spe"), mods.spe),
  };
}
