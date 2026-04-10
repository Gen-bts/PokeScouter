import { create } from "zustand";
import type { DefenderDamageResult } from "../types";

interface DamageCalcState {
  /** 攻撃側として選択中のパーティスロット (1-6), null = 未選択 */
  selectedAttackerPosition: number | null;
  /** ダメージ計算結果 */
  results: DefenderDamageResult[];
  /** リクエスト中 */
  loading: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** stale レスポンス破棄用カウンタ */
  requestGeneration: number;

  selectAttacker: (position: number | null) => void;
  setResults: (results: DefenderDamageResult[], generation: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  incrementGeneration: () => number;
  clear: () => void;
}

export const useDamageCalcStore = create<DamageCalcState>()((set, get) => ({
  selectedAttackerPosition: null,
  results: [],
  loading: false,
  error: null,
  requestGeneration: 0,

  selectAttacker: (position) =>
    set({
      selectedAttackerPosition: position,
      results: [],
      error: null,
    }),

  setResults: (results, generation) =>
    set((state) => {
      if (generation !== state.requestGeneration) return state;
      return { results, loading: false, error: null };
    }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  incrementGeneration: () => {
    const next = get().requestGeneration + 1;
    set({ requestGeneration: next });
    return next;
  },

  clear: () =>
    set({
      selectedAttackerPosition: null,
      results: [],
      loading: false,
      error: null,
    }),
}));
