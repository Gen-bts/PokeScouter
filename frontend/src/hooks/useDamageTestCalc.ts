import { useEffect, useRef } from "react";
import {
  useDamageTestStore,
  type DamageTestMoveResult,
  type DamageTestResult,
  type NatureMultiplier,
  type Stat,
} from "../stores/useDamageTestStore";
import { useLearnset } from "./useLearnset";

const DEBOUNCE_MS = 300;

interface SidePayload {
  pokemon_key: string;
  ev_allocation: Record<string, number>;
  nature_up: string | null;
  nature_down: string | null;
  ability_key: string | null;
  item_key: string | null;
  boosts: Record<string, number> | null;
  status: string | null;
  is_mega_active: boolean;
}

interface AttackerPayload extends SidePayload {
  move_keys: string[];
}

interface RequestPayload {
  attacker: AttackerPayload;
  defender: SidePayload;
  field: unknown;
}

async function postCalc(payload: RequestPayload): Promise<DamageTestResult> {
  const res = await fetch("/api/damage/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as DamageTestResult;
}

/** 倍率とステータスから nature_up / nature_down を組み立てる */
function naturePair(
  mul: NatureMultiplier,
  stat: Stat,
): { up: Stat | null; down: Stat | null } {
  if (mul === 1.1) return { up: stat, down: null };
  if (mul === 0.9) return { up: null, down: stat };
  return { up: null, down: null };
}

export function useDamageTestCalc() {
  const attacker = useDamageTestStore((s) => s.attacker);
  const defender = useDamageTestStore((s) => s.defender);
  const field = useDamageTestStore((s) => s.field);
  const setResults = useDamageTestStore((s) => s.setResults);
  const setLoading = useDamageTestStore((s) => s.setLoading);
  const setError = useDamageTestStore((s) => s.setError);

  const { moves: attackerLearnset } = useLearnset(attacker.pokemonKey);

  const lastPayloadRef = useRef<string>("");

  useEffect(() => {
    if (!attacker.pokemonKey || !defender.pokemonKey) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }

    const activeMoves = attacker.moveKeys.filter((m): m is string => !!m);
    if (activeMoves.length === 0) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }

    const attackerMul = attacker.natureMultiplier;
    const defenderMul = defender.natureMultiplier;
    const anyNature = attackerMul !== 1 || defenderMul !== 1;

    // わざ種類マップ（auto 分岐時のみ利用）
    const moveClassMap = new Map<string, string | null>();
    for (const m of attackerLearnset) {
      moveClassMap.set(m.move_key, m.damage_class);
    }

    const physicalMoves: string[] = [];
    const specialMoves: string[] = [];
    const otherMoves: string[] = []; // status 等
    for (const mk of activeMoves) {
      const cls = moveClassMap.get(mk) ?? null;
      if (cls === "special") specialMoves.push(mk);
      else if (cls === "physical") physicalMoves.push(mk);
      else otherMoves.push(mk);
    }

    // nature が無ければ分類不要。nature 有りでも learnset 未取得ならまだ確定しない
    const needsSplit =
      anyNature && (physicalMoves.length > 0 || specialMoves.length > 0);
    if (anyNature && attackerLearnset.length === 0) {
      return;
    }

    const buildAttackerPayload = (
      up: Stat | null,
      down: Stat | null,
      moveKeys: string[],
    ): AttackerPayload => ({
      pokemon_key: attacker.pokemonKey!,
      ev_allocation: attacker.evAllocation,
      nature_up: up,
      nature_down: down,
      ability_key: attacker.abilityKey,
      item_key: attacker.itemKey,
      boosts:
        Object.keys(attacker.boosts).length > 0
          ? (attacker.boosts as Record<string, number>)
          : null,
      status: attacker.status,
      is_mega_active: attacker.isMegaActive,
      move_keys: moveKeys,
    });

    const buildDefenderPayload = (
      up: Stat | null,
      down: Stat | null,
    ): SidePayload => ({
      pokemon_key: defender.pokemonKey!,
      ev_allocation: defender.evAllocation,
      nature_up: up,
      nature_down: down,
      ability_key: defender.abilityKey,
      item_key: defender.itemKey,
      boosts:
        Object.keys(defender.boosts).length > 0
          ? (defender.boosts as Record<string, number>)
          : null,
      status: defender.status,
      is_mega_active: defender.isMegaActive,
    });

    const fieldPayload = {
      weather: field.weather,
      terrain: field.terrain,
      attacker_side: field.attackerSide,
      defender_side: field.defenderSide,
    };

    // 状態変化の検出用フィンガープリント
    const planKey = needsSplit
      ? `split|a${attackerMul}|d${defenderMul}|p[${physicalMoves.join(",")}]|s[${specialMoves.join(",")}]|o[${otherMoves.join(",")}]`
      : `plain|a${attackerMul}|d${defenderMul}|m[${activeMoves.join(",")}]`;
    const payloadFingerprint = JSON.stringify({
      attacker: { ...buildAttackerPayload(null, null, activeMoves), _plan: planKey },
      defender: buildDefenderPayload(null, null),
      field: fieldPayload,
    });
    if (payloadFingerprint === lastPayloadRef.current) return;
    lastPayloadRef.current = payloadFingerprint;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        if (!needsSplit) {
          // nature が両側 1.0、または physical/special わざが無い場合は 1 リクエスト
          const payload: RequestPayload = {
            attacker: buildAttackerPayload(null, null, activeMoves),
            defender: buildDefenderPayload(null, null),
            field: fieldPayload,
          };
          const data = await postCalc(payload);
          if (!cancelled) setResults(data);
          return;
        }

        // 物理リクエスト: 攻撃側 A に倍率、防御側 B に倍率（状態技も相乗り）
        const atkPair = naturePair(attackerMul, "atk");
        const defPairB = naturePair(defenderMul, "def");
        // 特殊リクエスト: 攻撃側 C に倍率、防御側 D に倍率
        const spaPair = naturePair(attackerMul, "spa");
        const defPairD = naturePair(defenderMul, "spd");

        const physicalGroup = [...physicalMoves, ...otherMoves];
        const physicalReq =
          physicalGroup.length > 0
            ? postCalc({
                attacker: buildAttackerPayload(atkPair.up, atkPair.down, physicalGroup),
                defender: buildDefenderPayload(defPairB.up, defPairB.down),
                field: fieldPayload,
              })
            : Promise.resolve<DamageTestResult | null>(null);
        const specialReq =
          specialMoves.length > 0
            ? postCalc({
                attacker: buildAttackerPayload(spaPair.up, spaPair.down, specialMoves),
                defender: buildDefenderPayload(defPairD.up, defPairD.down),
                field: fieldPayload,
              })
            : Promise.resolve<DamageTestResult | null>(null);

        const [physRes, specRes] = await Promise.all([physicalReq, specialReq]);
        if (cancelled) return;

        const primary = physRes ?? specRes;
        if (!primary) {
          setResults(null);
          return;
        }

        // 元のわざ順で再構築
        const moveByKey = new Map<string, DamageTestMoveResult>();
        for (const r of [physRes, specRes]) {
          if (!r) continue;
          for (const dr of r.results) {
            for (const mr of dr.moves) moveByKey.set(mr.move_key, mr);
          }
        }
        const orderedMoves = activeMoves
          .map((mk) => moveByKey.get(mk))
          .filter((x): x is DamageTestMoveResult => !!x);

        const defenderHp =
          physRes?.results[0]?.defender_hp ??
          specRes?.results[0]?.defender_hp ??
          0;

        // 実数値表示: atk/def は物理レスポンス、spa/spd は特殊レスポンスの値を採用
        const mergedAttackerStats = {
          ...primary.attacker_stats,
          atk: physRes?.attacker_stats.atk ?? primary.attacker_stats.atk,
          spa: specRes?.attacker_stats.spa ?? primary.attacker_stats.spa,
        };
        const mergedDefenderStats = {
          ...primary.defender_stats,
          def: physRes?.defender_stats.def ?? primary.defender_stats.def,
          spd: specRes?.defender_stats.spd ?? primary.defender_stats.spd,
        };

        const merged: DamageTestResult = {
          attacker_pokemon_key: primary.attacker_pokemon_key,
          defender_pokemon_key: primary.defender_pokemon_key,
          attacker_stats: mergedAttackerStats,
          defender_stats: mergedDefenderStats,
          results:
            orderedMoves.length > 0
              ? [
                  {
                    defender_pokemon_key: primary.defender_pokemon_key,
                    defender_hp: defenderHp,
                    moves: orderedMoves,
                  },
                ]
              : [],
        };
        setResults(merged);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setResults(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    attacker,
    defender,
    field,
    attackerLearnset,
    setResults,
    setLoading,
    setError,
  ]);
}
