import { useCallback, useEffect, useRef, useState } from "react";
import type { BenchmarkResult, ConnectionState, OcrResult, PokemonIdentifiedResult, WsConfig } from "../types";

export interface UseWebSocket {
  connect: () => void;
  disconnect: () => void;
  sendFrame: (blob: Blob) => Promise<void>;
  sendConfig: (config: WsConfig) => void;
  isConnected: boolean;
  connectionState: ConnectionState;
  lastResult: OcrResult | null;
  lastBenchmarkResult: BenchmarkResult | null;
  lastPokemonResult: PokemonIdentifiedResult | null;
}

export function useWebSocket(): UseWebSocket {
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [lastResult, setLastResult] = useState<OcrResult | null>(null);
  const [lastBenchmarkResult, setLastBenchmarkResult] =
    useState<BenchmarkResult | null>(null);
  const [lastPokemonResult, setLastPokemonResult] =
    useState<PokemonIdentifiedResult | null>(null);

  // connectionState を ref でも保持（connect 内のコールバックから最新値を参照するため）
  const stateRef = useRef(connectionState);
  stateRef.current = connectionState;

  const doConnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setConnectionState("connecting");

    const url = `ws://${location.host}/ws/battle`;
    const newWs = new WebSocket(url);
    newWs.binaryType = "arraybuffer";
    wsRef.current = newWs;

    newWs.onopen = () => {
      reconnectDelayRef.current = 1000;
      setConnectionState("connected");
    };

    newWs.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as { type: string };
          if (msg.type === "ocr_result") {
            setLastResult(msg as unknown as OcrResult);
            setConnectionState("connected");
          } else if (msg.type === "benchmark_result") {
            setLastBenchmarkResult(msg as unknown as BenchmarkResult);
            setConnectionState("connected");
          } else if (msg.type === "pokemon_identified") {
            setLastPokemonResult(msg as unknown as PokemonIdentifiedResult);
          } else if (msg.type === "status") {
            const statusMsg = msg as unknown as { status: string };
            if (statusMsg.status === "processing") {
              setConnectionState("processing");
            } else if (statusMsg.status === "connected") {
              setConnectionState("connected");
            }
          }
        } catch {
          // 不正な JSON は無視
        }
      }
    };

    newWs.onclose = () => {
      if (!intentionalCloseRef.current) {
        setConnectionState("reconnecting");
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * 2,
            10000,
          );
          doConnect();
        }, reconnectDelayRef.current);
      } else {
        setConnectionState("disconnected");
      }
    };

    newWs.onerror = () => {
      // onclose が後に呼ばれるので何もしない
    };
  }, []);

  const connect = useCallback(() => {
    intentionalCloseRef.current = false;
    doConnect();
  }, [doConnect]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
  }, []);

  const sendFrame = useCallback(async (blob: Blob) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buffer = await blob.arrayBuffer();
    ws.send(buffer);
  }, []);

  const sendConfig = useCallback((config: WsConfig) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "config", ...config }));
  }, []);

  const isConnected = connectionState === "connected" || connectionState === "processing";

  // アンマウント時にクリーンアップ
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    connect,
    disconnect,
    sendFrame,
    sendConfig,
    isConnected,
    connectionState,
    lastResult,
    lastBenchmarkResult,
    lastPokemonResult,
  };
}
