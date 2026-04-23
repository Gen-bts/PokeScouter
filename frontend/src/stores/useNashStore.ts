import { create } from "zustand";

/** Nash API のレスポンス型. */
export interface NashStrategyEntry {
  pick: number[];       // pokemon のチーム内 index (0-5)
  p: number;            // 混合戦略の選択確率
}

export interface NashResponse {
  value: number;
  matchup_6x6: number[][];
  matchup_20x20: number[][];
  picks_a: number[][];
  picks_b: number[][];
  strategy_a: NashStrategyEntry[];
  strategy_b: NashStrategyEntry[];
  recommended_pick_a: number[];
  status: "converged" | "iteration_limit" | "trivial";
  iterations: number;
  exploitability: number;
}

interface NashState {
  /** 最後の Nash 結果. null = まだ解かれていない */
  result: NashResponse | null;
  /** 解求解の入力シグネチャ (team key 組合せ) — 重複リクエスト抑止 */
  lastRequestKey: string | null;
  /** ロード中 */
  loading: boolean;
  /** エラー */
  error: string | null;
  /** 最終計算時刻 (ms) */
  lastSolvedAt: number | null;
  /** 結果をセット */
  setResult: (result: NashResponse, requestKey: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useNashStore = create<NashState>((set) => ({
  result: null,
  lastRequestKey: null,
  loading: false,
  error: null,
  lastSolvedAt: null,
  setResult: (result, requestKey) =>
    set({
      result,
      lastRequestKey: requestKey,
      lastSolvedAt: Date.now(),
      loading: false,
      error: null,
    }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  clear: () =>
    set({
      result: null,
      lastRequestKey: null,
      loading: false,
      error: null,
      lastSolvedAt: null,
    }),
}));
