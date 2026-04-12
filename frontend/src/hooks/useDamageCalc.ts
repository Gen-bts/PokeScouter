import { useEffect, useRef } from "react";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import type { ValidatedField } from "../types";

const DEBOUNCE_MS = 300;

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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 防御側 pokemon keys を導出
  const defenderIds = opponentSlots
    .map((s) => s.pokemonId)
    .filter((id): id is string => id !== null);
  const defenderKey = defenderIds.join(",");

  // 防御側ブースト（ステータス変化）を導出
  const defenderBoosts: Record<string, Record<string, number>> = {};
  for (const slot of opponentSlots) {
    if (slot.pokemonId != null && Object.keys(slot.boosts).length > 0) {
      defenderBoosts[slot.pokemonId] = slot.boosts;
    }
  }
  const boostsKey = JSON.stringify(defenderBoosts);

  // 防御側アイテム・特性（検出済みのもの）を導出
  const defenderItems: Record<string, string> = {};
  const defenderAbilities: Record<string, string> = {};
  for (const slot of opponentSlots) {
    if (slot.pokemonId != null) {
      if (slot.itemId != null) defenderItems[slot.pokemonId] = slot.itemId;
      if (slot.abilityId != null) defenderAbilities[slot.pokemonId] = slot.abilityId;
    }
  }
  const itemsKey = JSON.stringify(defenderItems);
  const abilitiesKey = JSON.stringify(defenderAbilities);

  // 攻撃側のバリデーション & データ構築（effect 外で計算し依存キーに含める）
  const attackerSlot =
    attackerPos !== null ? partySlots[attackerPos - 1] : null;
  const attackerData =
    attackerSlot?.pokemonId != null
      ? buildAttackerData(attackerSlot.pokemonId, attackerSlot.fields)
      : null;
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

    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/damage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attacker: reqAttacker,
            defender_pokemon_keys: reqDefenders,
            defender_boosts: Object.keys(reqBoosts).length > 0 ? reqBoosts : undefined,
            defender_items: Object.keys(reqItems).length > 0 ? reqItems : undefined,
            defender_abilities: Object.keys(reqAbilities).length > 0 ? reqAbilities : undefined,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          setError(`API error: ${res.status} ${text.slice(0, 100)}`);
          return;
        }
        const data = await res.json();
        setResults(data.results ?? [], generation);
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
  }, [attackerPos, defenderKey, attackerKey, boostsKey, itemsKey, abilitiesKey]);
}
