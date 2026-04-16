import { useEffect, useState } from "react";
import type { PokemonUsage } from "../types";

const cache = new Map<string, PokemonUsage>();
const pending = new Map<string, Promise<PokemonUsage | null>>();
const DEBUG_ENDPOINT = "http://127.0.0.1:7439/ingest/9a392a2b-ccaf-4fd7-bbd7-f8bf6170fef3";
const DEBUG_SESSION_ID = "bc4e26";

export function usePokemonUsage(pokemonKey: string | null): {
  usage: PokemonUsage | null;
} {
  const [usage, setUsage] = useState<PokemonUsage | null>(
    pokemonKey !== null ? (cache.get(pokemonKey) ?? null) : null,
  );

  useEffect(() => {
    if (pokemonKey === null) {
      setUsage(null);
      return;
    }

    const cached = cache.get(pokemonKey);
    if (cached) {
      setUsage(cached);
      return;
    }

    // キャッシュにない場合は即座にクリアして古いデータが残らないようにする
    setUsage(null);

    let cancelled = false;

    let promise = pending.get(pokemonKey);
    if (!promise) {
      // #region agent log
      fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H2", location: "frontend/src/hooks/usePokemonUsage.ts:35", message: "usage fetch start", data: { pokemonKey, cached: false, hasPending: false }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
      promise = fetch(`/api/pokemon/${pokemonKey}/usage?lang=ja`)
        .then((res) => (res.ok ? (res.json() as Promise<PokemonUsage>) : null))
        .then((data) => {
          // #region agent log
          fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H2", location: "frontend/src/hooks/usePokemonUsage.ts:39", message: "usage fetch resolved", data: { pokemonKey, hasData: data != null, moveCount: data?.moves.length ?? 0, usagePercent: data?.usage_percent ?? null }, timestamp: Date.now() }) }).catch(() => {});
          // #endregion
          if (data && data.moves.length > 0) cache.set(pokemonKey, data);
          pending.delete(pokemonKey);
          return data;
        })
        .catch(() => {
          pending.delete(pokemonKey);
          return null;
        });
      pending.set(pokemonKey, promise);
    }

    promise.then((data) => {
      if (!cancelled) setUsage(data);
    });

    return () => {
      cancelled = true;
    };
  }, [pokemonKey]);

  return { usage };
}
