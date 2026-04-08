import { useCallback, useEffect, useState } from "react";
import {
  listSessions,
  listFrames,
  thumbnailUrl,
  frameUrl,
  type SessionMetadata,
  type FrameInfo,
} from "../../api/devtools";

interface Props {
  onOpenInCropEditor?: (sessionId: string, frame: FrameInfo) => void;
}

export function FrameViewer({ onOpenInCropEditor }: Props) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSession, setSelectedSession] = useState("");
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<FrameInfo | null>(null);
  const [sliderIndex, setSliderIndex] = useState(0);

  useEffect(() => {
    listSessions().then(setSessions);
  }, []);

  // セッション選択時にフレーム一覧取得
  const handleSessionChange = useCallback(async (sessionId: string) => {
    setSelectedSession(sessionId);
    setSelectedFrame(null);
    setSliderIndex(0);
    if (!sessionId) {
      setFrames([]);
      return;
    }
    const list = await listFrames(sessionId);
    setFrames(list);
    if (list.length > 0) {
      setSelectedFrame(list[0]);
    }
  }, []);

  // スライダー変更
  const handleSliderChange = useCallback(
    (index: number) => {
      setSliderIndex(index);
      if (frames[index]) {
        setSelectedFrame(frames[index]);
      }
    },
    [frames],
  );

  // サムネイルクリック
  const handleThumbnailClick = useCallback(
    (frame: FrameInfo, index: number) => {
      setSelectedFrame(frame);
      setSliderIndex(index);
    },
    [],
  );

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;
  };

  return (
    <div className="devtools-panel">
      <h2>フレームビューア</h2>

      <label htmlFor="session-select">セッション</label>
      <select
        id="session-select"
        value={selectedSession}
        onChange={(e) => handleSessionChange(e.target.value)}
      >
        <option value="">-- 選択 --</option>
        {sessions
          .filter((s) => s.status === "completed")
          .map((s) => (
            <option key={s.session_id} value={s.session_id}>
              {s.session_id} ({s.frame_count}フレーム)
            </option>
          ))}
      </select>

      {selectedFrame && selectedSession && (
        <div className="frame-display">
          <img
            className="frame-full"
            src={frameUrl(selectedSession, selectedFrame.filename)}
            alt={`Frame ${selectedFrame.index}`}
          />
          <div className="frame-info">
            <span>
              #{selectedFrame.index} / {formatTime(selectedFrame.timestamp_ms)}
            </span>
            {onOpenInCropEditor && (
              <button
                onClick={() =>
                  onOpenInCropEditor(selectedSession, selectedFrame)
                }
              >
                クロップ編集で開く
              </button>
            )}
          </div>
        </div>
      )}

      {frames.length > 1 && (
        <div className="timeline-slider">
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={sliderIndex}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
          />
          <span>
            {sliderIndex + 1} / {frames.length}
          </span>
        </div>
      )}

      {selectedSession && frames.length > 0 && (
        <div className="thumbnail-grid">
          {frames.map((f, i) => (
            <img
              key={f.filename}
              className={`thumbnail ${selectedFrame?.filename === f.filename ? "selected" : ""}`}
              src={thumbnailUrl(selectedSession, f.filename)}
              alt={`Frame ${f.index}`}
              onClick={() => handleThumbnailClick(f, i)}
              loading="lazy"
            />
          ))}
        </div>
      )}
    </div>
  );
}
