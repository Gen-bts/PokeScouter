import { useEffect, useState } from "react";
import type { MoveDetail } from "../types";

const cache = new Map<string, MoveDetail>();
const pending = new Map<string, Promise<MoveDetail | null>>();

export function useMoveDetail(moveKey: string | null): {
  detail: MoveDetail | null;
  loading: boolean;
} {
  const [detail, setDetail] = useState<MoveDetail | null>(
    moveKey !== null ? (cache.get(moveKey) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (moveKey === null) {
      setDetail(null);
      setLoading(false);
      return;
    }

    const cached = cache.get(moveKey);
    if (cached) {
      setDetail(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    let promise = pending.get(moveKey);
    if (!promise) {
      promise = fetch(`/api/move/${moveKey}?lang=ja`)
        .then((res) => (res.ok ? (res.json() as Promise<MoveDetail>) : null))
        .then((data) => {
          if (data) cache.set(moveKey, data);
          pending.delete(moveKey);
          return data;
        })
        .catch(() => {
          pending.delete(moveKey);
          return null;
        });
      pending.set(moveKey, promise);
    }

    promise.then((data) => {
      if (!cancelled) {
        setDetail(data);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [moveKey]);

  return { detail, loading };
}

/** 複数のわざキーから一度に詳細を取得するユーティリティ */
export function getMoveDetailFromCache(moveKey: string): MoveDetail | null {
  return cache.get(moveKey) ?? null;
}

/** キャッシュにわざ詳細をプリフェッチ */
export function prefetchMoveDetails(moveKeys: string[]): void {
  for (const moveKey of moveKeys) {
    if (cache.has(moveKey) || pending.has(moveKey)) continue;
    const promise = fetch(`/api/move/${moveKey}?lang=ja`)
      .then((res) => (res.ok ? (res.json() as Promise<MoveDetail>) : null))
      .then((data) => {
        if (data) cache.set(moveKey, data);
        pending.delete(moveKey);
        return data;
      })
      .catch(() => {
        pending.delete(moveKey);
        return null;
      });
    pending.set(moveKey, promise);
  }
}
