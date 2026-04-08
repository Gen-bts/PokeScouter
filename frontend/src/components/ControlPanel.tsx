import type { SceneMeta } from "../api/devtools";

interface Props {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  audioDevices: MediaDeviceInfo[];
  selectedAudioDeviceId: string;
  onAudioDeviceChange: (deviceId: string) => void;
  scene: string;
  onSceneChange: (scene: string) => void;
  availableScenes: Record<string, SceneMeta>;
  intervalMs: number;
  onIntervalChange: (ms: number) => void;
  quality: number;
  onQualityChange: (q: number) => void;
  paused: boolean;
  onPauseToggle: () => void;
  connected: boolean;
  onConnectToggle: () => void;
  connectDisabled: boolean;
  pauseDisabled: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  muted: boolean;
  onMuteToggle: () => void;
  debugOverlay: boolean;
  onToggleDebugOverlay: () => void;
  debugCrops: boolean;
  onToggleDebugCrops: () => void;
  benchmark: boolean;
  benchmarkFrameCount: number;
  onToggleBenchmark: () => void;
}

export function ControlPanel({
  devices,
  selectedDeviceId,
  onDeviceChange,
  audioDevices,
  selectedAudioDeviceId,
  onAudioDeviceChange,
  scene,
  onSceneChange,
  availableScenes,
  intervalMs,
  onIntervalChange,
  quality,
  onQualityChange,
  paused,
  onPauseToggle,
  connected,
  onConnectToggle,
  connectDisabled,
  pauseDisabled,
  volume,
  onVolumeChange,
  muted,
  onMuteToggle,
  debugOverlay,
  onToggleDebugOverlay,
  debugCrops,
  onToggleDebugCrops,
  benchmark,
  benchmarkFrameCount,
  onToggleBenchmark,
}: Props) {
  return (
    <section className="panel-section">
      <h2>コントロール</h2>

      <label htmlFor="device-select">デバイス</label>
      <select
        id="device-select"
        value={selectedDeviceId}
        onChange={(e) => onDeviceChange(e.target.value)}
      >
        <option value="">-- 選択 --</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Camera ${i}`}
          </option>
        ))}
      </select>

      <label htmlFor="audio-device-select">音声デバイス</label>
      <select
        id="audio-device-select"
        value={selectedAudioDeviceId}
        onChange={(e) => onAudioDeviceChange(e.target.value)}
      >
        <option value="">-- デフォルト --</option>
        {audioDevices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microphone ${i}`}
          </option>
        ))}
      </select>

      <label htmlFor="scene-select">シーン</label>
      <select
        id="scene-select"
        value={scene}
        onChange={(e) => onSceneChange(e.target.value)}
      >
        {Object.entries(availableScenes).map(([key, meta]) => (
          <option key={key} value={key}>
            {meta.display_name || key}
          </option>
        ))}
      </select>

      <label htmlFor="interval-slider">送信間隔: {intervalMs}ms</label>
      <input
        type="range"
        id="interval-slider"
        min={100}
        max={2000}
        step={100}
        value={intervalMs}
        onChange={(e) => onIntervalChange(Number(e.target.value))}
      />

      <label htmlFor="quality-slider">JPEG画質: {quality.toFixed(1)}</label>
      <input
        type="range"
        id="quality-slider"
        min={0.3}
        max={1.0}
        step={0.1}
        value={quality}
        onChange={(e) => onQualityChange(Number(e.target.value))}
      />

      <label htmlFor="volume-slider">
        音量: {muted ? "ミュート" : Math.round(volume * 100) + "%"}
      </label>
      <div className="volume-row">
        <button onClick={onMuteToggle} title={muted ? "ミュート解除" : "ミュート"}>
          {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
        </button>
        <input
          type="range"
          id="volume-slider"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </div>

      <div className="button-row">
        <button
          disabled={pauseDisabled}
          className={paused ? "active" : undefined}
          onClick={onPauseToggle}
        >
          {paused ? "再開" : "一時停止"}
        </button>
        <button disabled={connectDisabled} onClick={onConnectToggle}>
          {connected ? "切断" : "接続"}
        </button>
      </div>

      <h3 className="debug-heading">デバッグ</h3>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={debugOverlay}
          onChange={onToggleDebugOverlay}
        />
        領域オーバーレイ表示
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={debugCrops}
          onChange={onToggleDebugCrops}
        />
        クロップ画像表示
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={benchmark}
          onChange={onToggleBenchmark}
        />
        ベンチマークモード
        {benchmark && (
          <span className="benchmark-indicator">
            {" "}Recording... {benchmarkFrameCount} frames
          </span>
        )}
      </label>
    </section>
  );
}
