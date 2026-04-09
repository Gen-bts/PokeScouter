import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSessions,
  runFullMatchBenchmark,
  type SessionMetadata,
} from "../../api/devtools";
import { useFullMatchStore } from "../../stores/useFullMatchStore";
import { FullMatchSummary } from "./FullMatchSummary";
import { FullMatchTimeline } from "./FullMatchTimeline";
import { FullMatchFrameViewer } from "./FullMatchFrameViewer";
import { FullMatchEngineComparison } from "./FullMatchEngineComparison";

export function FullMatchBenchmark() {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSession, setSelectedSession] = useState("");
  const [ocrMode, setOcrMode] = useState<"default" | "all" | "normal">("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const store = useFullMatchStore();

  useEffect(() => {
    listSessions().then((list) => {
      const completed = list.filter((s) => s.status === "completed");
      setSessions(completed);
      if (completed.length > 0 && !selectedSession) {
        setSelectedSession(completed[0]!.session_id);
      }
    });
    store.fetchScenes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = useCallback(() => {
    if (!selectedSession) return;

    setError(null);
    setRunning(true);
    store.reset();
    store.start();
    store.setSessionId(selectedSession);

    const controller = runFullMatchBenchmark(selectedSession, ocrMode, {
      onStart: (totalFrames) => {
        store.setTotal(totalFrames);
      },
      onSceneChange: (data) => {
        store.addSceneChange(data);
      },
      onPokemonIdentified: (data) => {
        store.addPokemonResult(data);
      },
      onOcrResult: (data) => {
        store.addOcrResult(data);
      },
      onFrameSummary: (data) => {
        store.addFrameSummary(data);
        store.registerFrameFilename(data.frame_index, data.timestamp_ms);
      },
      onFrameSkipped: () => {
        store.addFrameSkipped();
      },
      onDone: (data) => {
        store.setDone(data);
        setRunning(false);
      },
      onError: (err) => {
        setError(err.message);
        store.stop();
        setRunning(false);
      },
    });

    abortRef.current = controller;
  }, [selectedSession, ocrMode, store]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    store.stop();
    setRunning(false);
  }, [store]);

  const selectedMeta = sessions.find((s) => s.session_id === selectedSession);
  const progressPct =
    store.totalFrames > 0
      ? ((store.processedFrames + store.skippedFrames) / store.totalFrames) * 100
      : 0;

  const hasResults = store.processedFrames > 0 && !running;
  const hasOcrComparison = Object.keys(store.ocrResults).length > 0;

  return (
    <div className="offline-benchmark fullmatch-benchmark">
      {/* コントロール */}
      <section className="panel-section">
        <h2>1試合通しベンチマーク</h2>
        <p className="hint-text">
          録画セッションをフルパイプライン（シーン検出→ポケモン識別→OCR）で再生します。
        </p>

        <div className="benchmark-controls">
          <label>
            セッション
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              disabled={running}
            >
              {sessions.length === 0 && (
                <option value="">セッションなし</option>
              )}
              {sessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {s.session_id} ({s.frame_count} frames
                  {s.description ? ` - ${s.description}` : ""})
                </option>
              ))}
            </select>
          </label>

          <label>
            OCRモード
            <select
              value={ocrMode}
              onChange={(e) => setOcrMode(e.target.value as "default" | "all" | "normal")}
              disabled={running}
            >
              <option value="all">全エンジン比較</option>
              <option value="default">デフォルト（設定エンジンのみ）</option>
              <option value="normal">通常運用（リアルタイム再現）</option>
            </select>
          </label>

          {selectedMeta && (
            <span className="session-info">
              {selectedMeta.frame_count} frames /{" "}
              {(selectedMeta.duration_ms / 1000).toFixed(1)}s
            </span>
          )}

          <div className="benchmark-buttons">
            {!running ? (
              <button onClick={handleStart} disabled={!selectedSession}>
                ベンチマーク開始
              </button>
            ) : (
              <button onClick={handleCancel} className="btn-danger">
                キャンセル
              </button>
            )}
          </div>
        </div>

        {/* プログレスバー */}
        {(running || store.totalFrames > 0) && (
          <div className="benchmark-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="progress-text">
              {store.processedFrames} / {store.totalFrames} frames
              {store.skippedFrames > 0 && ` (スキップ: ${store.skippedFrames})`}
              {running && " ...処理中"}
            </span>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </section>

      {/* サマリー */}
      {hasResults && <FullMatchSummary />}

      {/* タイムライン + ビューワー */}
      {(store.sceneTimeline.length > 0 || store.processedFrames > 0) && (
        <>
          <FullMatchTimeline />

          {store.selectedFrameIndex !== null && (
            <>
              <FullMatchFrameViewer />
              {hasOcrComparison && <FullMatchEngineComparison />}
            </>
          )}
        </>
      )}
    </div>
  );
}
