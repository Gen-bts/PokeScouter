import { useEffect, useRef } from "react";
import { useOpponentTeamStore, getEffectivePokemonKey, type HbdRecommendation } from "../stores/useOpponentTeamStore";

/** /api/optimize/hbd のレスポンス型. */
interface HbdApiResponse {
  sp: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  score: number;
  hp_constraint_satisfied: boolean;
  weights: { phys: number; spec: number };
  nearest_preset: "none" | "h" | "hb" | "hd" | "custom";
  preset_distance: number;
}

async function fetchHbd(pokemonKey: string): Promise<HbdRecommendation | null> {
  try {
    const res = await fetch("/api/optimize/hbd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pokemon_key: pokemonKey }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HbdApiResponse;
    return {
      sp: data.sp,
      stats: data.stats,
      nearestPreset: data.nearest_preset,
      presetDistance: data.preset_distance,
      score: data.score,
      weights: data.weights,
    };
  } catch {
    return null;
  }
}

/**
 * 相手スロットの pokemonId (メガ反映済み実効キー) が変化するたびに HBD 推定を取得し、
 * store.setHbdRecommendation に反映する。
 *
 * キャッシュ: 同じ pokemonKey に対しては 1 回だけ fetch する。
 */
export function useOpponentHbdEstimate(): void {
  const slots = useOpponentTeamStore((s) => s.slots);
  const setHbdRecommendation = useOpponentTeamStore((s) => s.setHbdRecommendation);

  // key: `${position}:${effectivePokemonKey}` → 既に取得済み
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const slot of slots) {
      const effectiveKey = getEffectivePokemonKey(slot);
      if (!effectiveKey) continue;

      const cacheKey = `${slot.position}:${effectiveKey}`;
      if (fetchedRef.current.has(cacheKey)) continue;

      // 既に同じ pokemon_key で推奨が入っているならスキップ
      if (slot.hbdRecommendation != null) {
        // hbdRecommendation は別の key で取られた可能性があるので position+key で管理
        fetchedRef.current.add(cacheKey);
        continue;
      }

      fetchedRef.current.add(cacheKey);

      fetchHbd(effectiveKey).then((rec) => {
        if (rec) {
          setHbdRecommendation(slot.position, rec);
        }
      });
    }
  }, [slots, setHbdRecommendation]);
}
