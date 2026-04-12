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

  const pokemonKeys = slots
    .map((s) => s.pokemonId)
    .filter((id): id is string => id !== null);
  const key = pokemonKeys.join(",");

  useEffect(() => {
    if (pokemonKeys.length === 0) {
      setResult(null);
      return;
    }
    setLoading(true);
    fetch(`/api/pokemon/type-consistency?pokemon_keys=${encodeURIComponent(key)}`)
      .then((res) => res.json())
      .then((data: TypeConsistencyResult) => {
        setResult(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pokemonKeys.length]);

  return { result, loading };
}
