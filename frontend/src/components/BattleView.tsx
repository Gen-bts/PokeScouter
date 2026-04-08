import { useCallback, useEffect, useRef, useState } from "react";
import { VideoCanvas } from "./VideoCanvas";
import { StatusIndicator } from "./StatusIndicator";
import { ControlPanel } from "./ControlPanel";
import { OcrResults } from "./OcrResults";
import { PokemonResults } from "./PokemonResults";
import { BenchmarkReport } from "./BenchmarkReport";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useBenchmarkStore } from "../stores/useBenchmarkStore";
import { getScenes, type SceneMeta } from "../api/devtools";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  devices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  startCapture: (deviceId: string, audioDeviceId?: string) => Promise<void>;
  captureFrame: (quality: number) => Promise<Blob | null>;
  setVideoVolume: (v: number) => void;
  setVideoMuted: (m: boolean) => void;
}

export function BattleView({
  videoRef,
  canvasRef,
  devices,
  audioDevices,
  startCapture,
  captureFrame,
  setVideoVolume,
  setVideoMuted,
}: Props) {
  const {
    connect,
    disconnect,
    sendFrame,
    sendConfig,
    isConnected,
    connectionState,
    lastResult,
    lastBenchmarkResult,
    lastPokemonResult,
  } = useWebSocket();

  const benchmarkActive = useBenchmarkStore((s) => s.active);
  const benchmarkFrameCount = useBenchmarkStore((s) => s.frameCount);
  const benchmarkStart = useBenchmarkStore((s) => s.start);
  const benchmarkStop = useBenchmarkStore((s) => s.stop);
  const benchmarkAddFrame = useBenchmarkStore((s) => s.addFrame);

  const selectedDeviceId = useSettingsStore((s) => s.selectedDeviceId);
  const setDeviceId = useSettingsStore((s) => s.setDeviceId);
  const selectedAudioDeviceId = useSettingsStore((s) => s.selectedAudioDeviceId);
  const setAudioDeviceId = useSettingsStore((s) => s.setAudioDeviceId);
  const volume = useSettingsStore((s) => s.volume);
  const storeSetVolume = useSettingsStore((s) => s.setVolume);
  const muted = useSettingsStore((s) => s.muted);
  const toggleMute = useSettingsStore((s) => s.toggleMute);
  const debugOverlay = useSettingsStore((s) => s.debugOverlay);
  const toggleDebugOverlay = useSettingsStore((s) => s.toggleDebugOverlay);
  const debugCrops = useSettingsStore((s) => s.debugCrops);
  const toggleDebugCrops = useSettingsStore((s) => s.toggleDebugCrops);

  const [availableScenes, setAvailableScenes] = useState<Record<string, SceneMeta>>({});
  const [scene, setScene] = useState("battle");
  const [intervalMs, setIntervalMs] = useState(500);
  const [quality, setQuality] = useState(0.8);
  const [paused, setPaused] = useState(false);
  const [videoReady, setVideoReady] = useState(!!selectedDeviceId);
  const [sending, setSending] = useState(false);

  // マウント時にバックエンドへ自動接続 & シーン一覧取得
  useEffect(() => {
    connect();
    getScenes().then(setAvailableScenes);
  }, [connect]);

  // volume / muted をビデオ要素に同期
  useEffect(() => {
    setVideoVolume(volume);
    setVideoMuted(muted);
  }, [volume, muted, setVideoVolume, setVideoMuted]);

  const handleVolumeChange = useCallback(
    (v: number) => {
      storeSetVolume(v);
      if (v > 0 && muted) {
        toggleMute();
      }
    },
    [storeSetVolume, muted, toggleMute],
  );

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  const handleDeviceChange = useCallback(
    async (deviceId: string) => {
      setDeviceId(deviceId);
      if (!deviceId) return;
      try {
        await startCapture(deviceId, selectedAudioDeviceId || undefined);
        setVideoReady(true);
      } catch (err) {
        alert("映像の開始に失敗しました: " + (err as Error).message);
      }
    },
    [setDeviceId, startCapture, selectedAudioDeviceId],
  );

  const handleAudioDeviceChange = useCallback(
    async (audioDeviceId: string) => {
      setAudioDeviceId(audioDeviceId);
      if (!selectedDeviceId) return;
      try {
        await startCapture(selectedDeviceId, audioDeviceId || undefined);
      } catch (err) {
        alert("音声デバイスの切り替えに失敗しました: " + (err as Error).message);
      }
    },
    [setAudioDeviceId, startCapture, selectedDeviceId],
  );

  const handleConnectToggle = useCallback(() => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  }, [isConnected, connect, disconnect]);

  const handlePauseToggle = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      sendConfig({ paused: next });
      return next;
    });
  }, [sendConfig]);

  const handleSceneChange = useCallback(
    (newScene: string) => {
      setScene(newScene);
      sendConfig({ scene: newScene, interval_ms: intervalMs, paused });
    },
    [sendConfig, intervalMs, paused],
  );

  const handleToggleDebugCrops = useCallback(() => {
    const next = !debugCrops;
    toggleDebugCrops();
    sendConfig({ debug_crops: next });
  }, [debugCrops, toggleDebugCrops, sendConfig]);

  const handleToggleBenchmark = useCallback(() => {
    if (benchmarkActive) {
      benchmarkStop();
      sendConfig({ benchmark: false });
    } else {
      benchmarkStart(scene);
      sendConfig({ benchmark: true });
    }
  }, [benchmarkActive, scene, sendConfig, benchmarkStart, benchmarkStop]);

  // ベンチマーク結果をストアに蓄積
  useEffect(() => {
    if (benchmarkActive && lastBenchmarkResult) {
      benchmarkAddFrame(lastBenchmarkResult.regions);
    }
  }, [benchmarkActive, lastBenchmarkResult, benchmarkAddFrame]);

  const handleIntervalChange = useCallback(
    (ms: number) => {
      setIntervalMs(ms);
      sendConfig({ scene, interval_ms: ms, paused });
    },
    [sendConfig, scene, paused],
  );

  useEffect(() => {
    if (connectionState === "connected" && !sending) {
      setSending(true);
      sendConfig({ scene, interval_ms: intervalMs, paused });
    } else if (
      connectionState !== "connected" &&
      connectionState !== "processing"
    ) {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  useEffect(() => {
    if (!sending) return;

    const id = setInterval(async () => {
      if (pausedRef.current || !isConnected) return;
      const blob = await captureFrame(qualityRef.current);
      if (blob) {
        sendFrame(blob);
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [sending, intervalMs, isConnected, captureFrame, sendFrame]);

  return (
    <>
      <VideoCanvas videoRef={videoRef} canvasRef={canvasRef} lastResult={lastResult} debugOverlay={debugOverlay} />
      <aside className="side-panel">
        <StatusIndicator state={connectionState} />
        <ControlPanel
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onDeviceChange={handleDeviceChange}
          audioDevices={audioDevices}
          selectedAudioDeviceId={selectedAudioDeviceId}
          onAudioDeviceChange={handleAudioDeviceChange}
          scene={scene}
          onSceneChange={handleSceneChange}
          availableScenes={availableScenes}
          intervalMs={intervalMs}
          onIntervalChange={handleIntervalChange}
          quality={quality}
          onQualityChange={setQuality}
          paused={paused}
          onPauseToggle={handlePauseToggle}
          connected={isConnected}
          onConnectToggle={handleConnectToggle}
          connectDisabled={!videoReady}
          pauseDisabled={!sending}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          muted={muted}
          onMuteToggle={toggleMute}
          debugOverlay={debugOverlay}
          onToggleDebugOverlay={toggleDebugOverlay}
          debugCrops={debugCrops}
          onToggleDebugCrops={handleToggleDebugCrops}
          benchmark={benchmarkActive}
          benchmarkFrameCount={benchmarkFrameCount}
          onToggleBenchmark={handleToggleBenchmark}
        />
        <PokemonResults result={lastPokemonResult} />
        <OcrResults result={lastResult} debugCrops={debugCrops} />
        {!benchmarkActive && benchmarkFrameCount > 0 && <BenchmarkReport />}
      </aside>
    </>
  );
}
