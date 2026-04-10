import { useEffect, useState } from "react";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import type { TypeConsistencyResult } from "../types";

export function useTypeConsistency(): {
  result: TypeConsistencyResult | null;
  loading: boolean;
} {
  const slots = useOpponentTeamStore((s) => s.slots);
  const [result, setResult] = useState<TypeConsistencyResult | null>(null);
  const [loading, setLoading] = useState(false);

  const pokemonIds = slots
    .map((s) => s.pokemonId)
    .filter((id): id is number => id !== null);
  const key = pokemonIds.join(",");

  useEffect(() => {
    if (pokemonIds.length === 0) {
      setResult(null);
      return;
    }
    setLoading(true);
    fetch(`/api/pokemon/type-consistency?pokemon_ids=${key}`)
      .then((res) => res.json())
      .then((data: TypeConsistencyResult) => {
        setResult(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { result, loading };
}
