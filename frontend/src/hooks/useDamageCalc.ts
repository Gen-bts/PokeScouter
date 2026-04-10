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

/** ValidatedField から matched_id を取得する. */
function fieldToId(field: ValidatedField | undefined): number | null {
  return field?.matched_id ?? null;
}

/** パーティスロットの fields から攻撃側データを構築する. */
function buildAttackerData(
  pokemonId: number,
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

  const moveIds: number[] = [];
  for (const key of ["わざ１", "わざ２", "わざ３", "わざ４"]) {
    const id = fieldToId(fields[key]);
    if (id != null) moveIds.push(id);
  }

  if (moveIds.length === 0) return null;

  return {
    pokemon_id: pokemonId,
    stats: { hp, atk, def: def_, spa, spd, spe },
    move_ids: moveIds,
    ability_id: fieldToId(fields["特性"]),
    item_id: fieldToId(fields["もちもの"]),
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

  const partySlots = useMyPartyStore((s) => s.slots);
  const opponentSlots = useOpponentTeamStore((s) => s.slots);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 防御側 species_ids を導出
  const defenderIds = opponentSlots
    .map((s) => s.pokemonId)
    .filter((id): id is number => id !== null);
  const defenderKey = defenderIds.join(",");

  // 攻撃側のバリデーション
  const attackerSlot =
    attackerPos !== null ? partySlots[attackerPos - 1] : null;
  const attackerValid =
    attackerSlot?.pokemonId != null && attackerSlot?.pokemonId !== undefined;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!attackerPos || !attackerValid || defenderIds.length === 0) {
      return;
    }

    const attackerData = buildAttackerData(
      attackerSlot!.pokemonId!,
      attackerSlot!.fields,
    );
    if (!attackerData) {
      return;
    }

    const generation = incrementGeneration();
    setLoading(true);

    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/damage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attacker: attackerData,
            defender_species_ids: defenderIds,
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
  }, [attackerPos, defenderKey, attackerValid]);
}
