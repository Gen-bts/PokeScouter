/** Champions ステータス計算ユーティリティ */

const LEVEL = 50;
const FIXED_IV = 31;

/** Champions HP 計算式 */
export function calcChampionsHp(base: number, statPoints: number): number {
  if (base === 1) return 1; // ヌケニン
  return Math.floor(((2 * base + FIXED_IV) * LEVEL) / 100 + LEVEL + 10) + statPoints;
}

/** Champions HP 以外のステータス計算式 */
export function calcChampionsStat(
  base: number,
  statPoints: number,
  natureMod: number,
): number {
  const raw =
    Math.floor(((2 * base + FIXED_IV) * LEVEL) / 100 + 5) + statPoints;
  return Math.floor(raw * natureMod);
}
