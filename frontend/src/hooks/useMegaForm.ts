import { useEffect } from "react";
import type { MegaFormDetail } from "../types";
import { useMyPartyStore } from "../stores/useMyPartyStore";

const cache = new Map<string, MegaFormDetail>();
const pending = new Map<string, Promise<MegaFormDetail | null>>();

export function useMegaForm(
  itemId: number | null,
  pokemonId: number | null,
  slotPosition: number,
): { megaForm: MegaFormDetail | null } {
  const persistedMegaForm = useMyPartyStore(
    (s) => s.slots[slotPosition - 1]?.megaForm ?? null,
  );
  const setSlotMegaForm = useMyPartyStore((s) => s.setSlotMegaForm);

  const cacheKey = itemId !== null ? `${itemId}-${pokemonId ?? ""}` : null;

  useEffect(() => {
    if (itemId === null || cacheKey === null) return;

    const cached = cache.get(cacheKey);
    if (cached) {
      if (!persistedMegaForm) setSlotMegaForm(slotPosition, cached);
      return;
    }

    let cancelled = false;

    let promise = pending.get(cacheKey);
    if (!promise) {
      const params = new URLSearchParams({ item_id: String(itemId), lang: "ja" });
      if (pokemonId !== null) params.set("pokemon_id", String(pokemonId));

      promise = fetch(`/api/pokemon/mega-form?${params}`)
        .then((res) => (res.ok ? (res.json() as Promise<MegaFormDetail>) : null))
        .then((data) => {
          if (data) cache.set(cacheKey!, data);
          pending.delete(cacheKey!);
          return data;
        })
        .catch(() => {
          pending.delete(cacheKey!);
          return null;
        });
      pending.set(cacheKey, promise);
    }

    promise.then((data) => {
      if (!cancelled && data) {
        setSlotMegaForm(slotPosition, data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [itemId, pokemonId, cacheKey, slotPosition, persistedMegaForm, setSlotMegaForm]);

  // インメモリキャッシュ → ストア永続化値 の順でフォールバック
  if (cacheKey !== null) {
    const cached = cache.get(cacheKey);
    if (cached) return { megaForm: cached };
  }
  return { megaForm: persistedMegaForm };
}
