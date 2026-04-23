import { useEffect, useRef } from "react";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useFieldStateStore } from "../stores/useFieldStateStore";
import { useIncomingDamageStore, type StatusMoveEntry } from "../stores/useIncomingDamageStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore, getEffectivePokemonKey } from "../stores/useOpponentTeamStore";
import type { UsageMove, ValidatedField } from "../types";
import { usePokemonUsage } from "./usePokemonUsage";

const DEBOUNCE_MS = 300;
const DEBUG_ENDPOINT = "http://127.0.0.1:7439/ingest/9a392a2b-ccaf-4fd7-bbd7-f8bf6170fef3";
const DEBUG_SESSION_ID = "bc4e26";

function fieldToInt(field: ValidatedField | undefined): number | null {
  if (!field) return null;
  const val = field.validated ?? field.raw;
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function fieldToKey(field: ValidatedField | undefined): string | null {
  return field?.matched_key ?? field?.matched_id ?? null;
}

/** パーティスロットの fields から防御側（自分）データを構築する. */
function buildDefenderData(
  pokemonId: string,
  fields: Record<string, ValidatedField>,
) {
  const hp = fieldToInt(fields["HP実数値"]);
  const atk = fieldToInt(fields["こうげき実数値"]);
  const def_ = fieldToInt(fields["ぼうぎょ実数値"]);
  const spa = fieldToInt(fields["とくこう実数値"]);
  const spd = fieldToInt(fields["とくぼう実数値"]);
  const spe = fieldToInt(fields["すばやさ実数値"]);

  if (hp == null || atk == null || def_ == null || spa == null || spd == null || spe == null) {
    return null;
  }

  return {
    pokemon_key: pokemonId,
    stats: { hp, atk, def: def_, spa, spd, spe },
    ability_key: fieldToKey(fields["特性"]),
    item_key: fieldToKey(fields["もちもの"]),
  };
}

/**
 * 被ダメージ計算をトリガーする副作用フック.
 *
 * 使用率データの技を常にベースとして表示し、確定済み技がある場合は
 * それらをリスト上部に★付きで表示する。変化技も表示対象に含む。
 * 300ms debounce で POST /api/damage/incoming を発火する。
 */
export function useIncomingDamageCalc(): void {
  const attackerPos = useDamageCalcStore((s) => s.selectedAttackerPosition);
  const partySlots = useMyPartyStore((s) => s.slots);
  const opponentSlots = useOpponentTeamStore((s) => s.slots);
  const displaySelectedPosition = useOpponentTeamStore(
    (s) => s.displaySelectedPosition,
  );

  const setResults = useIncomingDamageStore((s) => s.setResults);
  const setLoading = useIncomingDamageStore((s) => s.setLoading);
  const setError = useIncomingDamageStore((s) => s.setError);
  const incrementGeneration = useIncomingDamageStore(
    (s) => s.incrementGeneration,
  );
  const clearResults = useIncomingDamageStore((s) => s.clearResults);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自分ポケモン（防御側）
  const mySlot = attackerPos != null ? partySlots[attackerPos - 1] : null;
  const defenderData =
    mySlot?.pokemonId != null
      ? buildDefenderData(mySlot.pokemonId, mySlot.fields)
      : null;
  const defenderKey = defenderData ? JSON.stringify(defenderData) : "";

  // 相手ポケモン（攻撃側）
  const opponentSlot =
    displaySelectedPosition != null
      ? opponentSlots[displaySelectedPosition - 1] ?? null
      : null;
  const opponentPokemonId = opponentSlot ? getEffectivePokemonKey(opponentSlot) : null;
  const knownMoves = opponentSlot?.knownMoves ?? [];
  const knownMovesKey = knownMoves.map((m) => m.id).join(",");

  // 使用率データ
  const { usage } = usePokemonUsage(opponentPokemonId);
  const usageMoves: UsageMove[] = usage?.moves ?? [];
  const usageMovesKey = usageMoves.map((m) => m.move_key).join(",");

  // 火力配分の自動判定
  const autoSetOffensePreset = useOpponentTeamStore(
    (s) => s.autoSetOffensePresetFromMoves,
  );
  useEffect(() => {
    if (displaySelectedPosition == null) return;
    if (knownMoves.length === 0 && usageMoves.length === 0) return;
    const knownWithClass = knownMoves.map((m) => {
      const usageInfo = usageMoves.find((um) => um.move_key === m.id);
      return { id: m.id, damageClass: usageInfo?.damage_class };
    });
    autoSetOffensePreset(displaySelectedPosition, knownWithClass, usageMoves);
  }, [displaySelectedPosition, knownMovesKey, usageMovesKey, autoSetOffensePreset]);

  // --- 技マージロジック ---
  const usageMoveKeySet = new Set(usageMoves.map((m) => m.move_key));

  // 変化技を分離（calc-service には送らない）
  const statusMovesFromUsage: StatusMoveEntry[] = usageMoves
    .filter((m) => m.damage_class === "status")
    .map((m) => ({ move_key: m.move_key, move_name: m.move_name }));

  // 攻撃系 usage 技
  const damagingUsageMoveKeys = usageMoves
    .filter((m) => m.damage_class !== "status")
    .map((m) => m.move_key);

  // known 技のうち usage リストに無いもの（変化技含む — calc-service がスキップする）
  const knownMoveKeysList = knownMoves.map((m) => m.id);
  const extraKnownKeys = knownMoveKeysList.filter((k) => !usageMoveKeySet.has(k));

  // known 技のうち usage にも無く、名前を持つもの → 変化技候補として追加
  const extraKnownStatusMoves: StatusMoveEntry[] = [];
  // （calc-service レスポンスに含まれなかった extra known 技は変化技と推定する）

  // calc-service に送る技キー = 攻撃系 usage 技 + 追加 known 技
  const calcMoveKeys = [...damagingUsageMoveKeys, ...extraKnownKeys];
  const effectiveMovesKey = [...calcMoveKeys, ...statusMovesFromUsage.map((m) => m.move_key)].join(",");

  // 相手のブースト・特性・アイテム
  const opponentBoosts = opponentSlot?.boosts ?? {};
  const boostsKey = JSON.stringify(opponentBoosts);
  const opponentAbilityId = opponentSlot?.abilityId ?? null;
  const opponentItemId = opponentSlot?.itemId ?? null;

  // 相手の火力配分・性格補正
  const opponentOffensePreset = opponentSlot?.offensePreset ?? "a";
  const opponentNatureBoostStat = opponentSlot?.natureBoostStat ?? null;

  // フィールド状態
  const weather = useFieldStateStore((s) => s.weather);
  const terrain = useFieldStateStore((s) => s.terrain);
  const playerSide = useFieldStateStore((s) => s.playerSide);
  const opponentSide = useFieldStateStore((s) => s.opponentSide);
  const fieldKey = JSON.stringify({ weather, terrain, playerSide, opponentSide });

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (
      !defenderData ||
      !opponentPokemonId ||
      (calcMoveKeys.length === 0 && statusMovesFromUsage.length === 0)
    ) {
      // #region agent log
      fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H1", location: "frontend/src/hooks/useIncomingDamageCalc.ts:144", message: "incoming calc cleared by precondition", data: { hasDefenderData: defenderData != null, opponentPokemonId, calcMoveCount: calcMoveKeys.length, statusMoveCount: statusMovesFromUsage.length, attackerPos, displaySelectedPosition, knownMoveKeys: knownMoveKeysList }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
      clearResults();
      return;
    }

    const generation = incrementGeneration();
    setLoading(true);

    const reqDefender = defenderData;
    const reqAttackerKey = opponentPokemonId;
    const reqCalcMoveKeys = calcMoveKeys;
    const reqUsageMoves = usageMoves;
    const reqKnownMoveKeys = knownMoveKeysList;
    const reqStatusMoves = statusMovesFromUsage;
    const reqExtraKnownKeys = extraKnownKeys;
    const reqExtraKnownMoves = knownMoves.filter(
      (m) => !usageMoveKeySet.has(m.id),
    );
    const reqBoosts =
      Object.keys(opponentBoosts).length > 0 ? { ...opponentBoosts } : undefined;
    const reqAbilityKey = opponentAbilityId;
    const reqItemKey = opponentItemId;
    const reqOffensePreset = opponentOffensePreset;
    const reqNatureBoostStat = opponentNatureBoostStat;

    timerRef.current = setTimeout(async () => {
      try {
        let results: import("../types").DefenderDamageResult[] = [];

        const requestBody = {
          attacker_pokemon_key: reqAttackerKey,
          attacker_move_keys: reqCalcMoveKeys,
          attacker_boosts: reqBoosts,
          attacker_ability_key: reqAbilityKey,
          attacker_item_key: reqItemKey,
          attacker_offense_preset: reqOffensePreset,
          attacker_nature_boost_stat: reqNatureBoostStat,
          defender: reqDefender,
          field: {
            weather,
            terrain,
            attacker_side: {
              is_reflect: opponentSide.reflect,
              is_light_screen: opponentSide.lightScreen,
              is_aurora_veil: opponentSide.auroraVeil,
              is_tailwind: opponentSide.tailwind,
            },
            defender_side: {
              is_reflect: playerSide.reflect,
              is_light_screen: playerSide.lightScreen,
              is_aurora_veil: playerSide.auroraVeil,
              is_tailwind: playerSide.tailwind,
            },
          },
        };

        if (reqCalcMoveKeys.length > 0) {
          try {
            // #region agent log
            fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H4", location: "frontend/src/hooks/useIncomingDamageCalc.ts:175", message: "incoming calc request start", data: { generation, attackerPokemonKey: reqAttackerKey, calcMoveKeys: reqCalcMoveKeys, usageMoveCount: reqUsageMoves.length, knownMoveKeys: reqKnownMoveKeys, defenderPokemonKey: reqDefender.pokemon_key, attackerAbilityKey: reqAbilityKey, attackerItemKey: reqItemKey }, timestamp: Date.now() }) }).catch(() => {});
            // #endregion
            const res = await fetch("/api/damage/incoming", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });
            // #region agent log
            fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H4", location: "frontend/src/hooks/useIncomingDamageCalc.ts:201", message: "incoming calc response received", data: { generation, ok: res.ok, status: res.status, attackerPokemonKey: reqAttackerKey }, timestamp: Date.now() }) }).catch(() => {});
            // #endregion
            if (res.ok) {
              const data = await res.json();
              results = data.results ?? [];
              // #region agent log
              fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H4", location: "frontend/src/hooks/useIncomingDamageCalc.ts:205", message: "incoming calc payload parsed", data: { generation, resultCount: results.length, moveCounts: results.map((r) => ({ defender: r.defender_species_id, moves: r.moves.length })) }, timestamp: Date.now() }) }).catch(() => {});
              // #endregion
            }
            // API エラー時は results=[] のまま続行（使用率技は表示する）
          } catch {
            // ネットワークエラー時も results=[] のまま続行
          }
        }

        // 追加 known 技のうち calc 結果に含まれないものを変化技として追加
        const returnedMoveKeys = new Set(
          results.flatMap((r) => r.moves.map((m) => m.move_key)),
        );
        const finalStatusMoves = [...reqStatusMoves];
        for (const km of reqExtraKnownMoves) {
          if (!returnedMoveKeys.has(km.id)) {
            finalStatusMoves.push({ move_key: km.id, move_name: km.name });
          }
        }

        setResults(results, generation, reqUsageMoves, reqKnownMoveKeys, finalStatusMoves, requestBody);
      } catch (e) {
        // 予期しないエラー時も使用率技リストだけは表示する
        const finalStatusMoves = [...reqStatusMoves];
        for (const km of reqExtraKnownMoves) {
          finalStatusMoves.push({ move_key: km.id, move_name: km.name });
        }
        setResults([], generation, reqUsageMoves, reqKnownMoveKeys, finalStatusMoves, requestBody);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    defenderKey,
    opponentPokemonId,
    effectiveMovesKey,
    knownMovesKey,
    usageMovesKey,
    boostsKey,
    opponentAbilityId,
    opponentItemId,
    opponentOffensePreset,
    opponentNatureBoostStat,
    fieldKey,
  ]);
}
