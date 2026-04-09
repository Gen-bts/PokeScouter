import type { ConnectionState } from "../types";

const STATE_LABELS: Record<ConnectionState, string> = {
  connected: "接続中",
  disconnected: "未接続",
  connecting: "接続中...",
  reconnecting: "再接続中...",
  processing: "処理中...",
};

interface Props {
  connectionState: ConnectionState;
  debugOverlay: boolean;
  onToggleDebugOverlay: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  muted: boolean;
  onMuteToggle: () => void;
  onSceneReset?: () => void;
  paused: boolean;
  onPauseToggle?: () => void;
  pauseDisabled: boolean;
  leftPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}

export function Toolbar({
  connectionState,
  debugOverlay,
  onToggleDebugOverlay,
  volume,
  onVolumeChange,
  muted,
  onMuteToggle,
  onSceneReset,
  paused,
  onPauseToggle,
  pauseDisabled,
  leftPanelOpen,
  onToggleLeftPanel,
  rightPanelOpen,
  onToggleRightPanel,
}: Props) {
  return (
    <div className="toolbar">
      <button className="toolbar-btn" onClick={onToggleLeftPanel}>
        {leftPanelOpen ? "\u25C0 \u30ED\u30B0" : "\u25B6 \u30ED\u30B0"}
      </button>

      <div className={`toolbar-status ${connectionState}`}>
        <span className="status-dot" />
        <span>{STATE_LABELS[connectionState]}</span>
      </div>

      {onSceneReset && (
        <button className="toolbar-btn" onClick={onSceneReset}>
          シーンリセット
        </button>
      )}

      {onPauseToggle && (
        <button
          className={`toolbar-btn${paused ? " active" : ""}`}
          disabled={pauseDisabled}
          onClick={onPauseToggle}
        >
          {paused ? "再開" : "一時停止"}
        </button>
      )}

      <label className="toolbar-checkbox">
        <input
          type="checkbox"
          checked={debugOverlay}
          onChange={onToggleDebugOverlay}
        />
        領域オーバーレイ表示
      </label>

      <button className="toolbar-btn" onClick={onToggleRightPanel}>
        {rightPanelOpen ? "\u76F8\u624B \u25B6" : "\u25C0 \u76F8\u624B"}
      </button>

      <div className="toolbar-volume">
        <button onClick={onMuteToggle} title={muted ? "ミュート解除" : "ミュート"}>
          {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
        <span className="toolbar-volume-label">
          {muted ? "ミュート" : Math.round(volume * 100) + "%"}
        </span>
      </div>
    </div>
  );
}
