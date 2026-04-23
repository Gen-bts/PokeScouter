/**
 * Gen 9 タイプ相性表.
 *
 * TYPE_CHART[attackingType][defendingType] = 倍率 (0, 0.5, 1, 2).
 * フロントエンドでの型マトリクス表示と coverage 計算に使う。
 */

export const ALL_TYPES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type TypeName = (typeof ALL_TYPES)[number];

/** atk → def → multiplier。atk 行の未記載 def は 1.0 倍。 */
export const TYPE_CHART: Record<TypeName, Partial<Record<TypeName, number>>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: {
    fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2,
    rock: 0.5, dragon: 0.5, steel: 2,
  },
  water: {
    fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5,
  },
  electric: {
    water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5,
  },
  grass: {
    fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5,
    bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5,
  },
  ice: {
    fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2,
    dragon: 2, steel: 0.5,
  },
  fighting: {
    normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5,
    rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5,
  },
  poison: {
    grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0,
    fairy: 2,
  },
  ground: {
    fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5,
    rock: 2, steel: 2,
  },
  flying: {
    electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5,
  },
  psychic: {
    fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5,
  },
  bug: {
    fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5,
    psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5,
  },
  rock: {
    fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5,
  },
  ghost: {
    normal: 0, psychic: 2, ghost: 2, dark: 0.5,
  },
  dragon: {
    dragon: 2, steel: 0.5, fairy: 0,
  },
  dark: {
    fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5,
  },
  steel: {
    fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2,
  },
  fairy: {
    fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5,
  },
};

/** 攻撃タイプ 1 つ × 防御タイプ 1-2 の倍率を返す. */
export function getTypeMultiplier(attack: TypeName, defense: TypeName[]): number {
  let m = 1;
  for (const d of defense) {
    const chartRow = TYPE_CHART[attack];
    const v = chartRow[d];
    if (v !== undefined) m *= v;
  }
  return m;
}

/** 倍率に応じた CSS クラス名を返す. */
export function effectivenessClass(mult: number): string {
  if (mult === 0) return "type-eff-immune";
  if (mult >= 4) return "type-eff-quad";
  if (mult >= 2) return "type-eff-super";
  if (mult === 1) return "type-eff-neutral";
  if (mult >= 0.5) return "type-eff-resisted";
  return "type-eff-deeply-resisted";
}

/** 倍率を人間可読に整形 (例: "×0.5"). */
export function formatMultiplier(mult: number): string {
  if (mult === 0) return "×0";
  if (mult === 0.25) return "×¼";
  if (mult === 0.5) return "×½";
  if (mult === 1) return "×1";
  if (mult === 2) return "×2";
  if (mult === 4) return "×4";
  return `×${mult}`;
}
