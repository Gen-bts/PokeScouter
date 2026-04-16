/** プレイヤーパーティの HP 解決ユーティリティ */

import type { MyPartySlot } from "../stores/useMyPartyStore";
import type { ValidatedField } from "../types";
import { calcChampionsHp } from "./statCalc";

/** ValidatedField から整数を取得する */
function fieldToInt(field: ValidatedField | undefined): number | null {
  if (!field) return null;
  const val = field.validated ?? field.raw;
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

/**
 * パーティスロットから最大 HP を取得する。
 * メガシンカ中はメガフォームの種族値 + HP努力値で再計算し、
 * 通常時は登録済みの「HP実数値」フィールドを使用する。
 * 取得できない場合は null（フォールバックで OCR の max_hp を使う）。
 */
export function getEffectivePlayerMaxHp(slot: MyPartySlot): number | null {
  if (slot.isMegaEvolved && slot.megaForm) {
    const megaBaseHp = slot.megaForm.base_stats.hp;
    if (megaBaseHp == null) return null;
    const evField = slot.fields["HP努力値"];
    const statPoints = fieldToInt(evField) ?? 0;
    return calcChampionsHp(megaBaseHp, statPoints);
  }
  return fieldToInt(slot.fields["HP実数値"]);
}

/**
 * スロットの現在 HP と最大 HP からパーセンテージを計算する。
 * partyMaxHp が渡された場合はそれを優先し、なければスロットの maxHp を使用。
 */
export function resolveHpPercent(
  currentHp: number | null,
  maxHp: number | null,
  partyMaxHp: number | null,
): number | null {
  const resolvedMax = partyMaxHp ?? maxHp;
  if (currentHp == null || resolvedMax == null || resolvedMax <= 0) return null;
  const percent = Math.round((currentHp * 100) / resolvedMax);
  return Math.max(0, Math.min(100, percent));
}

/**
 * 値を指定範囲にクランプする。
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
