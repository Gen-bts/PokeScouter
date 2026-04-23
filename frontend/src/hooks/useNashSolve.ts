import { useCallback } from "react";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore, getEffectivePokemonKey } from "../stores/useOpponentTeamStore";
import { useNashStore } from "../stores/useNashStore";
import type { ValidatedField } from "../types";

interface NashPokemonSpec {
  pokemon_key: string;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  ability_key: string | null;
  item_key: string | null;
  move_keys: string[];
}

function fieldInt(f: ValidatedField | undefined): number | null {
  if (!f) return null;
  const v = f.validated ?? f.raw;
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function fieldKey(f: ValidatedField | undefined): string | null {
  return f?.matched_key ?? f?.matched_id ?? null;
}

/**
 * 自分パーティスロット (OCR 実数値) から NashPokemonSpec を構築.
 * 実数値 / 技が不完全な場合は null を返す。
 */
function buildSelfSpec(
  slot: ReturnType<typeof useMyPartyStore.getState>["slots"][number],
): NashPokemonSpec | null {
  if (!slot.pokemonId) return null;
  const hp = fieldInt(slot.fields["HP実数値"]);
  const atk = fieldInt(slot.fields["こうげき実数値"]);
  const def_ = fieldInt(slot.fields["ぼうぎょ実数値"]);
  const spa = fieldInt(slot.fields["とくこう実数値"]);
  const spd = fieldInt(slot.fields["とくぼう実数値"]);
  const spe = fieldInt(slot.fields["すばやさ実数値"]);
  if (hp == null || atk == null || def_ == null || spa == null || spd == null || spe == null) {
    return null;
  }
  const moves: string[] = [];
  for (const k of ["わざ１", "わざ２", "わざ３", "わざ４"]) {
    const id = fieldKey(slot.fields[k]);
    if (id) moves.push(id);
  }
  return {
    pokemon_key: slot.pokemonId,
    stats: { hp, atk, def: def_, spa, spd, spe },
    ability_key: fieldKey(slot.fields["特性"]),
    item_key: fieldKey(slot.fields["もちもの"]),
    move_keys: moves,
  };
}

/**
 * 相手スロットから NashPokemonSpec を構築.
 * stats/moves は 0/空のまま送り、バックエンドが使用率から補完する。
 */
function buildOpponentSpec(
  slot: ReturnType<typeof useOpponentTeamStore.getState>["slots"][number],
): NashPokemonSpec | null {
  const pokemonKey = getEffectivePokemonKey(slot);
  if (!pokemonKey) return null;
  const moves = slot.knownMoves.map((m) => m.id);
  return {
    pokemon_key: pokemonKey,
    stats: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ability_key: slot.abilityId,
    item_key: slot.itemId,
    move_keys: moves,
  };
}

/**
 * 現在のストア状態から Nash API を叩くトリガー関数を返す。
 *
 * 12 匹 (自分 6 + 相手 6) が全て確定している場合のみ発火。
 * 同じ team 組合せでは二重リクエスト抑止。
 */
export function useNashSolve(): {
  solve: () => Promise<void>;
  canSolve: boolean;
} {
  const mySlots = useMyPartyStore((s) => s.slots);
  const opSlots = useOpponentTeamStore((s) => s.slots);
  const setResult = useNashStore((s) => s.setResult);
  const setLoading = useNashStore((s) => s.setLoading);
  const setError = useNashStore((s) => s.setError);
  const lastRequestKey = useNashStore((s) => s.lastRequestKey);

  // team 特定用シグネチャ (pokemon_key のみで判定; stats 詳細が変わっても再計算しない簡易版)
  const selfKeys = mySlots
    .map((s) => s.pokemonId)
    .filter((k): k is string => k !== null);
  const opKeys = opSlots
    .map((s) => getEffectivePokemonKey(s))
    .filter((k): k is string => k !== null);
  const canSolve = selfKeys.length === 6 && opKeys.length === 6;
  const requestKey = `${selfKeys.join(",")}|${opKeys.join(",")}`;

  const solve = useCallback(async () => {
    if (!canSolve) return;
    if (lastRequestKey === requestKey) return; // 同じ team なら再計算しない

    // ポケモンスペック構築
    const teamA: NashPokemonSpec[] = [];
    for (const s of mySlots) {
      const spec = buildSelfSpec(s);
      if (!spec) return; // OCR 実数値不足
      teamA.push(spec);
    }
    const teamB: NashPokemonSpec[] = [];
    for (const s of opSlots) {
      const spec = buildOpponentSpec(s);
      if (!spec) return;
      teamB.push(spec);
    }
    if (teamA.length !== 6 || teamB.length !== 6) return;

    setLoading(true);
    try {
      const res = await fetch("/api/nash/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_a: teamA,
          team_b: teamB,
          pick_size: 3,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setError(`Nash API error: ${res.status} ${txt.slice(0, 100)}`);
        return;
      }
      const data = await res.json();
      setResult(data, requestKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown Nash error");
    }
  }, [canSolve, requestKey, lastRequestKey, mySlots, opSlots, setLoading, setError, setResult]);

  return { solve, canSolve };
}
