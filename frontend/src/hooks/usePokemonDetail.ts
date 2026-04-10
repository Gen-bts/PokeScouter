import { useEffect, useState } from "react";

interface TypeEffectivenessEntry {
  type: string;
  multiplier: number;
}

export interface PokemonDetail {
  pokemon_id: number;
  name: string;
  types: string[];
  base_stats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  abilities: {
    normal: Array<{ name: string; effect: string }>;
    hidden: { name: string; effect: string } | null;
  };
  type_effectiveness: {
    weak: TypeEffectivenessEntry[];
    resist: TypeEffectivenessEntry[];
    immune: TypeEffectivenessEntry[];
  };
}

const cache = new Map<number, PokemonDetail>();
const pending = new Map<number, Promise<PokemonDetail | null>>();

export function usePokemonDetail(pokemonId: number | null): {
  detail: PokemonDetail | null;
} {
  const [detail, setDetail] = useState<PokemonDetail | null>(
    pokemonId !== null ? (cache.get(pokemonId) ?? null) : null,
  );

  useEffect(() => {
    if (pokemonId === null) {
      setDetail(null);
      return;
    }

    const cached = cache.get(pokemonId);
    if (cached) {
      setDetail(cached);
      return;
    }

    let cancelled = false;

    let promise = pending.get(pokemonId);
    if (!promise) {
      promise = fetch(`/api/pokemon/${pokemonId}/detail?lang=ja`)
        .then((res) => (res.ok ? (res.json() as Promise<PokemonDetail>) : null))
        .then((data) => {
          if (data) cache.set(pokemonId, data);
          pending.delete(pokemonId);
          return data;
        })
        .catch(() => {
          pending.delete(pokemonId);
          return null;
        });
      pending.set(pokemonId, promise);
    }

    promise.then((data) => {
      if (!cancelled) setDetail(data);
    });

    return () => {
      cancelled = true;
    };
  }, [pokemonId]);

  return { detail };
}
