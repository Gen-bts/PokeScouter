import { create } from "zustand";
import type {
  BattleEventMessage,
  BattleTurnCloseReason,
  BattleResultMessage,
  BenchmarkResult,
  ConnectionState,
  FieldStateMessage,
  MatchTeamsMessage,
  OcrResult,
  OpponentActiveMessage,
  OpponentItemAbilityMessage,
  PlayerActiveMessage,
  PartyRegisterCompleteMessage,
  PartyRegisterErrorMessage,
  PartyRegisterProgressMessage,
  PartyRegisterScreenMessage,
  PartyRegistrationPhase,
  PokemonIdentifiedResult,
  ResolvedTurnSummary,
  SceneChangeMessage,
  SceneDebugResult,
  TeamSelectionMessage,
  TeamSelectionOrderMessage,
  WsConfig,
} from "../types";
import { useFieldStateStore } from "./useFieldStateStore";
import { useMatchLogStore } from "./useMatchLogStore";
import { useDamageCalcStore } from "./useDamageCalcStore";
import { useBattleTurnStore } from "./useBattleTurnStore";
import { useMyPartyStore } from "./useMyPartyStore";
import { useOpponentTeamStore } from "./useOpponentTeamStore";
import { useSpeedInferenceStore } from "./useSpeedInferenceStore";
import {
  getEffectivePlayerMaxHp,
  resolveHpPercent,
  clamp,
} from "../utils/playerPartyHp";

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
  sendErrorFlag: (targetSeq: number | null, entryKind: string, entryTimestamp: number, flagged: boolean) => void;
  sendSceneDebug: () => void;
}

// モジュールレベル変数（WebSocket インスタンスは1つだけ）
let ws: WebSocket | null = null;
let intentionalClose = false;
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function finalizeResolvedTurn(summary: ResolvedTurnSummary | null) {
  if (!summary) return;
  const inferenceResult = useSpeedInferenceStore.getState().consumeResolvedTurn(summary);
  const finalizedSummary: ResolvedTurnSummary = {
    ...summary,
    inferenceApplied: inferenceResult.applied,
    inferenceNote: inferenceResult.note,
  };
  useBattleTurnStore.getState().commitResolvedTurn(finalizedSummary);
  useMatchLogStore.getState().addTurnSummary(finalizedSummary);
}

function abortTurn(reason: BattleTurnCloseReason) {
  finalizeResolvedTurn(useBattleTurnStore.getState().abortCurrentTurn(reason));
}

/** マッチログの味方チーム表示用。バックエンドは set_player_party の並びを match_teams に使う。 */
function sendPlayerPartyIfReady(socket: WebSocket) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const party = useMyPartyStore
    .getState()
    .slots.filter((s) => s.pokemonId !== null)
    .map((s) => ({ pokemon_key: s.pokemonId!, name: s.name ?? "" }));
  if (party.length > 0) {
    socket.send(JSON.stringify({ type: "set_player_party", party }));
  }
}

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
    sendPlayerPartyIfReady(newWs);
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
          const previousScene = useConnectionStore.getState().currentScene;
          setState({
            currentScene: sceneMsg.scene,
            ...(sceneMsg.scene === "none" ? { lastResult: null } : {}),
          });
          useMatchLogStore.getState().addSceneChange(sceneMsg);
          finalizeResolvedTurn(
            useBattleTurnStore
              .getState()
              .handleSceneChange(sceneMsg.scene, previousScene),
          );
          console.log("[MatchLog] scene_change", sceneMsg.scene, `(${sceneMsg.top_level}${sceneMsg.sub_scene ? "/" + sceneMsg.sub_scene : ""})`, `conf=${sceneMsg.confidence}`);
          // 選出画面遷移時に相手パーティをクリア（match_teams より先に届くため）
          if (sceneMsg.scene === "team_select") {
            useOpponentTeamStore.getState().clear();
          }
          // 試合前にパーティを同期（match_teams の味方行はこの並びを優先）
          if (ws && ws.readyState === WebSocket.OPEN) {
            if (sceneMsg.top_level === "pre_match") {
              sendPlayerPartyIfReady(ws);
            } else if (sceneMsg.top_level === "battle") {
              sendPlayerPartyIfReady(ws);
            }
          }
        } else if (msg.type === "match_teams") {
          const teamsMsg = msg as unknown as MatchTeamsMessage;
          abortTurn("match_teams");
          useBattleTurnStore.getState().reset();
          useMatchLogStore.getState().addMatchTeams(teamsMsg);
          console.log("[MatchLog] match_teams", "player:", teamsMsg.player_team.map((p) => p.name).join(", "), "| opponent:", teamsMsg.opponent_team.map((p) => p.name ?? "?").join(", "));
          useOpponentTeamStore.getState().resetDisplaySelection();
          useOpponentTeamStore.getState().updateFromMatchTeams(teamsMsg.opponent_team);
          useFieldStateStore.getState().clear();
          useMyPartyStore.getState().clearBattleState();
          useSpeedInferenceStore.getState().reset();
        } else if (msg.type === "team_selection") {
          useMatchLogStore.getState().addTeamSelection(msg as unknown as TeamSelectionMessage);
          console.log("[MatchLog] team_selection", (msg as unknown as TeamSelectionMessage).selected_positions);
        } else if (msg.type === "team_selection_order") {
          useMatchLogStore.getState().addTeamSelectionOrder(msg as unknown as TeamSelectionOrderMessage);
          console.log("[MatchLog] team_selection_order", (msg as unknown as TeamSelectionOrderMessage).selection_order);
        } else if (msg.type === "battle_result") {
          useMatchLogStore.getState().addBattleResult(msg as unknown as BattleResultMessage);
          abortTurn("battle_result");
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
          } else if (battleMsg.event_type === "stat_change" && battleMsg.side === "player" && battlePokemonKey != null) {
            const stat = battleMsg.details?.stat as string;
            const stages = battleMsg.details?.stages as number;
            if (stat && typeof stages === "number") {
              useMyPartyStore.getState().applyStatChange(battlePokemonKey, stat, stages);
            }
          } else if (battleMsg.event_type === "stat_change" && battleMsg.side === "opponent" && battlePokemonKey != null) {
            const stat = battleMsg.details?.stat as string;
            const stages = battleMsg.details?.stages as number;
            if (stat && typeof stages === "number") {
              useOpponentTeamStore.getState().applyStatChange(battlePokemonKey, stat, stages);
            }
          } else if (battleMsg.event_type === "move_used" && battleMsg.side === "opponent" && battlePokemonKey != null && battleMsg.move_name != null && battleMoveKey != null) {
            useOpponentTeamStore.getState().addKnownMove(battlePokemonKey, battleMsg.move_name, battleMoveKey);
          } else if (battleMsg.event_type === "mega_evolution" && battlePokemonKey != null) {
            const megaPokemonKey = battleMsg.details?.mega_pokemon_key as string | undefined;
            if (megaPokemonKey) {
              if (battleMsg.side === "opponent") {
                useOpponentTeamStore.getState().applyMegaEvolution(battlePokemonKey, megaPokemonKey);
              } else if (battleMsg.side === "player") {
                useMyPartyStore.getState().applyMegaEvolution(battlePokemonKey, megaPokemonKey);
              }
            }
          }
          // 素早さ推定ストアへ全 battle_event をディスパッチ
          useBattleTurnStore.getState().recordBattleEvent(
            battleMsg,
            useConnectionStore.getState().currentScene,
          );
        } else if (msg.type === "field_state") {
          const fieldMsg = msg as unknown as FieldStateMessage;
          useFieldStateStore.getState().updateFromMessage(fieldMsg);
          console.log("[FieldState] updated", fieldMsg.weather, fieldMsg.terrain, fieldMsg.trick_room);
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
        } else if (msg.type === "player_active") {
          const playerMsg = msg as unknown as PlayerActiveMessage;
          const playerPokemonKey = playerMsg.pokemon_key ?? playerMsg.species_id;
          if (playerPokemonKey != null) {
            const oldSlot = useMyPartyStore.getState().slots.find(
              (s) => s.pokemonId === playerPokemonKey,
            );

            // パーティ登録の最大 HP を優先（メガ時は再計算）
            const partyMaxHp = oldSlot ? getEffectivePlayerMaxHp(oldSlot) : null;
            const resolvedMax = partyMaxHp ?? playerMsg.max_hp;

            // 現在 HP をクランプ（最大 HP を超えないように）
            let resolvedCurrent = playerMsg.current_hp;
            if (resolvedCurrent != null && resolvedMax != null && resolvedMax > 0) {
              resolvedCurrent = clamp(resolvedCurrent, 0, resolvedMax);
            }

            // パーセンテージを再計算（パーティ基準の最大 HP で）
            const resolvedPercent = resolveHpPercent(resolvedCurrent, playerMsg.max_hp, partyMaxHp)
              ?? playerMsg.hp_percent;

            // 前回のパーセンテージもパーティ基準で再計算
            const oldHpPercent = oldSlot
              ? resolveHpPercent(oldSlot.currentHp, oldSlot.maxHp, partyMaxHp) ?? oldSlot.hpPercent
              : null;

            useMyPartyStore.getState().updatePlayerActive(
              playerPokemonKey,
              resolvedCurrent,
              resolvedMax,
              resolvedPercent,
            );

            if (
              resolvedPercent != null &&
              oldHpPercent != null &&
              oldHpPercent !== resolvedPercent
            ) {
              // actualHp は両方とも resolvedMax（パーティ基準）を使用
              const actualHp =
                oldSlot?.currentHp != null &&
                resolvedMax != null &&
                resolvedCurrent != null
                  ? {
                      fromCurrent: oldSlot.currentHp,
                      fromMax: resolvedMax,
                      toCurrent: resolvedCurrent,
                      toMax: resolvedMax,
                    }
                  : undefined;
              useMatchLogStore.getState().addHpChange(
                playerMsg.pokemon_name,
                oldHpPercent,
                resolvedPercent,
                actualHp,
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
            useSpeedInferenceStore.getState().refreshInferences();
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
        } else if (msg.type === "scene_debug_result") {
          const d = msg as unknown as SceneDebugResult;
          if (d.error) {
            console.warn("[SceneDebug]", d.error);
            return;
          }
          const sm = d.state_machine;
          console.group(
            "%c[SceneDebug] シーン検出デバッグダンプ",
            "color: #ff9800; font-weight: bold; font-size: 14px",
          );
          console.log(
            "%cState Machine:",
            "color: #2196f3; font-weight: bold",
            `${sm.top_level}` + (sm.sub_scene ? `/${sm.sub_scene}` : "") +
            ` (conf=${sm.confidence})`,
          );
          console.log("  Candidates:", sm.candidates.join(", ") || "(none)");
          console.log(
            "  Pending top:", sm.pending_top ?? "none",
            `(${sm.pending_top_count} frames)`,
          );
          console.log(
            "  Pending sub:", sm.pending_sub ?? "none",
            `(${sm.pending_sub_count} frames)`,
          );
          console.log("  No-sub count:", sm.no_sub_count);
          if (sm.force_cooldown_active) {
            console.warn("  Force cooldown ACTIVE");
          }
          console.log("  Scenes tested:", d.scenes_tested.join(", "));
          console.table(
            d.detections.map((r) => ({
              scene: r.scene,
              region: r.region_name,
              matched: r.matched ? "YES" : "---",
              confidence: r.confidence.toFixed(3),
              elapsed_ms: r.elapsed_ms.toFixed(1),
            })),
          );
          console.groupEnd();
        }
      } catch {
        // 不正な JSON は無視
      }
    }
  };

  newWs.onclose = () => {
    abortTurn("disconnect");
    useBattleTurnStore.getState().reset();
    useFieldStateStore.getState().clear();
    useMyPartyStore.getState().clearBattleState();
    useSpeedInferenceStore.getState().reset();
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
    abortTurn("disconnect");
    useBattleTurnStore.getState().reset();
    useFieldStateStore.getState().clear();
    useMyPartyStore.getState().clearBattleState();
    useSpeedInferenceStore.getState().reset();
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
    abortTurn("reset");
    useBattleTurnStore.getState().reset();
    useFieldStateStore.getState().clear();
    useMyPartyStore.getState().clearBattleState();
    useSpeedInferenceStore.getState().reset();
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

  sendErrorFlag: (targetSeq: number | null, entryKind: string, entryTimestamp: number, flagged: boolean) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "error_flag",
      target_seq: targetSeq,
      entry_kind: entryKind,
      entry_timestamp: entryTimestamp,
      flagged,
    }));
  },

  sendSceneDebug: () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "scene_debug" }));
  },
}));
