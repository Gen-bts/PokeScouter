import { useBackendSettings } from "../hooks/useBackendSettings";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useCallback, useState } from "react";

interface DeviceProps {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  audioDevices: MediaDeviceInfo[];
  selectedAudioDeviceId: string;
  onAudioDeviceChange: (deviceId: string) => void;
}

interface ConnectionProps {
  connected: boolean;
  onConnectToggle: () => void;
  connectDisabled: boolean;
}

interface DebugProps {
  debugCrops: boolean;
  onToggleDebugCrops: () => void;
  benchmark: boolean;
  benchmarkFrameCount: number;
  onToggleBenchmark: () => void;
}

type Props = DeviceProps & ConnectionProps & DebugProps;

export function ControlPanel({
  devices,
  selectedDeviceId,
  onDeviceChange,
  audioDevices,
  selectedAudioDeviceId,
  onAudioDeviceChange,
  connected,
  onConnectToggle,
  connectDisabled,
  debugCrops,
  onToggleDebugCrops,
  benchmark,
  benchmarkFrameCount,
  onToggleBenchmark,
}: Props) {
  const jpegQuality = useSettingsStore((s) => s.jpegQuality);
  const setJpegQuality = useSettingsStore((s) => s.setJpegQuality);
  const autoPauseMinutes = useSettingsStore((s) => s.autoPauseMinutes);
  const setAutoPauseMinutes = useSettingsStore((s) => s.setAutoPauseMinutes);
  const debugOverlay = useSettingsStore((s) => s.debugOverlay);
  const toggleDebugOverlay = useSettingsStore((s) => s.toggleDebugOverlay);

  const { settings: backend, loading, updateSettings } = useBackendSettings();
  const [restartHint, setRestartHint] = useState(false);

  const handleBackendChange = useCallback(
    async (patch: Record<string, unknown>) => {
      const result = await updateSettings(patch);
      if (result?.restart_required) {
        setRestartHint(true);
      }
    },
    [updateSettings],
  );

  return (
    <div className="settings-view">
      {/* --- デバイス --- */}
      <section className="panel-section">
        <h2>デバイス</h2>

        <label htmlFor="device-select">映像デバイス</label>
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
        {selectedDeviceId && devices.length > 0 &&
          !devices.some((d) => d.deviceId === selectedDeviceId) && (
            <p className="text-warning">
              保存済みの映像デバイスが見つかりません。再接続するか別のデバイスを選択してください。
            </p>
          )}

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
        {selectedAudioDeviceId && audioDevices.length > 0 &&
          !audioDevices.some((d) => d.deviceId === selectedAudioDeviceId) && (
            <p className="text-warning">
              保存済みの音声デバイスが見つかりません。
            </p>
          )}
      </section>

      {/* --- 映像・キャプチャ --- */}
      <section className="panel-section">
        <h2>映像・キャプチャ</h2>

        <label htmlFor="quality-slider">
          JPEG画質: {jpegQuality.toFixed(1)}
        </label>
        <input
          type="range"
          id="quality-slider"
          min={0.3}
          max={1.0}
          step={0.1}
          value={jpegQuality}
          onChange={(e) => setJpegQuality(Number(e.target.value))}
        />

        <label htmlFor="auto-pause-input">
          自動停止タイムアウト (分)
        </label>
        <input
          type="number"
          id="auto-pause-input"
          min={1}
          max={60}
          value={autoPauseMinutes}
          onChange={(e) => setAutoPauseMinutes(Number(e.target.value))}
        />
      </section>

      {/* --- 認識設定（バックエンド） --- */}
      <section className="panel-section">
        <h2>認識設定</h2>
        {loading ? (
          <p className="text-secondary">読み込み中...</p>
        ) : backend ? (
          <>
            <label>
              テンプレート閾値:{" "}
              {backend.recognition.scene_detector.template_threshold.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.5}
              max={1.0}
              step={0.01}
              value={backend.recognition.scene_detector.template_threshold}
              onChange={(e) =>
                handleBackendChange({
                  recognition: {
                    scene_detector: {
                      template_threshold: Number(e.target.value),
                    },
                  },
                })
              }
            />

            <label>
              OCR検出閾値:{" "}
              {backend.recognition.scene_detector.ocr_threshold.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.3}
              max={1.0}
              step={0.01}
              value={backend.recognition.scene_detector.ocr_threshold}
              onChange={(e) =>
                handleBackendChange({
                  recognition: {
                    scene_detector: {
                      ocr_threshold: Number(e.target.value),
                    },
                  },
                })
              }
            />

            <label>
              ポケモン識別閾値:{" "}
              {backend.recognition.pokemon_matcher.threshold.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.3}
              max={1.0}
              step={0.01}
              value={backend.recognition.pokemon_matcher.threshold}
              onChange={(e) =>
                handleBackendChange({
                  recognition: {
                    pokemon_matcher: {
                      threshold: Number(e.target.value),
                    },
                  },
                })
              }
            />

            <label>
              パーティ登録デバウンス (フレーム)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={backend.recognition.party_register.detection_debounce}
              onChange={(e) =>
                handleBackendChange({
                  recognition: {
                    party_register: {
                      detection_debounce: Number(e.target.value),
                    },
                  },
                })
              }
            />

            <label>
              パーティ登録タイムアウト (秒)
            </label>
            <input
              type="number"
              min={10}
              max={300}
              value={backend.recognition.party_register.detection_timeout_s}
              onChange={(e) =>
                handleBackendChange({
                  recognition: {
                    party_register: {
                      detection_timeout_s: Number(e.target.value),
                    },
                  },
                })
              }
            />
          </>
        ) : (
          <p className="text-secondary">バックエンド未接続</p>
        )}
      </section>

      {/* --- ダメージ計算 --- */}
      <section className="panel-section">
        <h2>ダメージ計算</h2>
        {backend ? (
          <>
            <label htmlFor="calc-url">calc-service URL</label>
            <input
              type="text"
              id="calc-url"
              value={backend.calc_service.base_url}
              onChange={(e) =>
                handleBackendChange({
                  calc_service: { base_url: e.target.value },
                })
              }
            />

            <label htmlFor="calc-timeout">タイムアウト (秒)</label>
            <input
              type="number"
              id="calc-timeout"
              min={1}
              max={30}
              step={0.5}
              value={backend.calc_service.timeout}
              onChange={(e) =>
                handleBackendChange({
                  calc_service: { timeout: Number(e.target.value) },
                })
              }
            />
          </>
        ) : null}
      </section>

      {/* --- 表示 --- */}
      <section className="panel-section">
        <h2>表示</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={debugOverlay}
            onChange={toggleDebugOverlay}
          />
          デバッグオーバーレイ
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

      {/* --- 接続 --- */}
      <section className="panel-section">
        <div className="button-row">
          <button disabled={connectDisabled} onClick={onConnectToggle}>
            {connected ? "切断" : "接続"}
          </button>
        </div>
        {restartHint && (
          <p className="text-warning">
            一部の設定変更は再起動後に反映されます
          </p>
        )}
      </section>
    </div>
  );
}
