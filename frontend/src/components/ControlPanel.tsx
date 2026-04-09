interface Props {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  audioDevices: MediaDeviceInfo[];
  selectedAudioDeviceId: string;
  onAudioDeviceChange: (deviceId: string) => void;
  quality: number;
  onQualityChange: (q: number) => void;
  connected: boolean;
  onConnectToggle: () => void;
  connectDisabled: boolean;
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
  quality,
  onQualityChange,
  connected,
  onConnectToggle,
  connectDisabled,
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

      <div className="button-row">
        <button disabled={connectDisabled} onClick={onConnectToggle}>
          {connected ? "切断" : "接続"}
        </button>
      </div>

      <h3 className="debug-heading">デバッグ</h3>
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
