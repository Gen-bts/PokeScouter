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
  /** デバッグ用: 最後に送信したリクエストボディ */
  lastRequestBody: Record<string, unknown> | null;

  selectAttacker: (position: number | null) => void;
  setResults: (results: DefenderDamageResult[], generation: number, requestBody?: Record<string, unknown>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  incrementGeneration: () => number;
  clearResults: () => void;
  clear: () => void;
}

export const useDamageCalcStore = create<DamageCalcState>()((set, get) => ({
  selectedAttackerPosition: null,
  results: [],
  loading: false,
  error: null,
  requestGeneration: 0,
  lastRequestBody: null,

  selectAttacker: (position) =>
    set({
      selectedAttackerPosition: position,
      results: [],
      error: null,
    }),

  setResults: (results, generation, requestBody?) =>
    set((state) => {
      if (generation !== state.requestGeneration) return state;
      return { results, loading: false, error: null, lastRequestBody: requestBody ?? null };
    }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  incrementGeneration: () => {
    const next = get().requestGeneration + 1;
    set({ requestGeneration: next });
    return next;
  },

  clearResults: () => set({ results: [], loading: false, error: null, lastRequestBody: null }),

  clear: () =>
    set({
      selectedAttackerPosition: null,
      results: [],
      loading: false,
      error: null,
      lastRequestBody: null,
    }),
}));
