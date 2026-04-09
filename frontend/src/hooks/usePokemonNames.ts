import { useEffect, useState } from "react";

interface PokemonNamesResult {
  names: Record<string, number>;
  loading: boolean;
}

let cachedNames: Record<string, number> | null = null;

export function usePokemonNames(): PokemonNamesResult {
  const [names, setNames] = useState<Record<string, number>>(cachedNames ?? {});
  const [loading, setLoading] = useState(cachedNames === null);

  useEffect(() => {
    if (cachedNames !== null) return;

    fetch("/api/pokemon/names?lang=ja")
      .then((res) => res.json())
      .then((data: { pokemon: Record<string, number> }) => {
        cachedNames = data.pokemon;
        setNames(data.pokemon);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  return { names, loading };
}
