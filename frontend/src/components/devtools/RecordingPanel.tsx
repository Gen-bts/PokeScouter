import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSession,
  completeSession,
  uploadFrame,
  listSessions,
  deleteSession,
  type SessionMetadata,
} from "../../api/devtools";

interface Props {
  captureFrame: (quality: number) => Promise<Blob | null>;
}

export function RecordingPanel({ captureFrame }: Props) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [recording, setRecording] = useState(false);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [intervalMs, setIntervalMs] = useState(500);

  const recordingRef = useRef(false);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // セッション一覧を取得
  const refreshSessions = useCallback(async () => {
    const list = await listSessions();
    setSessions(list);
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // 録画開始
  const handleStart = useCallback(async () => {
    const session = await createSession();
    setCurrentSession(session.session_id);
    setFrameCount(0);
    setElapsed(0);
    setRecording(true);
    recordingRef.current = true;
    startTimeRef.current = Date.now();

    // 経過時間表示用タイマー
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 200);

    // フレームキャプチャループ
    captureTimerRef.current = setInterval(async () => {
      if (!recordingRef.current) return;
      try {
        const blob = await captureFrame(0.9);
        if (blob) {
          const ts = Date.now() - startTimeRef.current;
          await uploadFrame(session.session_id, blob, ts);
          setFrameCount((c) => c + 1);
        }
      } catch (err) {
        console.error("Frame capture/upload failed:", err);
      }
    }, intervalMs);
  }, [captureFrame, intervalMs]);

  // 録画停止
  const handleStop = useCallback(async () => {
    recordingRef.current = false;
    setRecording(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }

    if (currentSession) {
      await completeSession(currentSession);
      setCurrentSession(null);
      await refreshSessions();
    }
  }, [currentSession, refreshSessions]);

  // セッション削除
  const handleDelete = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div className="devtools-panel">
      <h2>録画</h2>

      <div className="recording-controls">
        <label htmlFor="rec-interval">キャプチャ間隔: {intervalMs}ms</label>
        <input
          type="range"
          id="rec-interval"
          min={100}
          max={2000}
          step={100}
          value={intervalMs}
          disabled={recording}
          onChange={(e) => setIntervalMs(Number(e.target.value))}
        />

        <div className="button-row" style={{ marginTop: 8 }}>
          {!recording ? (
            <button className="btn-record" onClick={handleStart}>
              録画開始
            </button>
          ) : (
            <button className="btn-stop" onClick={handleStop}>
              録画停止
            </button>
          )}
        </div>

        {recording && (
          <div className="recording-stats">
            <span className="rec-indicator" />
            <span>
              {frameCount} フレーム / {formatTime(elapsed)}
            </span>
          </div>
        )}
      </div>

      <h3>セッション一覧</h3>
      <div className="session-list">
        {sessions.length === 0 && (
          <p className="placeholder">セッションなし</p>
        )}
        {sessions.map((s) => (
          <div className="session-item" key={s.session_id}>
            <div className="session-info">
              <div className="session-id">{s.session_id}</div>
              <div className="session-meta">
                {s.frame_count} フレーム / {formatTime(s.duration_ms)}
                {s.status === "recording" && (
                  <span className="badge-recording">録画中</span>
                )}
              </div>
            </div>
            <button
              className="btn-delete"
              onClick={() => handleDelete(s.session_id)}
              title="削除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
