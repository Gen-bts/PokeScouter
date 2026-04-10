import { useCallback, useEffect, useState } from "react";
import { useVideoCapture } from "./hooks/useVideoCapture";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useConnectionStore } from "./stores/useConnectionStore";
import { BattleView } from "./components/BattleView";
import { DevToolsView } from "./components/DevToolsView";
import { SettingsView } from "./components/SettingsView";
import { Toolbar } from "./components/Toolbar";
import { getScenes, type SceneMeta } from "./api/devtools";
import type { ConnectionState } from "./types";
import "./App.css";

type Tab = "battle" | "settings" | "devtools";

export default function App() {
  const { videoRef, canvasRef, devices, audioDevices, startCapture, captureFrame, setVolume, setMuted } =
    useVideoCapture();

  const [activeTab, setActiveTab] = useState<Tab>("battle");
  const [battleConnectionState, setBattleConnectionState] =
    useState<ConnectionState>("disconnected");
  const [sceneReset, setSceneReset] = useState<(() => void) | null>(null);
  const [pauseToggle, setPauseToggle] = useState<(() => void) | null>(null);
  const [paused, setPaused] = useState(false);
  const [sending, setSending] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [availableScenes, setAvailableScenes] = useState<Record<string, SceneMeta>>({});
  const currentScene = useConnectionStore((s) => s.currentScene);
  const sendForceScene = useConnectionStore((s) => s.sendForceScene);
  const connect = useConnectionStore((s) => s.connect);
  const selectedDeviceId = useSettingsStore((s) => s.selectedDeviceId);
  const selectedAudioDeviceId = useSettingsStore((s) => s.selectedAudioDeviceId);
  const volume = useSettingsStore((s) => s.volume);
  const storeSetVolume = useSettingsStore((s) => s.setVolume);
  const muted = useSettingsStore((s) => s.muted);
  const toggleMute = useSettingsStore((s) => s.toggleMute);
  const debugOverlay = useSettingsStore((s) => s.debugOverlay);
  const toggleDebugOverlay = useSettingsStore((s) => s.toggleDebugOverlay);

  const handleVolumeChange = useCallback(
    (v: number) => {
      storeSetVolume(v);
      if (v > 0 && muted) {
        toggleMute();
      }
    },
    [storeSetVolume, muted, toggleMute],
  );

  // アプリ起動時にバックエンドへ自動接続
  useEffect(() => {
    useConnectionStore.getState().connect();
  }, []);

  // シーン一覧取得
  useEffect(() => {
    getScenes().then(setAvailableScenes);
  }, []);

  // 保存済みデバイスが列挙リストにあれば自動でキャプチャ開始
  useEffect(() => {
    if (
      selectedDeviceId &&
      devices.length > 0 &&
      devices.some((d) => d.deviceId === selectedDeviceId)
    ) {
      startCapture(selectedDeviceId, selectedAudioDeviceId || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  return (
    <div className="app-root">
      <nav className="tab-bar">
        <button
          className={activeTab === "battle" ? "active" : undefined}
          onClick={() => setActiveTab("battle")}
        >
          バトル
        </button>
        <button
          className={activeTab === "settings" ? "active" : undefined}
          onClick={() => setActiveTab("settings")}
        >
          設定
        </button>
        <button
          className={activeTab === "devtools" ? "active" : undefined}
          onClick={() => setActiveTab("devtools")}
        >
          Dev Tools
        </button>
      </nav>

      {activeTab === "battle" && (
        <Toolbar
          connectionState={battleConnectionState}
          onConnect={connect}
          debugOverlay={debugOverlay}
          onToggleDebugOverlay={toggleDebugOverlay}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          muted={muted}
          onMuteToggle={toggleMute}
          onSceneReset={sceneReset ?? undefined}
          paused={paused}
          onPauseToggle={pauseToggle ?? undefined}
          pauseDisabled={!sending}
          leftPanelOpen={leftPanelOpen}
          onToggleLeftPanel={() => setLeftPanelOpen((v) => !v)}
          rightPanelOpen={rightPanelOpen}
          onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
          availableScenes={availableScenes}
          currentScene={currentScene}
          onForceScene={sendForceScene}
        />
      )}

      <div className="layout">
        <div style={{ display: activeTab === "battle" ? "contents" : "none" }}>
          <BattleView
            videoRef={videoRef}
            canvasRef={canvasRef}
            captureFrame={captureFrame}
            setVideoVolume={setVolume}
            setVideoMuted={setMuted}
            onConnectionStateChange={setBattleConnectionState}
            onSceneResetReady={(reset) => setSceneReset(() => reset)}
            onPauseReady={(toggle) => setPauseToggle(() => toggle)}
            onPauseStateChange={setPaused}
            onSendingStateChange={setSending}
            leftPanelOpen={leftPanelOpen}
            rightPanelOpen={rightPanelOpen}
          />
        </div>
        <div style={{ display: activeTab === "settings" ? "contents" : "none" }}>
          <SettingsView
            devices={devices}
            audioDevices={audioDevices}
            startCapture={startCapture}
          />
        </div>
        <div style={{ display: activeTab === "devtools" ? "contents" : "none" }}>
          <DevToolsView captureFrame={captureFrame} />
        </div>
      </div>
    </div>
  );
}
