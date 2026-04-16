import type { MoveDamageResult } from "../types";

export function getKoClass(guaranteedKo: number): string {
  if (guaranteedKo === 1) return "dmg-ohko";
  if (guaranteedKo === 2) return "dmg-2hko";
  if (guaranteedKo === 3) return "dmg-3hko";
  return "dmg-weak";
}

export function getKoLabel(guaranteedKo: number, typeEff: number): string {
  if (typeEff === 0) return "無効";
  if (guaranteedKo <= 0) return "";
  if (guaranteedKo === 1) return "確1";
  return `確${guaranteedKo}`;
}

/**
 * range を含むKOラベルを返す.
 * best_ko と worst_ko が異なる場合は "確1-2" のように表示する。
 */
export function getRangeKoLabel(move: MoveDamageResult): string {
  if (move.type_effectiveness === 0) return "無効";

  const r = move.range;
  if (!r) return getKoLabel(move.guaranteed_ko, move.type_effectiveness);

  const best = r.best_ko;
  const worst = r.worst_ko;

  if (best <= 0 && worst <= 0) return "";
  if (best <= 0) return `確${worst}`;
  if (worst <= 0) return `確${best}`;
  if (best === worst) return `確${best}`;
  return `確${best}-${worst}`;
}

/**
 * range 付きのKOクラスを返す（best_ko ベースで色を決める）.
 */
export function getRangeKoClass(move: MoveDamageResult): string {
  const r = move.range;
  if (!r) return getKoClass(move.guaranteed_ko);
  const best = r.best_ko > 0 ? r.best_ko : move.guaranteed_ko;
  return getKoClass(best);
}

/**
 * range を含むダメージ%文字列を返す.
 * range あり: "(24.1~) 31.2-37.5 (~48.8)%"
 * range なし: "31.2-37.5%"
 */
export function formatDamagePercent(move: MoveDamageResult): string {
  if (move.type_effectiveness === 0) return "0% 無効";

  const nomMin = move.min_percent.toFixed(1);
  const nomMax = move.max_percent.toFixed(1);
  const nominal = `${nomMin}-${nomMax}`;

  const r = move.range;
  if (!r) return `${nominal}%`;

  const rMin = r.min_percent.toFixed(1);
  const rMax = r.max_percent.toFixed(1);

  const hasLower = rMin !== nomMin;
  const hasUpper = rMax !== nomMax;

  if (!hasLower && !hasUpper) return `${nominal}%`;

  const prefix = hasLower ? `(${rMin}~) ` : "";
  const suffix = hasUpper ? ` (~${rMax})` : "";
  return `${prefix}${nominal}${suffix}%`;
}
