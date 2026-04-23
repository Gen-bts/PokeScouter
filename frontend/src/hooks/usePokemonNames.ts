import { useEffect, useState } from "react";

interface PokemonNamesResult {
  names: Record<string, string>;
  loading: boolean;
}

interface PokemonNamesOptions {
  championsOnly?: boolean;
}

const cache: Record<string, Record<string, string>> = {};

export function usePokemonNames(
  options: PokemonNamesOptions = {},
): PokemonNamesResult {
  const { championsOnly = false } = options;
  const cacheKey = championsOnly ? "champions" : "all";
  const [names, setNames] = useState<Record<string, string>>(cache[cacheKey] ?? {});
  const [loading, setLoading] = useState(cache[cacheKey] === undefined);

  useEffect(() => {
    if (cache[cacheKey] !== undefined) {
      setNames(cache[cacheKey]);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ lang: "ja" });
    if (championsOnly) params.set("champions_only", "true");

    fetch(`/api/pokemon/names?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { pokemon: Record<string, string> }) => {
        cache[cacheKey] = data.pokemon;
        setNames(data.pokemon);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [cacheKey, championsOnly]);

  return { names, loading };
}
