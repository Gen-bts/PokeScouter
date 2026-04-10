/**
 * @smogon/calc ラッパー.
 *
 * Gen 9 をベースに使用し、Champions の実数値を stat override で注入する。
 */

import {
  calculate,
  Generations,
  Pokemon,
  Move,
  Field,
  TYPE_CHART,
} from "@smogon/calc";
import type { Generation, StatsTable as SmogonStats } from "@smogon/calc";
import type {
  AttackerInput,
  DamageRequest,
  DamageResponse,
  DefenderInput,
  DefenderResult,
  FieldInput,
  MoveInput,
  MoveResult,
  StatsTable,
} from "../types.js";
import {
  preprocessRequest,
  applyAnnotations,
} from "./champions-abilities.js";

const GEN_NUM = 9;
let gen: Generation;

function getGen(): Generation {
  if (!gen) {
    gen = Generations.get(GEN_NUM);
  }
  return gen;
}

/**
 * Pokemon オブジェクトを構築し、実数値を直接注入する.
 */
function buildPokemon(
  input: AttackerInput | DefenderInput,
  ability: string | null,
): Pokemon {
  const g = getGen();

  // @smogon/calc が認識する種族名を使う; 認識しない場合は fallback
  let speciesName = input.name;
  const speciesData = g.species.get(speciesName.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!speciesData) {
    // Champions 限定メガなど → base form 名で作成し types を override
    const baseName = input.name.replace(/-Mega.*$/, "").replace(/-mega.*$/, "");
    speciesName = baseName;
  }

  let pokemon: Pokemon;
  try {
    pokemon = new Pokemon(g, speciesName, {
      level: 50,
      nature: "Serious", // 中性性格
      ability: ability ?? undefined,
      item: input.item ?? undefined,
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      boosts: input.boosts
        ? {
            atk: input.boosts.atk ?? 0,
            def: input.boosts.def ?? 0,
            spa: input.boosts.spa ?? 0,
            spd: input.boosts.spd ?? 0,
            spe: input.boosts.spe ?? 0,
          }
        : undefined,
      status: (input.status as "" | "slp" | "psn" | "brn" | "frz" | "par" | "tox") || undefined,
    });
  } catch {
    // Fallback: 認識できない種族名の場合 Pikachu で作成
    pokemon = new Pokemon(g, "Pikachu", {
      level: 50,
      nature: "Serious",
      ability: ability ?? undefined,
      item: input.item ?? undefined,
    });
  }

  // 型をオーバーライド
  if (input.types.length > 0) {
    const capitalizedTypes = input.types.map(
      (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(),
    );
    pokemon.types = capitalizedTypes as [string] | [string, string] as
      Pokemon["types"];
  }

  // 実数値を直接注入（内部計算をバイパス）
  const stats: SmogonStats = {
    hp: input.stats.hp,
    atk: input.stats.atk,
    def: input.stats.def,
    spa: input.stats.spa,
    spd: input.stats.spd,
    spe: input.stats.spe,
  };
  pokemon.rawStats = stats;
  pokemon.stats = { ...stats };

  // HP の設定
  const curHP = "cur_hp" in input && (input as DefenderInput).cur_hp != null
    ? (input as DefenderInput).cur_hp!
    : input.stats.hp;
  pokemon.originalCurHP = curHP;

  return pokemon;
}

/**
 * Move オブジェクトを構築する.
 */
function buildMove(input: MoveInput): Move {
  const g = getGen();

  try {
    // まず名前で検索
    const move = new Move(g, input.name);
    return move;
  } catch {
    // @smogon/calc が知らない技 → overrides で power/type をセット
    try {
      // ダミーの技をベースに使用
      const move = new Move(g, "Tackle", {
        overrides: {
          name: input.name,
          type: capitalizeType(input.type),
          category: input.damage_class === "physical" ? "Physical" : "Special",
          bp: input.power ?? 0,
        } as Partial<import("@smogon/calc").State.Move>,
      });
      return move;
    } catch {
      return new Move(g, "Tackle");
    }
  }
}

/**
 * Field オブジェクトを構築する.
 */
function buildField(input?: FieldInput): Field {
  if (!input) return new Field();

  return new Field({
    gameType: input.is_doubles ? "Doubles" : "Singles",
    weather: normalizeWeather(input.weather),
    terrain: normalizeTerrain(input.terrain),
    attackerSide: input.attacker_side
      ? {
          isReflect: input.attacker_side.is_reflect,
          isLightScreen: input.attacker_side.is_light_screen,
          isAuroraVeil: input.attacker_side.is_aurora_veil,
          isTailwind: input.attacker_side.is_tailwind,
          isHelpingHand: input.attacker_side.is_helping_hand,
        }
      : undefined,
    defenderSide: input.defender_side
      ? {
          isReflect: input.defender_side.is_reflect,
          isLightScreen: input.defender_side.is_light_screen,
          isAuroraVeil: input.defender_side.is_aurora_veil,
          isTailwind: input.defender_side.is_tailwind,
          isHelpingHand: input.defender_side.is_helping_hand,
        }
      : undefined,
  });
}

function capitalizeType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function normalizeWeather(
  weather?: string | null,
): "Sun" | "Rain" | "Sand" | "Hail" | "Snow" | undefined {
  if (!weather) return undefined;
  const w = weather.toLowerCase();
  if (w === "sun" || w === "sunny" || w === "harsh sunshine") return "Sun";
  if (w === "rain" || w === "rainy" || w === "heavy rain") return "Rain";
  if (w === "sand" || w === "sandstorm") return "Sand";
  if (w === "hail") return "Hail";
  if (w === "snow") return "Snow";
  return undefined;
}

function normalizeTerrain(
  terrain?: string | null,
): "Electric" | "Grassy" | "Psychic" | "Misty" | undefined {
  if (!terrain) return undefined;
  const t = terrain.toLowerCase();
  if (t === "electric") return "Electric";
  if (t === "grassy") return "Grassy";
  if (t === "psychic") return "Psychic";
  if (t === "misty") return "Misty";
  return undefined;
}

/**
 * タイプ相性倍率を計算する.
 */
function getTypeEffectiveness(
  moveType: string,
  defenderTypes: string[],
): number {
  const chart = TYPE_CHART[GEN_NUM];
  if (!chart) return 1;

  const moveTypeCap = capitalizeType(moveType);
  const attackChart = chart[moveTypeCap];
  if (!attackChart) return 1;

  let effectiveness = 1;
  for (const dType of defenderTypes) {
    const dTypeCap = capitalizeType(dType);
    const mult = attackChart[dTypeCap];
    if (mult != null) {
      effectiveness *= mult;
    }
  }
  return effectiveness;
}

/**
 * 確定数の日本語表記を生成する.
 */
function koDescription(
  minPercent: number,
  maxPercent: number,
  guaranteedKo: number,
): string {
  const pctStr = `${minPercent.toFixed(1)}% - ${maxPercent.toFixed(1)}%`;
  if (guaranteedKo <= 0) return `${pctStr} (確定数不明)`;
  if (guaranteedKo === 1) return `${pctStr} (確1)`;
  return `${pctStr} (確${guaranteedKo})`;
}

/**
 * ダメージ計算のメインエントリポイント.
 *
 * M moves × D defenders のダメージ範囲を一括計算して返す。
 */
export function calculateDamage(req: DamageRequest): DamageResponse {
  const results: DefenderResult[] = [];

  for (const defender of req.defenders) {
    // 防御側ごとに前処理
    const preprocess = preprocessRequest(
      req.attacker,
      defender,
      req.moves,
      req.field ?? {},
    );

    const attackerPokemon = buildPokemon(
      req.attacker,
      preprocess.sanitizedAbility,
    );
    const defenderPokemon = buildPokemon(defender, defender.ability);
    const field = buildField(preprocess.field);

    const moveResults: MoveResult[] = [];

    for (const moveInput of preprocess.moves) {
      // Status 技やパワー0の技はスキップ
      if (moveInput.damage_class === "status" || !moveInput.power) {
        continue;
      }

      // タイプ相性（calculate 前に確認）
      const typeEff = getTypeEffectiveness(moveInput.type, defender.types);

      // 無効 (0x) の場合はダメージ 0 で即座に結果を返す
      if (typeEff === 0) {
        let moveResult: MoveResult = {
          move_id: moveInput.move_id,
          move_name: moveInput.name,
          damage: { min: 0, max: 0 },
          min_percent: 0,
          max_percent: 0,
          guaranteed_ko: 0,
          type_effectiveness: 0,
          description: "0.0% - 0.0% (無効)",
        };
        moveResult = applyAnnotations(moveResult, preprocess.annotations, moveInput);
        moveResults.push(moveResult);
        continue;
      }

      const move = buildMove(moveInput);

      try {
        const result = calculate(getGen(), attackerPokemon, defenderPokemon, move, field);

        // ダメージ範囲を取得
        const damageArray = result.damage;
        let minDmg: number;
        let maxDmg: number;

        if (Array.isArray(damageArray)) {
          if (Array.isArray(damageArray[0])) {
            // Parental Bond: [number[], number[]]
            const firstHit = damageArray[0] as number[];
            const secondHit = damageArray[1] as number[];
            minDmg = Math.min(...firstHit) + Math.min(...secondHit);
            maxDmg = Math.max(...firstHit) + Math.max(...secondHit);
          } else {
            // 通常: number[]
            const dmgArr = damageArray as number[];
            minDmg = Math.min(...dmgArr);
            maxDmg = Math.max(...dmgArr);
          }
        } else {
          // 固定ダメージ
          minDmg = damageArray as number;
          maxDmg = damageArray as number;
        }

        const defenderHP = defenderPokemon.maxHP();
        const minPercent = defenderHP > 0 ? (minDmg / defenderHP) * 100 : 0;
        const maxPercent = defenderHP > 0 ? (maxDmg / defenderHP) * 100 : 0;

        // KO 情報（n=0 は「確定数不明」を表す）
        let guaranteedKo = 0;
        try {
          const koInfo = result.kochance();
          guaranteedKo = koInfo.n;
        } catch {
          // kochance() がエラーを投げる場合は 0 のまま
        }

        let moveResult: MoveResult = {
          move_id: moveInput.move_id,
          move_name: moveInput.name,
          damage: { min: minDmg, max: maxDmg },
          min_percent: Math.round(minPercent * 10) / 10,
          max_percent: Math.round(maxPercent * 10) / 10,
          guaranteed_ko: guaranteedKo,
          type_effectiveness: typeEff,
          description: koDescription(
            Math.round(minPercent * 10) / 10,
            Math.round(maxPercent * 10) / 10,
            guaranteedKo,
          ),
        };

        // 後処理: Champions 新特性の注釈
        moveResult = applyAnnotations(moveResult, preprocess.annotations, moveInput);

        moveResults.push(moveResult);
      } catch (err) {
        // 計算エラー時はスキップ（ログはサーバー側で出す）
        console.error(
          `Calc error: ${moveInput.name} vs ${defender.name}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    results.push({
      defender_species_id: defender.species_id,
      defender_hp: defenderPokemon.maxHP(),
      moves: moveResults,
    });
  }

  return { results };
}
