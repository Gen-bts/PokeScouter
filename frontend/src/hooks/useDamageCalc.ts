import { useEffect, useRef } from "react";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useFieldStateStore } from "../stores/useFieldStateStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore, getEffectivePokemonKey } from "../stores/useOpponentTeamStore";
import type { ValidatedField } from "../types";
import { calcChampionsHp, calcChampionsStat } from "../utils/statCalc";

const DEBOUNCE_MS = 300;

const STAT_FIELDS: { key: string; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "こうげき" },
  { key: "def", label: "ぼうぎょ" },
  { key: "spa", label: "とくこう" },
  { key: "spd", label: "とくぼう" },
  { key: "spe", label: "すばやさ" },
];

/** メガシンカ後の種族値 + 努力値 + 性格補正から実数値を再計算する. */
function calcMegaStats(
  megaBaseStats: Record<string, number>,
  fields: Record<string, ValidatedField>,
): { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } {
  const result: Record<string, number> = {};
  for (const { key, label } of STAT_FIELDS) {
    const base = megaBaseStats[key];
    const evField = fields[`${label}努力値`];
    const statPoints = evField
      ? parseInt(evField.validated ?? evField.raw, 10) || 0
      : 0;
    if (key === "hp") {
      result[key] = calcChampionsHp(base, statPoints);
    } else {
      const modField = fields[`${label}性格補正`];
      const natureMod =
        modField?.validated === "up"
          ? 1.1
          : modField?.validated === "down"
            ? 0.9
            : 1.0;
      result[key] = calcChampionsStat(base, statPoints, natureMod);
    }
  }
  return result as {
    hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  };
}

/** ValidatedField から数値を取得する. */
function fieldToInt(field: ValidatedField | undefined): number | null {
  if (!field) return null;
  const val = field.validated ?? field.raw;
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

/** ValidatedField から string key を取得する. */
function fieldToKey(field: ValidatedField | undefined): string | null {
  return field?.matched_key ?? field?.matched_id ?? null;
}

/** パーティスロットの fields から攻撃側データを構築する. */
function buildAttackerData(
  pokemonId: string,
  fields: Record<string, ValidatedField>,
) {
  const hp = fieldToInt(fields["HP実数値"]);
  const atk = fieldToInt(fields["こうげき実数値"]);
  const def_ = fieldToInt(fields["ぼうぎょ実数値"]);
  const spa = fieldToInt(fields["とくこう実数値"]);
  const spd = fieldToInt(fields["とくぼう実数値"]);
  const spe = fieldToInt(fields["すばやさ実数値"]);

  // 実数値が揃っていない場合は null
  if (hp == null || atk == null || def_ == null || spa == null || spd == null || spe == null) {
    return null;
  }

  const moveIds: string[] = [];
  for (const key of ["わざ１", "わざ２", "わざ３", "わざ４"]) {
    const id = fieldToKey(fields[key]);
    if (id != null) moveIds.push(id);
  }

  if (moveIds.length === 0) return null;

  return {
    pokemon_key: pokemonId,
    stats: { hp, atk, def: def_, spa, spd, spe },
    move_keys: moveIds,
    ability_key: fieldToKey(fields["特性"]),
    item_key: fieldToKey(fields["もちもの"]),
  };
}

/**
 * ダメージ計算をトリガーする副作用フック.
 *
 * 選択中の攻撃側 + 検出済みの相手チームが変化するたびに
 * 300ms debounce で POST /api/damage を発火する。
 */
export function useDamageCalc(): void {
  const attackerPos = useDamageCalcStore((s) => s.selectedAttackerPosition);
  const setResults = useDamageCalcStore((s) => s.setResults);
  const setLoading = useDamageCalcStore((s) => s.setLoading);
  const setError = useDamageCalcStore((s) => s.setError);
  const incrementGeneration = useDamageCalcStore((s) => s.incrementGeneration);
  const clearResults = useDamageCalcStore((s) => s.clearResults);

  const partySlots = useMyPartyStore((s) => s.slots);
  const opponentSlots = useOpponentTeamStore((s) => s.slots);

  // フィールド状態
  const weather = useFieldStateStore((s) => s.weather);
  const terrain = useFieldStateStore((s) => s.terrain);
  const playerSide = useFieldStateStore((s) => s.playerSide);
  const opponentSide = useFieldStateStore((s) => s.opponentSide);
  const fieldKey = JSON.stringify({ weather, terrain, playerSide, opponentSide });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 防御側 pokemon keys を導出（メガトグル反映）
  const defenderIds = opponentSlots
    .map((s) => getEffectivePokemonKey(s))
    .filter((id): id is string => id !== null);
  const defenderKey = defenderIds.join(",");

  // 防御側ブースト（ステータス変化）を導出 — 実効キーで送信
  const defenderBoosts: Record<string, Record<string, number>> = {};
  for (const slot of opponentSlots) {
    const effectiveKey = getEffectivePokemonKey(slot);
    if (effectiveKey != null && Object.keys(slot.boosts).length > 0) {
      defenderBoosts[effectiveKey] = slot.boosts;
    }
  }
  const boostsKey = JSON.stringify(defenderBoosts);

  // 防御側アイテム・特性（検出済みのもの）を導出 — 実効キーで送信
  const defenderItems: Record<string, string> = {};
  const defenderAbilities: Record<string, string> = {};
  for (const slot of opponentSlots) {
    const effectiveKey = getEffectivePokemonKey(slot);
    if (effectiveKey != null) {
      if (slot.itemId != null) defenderItems[effectiveKey] = slot.itemId;
      if (slot.abilityId != null) defenderAbilities[effectiveKey] = slot.abilityId;
    }
  }
  const itemsKey = JSON.stringify(defenderItems);
  const abilitiesKey = JSON.stringify(defenderAbilities);

  // 防御側プリセット（耐久配分・性格補正）を導出 — 実効キーで送信
  // defensePreset === "custom" の場合は customDefenseSp を custom_sp として同送する
  const defenderPresets: Record<
    string,
    {
      defense_preset: string;
      nature_boost_stat: string | null;
      custom_sp?: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
    }
  > = {};
  for (const slot of opponentSlots) {
    const effectiveKey = getEffectivePokemonKey(slot);
    if (effectiveKey != null) {
      const entry: {
        defense_preset: string;
        nature_boost_stat: string | null;
        custom_sp?: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
      } = {
        defense_preset: slot.defensePreset,
        nature_boost_stat: slot.natureBoostStat,
      };
      if (slot.defensePreset === "custom" && slot.customDefenseSp) {
        entry.custom_sp = slot.customDefenseSp;
      }
      defenderPresets[effectiveKey] = entry;
    }
  }
  const presetsKey = JSON.stringify(defenderPresets);

  // 攻撃側のバリデーション & データ構築（effect 外で計算し依存キーに含める）
  const attackerSlot =
    attackerPos !== null ? partySlots[attackerPos - 1] : null;
  const attackerMegaActive = attackerSlot?.isMegaEvolved ?? false;
  const attackerHasMega = attackerSlot?.megaForm != null;
  let attackerData =
    attackerSlot?.pokemonId != null
      ? buildAttackerData(attackerSlot.pokemonId, attackerSlot.fields)
      : null;
  // メガシンカ状態に応じて攻撃側データを調整
  if (attackerData && attackerHasMega) {
    if (attackerMegaActive && attackerSlot?.megaForm) {
      // メガ活性: pokemon_key 差替え + 実数値再計算 + ability_key null
      const megaStats = calcMegaStats(
        attackerSlot.megaForm.base_stats,
        attackerSlot.fields,
      );
      attackerData = {
        ...attackerData,
        pokemon_key: attackerSlot.megaForm.pokemon_key,
        stats: megaStats,
        ability_key: null,
      };
    } else {
      // メガ非活性: item_key を除外して通常形態で計算
      attackerData = { ...attackerData, item_key: null };
    }
  }
  const attackerKey = attackerData ? JSON.stringify(attackerData) : "";

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!attackerPos || !attackerData || defenderIds.length === 0) {
      clearResults();
      return;
    }

    const generation = incrementGeneration();
    setLoading(true);

    // attackerData / defenderIds のスナップショットをクロージャにキャプチャ
    const reqAttacker = attackerData;
    const reqDefenders = defenderIds;
    const reqBoosts = { ...defenderBoosts };
    const reqItems = { ...defenderItems };
    const reqAbilities = { ...defenderAbilities };
    const reqPresets = { ...defenderPresets };

    timerRef.current = setTimeout(async () => {
      try {
        const requestBody = {
          attacker: reqAttacker,
          defender_pokemon_keys: reqDefenders,
          defender_boosts: Object.keys(reqBoosts).length > 0 ? reqBoosts : undefined,
          defender_items: Object.keys(reqItems).length > 0 ? reqItems : undefined,
          defender_abilities: Object.keys(reqAbilities).length > 0 ? reqAbilities : undefined,
          defender_presets: Object.keys(reqPresets).length > 0 ? reqPresets : undefined,
          field: {
            weather,
            terrain,
            attacker_side: {
              is_reflect: playerSide.reflect,
              is_light_screen: playerSide.lightScreen,
              is_aurora_veil: playerSide.auroraVeil,
              is_tailwind: playerSide.tailwind,
            },
            defender_side: {
              is_reflect: opponentSide.reflect,
              is_light_screen: opponentSide.lightScreen,
              is_aurora_veil: opponentSide.auroraVeil,
              is_tailwind: opponentSide.tailwind,
            },
          },
        };
        const res = await fetch("/api/damage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        if (!res.ok) {
          const text = await res.text();
          setError(`API error: ${res.status} ${text.slice(0, 100)}`);
          return;
        }
        const data = await res.json();
        setResults(data.results ?? [], generation, requestBody);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attackerPos, defenderKey, attackerKey, boostsKey, itemsKey, abilitiesKey, presetsKey, fieldKey]);
}
