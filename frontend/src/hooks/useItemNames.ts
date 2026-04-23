import { useEffect, useState } from "react";

interface ItemEntry {
  key: string;
  name: string;
}

interface ItemNamesResult {
  items: ItemEntry[];
  loading: boolean;
}

let cache: ItemEntry[] | null = null;
let pending: Promise<ItemEntry[] | null> | null = null;

export function useItemNames(): ItemNamesResult {
  const [items, setItems] = useState<ItemEntry[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    if (cache !== null) {
      setItems(cache);
      setLoading(false);
      return;
    }

    if (!pending) {
      pending = fetch(`/api/item/names?lang=ja`)
        .then((res) => (res.ok ? (res.json() as Promise<{ items: ItemEntry[] }>) : null))
        .then((data) => {
          if (data) cache = data.items;
          pending = null;
          return data ? data.items : null;
        })
        .catch(() => {
          pending = null;
          return null;
        });
    }

    let cancelled = false;
    pending.then((data) => {
      if (cancelled) return;
      if (data) setItems(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { items, loading };
}
