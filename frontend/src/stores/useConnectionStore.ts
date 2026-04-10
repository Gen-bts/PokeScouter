import { create } from "zustand";
import type {
  BattleEventMessage,
  BattleResultMessage,
  BenchmarkResult,
  ConnectionState,
  MatchTeamsMessage,
  OcrResult,
  PartyRegisterCompleteMessage,
  PartyRegisterErrorMessage,
  PartyRegisterProgressMessage,
  PartyRegisterScreenMessage,
  PartyRegistrationPhase,
  PokemonIdentifiedResult,
  SceneChangeMessage,
  TeamSelectionMessage,
  WsConfig,
} from "../types";
import { useMatchLogStore } from "./useMatchLogStore";
import { useMyPartyStore } from "./useMyPartyStore";
import { useOpponentTeamStore } from "./useOpponentTeamStore";

interface ConnectionStore {
  connectionState: ConnectionState;
  currentScene: string;
  lastResult: OcrResult | null;
  lastBenchmarkResult: BenchmarkResult | null;
  lastPokemonResult: PokemonIdentifiedResult | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  sendFrame: (blob: Blob) => Promise<void>;
  sendConfig: (config: WsConfig) => void;
  sendReset: () => void;
  sendPartyRegisterStart: () => void;
  sendPartyRegisterCancel: () => void;
}

// モジュールレベル変数（WebSocket インスタンスは1つだけ）
let ws: WebSocket | null = null;
let intentionalClose = false;
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function doConnect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const { setState } = useConnectionStore;
  setState({ connectionState: "connecting" });

  const url = `ws://${location.host}/ws/battle`;
  const newWs = new WebSocket(url);
  newWs.binaryType = "arraybuffer";
  ws = newWs;

  newWs.onopen = () => {
    reconnectDelay = 1000;
    setState({ connectionState: "connected", isConnected: true });
  };

  newWs.onmessage = (event: MessageEvent) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data) as { type: string };
        if (msg.type === "ocr_result") {
          const ocrMsg = msg as unknown as OcrResult;
          setState({
            lastResult: ocrMsg,
            connectionState: "connected",
            isConnected: true,
          });
          const hasText = ocrMsg.regions.some((r) => r.text && r.text.trim() !== "");
          if (hasText) {
            useMatchLogStore.getState().addOcrResult(ocrMsg);
          }
        } else if (msg.type === "benchmark_result") {
          setState({
            lastBenchmarkResult: msg as unknown as BenchmarkResult,
            connectionState: "connected",
            isConnected: true,
          });
        } else if (msg.type === "pokemon_identified") {
          const pokemonMsg = msg as unknown as PokemonIdentifiedResult;
          setState({ lastPokemonResult: pokemonMsg });
          useOpponentTeamStore.getState().updateFromPokemonIdentified(pokemonMsg.pokemon);
        } else if (msg.type === "scene_change") {
          const sceneMsg = msg as unknown as SceneChangeMessage;
          setState({
            currentScene: sceneMsg.scene,
            ...(sceneMsg.scene === "none" ? { lastResult: null } : {}),
          });
          useMatchLogStore.getState().addSceneChange(sceneMsg);
        } else if (msg.type === "match_teams") {
          const teamsMsg = msg as unknown as MatchTeamsMessage;
          useMatchLogStore.getState().addMatchTeams(teamsMsg);
          useOpponentTeamStore.getState().updateFromMatchTeams(teamsMsg.opponent_team);
        } else if (msg.type === "team_selection") {
          useMatchLogStore.getState().addTeamSelection(msg as unknown as TeamSelectionMessage);
        } else if (msg.type === "battle_result") {
          useMatchLogStore.getState().addBattleResult(msg as unknown as BattleResultMessage);
        } else if (msg.type === "battle_event") {
          useMatchLogStore.getState().addBattleEvent(msg as unknown as BattleEventMessage);
        } else if (msg.type === "party_register_progress") {
          const progressMsg = msg as unknown as PartyRegisterProgressMessage;
          useMyPartyStore.getState().setRegistrationState(progressMsg.state as PartyRegistrationPhase);
        } else if (msg.type === "party_register_screen") {
          const screenMsg = msg as unknown as PartyRegisterScreenMessage;
          useMyPartyStore.getState().updateFromScreen(screenMsg);
        } else if (msg.type === "party_register_complete") {
          const completeMsg = msg as unknown as PartyRegisterCompleteMessage;
          useMyPartyStore.getState().updateFromComplete(completeMsg.party);
        } else if (msg.type === "party_register_error") {
          const errorMsg = msg as unknown as PartyRegisterErrorMessage;
          useMyPartyStore.getState().setError(errorMsg.message);
        } else if (msg.type === "status") {
          const statusMsg = msg as unknown as { status: string };
          if (statusMsg.status === "processing") {
            setState({ connectionState: "processing", isConnected: true });
          } else if (statusMsg.status === "connected") {
            setState({ connectionState: "connected", isConnected: true });
          }
        }
      } catch {
        // 不正な JSON は無視
      }
    }
  };

  newWs.onclose = () => {
    if (!intentionalClose) {
      setState({ connectionState: "reconnecting", isConnected: false });
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
        doConnect();
      }, reconnectDelay);
    } else {
      setState({ connectionState: "disconnected", isConnected: false });
    }
  };

  newWs.onerror = () => {
    // onclose が後に呼ばれるので何もしない
  };
}

export const useConnectionStore = create<ConnectionStore>()((set) => ({
  connectionState: "disconnected",
  currentScene: "none",
  lastResult: null,
  lastBenchmarkResult: null,
  lastPokemonResult: null,
  isConnected: false,

  connect: () => {
    intentionalClose = false;
    doConnect();
  },

  disconnect: () => {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    set({ connectionState: "disconnected", isConnected: false });
  },

  sendFrame: async (blob: Blob) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buffer = await blob.arrayBuffer();
    ws.send(buffer);
  },

  sendConfig: (config: WsConfig) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "config", ...config }));
  },

  sendReset: () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "reset" }));
  },

  sendPartyRegisterStart: () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "party_register_start" }));
  },

  sendPartyRegisterCancel: () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "party_register_cancel" }));
  },
}));
