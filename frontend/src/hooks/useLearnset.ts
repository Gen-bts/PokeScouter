import { useEffect, useState } from "react";

export interface LearnsetMove {
  move_key: string;
  name: string;
  type: string | null;
  damage_class: string | null;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number | null;
}

interface LearnsetResult {
  moves: LearnsetMove[];
  loading: boolean;
}

const cache = new Map<string, LearnsetMove[]>();
const pending = new Map<string, Promise<LearnsetMove[] | null>>();

export function useLearnset(pokemonKey: string | null): LearnsetResult {
  const [moves, setMoves] = useState<LearnsetMove[]>(
    pokemonKey ? (cache.get(pokemonKey) ?? []) : [],
  );
  const [loading, setLoading] = useState(
    pokemonKey !== null && !cache.has(pokemonKey),
  );

  useEffect(() => {
    if (!pokemonKey) {
      setMoves([]);
      setLoading(false);
      return;
    }

    const cached = cache.get(pokemonKey);
    if (cached) {
      setMoves(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    let promise = pending.get(pokemonKey);
    if (!promise) {
      promise = fetch(`/api/pokemon/${pokemonKey}/learnset?lang=ja`)
        .then((res) =>
          res.ok ? (res.json() as Promise<{ moves: LearnsetMove[] }>) : null,
        )
        .then((data) => {
          if (data) cache.set(pokemonKey, data.moves);
          pending.delete(pokemonKey);
          return data ? data.moves : null;
        })
        .catch(() => {
          pending.delete(pokemonKey);
          return null;
        });
      pending.set(pokemonKey, promise);
    }

    promise.then((data) => {
      if (cancelled) return;
      if (data) setMoves(data);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [pokemonKey]);

  return { moves, loading };
}
