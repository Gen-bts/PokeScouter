import { useCallback, useState } from "react";
import { ControlPanel } from "./ControlPanel";
import { BenchmarkReport } from "./BenchmarkReport";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useBenchmarkStore } from "../stores/useBenchmarkStore";

interface Props {
  devices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  startCapture: (deviceId: string, audioDeviceId?: string) => Promise<void>;
}

export function SettingsView({ devices, audioDevices, startCapture }: Props) {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const sendConfig = useConnectionStore((s) => s.sendConfig);
  const currentScene = useConnectionStore((s) => s.currentScene);

  const selectedDeviceId = useSettingsStore((s) => s.selectedDeviceId);
  const setDeviceId = useSettingsStore((s) => s.setDeviceId);
  const selectedAudioDeviceId = useSettingsStore((s) => s.selectedAudioDeviceId);
  const setAudioDeviceId = useSettingsStore((s) => s.setAudioDeviceId);
  const debugCrops = useSettingsStore((s) => s.debugCrops);
  const toggleDebugCrops = useSettingsStore((s) => s.toggleDebugCrops);

  const benchmarkActive = useBenchmarkStore((s) => s.active);
  const benchmarkFrameCount = useBenchmarkStore((s) => s.frameCount);
  const benchmarkStart = useBenchmarkStore((s) => s.start);
  const benchmarkStop = useBenchmarkStore((s) => s.stop);

  const [quality, setQuality] = useState(0.8);
  const [videoReady, setVideoReady] = useState(!!selectedDeviceId);

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
      benchmarkStart(currentScene ?? "none");
      sendConfig({ benchmark: true });
    }
  }, [benchmarkActive, currentScene, sendConfig, benchmarkStart, benchmarkStop]);

  return (
    <div className="settings-view">
      <ControlPanel
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onDeviceChange={handleDeviceChange}
        audioDevices={audioDevices}
        selectedAudioDeviceId={selectedAudioDeviceId}
        onAudioDeviceChange={handleAudioDeviceChange}
        quality={quality}
        onQualityChange={setQuality}
        connected={isConnected}
        onConnectToggle={handleConnectToggle}
        connectDisabled={!videoReady}
        debugCrops={debugCrops}
        onToggleDebugCrops={handleToggleDebugCrops}
        benchmark={benchmarkActive}
        benchmarkFrameCount={benchmarkFrameCount}
        onToggleBenchmark={handleToggleBenchmark}
      />
      {!benchmarkActive && benchmarkFrameCount > 0 && <BenchmarkReport />}
    </div>
  );
}
