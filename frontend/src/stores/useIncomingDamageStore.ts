import { create } from "zustand";
import type { DefenderDamageResult, UsageMove } from "../types";

export interface StatusMoveEntry {
  move_key: string;
  move_name: string;
}

const DEBUG_ENDPOINT = "http://127.0.0.1:7439/ingest/9a392a2b-ccaf-4fd7-bbd7-f8bf6170fef3";
const DEBUG_SESSION_ID = "bc4e26";

interface IncomingDamageState {
  /** 被ダメージ計算結果 (attacker=相手, defender=自分) */
  results: DefenderDamageResult[];
  /** リクエスト中 */
  loading: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** stale レスポンス破棄用カウンタ */
  requestGeneration: number;
  /** usage ソースの使用率マップ (move_key → usage_percent). yakkun fallback では null */
  usagePercentMap: Record<string, number | null>;
  /** 確定済み技のキーリスト */
  knownMoveKeys: string[];
  /** 変化技リスト（ダメージ計算対象外・表示用） */
  statusMoves: StatusMoveEntry[];
  /** デバッグ用: 最後に送信したリクエストボディ */
  lastRequestBody: Record<string, unknown> | null;

  setResults: (
    results: DefenderDamageResult[],
    generation: number,
    usageMoves: UsageMove[],
    knownMoveKeys: string[],
    statusMoves: StatusMoveEntry[],
    requestBody?: Record<string, unknown>,
  ) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  incrementGeneration: () => number;
  clearResults: () => void;
  clear: () => void;
}

export const useIncomingDamageStore = create<IncomingDamageState>()(
  (set, get) => ({
    results: [],
    loading: false,
    error: null,
    requestGeneration: 0,
    usagePercentMap: {},
    knownMoveKeys: [],
    statusMoves: [],
    lastRequestBody: null,

    setResults: (results, generation, usageMoves, knownMoveKeys, statusMoves, requestBody?) =>
      set((state) => {
        if (generation !== state.requestGeneration) {
          // #region agent log
          fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H5", location: "frontend/src/stores/useIncomingDamageStore.ts:54", message: "incoming result dropped as stale", data: { generation, requestGeneration: state.requestGeneration, resultCount: results.length, usageMoveCount: usageMoves.length, knownMoveCount: knownMoveKeys.length, statusMoveCount: statusMoves.length }, timestamp: Date.now() }) }).catch(() => {});
          // #endregion
          return state;
        }
        const usagePercentMap: Record<string, number | null> = {};
        for (const m of usageMoves) {
          usagePercentMap[m.move_key] = m.usage_percent;
        }
        // #region agent log
        fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID }, body: JSON.stringify({ sessionId: DEBUG_SESSION_ID, runId: "pre-fix", hypothesisId: "H5", location: "frontend/src/stores/useIncomingDamageStore.ts:63", message: "incoming result committed", data: { generation, requestGeneration: state.requestGeneration, resultCount: results.length, usageMoveCount: usageMoves.length, usageMapCount: Object.keys(usagePercentMap).length, knownMoveCount: knownMoveKeys.length, statusMoveCount: statusMoves.length }, timestamp: Date.now() }) }).catch(() => {});
        // #endregion
        return {
          results,
          loading: false,
          error: null,
          usagePercentMap,
          knownMoveKeys,
          statusMoves,
          lastRequestBody: requestBody ?? null,
        };
      }),

    setLoading: (loading) => set({ loading }),

    setError: (error) => set({ error, loading: false }),

    incrementGeneration: () => {
      const next = get().requestGeneration + 1;
      set({ requestGeneration: next });
      return next;
    },

    clearResults: () =>
      set({
        results: [],
        loading: false,
        error: null,
        usagePercentMap: {},
        knownMoveKeys: [],
        statusMoves: [],
        lastRequestBody: null,
      }),

    clear: () =>
      set({
        results: [],
        loading: false,
        error: null,
        usagePercentMap: {},
        knownMoveKeys: [],
        statusMoves: [],
        lastRequestBody: null,
      }),
  }),
);
