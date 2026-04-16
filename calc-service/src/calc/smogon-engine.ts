/**
 * @smogon/calc ベースのダメージ計算エンジン.
 *
 * Gen 9 をベースに使用し、Champions の実数値を stat override で注入する。
 */

import {
  calculate,
  Generations,
  Pokemon,
  Move,
  Field,
} from "@smogon/calc";
import type { StatsTable as SmogonStats } from "@smogon/calc";
import type {
  DamageRequest,
  DamageResponse,
  DefenderResult,
  FieldInput,
  MoveResult,
  ResolvedMoveInput,
  ResolvedPokemonInput,
} from "../types.js";
import type { DamageEngine } from "./engine.js";
import {
  capitalizeType,
  getTypeEffectiveness,
  koDescription,
  normalizeWeather,
  normalizeTerrain,
} from "./shared.js";
import {
  preprocessRequest,
  applyAnnotations,
  getEffectiveMoveType,
} from "./champions-abilities.js";
import {
  loadSnapshot,
  type SnapshotPokemon,
  type SnapshotMove,
} from "../showdown/snapshot.js";

const GEN_NUM = 9;
let gen: ReturnType<typeof Generations.get> | null = null;

function getGen(): ReturnType<typeof Generations.get> {
  if (!gen) {
    gen = Generations.get(GEN_NUM);
  }
  return gen;
}

/**
 * Pokemon オブジェクトを構築し、実数値を直接注入する.
 */
function buildPokemon(
  input: ResolvedPokemonInput,
  ability: string | null,
): Pokemon {
  const g = getGen();

  // @smogon/calc が認識する種族名を使う; 認識しない場合は fallback
  let speciesName = input.name;
  const speciesId = speciesName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const speciesData = g.species.get(
    speciesId as Parameters<typeof g.species.get>[0],
  );
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
  const curHP = input.cur_hp != null
    ? input.cur_hp
    : input.stats.hp;
  pokemon.originalCurHP = curHP;

  return pokemon;
}

/**
 * Move オブジェクトを構築する.
 */
function buildMove(input: ResolvedMoveInput): Move {
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
        } as unknown as Partial<import("@smogon/calc").State.Move>,
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

/**
 * @smogon/calc ベースのダメージ計算エンジン.
 */
export class SmogonDamageEngine implements DamageEngine {
  calculateDamage(req: DamageRequest): DamageResponse {
    const snapshot = loadSnapshot();
    const results: DefenderResult[] = [];

    const attackerSnapshot = resolvePokemonEntry(snapshot.pokemon, req.attacker.pokemon_key);
    if (!attackerSnapshot) {
      throw new Error(`Unknown attacker pokemon_key: ${req.attacker.pokemon_key}`);
    }

    const resolvedMoves = req.moves
      .map((move) => resolveMoveEntry(snapshot.moves, move.move_key))
      .filter((move): move is ResolvedMoveInput => move !== null);

    for (const defender of req.defenders) {
      const defenderSnapshot = resolvePokemonEntry(snapshot.pokemon, defender.pokemon_key);
      if (!defenderSnapshot) {
        throw new Error(`Unknown defender pokemon_key: ${defender.pokemon_key}`);
      }

      const resolvedAttacker = resolvePokemonInput(
        snapshot,
        req.attacker,
        attackerSnapshot,
      );
      const resolvedDefender = resolvePokemonInput(
        snapshot,
        defender,
        defenderSnapshot,
      );

      // 防御側ごとに前処理
      const preprocess = preprocessRequest(
        resolvedAttacker,
        resolvedDefender,
        resolvedMoves,
        req.field ?? {},
      );

      const attackerPokemon = buildPokemon(
        resolvedAttacker,
        preprocess.sanitizedAbility,
      );
      const defenderPokemon = buildPokemon(
        resolvedDefender,
        resolvedDefender.ability,
      );
      const field = buildField(preprocess.field);

      const moveResults: MoveResult[] = [];

      for (const moveInput of preprocess.moves) {
        // Status 技やパワー0の技はスキップ
        if (moveInput.damage_class === "status" || !moveInput.power) {
          continue;
        }

        // タイプ相性（表示用 — 特性によるタイプ変換を考慮）
        const effectiveMoveType = getEffectiveMoveType(
          moveInput.type,
          preprocess.sanitizedAbility,
        );
        const typeEff = getTypeEffectiveness(effectiveMoveType, resolvedDefender.types);

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
            move_key: moveInput.move_key,
            move_id: moveInput.move_key,
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
            `Calc error: ${moveInput.name} vs ${resolvedDefender.name}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      results.push({
        defender_pokemon_key: defender.pokemon_key,
        defender_species_id: defender.pokemon_key,
        defender_hp: defenderPokemon.maxHP(),
        moves: moveResults,
      });
    }

    return { results };
  }
}

function resolvePokemonEntry(
  pokemon: Record<string, SnapshotPokemon>,
  pokemonKey: string,
): SnapshotPokemon | null {
  const direct = pokemon[pokemonKey];
  if (direct) return direct;
  return null;
}

function resolveMoveEntry(
  moves: Record<string, SnapshotMove>,
  moveKey: string,
): ResolvedMoveInput | null {
  const move = moves[moveKey];
  if (!move) return null;
  return {
    move_key: move.move_key,
    name: move.name,
    type: move.type,
    power: move.power,
    damage_class: move.damage_class ?? "physical",
    makes_contact: move.makes_contact,
  };
}

function resolvePokemonInput(
  snapshot: ReturnType<typeof loadSnapshot>,
  input: DamageRequest["attacker"] | DamageRequest["defenders"][number],
  pokemonEntry: SnapshotPokemon,
): ResolvedPokemonInput {
  const item = input.item_key ? snapshot.items[input.item_key] : null;
  const megaSpecies = (
    item?.mega_stone &&
    item.mega_evolves === pokemonEntry.base_species_key &&
    snapshot.pokemon[item.mega_stone]
  )
    ? snapshot.pokemon[item.mega_stone]
    : null;

  const effectivePokemon = megaSpecies ?? pokemonEntry;
  const abilityKey = input.ability_key
    ?? effectivePokemon.abilities.normal[0]
    ?? effectivePokemon.abilities.hidden
    ?? null;
  const abilityName = abilityKey ? snapshot.abilities[abilityKey]?.name ?? null : null;
  const itemName = input.item_key ? snapshot.items[input.item_key]?.name ?? null : null;

  return {
    pokemon_key: effectivePokemon.pokemon_key,
    name: effectivePokemon.name,
    types: effectivePokemon.types,
    stats: input.stats,
    ability: abilityName,
    item: itemName,
    boosts: input.boosts,
    status: input.status,
    cur_hp: "cur_hp" in input ? input.cur_hp : undefined,
  };
}
