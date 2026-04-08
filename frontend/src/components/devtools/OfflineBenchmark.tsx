import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSessions,
  getScenes,
  runOfflineBenchmark,
  type SessionMetadata,
  type SceneMeta,
} from "../../api/devtools";
import { useBenchmarkStore } from "../../stores/useBenchmarkStore";
import { BenchmarkReport } from "../BenchmarkReport";

export function OfflineBenchmark() {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [scenes, setScenes] = useState<Record<string, SceneMeta>>({});
  const [selectedSession, setSelectedSession] = useState("");
  const [selectedScene, setSelectedScene] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const benchmarkStart = useBenchmarkStore((s) => s.start);
  const benchmarkStop = useBenchmarkStore((s) => s.stop);
  const benchmarkAddFrame = useBenchmarkStore((s) => s.addFrame);
  const benchmarkReset = useBenchmarkStore((s) => s.reset);
  const frameCount = useBenchmarkStore((s) => s.frameCount);

  // セッション・シーン一覧を取得
  useEffect(() => {
    listSessions().then((list) => {
      const completed = list.filter((s) => s.status === "completed");
      setSessions(completed);
      if (completed.length > 0 && !selectedSession) {
        setSelectedSession(completed[0].session_id);
      }
    });
    getScenes().then((s) => {
      setScenes(s);
      const keys = Object.keys(s);
      if (keys.length > 0 && !selectedScene) {
        setSelectedScene(keys[0]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = useCallback(() => {
    if (!selectedSession || !selectedScene) return;

    setError(null);
    setRunning(true);
    setProgress({ current: 0, total: 0 });
    benchmarkReset();
    benchmarkStart(selectedScene);

    const controller = runOfflineBenchmark(selectedSession, selectedScene, {
      onStart: (totalFrames) => {
        setProgress({ current: 0, total: totalFrames });
      },
      onFrame: (regions) => {
        benchmarkAddFrame(regions);
        setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
      },
      onDone: () => {
        benchmarkStop();
        setRunning(false);
      },
      onError: (err) => {
        setError(err.message);
        benchmarkStop();
        setRunning(false);
      },
    });

    abortRef.current = controller;
  }, [selectedSession, selectedScene, benchmarkReset, benchmarkStart, benchmarkAddFrame, benchmarkStop]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    benchmarkStop();
    setRunning(false);
  }, [benchmarkStop]);

  const selectedMeta = sessions.find((s) => s.session_id === selectedSession);
  const progressPct =
    progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className="offline-benchmark">
      <section className="panel-section">
        <h2>オフラインベンチマーク</h2>
        <p className="hint-text">
          録画セッションのフレームを全 OCR エンジンで処理し比較します。
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
            シーン
            <select
              value={selectedScene}
              onChange={(e) => setSelectedScene(e.target.value)}
              disabled={running}
            >
              {Object.entries(scenes).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.display_name || key}
                </option>
              ))}
            </select>
          </label>

          {selectedMeta && (
            <span className="session-info">
              {selectedMeta.frame_count} frames / {(selectedMeta.duration_ms / 1000).toFixed(1)}s
            </span>
          )}

          <div className="benchmark-buttons">
            {!running ? (
              <button
                onClick={handleStart}
                disabled={!selectedSession || !selectedScene}
              >
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
        {(running || progress.total > 0) && (
          <div className="benchmark-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="progress-text">
              {progress.current} / {progress.total} frames
              {running && " ...処理中"}
            </span>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </section>

      {/* 既存の BenchmarkReport を表示 */}
      {frameCount > 0 && <BenchmarkReport />}
    </div>
  );
}
