import { useRef } from "react";
import Draggable from "react-draggable";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useNashStore } from "../stores/useNashStore";
import { useNashSolve } from "../hooks/useNashSolve";
import { MatchupMatrix } from "./nash/MatchupMatrix";
import { SelectionAdvisor } from "./nash/SelectionAdvisor";

export function NashOverlay() {
  const nodeRef = useRef<HTMLDivElement>(null);
  const pos = useSettingsStore((s) => s.nashOverlayPosition);
  const setPos = useSettingsStore((s) => s.setNashOverlayPosition);
  const toggle = useSettingsStore((s) => s.toggleNashOverlay);

  const result = useNashStore((s) => s.result);
  const loading = useNashStore((s) => s.loading);
  const error = useNashStore((s) => s.error);
  const lastSolvedAt = useNashStore((s) => s.lastSolvedAt);

  const { solve, canSolve } = useNashSolve();

  return (
    <Draggable
      nodeRef={nodeRef}
      position={pos}
      handle=".nash-overlay__header"
      onStop={(_e, data) => setPos({ x: data.x, y: data.y })}
    >
      <div ref={nodeRef} className="nash-overlay">
        <div className="nash-overlay__header">
          <span className="nash-overlay__title">Nash 選出シミュ</span>
          <div className="nash-overlay__status">
            {loading && <span className="nash-overlay__loading">計算中…</span>}
            {!loading && result && (
              <span
                className={`nash-overlay__status-tag nash-overlay__status-${result.status}`}
              >
                {result.status === "converged"
                  ? "収束"
                  : result.status === "iteration_limit"
                    ? `反復上限 (ε=${result.exploitability.toFixed(3)})`
                    : "自明解"}
              </span>
            )}
            {!loading && !result && <span className="nash-overlay__idle">未計算</span>}
          </div>
          <button
            type="button"
            className="ref-btn"
            disabled={!canSolve || loading}
            onClick={solve}
            title={!canSolve ? "双方 6 匹揃うまで待機" : "Nash を再計算"}
          >
            {loading ? "…" : result ? "再計算" : "計算"}
          </button>
          <button
            type="button"
            className="reference-overlay__close"
            onClick={toggle}
            aria-label="閉じる"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="nash-overlay__body">
          {error && <div className="nash-overlay__error">{error}</div>}
          {!result && !loading && !error && (
            <div className="ref-placeholder">
              {canSolve
                ? "「計算」ボタンで Nash を解きます"
                : "自分 6 匹 + 相手 6 匹が揃うと自動計算が走ります"}
            </div>
          )}
          {result && (
            <>
              <SelectionAdvisor
                recommendedPick={result.recommended_pick_a}
                strategyA={result.strategy_a}
                strategyB={result.strategy_b}
                value={result.value}
              />
              <MatchupMatrix matrix={result.matchup_6x6} />
              {lastSolvedAt != null && (
                <div className="nash-overlay__meta">
                  計算: {new Date(lastSolvedAt).toLocaleTimeString("ja-JP")} · iter{" "}
                  {result.iterations}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Draggable>
  );
}
