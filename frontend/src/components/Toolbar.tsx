import type { ConnectionState } from "../types";
import { useSettingsStore } from "../stores/useSettingsStore";

const STATE_LABELS: Record<ConnectionState, string> = {
  connected: "接続中",
  disconnected: "未接続",
  connecting: "接続中...",
  reconnecting: "再接続中...",
  processing: "処理中...",
};

function OverlayToggle() {
  const show = useSettingsStore((s) => s.showBattleInfo);
  const toggle = useSettingsStore((s) => s.toggleBattleInfo);
  return (
    <label className="toolbar-checkbox">
      <input type="checkbox" checked={show} onChange={toggle} />
      バトル情報
    </label>
  );
}

function ReferenceOverlayToggle() {
  const show = useSettingsStore((s) => s.showReferenceOverlay);
  const toggle = useSettingsStore((s) => s.toggleReferenceOverlay);
  return (
    <label className="toolbar-checkbox">
      <input type="checkbox" checked={show} onChange={toggle} />
      参考
    </label>
  );
}

function NashOverlayToggle() {
  const show = useSettingsStore((s) => s.showNashOverlay);
  const toggle = useSettingsStore((s) => s.toggleNashOverlay);
  return (
    <label className="toolbar-checkbox">
      <input type="checkbox" checked={show} onChange={toggle} />
      Nash
    </label>
  );
}

interface Props {
  connectionState: ConnectionState;
  onConnect?: () => void;
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
  availableScenes?: Record<string, { display_name: string }>;
  currentScene?: string;
  onForceScene?: (scene: string) => void;
  onSceneDebug?: () => void;
}

export function Toolbar({
  connectionState,
  onConnect,
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
  availableScenes,
  currentScene,
  onForceScene,
  onSceneDebug,
}: Props) {
  return (
    <div className="toolbar">
      <button className="toolbar-btn" onClick={onToggleLeftPanel}>
        {leftPanelOpen ? "\u25C0 \u30ED\u30B0" : "\u25B6 \u30ED\u30B0"}
      </button>

      {connectionState === "disconnected" && onConnect ? (
        <button
          className={`toolbar-status ${connectionState} clickable`}
          onClick={onConnect}
          title="クリックして接続"
        >
          <span className="status-dot" />
          <span>{STATE_LABELS[connectionState]}</span>
        </button>
      ) : (
        <div className={`toolbar-status ${connectionState}`}>
          <span className="status-dot" />
          <span>{STATE_LABELS[connectionState]}</span>
        </div>
      )}

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

      {onSceneDebug && (
        <button
          className="toolbar-btn"
          onClick={onSceneDebug}
          title="シーン検出状態を DevTools コンソールに出力"
        >
          検出ログ
        </button>
      )}

      {onForceScene && availableScenes && (
        <select
          className="toolbar-select"
          value={currentScene || "none"}
          onChange={(e) => onForceScene(e.target.value)}
          title="シーン強制切替"
        >
          <option value="none">シーン検出待機中</option>
          {Object.entries(availableScenes).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.display_name}
            </option>
          ))}
        </select>
      )}

      <label className="toolbar-checkbox">
        <input
          type="checkbox"
          checked={debugOverlay}
          onChange={onToggleDebugOverlay}
        />
        領域オーバーレイ表示
      </label>

      <OverlayToggle />
      <ReferenceOverlayToggle />
      <NashOverlayToggle />

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
