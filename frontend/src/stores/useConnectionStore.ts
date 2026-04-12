import { create } from "zustand";
import type {
  BattleEventMessage,
  BattleResultMessage,
  BenchmarkResult,
  ConnectionState,
  MatchTeamsMessage,
  OcrResult,
  OpponentActiveMessage,
  OpponentItemAbilityMessage,
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
import { useDamageCalcStore } from "./useDamageCalcStore";
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
  sendForceScene: (scene: string) => void;
  sendPartyRegisterStart: () => void;
  sendPartyRegisterCancel: () => void;
  sendSetOpponentPokemon: (position: number, speciesId: string, name: string) => void;
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
            // 構造化イベント（battle_event, hp_change, match_teams 等）でカバーされるシーンは
            // OCR 生テキストをマッチログに出さない
            const suppressedScenes = new Set(["team_select", "team_confirm", "move_select", "pokemon_summary"]);
            const isBattleScene = ocrMsg.scene === "battle" || ocrMsg.scene.startsWith("battle_");
            if (!suppressedScenes.has(ocrMsg.scene) && !isBattleScene) {
              useMatchLogStore.getState().addOcrResult(ocrMsg);
            }
            console.log("[MatchLog] ocr_result", ocrMsg.scene, ocrMsg.regions.map((r) => `${r.name}="${r.text}"`).join(", "));
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
          console.log("[MatchLog] scene_change", sceneMsg.scene, `(${sceneMsg.top_level}${sceneMsg.sub_scene ? "/" + sceneMsg.sub_scene : ""})`, `conf=${sceneMsg.confidence}`);
          // バトルシーン遷移時にプレイヤーパーティをバックエンドに送信
          if (sceneMsg.top_level === "battle" && ws && ws.readyState === WebSocket.OPEN) {
            const partySlots = useMyPartyStore.getState().slots;
            const party = partySlots
              .filter((s) => s.pokemonId !== null)
              .map((s) => ({ pokemon_key: s.pokemonId, name: s.name }));
            if (party.length > 0) {
              ws.send(JSON.stringify({ type: "set_player_party", party }));
            }
          }
        } else if (msg.type === "match_teams") {
          const teamsMsg = msg as unknown as MatchTeamsMessage;
          useMatchLogStore.getState().addMatchTeams(teamsMsg);
          console.log("[MatchLog] match_teams", "player:", teamsMsg.player_team.map((p) => p.name).join(", "), "| opponent:", teamsMsg.opponent_team.map((p) => p.name ?? "?").join(", "));
          useOpponentTeamStore.getState().resetDisplaySelection();
          useOpponentTeamStore.getState().updateFromMatchTeams(teamsMsg.opponent_team);
        } else if (msg.type === "team_selection") {
          useMatchLogStore.getState().addTeamSelection(msg as unknown as TeamSelectionMessage);
          console.log("[MatchLog] team_selection", (msg as unknown as TeamSelectionMessage).selected_positions);
        } else if (msg.type === "battle_result") {
          useMatchLogStore.getState().addBattleResult(msg as unknown as BattleResultMessage);
          console.log("[MatchLog] battle_result", (msg as unknown as BattleResultMessage).result);
        } else if (msg.type === "battle_event") {
          const battleMsg = msg as unknown as BattleEventMessage;
          useMatchLogStore.getState().addBattleEvent(battleMsg);
          console.log("[MatchLog] battle_event", battleMsg.event_type, battleMsg.side, battleMsg.raw_text, battleMsg.pokemon_name ? `(${battleMsg.pokemon_name})` : "", battleMsg.move_name ? `move=${battleMsg.move_name}` : "");
          const battlePokemonKey = battleMsg.pokemon_key ?? battleMsg.species_id;
          const battleMoveKey = battleMsg.move_key ?? battleMsg.move_id;
          if (battleMsg.event_type === "opponent_sent_out" && battlePokemonKey != null) {
            useOpponentTeamStore.getState().markSentOut(battlePokemonKey);
          } else if (battleMsg.event_type === "player_sent_out" && battlePokemonKey != null) {
            useMyPartyStore.getState().markActive(battlePokemonKey);
            // アクティブポケモンを自動的にアタッカーとして選択（すばやさ比較 + ダメージ計算）
            const activeSlot = useMyPartyStore.getState().slots.find(s => s.pokemonId === battlePokemonKey);
            if (activeSlot) {
              useDamageCalcStore.getState().selectAttacker(activeSlot.position);
            }
          } else if (battleMsg.event_type === "pokemon_fainted" && battleMsg.side === "opponent" && battlePokemonKey != null) {
            useOpponentTeamStore.getState().markFainted(battlePokemonKey);
          } else if (battleMsg.event_type === "pokemon_fainted" && battleMsg.side === "player" && battlePokemonKey != null) {
            useMyPartyStore.getState().markFainted(battlePokemonKey);
          } else if (battleMsg.event_type === "stat_change" && battleMsg.side === "opponent" && battlePokemonKey != null) {
            const stat = battleMsg.details?.stat as string;
            const stages = battleMsg.details?.stages as number;
            if (stat && typeof stages === "number") {
              useOpponentTeamStore.getState().applyStatChange(battlePokemonKey, stat, stages);
            }
          } else if (battleMsg.event_type === "move_used" && battleMsg.side === "opponent" && battlePokemonKey != null && battleMsg.move_name != null && battleMoveKey != null) {
            useOpponentTeamStore.getState().addKnownMove(battlePokemonKey, battleMsg.move_name, battleMoveKey);
          }
        } else if (msg.type === "opponent_active") {
          const activeMsg = msg as unknown as OpponentActiveMessage;
          const activePokemonKey = activeMsg.pokemon_key ?? activeMsg.species_id;
          if (activePokemonKey != null) {
            const oldSlot = useOpponentTeamStore.getState().slots.find(
              (s) => s.pokemonId === activePokemonKey,
            );
            const oldHp = oldSlot?.hpPercent;
            useOpponentTeamStore.getState().updateOpponentActive(
              activePokemonKey,
              activeMsg.hp_percent,
            );
            if (
              activeMsg.hp_percent != null &&
              oldHp != null &&
              oldHp !== activeMsg.hp_percent
            ) {
              useMatchLogStore.getState().addHpChange(
                activeMsg.pokemon_name,
                oldHp,
                activeMsg.hp_percent,
              );
            }
          }
        } else if (msg.type === "opponent_item_ability") {
          const iaMsg = msg as unknown as OpponentItemAbilityMessage;
          useMatchLogStore.getState().addItemAbility(iaMsg);
          console.log(
            "[MatchLog] opponent_%s: %s → %s",
            iaMsg.detection_type, iaMsg.pokemon_name, iaMsg.trait_name,
          );
          const iaPokemonKey = iaMsg.pokemon_key ?? iaMsg.species_id;
          const traitKey = iaMsg.trait_key ?? iaMsg.trait_id;
          if (iaPokemonKey != null && traitKey != null) {
            useOpponentTeamStore.getState().setItemAbility(
              iaPokemonKey,
              iaMsg.detection_type,
              iaMsg.trait_name,
              traitKey,
              iaMsg.item_identifier,
            );
          }
        } else if (msg.type === "party_register_progress") {
          const progressMsg = msg as unknown as PartyRegisterProgressMessage;
          useMyPartyStore.getState().setRegistrationState(progressMsg.state as PartyRegistrationPhase);
        } else if (msg.type === "party_register_screen") {
          const screenMsg = msg as unknown as PartyRegisterScreenMessage;
          useMyPartyStore.getState().updateFromScreen(screenMsg);
          if (screenMsg.screen === 1 && screenMsg.party_name) {
            useMyPartyStore.getState().setPartyName(screenMsg.party_name);
          }
        } else if (msg.type === "party_register_complete") {
          const completeMsg = msg as unknown as PartyRegisterCompleteMessage;
          useMyPartyStore.getState().updateFromComplete(completeMsg.party, completeMsg.party_name ?? null);
        } else if (msg.type === "party_register_error") {
          const errorMsg = msg as unknown as PartyRegisterErrorMessage;
          useMyPartyStore.getState().setError(errorMsg.message);
        } else if (msg.type === "status") {
          const statusMsg = msg as unknown as { status: string };
          if (statusMsg.status === "processing") {
            // connectionState は変更しない — "connected"↔"processing" の高頻度トグルを防止
            setState({ isConnected: true });
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

  sendForceScene: (scene: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "force_scene", scene }));
  },

  sendPartyRegisterStart: () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "party_register_start" }));
  },

  sendPartyRegisterCancel: () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "party_register_cancel" }));
  },

  sendSetOpponentPokemon: (position: number, speciesId: string, name: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "set_opponent_pokemon",
      position,
      pokemon_key: speciesId,
      name,
    }));
  },
}));
