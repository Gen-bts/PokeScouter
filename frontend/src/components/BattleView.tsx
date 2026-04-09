import { useCallback, useEffect, useRef, useState } from "react";
import { VideoCanvas } from "./VideoCanvas";
import { MyPartyPanel } from "./MyPartyPanel";
import { MatchLog } from "./MatchLog";
import { OpponentPanel } from "./OpponentPanel";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useBenchmarkStore } from "../stores/useBenchmarkStore";
import { getScenes, type SceneMeta } from "../api/devtools";
import type { ConnectionState } from "../types";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  captureFrame: (quality: number) => Promise<Blob | null>;
  setVideoVolume: (v: number) => void;
  setVideoMuted: (m: boolean) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onSceneResetReady: (reset: () => void) => void;
  onPauseReady: (toggle: () => void) => void;
  onPauseStateChange: (paused: boolean) => void;
  onSendingStateChange: (sending: boolean) => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
}

export function BattleView({
  videoRef,
  canvasRef,
  captureFrame,
  setVideoVolume,
  setVideoMuted,
  onConnectionStateChange,
  onSceneResetReady,
  onPauseReady,
  onPauseStateChange,
  onSendingStateChange,
  leftPanelOpen,
  rightPanelOpen,
}: Props) {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const connectionState = useConnectionStore((s) => s.connectionState);
  const currentScene = useConnectionStore((s) => s.currentScene);
  const lastResult = useConnectionStore((s) => s.lastResult);
  const lastBenchmarkResult = useConnectionStore((s) => s.lastBenchmarkResult);
  const lastPokemonResult = useConnectionStore((s) => s.lastPokemonResult);
  const sendFrame = useConnectionStore((s) => s.sendFrame);
  const sendConfig = useConnectionStore((s) => s.sendConfig);
  const sendReset = useConnectionStore((s) => s.sendReset);

  const benchmarkActive = useBenchmarkStore((s) => s.active);
  const benchmarkAddFrame = useBenchmarkStore((s) => s.addFrame);

  const volume = useSettingsStore((s) => s.volume);
  const muted = useSettingsStore((s) => s.muted);
  const debugOverlay = useSettingsStore((s) => s.debugOverlay);

  const FRAME_INTERVAL_MS = 500;
  const [availableScenes, setAvailableScenes] = useState<Record<string, SceneMeta>>({});
  const [paused, setPaused] = useState(false);
  const [sending, setSending] = useState(false);

  // シーン一覧取得
  useEffect(() => {
    getScenes().then(setAvailableScenes);
  }, []);

  // volume / muted をビデオ要素に同期
  useEffect(() => {
    setVideoVolume(volume);
    setVideoMuted(muted);
  }, [volume, muted, setVideoVolume, setVideoMuted]);

  // connectionState の変更を親に通知
  useEffect(() => {
    onConnectionStateChange(connectionState);
  }, [connectionState, onConnectionStateChange]);

  // sendReset を親に公開
  useEffect(() => {
    onSceneResetReady(sendReset);
  }, [sendReset, onSceneResetReady]);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const handlePauseToggle = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      sendConfig({ paused: next });
      return next;
    });
  }, [sendConfig]);

  // pause toggle を親に公開
  useEffect(() => {
    onPauseReady(handlePauseToggle);
  }, [handlePauseToggle, onPauseReady]);

  // paused 状態を親に通知
  useEffect(() => {
    onPauseStateChange(paused);
  }, [paused, onPauseStateChange]);

  // sending 状態を親に通知
  useEffect(() => {
    onSendingStateChange(sending);
  }, [sending, onSendingStateChange]);

  // ベンチマーク結果をストアに蓄積
  useEffect(() => {
    if (benchmarkActive && lastBenchmarkResult) {
      benchmarkAddFrame(lastBenchmarkResult.regions);
    }
  }, [benchmarkActive, lastBenchmarkResult, benchmarkAddFrame]);

  useEffect(() => {
    if (connectionState === "connected" && !sending) {
      setSending(true);
      sendConfig({ paused });
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
      const blob = await captureFrame(0.8);
      if (blob) {
        sendFrame(blob);
      }
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(id);
  }, [sending, isConnected, captureFrame, sendFrame]);

  return (
    <>
      <aside className={`left-panel${leftPanelOpen ? "" : " collapsed"}`}>
        <MyPartyPanel />
        <MatchLog />
      </aside>
      <VideoCanvas
        videoRef={videoRef}
        canvasRef={canvasRef}
        currentScene={currentScene}
        lastResult={lastResult}
        lastPokemonResult={lastPokemonResult}
        availableScenes={availableScenes}
        debugOverlay={debugOverlay}
      />
      <aside className={`right-panel${rightPanelOpen ? "" : " collapsed"}`}>
        <OpponentPanel />
      </aside>
    </>
  );
}
