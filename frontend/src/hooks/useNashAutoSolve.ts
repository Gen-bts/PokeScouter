import { useEffect, useRef } from "react";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore, getEffectivePokemonKey } from "../stores/useOpponentTeamStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useNashStore } from "../stores/useNashStore";
import { useNashSolve } from "./useNashSolve";

/** 選出画面で双方 6 匹揃ったら自動で Nash を解く副作用フック. */
export function useNashAutoSolve(): void {
  const mySlots = useMyPartyStore((s) => s.slots);
  const opSlots = useOpponentTeamStore((s) => s.slots);
  const autoSolve = useSettingsStore((s) => s.nashAutoSolve);
  const loading = useNashStore((s) => s.loading);
  const lastRequestKey = useNashStore((s) => s.lastRequestKey);
  const { solve } = useNashSolve();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // team シグネチャ
  const selfKeys = mySlots
    .map((s) => s.pokemonId)
    .filter((k): k is string => k !== null);
  const opKeys = opSlots
    .map((s) => getEffectivePokemonKey(s))
    .filter((k): k is string => k !== null);
  const teamsReady = selfKeys.length === 6 && opKeys.length === 6;
  const requestKey = `${selfKeys.join(",")}|${opKeys.join(",")}`;

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!autoSolve || !teamsReady || loading) return;
    if (lastRequestKey === requestKey) return;

    // 500ms デバウンス (OCR 連続更新時の抑制)
    debounceRef.current = setTimeout(() => {
      void solve();
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [autoSolve, teamsReady, loading, lastRequestKey, requestKey, solve]);
}
