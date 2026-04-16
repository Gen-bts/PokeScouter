import { useCallback, useEffect, useRef, useState } from "react";
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
  const {
    videoRef,
    canvasRef,
    devices,
    audioDevices,
    devicesReady,
    isCapturing,
    startCapture,
    captureFrame,
    setVolume,
    setMuted,
    refreshDevices,
  } = useVideoCapture();

  const [activeTab, setActiveTab] = useState<Tab>("battle");
  const [battleConnectionState, setBattleConnectionState] =
    useState<ConnectionState>("disconnected");
  const [sceneReset, setSceneReset] = useState<(() => void) | null>(null);
  const [pauseToggle, setPauseToggle] = useState<(() => void) | null>(null);
  const handleSceneResetReady = useCallback(
    (reset: () => void) => setSceneReset(() => reset), [],
  );
  const handlePauseReady = useCallback(
    (toggle: () => void) => setPauseToggle(() => toggle), [],
  );
  const [paused, setPaused] = useState(false);
  const [sending, setSending] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [availableScenes, setAvailableScenes] = useState<Record<string, SceneMeta>>({});
  const currentScene = useConnectionStore((s) => s.currentScene);
  const sendForceScene = useConnectionStore((s) => s.sendForceScene);
  const sendSceneDebug = useConnectionStore((s) => s.sendSceneDebug);
  const connect = useConnectionStore((s) => s.connect);
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

  // Zustand persist hydration 完了を待つ
  const [hydrated, setHydrated] = useState(
    useSettingsStore.persist.hasHydrated(),
  );
  useEffect(() => {
    if (hydrated) return;
    return useSettingsStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  // 保存済みデバイスで自動キャプチャを試みる
  const autoCaptureRan = useRef(false);
  const autoCaptureInFlight = useRef(false);
  const [autoRestoreFailed, setAutoRestoreFailed] = useState(false);

  useEffect(() => {
    if (!hydrated || !devicesReady || autoCaptureRan.current || autoCaptureInFlight.current) return;

    const savedVideoId = useSettingsStore.getState().selectedDeviceId;
    if (!savedVideoId) return;

    const savedAudioId = useSettingsStore.getState().selectedAudioDeviceId;
    const validAudioId =
      savedAudioId && audioDevices.some((d) => d.deviceId === savedAudioId)
        ? savedAudioId
        : undefined;

    (async () => {
      autoCaptureInFlight.current = true;
      try {
        await startCapture(savedVideoId, validAudioId);
        autoCaptureRan.current = true;
        setAutoRestoreFailed(false);
      } catch {
        setAutoRestoreFailed(true);
        await refreshDevices();
      } finally {
        autoCaptureInFlight.current = false;
      }
    })();
  }, [hydrated, devicesReady, audioDevices, startCapture, refreshDevices]);

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
          onSceneDebug={sendSceneDebug}
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
            onSceneResetReady={handleSceneResetReady}
            onPauseReady={handlePauseReady}
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
            isCapturing={isCapturing}
            autoRestoreFailed={autoRestoreFailed}
          />
        </div>
        <div style={{ display: activeTab === "devtools" ? "contents" : "none" }}>
          <DevToolsView captureFrame={captureFrame} />
        </div>
      </div>
    </div>
  );
}
