import { useCallback, useEffect, useRef, useState } from "react";
import { VideoCanvas } from "./VideoCanvas";
import { MyPartyPanel } from "./MyPartyPanel";
import { MatchLog } from "./MatchLog";
import { OpponentPanel } from "./OpponentPanel";
import { DamagePanel } from "./DamagePanel";
import { useDamageCalc } from "../hooks/useDamageCalc";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useBenchmarkStore } from "../stores/useBenchmarkStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { getScenes, type SceneMeta } from "../api/devtools";
import type { ConnectionState } from "../types";

/** ベンチマーク結果をストアに蓄積する副作用専用コンポーネント（BattleView の再描画を防止） */
function BenchmarkSync() {
  const lastBenchmarkResult = useConnectionStore((s) => s.lastBenchmarkResult);
  const benchmarkActive = useBenchmarkStore((s) => s.active);
  const benchmarkAddFrame = useBenchmarkStore((s) => s.addFrame);
  useEffect(() => {
    if (benchmarkActive && lastBenchmarkResult) {
      benchmarkAddFrame(lastBenchmarkResult.regions);
    }
  }, [benchmarkActive, lastBenchmarkResult, benchmarkAddFrame]);
  return null;
}

/** ダメージ計算をトリガーする副作用専用コンポーネント（BattleView の再描画を防止） */
function DamageCalcSync() {
  useDamageCalc();
  return null;
}

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
  const sendFrame = useConnectionStore((s) => s.sendFrame);
  const sendConfig = useConnectionStore((s) => s.sendConfig);
  const sendReset = useConnectionStore((s) => s.sendReset);

  const volume = useSettingsStore((s) => s.volume);
  const muted = useSettingsStore((s) => s.muted);
  const debugOverlay = useSettingsStore((s) => s.debugOverlay);
  const jpegQuality = useSettingsStore((s) => s.jpegQuality);
  const autoPauseMinutes = useSettingsStore((s) => s.autoPauseMinutes);

  const partyRegState = useMyPartyStore((s) => s.registrationState);
  const isPartyRegistering =
    partyRegState === "detecting_screen1" ||
    partyRegState === "reading_screen1" ||
    partyRegState === "detecting_screen2" ||
    partyRegState === "reading_screen2";
  const FRAME_INTERVAL_MS = isPartyRegistering ? 150 : 100;
  const [availableScenes, setAvailableScenes] = useState<Record<string, SceneMeta>>({});
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<"manual" | "auto" | null>(null);
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
      setPauseReason(next ? "manual" : null);
      return next;
    });
  }, [sendConfig]);

  const handleResume = useCallback(() => {
    if (!paused) return;
    setPaused(false);
    setPauseReason(null);
    sendConfig({ paused: false });
  }, [paused, sendConfig]);

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

  // シーン未検出が一定時間続いたら自動停止
  const autoPauseMs = autoPauseMinutes * 60 * 1000;
  useEffect(() => {
    if (!sending || paused || currentScene !== "none") return;
    const timer = setTimeout(() => {
      setPaused(true);
      setPauseReason("auto");
      sendConfig({ paused: true });
    }, autoPauseMs);
    return () => clearTimeout(timer);
  }, [currentScene, sending, paused, sendConfig, autoPauseMs]);

  useEffect(() => {
    if (!sending) return;

    const id = setInterval(async () => {
      if (pausedRef.current || !isConnected) return;
      const blob = await captureFrame(jpegQuality);
      if (blob) {
        sendFrame(blob);
      }
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(id);
  }, [sending, isConnected, captureFrame, sendFrame, FRAME_INTERVAL_MS]);

  return (
    <>
      <BenchmarkSync />
      <DamageCalcSync />
      <aside className={`left-panel${leftPanelOpen ? "" : " collapsed"}`}>
        <MyPartyPanel />
        <MatchLog />
      </aside>
      <VideoCanvas
        videoRef={videoRef}
        canvasRef={canvasRef}
        currentScene={currentScene}
        availableScenes={availableScenes}
        debugOverlay={debugOverlay}
        paused={paused}
        pauseReason={pauseReason}
        onResume={handleResume}
      />
      <aside className={`right-panel${rightPanelOpen ? "" : " collapsed"}`}>
        <OpponentPanel />
        <DamagePanel />
      </aside>
    </>
  );
}
