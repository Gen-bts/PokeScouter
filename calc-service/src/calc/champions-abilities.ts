/**
 * Champions 特性に関する表示ロジック.
 *
 * @smogon/calc master (2026-04-16〜) が Champions をネイティブサポートした
 * ことで Dragonize / Mega Sol / Piercing Drill などのダメージ計算自体は
 * ライブラリ側で完結する。このモジュールは次のみ担当する:
 *
 * 1. タイプ相性 (type_effectiveness) 表示用のタイプ変換
 *    — ライブラリ内部の処理はダメージ値にしか反映されないため、
 *      UI に「Pixilate 適用後の Fairy タイプ vs 〜」を出すには
 *      こちら側で同じ変換を再現する必要がある.
 *
 * 2. MoveResult に付与する UI 向け注釈 (pierces_protect など)
 *    — ダメージ計算には影響しないが、技ツールチップで
 *      「Protect 貫通」「接触やけど」のようなヒントを表示する.
 */

import type {
  FieldInput,
  MoveResult,
  ResolvedMoveInput,
  ResolvedPokemonInput,
} from "../types.js";

/**
 * 表示時に Normal タイプを別タイプに変換する特性.
 * ダメージ計算自体は @smogon/calc が処理するが、type_effectiveness の
 * 表示計算はこちらで行うため同じ対応表を持つ。
 */
const TYPE_CHANGE_ABILITIES_FOR_DISPLAY: Record<string, string> = {
  pixilate: "Fairy",
  refrigerate: "Ice",
  aerilate: "Flying",
  galvanize: "Electric",
  dragonize: "Dragon",
};

/** UI ツールチップ用の注釈付与特性. */
const ANNOTATION_ABILITIES: Record<string, string> = {
  "piercing drill": "pierces_protect",
  "spicy spray": "contact_burn",
};

export interface PreprocessResult {
  moves: ResolvedMoveInput[];
  field: FieldInput;
  /** 攻撃側の特性 (そのまま渡す; @smogon/calc が Champions 特性をネイティブ処理). */
  ability: string | null;
  annotations: Record<string, boolean>;
}

/**
 * リクエストから UI 向け注釈を収集する.
 *
 * 以前は Champions 特性を @smogon/calc 向けに書き換えていたが、
 * ライブラリ本体が Champions をネイティブサポートしたため、ここでは
 * 表示用の注釈だけを抽出する。
 */
export function preprocessRequest(
  attacker: ResolvedPokemonInput,
  _defender: ResolvedPokemonInput,
  moves: ResolvedMoveInput[],
  field: FieldInput,
): PreprocessResult {
  const abilityLower = attacker.ability?.toLowerCase() ?? "";
  const annotations: Record<string, boolean> = {};

  const annotation = ANNOTATION_ABILITIES[abilityLower];
  if (annotation) annotations[annotation] = true;

  return {
    moves,
    field,
    ability: attacker.ability,
    annotations,
  };
}

/**
 * タイプ変換特性を考慮した実効タイプを返す (表示専用).
 */
export function getEffectiveMoveType(
  moveType: string,
  attackerAbility: string | null,
): string {
  if (!attackerAbility) return moveType;
  const target =
    TYPE_CHANGE_ABILITIES_FOR_DISPLAY[attackerAbility.toLowerCase()];
  if (target && moveType.toLowerCase() === "normal") return target;
  return moveType;
}

/** MoveResult に注釈を付与する (後処理). */
export function applyAnnotations(
  result: MoveResult,
  annotations: Record<string, boolean>,
  move: ResolvedMoveInput,
): MoveResult {
  const merged = { ...annotations };

  // Spicy Spray: 接触技のときだけ注釈を残す.
  if (merged["contact_burn"] && !move.makes_contact) {
    delete merged["contact_burn"];
  }

  if (Object.keys(merged).length === 0) return result;

  return {
    ...result,
    annotations: { ...(result.annotations ?? {}), ...merged },
  };
}
