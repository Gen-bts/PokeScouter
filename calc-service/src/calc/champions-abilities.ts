/**
 * Champions 新特性の前処理/後処理.
 *
 * @smogon/calc が知らない Champions 固有特性について、
 * calculate() 呼び出しの前後でリクエスト/レスポンスを変換する。
 */

import type {
  FieldInput,
  MoveResult,
  ResolvedMoveInput,
  ResolvedPokemonInput,
} from "../types.js";

/** -ize 系特性（ノーマル技を別タイプに変換 + 1.2 倍） — Champions 固有 */
const TYPE_CHANGE_ABILITIES: Record<string, string> = {
  dragonize: "Dragon",
  // 将来: 他の Champions 固有 -ize 特性をここに追加
};

/** @smogon/calc が認識する標準タイプ変換特性（表示用タイプ相性の算出に使用） */
export const SMOGON_TYPE_CHANGE_ABILITIES: Record<string, string> = {
  pixilate: "Fairy",
  refrigerate: "Ice",
  aerilate: "Flying",
  galvanize: "Electric",
};

/** 天候をセットする特性 */
const WEATHER_ABILITIES: Record<string, string> = {
  "mega sol": "Sun",
  // 将来: 他の天候特性をここに追加
};

/** 結果に注釈を付ける特性 */
const ANNOTATION_ABILITIES: Record<string, string> = {
  "piercing drill": "pierces_protect",
  "spicy spray": "contact_burn",
};

export interface PreprocessResult {
  moves: ResolvedMoveInput[];
  field: FieldInput;
  /** 攻撃側の特性を @smogon/calc が認識するものに置換した場合の値 */
  sanitizedAbility: string | null;
  /** 防御側の特性を @smogon/calc が認識するものに置換した場合の値 */
  defenderSanitizedAbility?: string | null;
  annotations: Record<string, boolean>;
}

/**
 * calculate() 前にリクエストを変換する.
 *
 * @returns 変換後の moves, field, 注釈情報
 */
export function preprocessRequest(
  attacker: ResolvedPokemonInput,
  defender: ResolvedPokemonInput,
  moves: ResolvedMoveInput[],
  field: FieldInput,
): PreprocessResult {
  let processedMoves = [...moves];
  let processedField = { ...field };
  let sanitizedAbility = attacker.ability;
  const annotations: Record<string, boolean> = {};

  const abilityLower = attacker.ability?.toLowerCase() ?? "";

  // -ize 系特性: ノーマル技のタイプ変換 + 1.2 倍
  const targetType = TYPE_CHANGE_ABILITIES[abilityLower];
  if (targetType) {
    processedMoves = processedMoves.map((m) => {
      if (m.type.toLowerCase() === "normal" && m.damage_class !== "status") {
        return {
          ...m,
          type: targetType,
          power: m.power != null ? Math.floor(m.power * 1.2) : m.power,
        };
      }
      return m;
    });
    // @smogon/calc には知られていないので無効な特性を渡さない
    sanitizedAbility = null;
  }

  // 天候特性
  const weather = WEATHER_ABILITIES[abilityLower];
  if (weather) {
    processedField = { ...processedField, weather };
    sanitizedAbility = null;
  }

  // 注釈特性（ダメージ計算自体は変わらない）
  const annotation = ANNOTATION_ABILITIES[abilityLower];
  if (annotation) {
    annotations[annotation] = true;
    sanitizedAbility = null;
  }

  return {
    moves: processedMoves,
    field: processedField,
    sanitizedAbility,
    annotations,
  };
}

/**
 * タイプ変換特性を考慮した実効タイプを返す.
 *
 * Champions 固有特性は preprocessRequest で既に変換済みのため、
 * ここでは @smogon/calc が認識する標準特性のみ対応する。
 */
export function getEffectiveMoveType(
  moveType: string,
  attackerAbility: string | null,
): string {
  if (!attackerAbility) return moveType;
  const target = SMOGON_TYPE_CHANGE_ABILITIES[attackerAbility.toLowerCase()];
  if (target && moveType.toLowerCase() === "normal") return target;
  return moveType;
}

/**
 * MoveResult に注釈を付与する（後処理）.
 */
export function applyAnnotations(
  result: MoveResult,
  annotations: Record<string, boolean>,
  move: ResolvedMoveInput,
): MoveResult {
  const merged = { ...annotations };

  // Spicy Spray: 接触技の場合のみ注釈
  if (merged["contact_burn"] && !move.makes_contact) {
    delete merged["contact_burn"];
  }

  if (Object.keys(merged).length === 0) return result;

  return {
    ...result,
    annotations: { ...(result.annotations ?? {}), ...merged },
  };
}
