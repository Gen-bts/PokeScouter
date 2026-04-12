import { useEffect, useState } from "react";
import type { MegaFormDetail, TypeEffectivenessData } from "../types";

export interface PokemonDetail {
  pokemon_key: string;
  base_species_key: string;
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
  type_effectiveness: TypeEffectivenessData;
  mega_forms: MegaFormDetail[];
}

const cache = new Map<string, PokemonDetail>();
const pending = new Map<string, Promise<PokemonDetail | null>>();

export function usePokemonDetail(pokemonKey: string | null): {
  detail: PokemonDetail | null;
} {
  const [detail, setDetail] = useState<PokemonDetail | null>(
    pokemonKey !== null ? (cache.get(pokemonKey) ?? null) : null,
  );

  useEffect(() => {
    if (pokemonKey === null) {
      setDetail(null);
      return;
    }

    const cached = cache.get(pokemonKey);
    if (cached) {
      setDetail(cached);
      return;
    }

    let cancelled = false;

    let promise = pending.get(pokemonKey);
    if (!promise) {
      promise = fetch(`/api/pokemon/${pokemonKey}/detail?lang=ja`)
        .then((res) => (res.ok ? (res.json() as Promise<PokemonDetail>) : null))
        .then((data) => {
          if (data) cache.set(pokemonKey, data);
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
      if (!cancelled) setDetail(data);
    });

    return () => {
      cancelled = true;
    };
  }, [pokemonKey]);

  return { detail };
}
