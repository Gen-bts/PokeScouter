import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SceneMeta } from "../api/devtools";
import { BattleInfoOverlay } from "./BattleInfoOverlay";
import { PauseBanner } from "./PauseBanner";
import { RegistrationOverlay } from "./RegistrationOverlay";
import { PokemonIconCandidateSelector } from "./devtools/PokemonIconCandidateSelector";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useMatchLogStore } from "../stores/useMatchLogStore";
import { useSettingsStore } from "../stores/useSettingsStore";

const COLORS = [
  "rgba(255, 107, 107, 0.7)",
  "rgba(78, 205, 196, 0.7)",
  "rgba(255, 230, 109, 0.7)",
  "rgba(162, 155, 254, 0.7)",
  "rgba(255, 159, 67, 0.7)",
  "rgba(46, 213, 115, 0.7)",
  "rgba(116, 185, 255, 0.7)",
  "rgba(223, 128, 255, 0.7)",
];

const DETECTION_COLOR = "rgba(0, 255, 255, 0.7)";
const POKEMON_ICON_COLOR = "rgba(255, 0, 255, 0.7)";

/** API 未取得時のフォールバック用 日本語シーン名 */
const SCENE_NAMES_JA: Record<string, string> = {
  none: "シーン検出待機中",
  pre_match: "バトル開始前",
  team_select: "選出画面",
  team_confirm: "選出決定",
  move_select: "わざ選択",
  battle: "バトル",
  battle_Neutral: "ニュートラルバトル",
  pokemon_summary: "ポケモン画面",
  battle_end: "バトル終了",
  party_register_1: "パーティ登録 画面1",
  party_register_2: "パーティ登録 画面2",
};

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  currentScene: string;
  availableScenes: Record<string, SceneMeta>;
  debugOverlay: boolean;
  paused: boolean;
  pauseReason: "manual" | "auto" | null;
  onResume: () => void;
}

export const VideoCanvas = memo(function VideoCanvas({
  videoRef,
  canvasRef,
  currentScene,
  availableScenes,
  debugOverlay,
  paused,
  pauseReason,
  onResume,
}: Props) {
  const showBattleInfo = useSettingsStore((s) => s.showBattleInfo);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [activeSpritePosition, setActiveSpritePosition] = useState<number | null>(null);
  const [spriteOverrides, setSpriteOverrides] = useState<
    Record<number, { pokemon_id: string; name: string }>
  >({});
  const manualSet = useOpponentTeamStore((s) => s.manualSet);
  const sendSetOpponentPokemon = useConnectionStore((s) => s.sendSetOpponentPokemon);

  // Canvas オーバーレイ描画: React レンダーパスを経由せず store を直接購読 + rAF でコアレス
  const debugOverlayRef = useRef(debugOverlay);
  debugOverlayRef.current = debugOverlay;
  const currentSceneRef = useRef(currentScene);
  currentSceneRef.current = currentScene;
  const availableScenesRef = useRef(availableScenes);
  availableScenesRef.current = availableScenes;

  useEffect(() => {
    if (paused) return;

    let rafId: number | null = null;
    let dirty = false;

    function drawOverlay() {
      dirty = false;
      const { lastResult, lastPokemonResult } = useConnectionStore.getState();
      const scene = currentSceneRef.current;
      const scenes = availableScenesRef.current;
      const debug = debugOverlayRef.current;

      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext("2d");
      if (!ctx) return;

      if (!canvasRef.current) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        return;
      }

      const baseCanvas = canvasRef.current;
      // キャプチャ中はbase canvasのビットマップサイズ、未開始時はオーバーレイの表示サイズを使う
      const displayRect = overlay.getBoundingClientRect();
      if (baseCanvas.width > 300) {
        overlay.width = baseCanvas.width;
        overlay.height = baseCanvas.height;
      } else {
        overlay.width = displayRect.width;
        overlay.height = displayRect.height;
      }

      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // === debugOverlay が有効かつ OCR 結果がある場合のみリージョンを描画 ===
      if (debug && lastResult) {
        const refW = lastResult.resolution?.width ?? 1920;
        const refH = lastResult.resolution?.height ?? 1080;
        const scaleX = overlay.width / refW;
        const scaleY = overlay.height / refH;

        // === 1. 検出用リージョン (破線シアン) ===
        const detectionRegions = lastResult.detection_regions ?? [];
        if (detectionRegions.length > 0) {
          ctx.save();
          ctx.setLineDash([8, 4]);
          for (const dr of detectionRegions) {
            const rx = dr.x * scaleX;
            const ry = dr.y * scaleY;
            const rw = dr.w * scaleX;
            const rh = dr.h * scaleY;

            // 半透明の塗り
            ctx.fillStyle = DETECTION_COLOR.replace("0.7", "0.08");
            ctx.fillRect(rx, ry, rw, rh);

            // 破線枠
            ctx.strokeStyle = DETECTION_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(rx, ry, rw, rh);

            // ラベル: name (method)
            ctx.font = `bold ${Math.max(11, 13 * scaleY)}px sans-serif`;
            ctx.fillStyle = DETECTION_COLOR;
            const label = `${dr.name} (${dr.method})`;
            const labelY = ry - 4;
            if (labelY > 14) {
              ctx.fillText(label, rx + 2, labelY);
            } else {
              ctx.fillText(label, rx + 2, ry + 13 * scaleY);
            }
          }
          ctx.restore();
        }

        // === 2. OCR 読み取りリージョン (既存、実線カラー) ===
        for (let i = 0; i < lastResult.regions.length; i++) {
          const region = lastResult.regions[i];
          if (!region) continue;
          const color = COLORS[i % COLORS.length] ?? COLORS[0]!;

          const rx = region.x * scaleX;
          const ry = region.y * scaleY;
          const rw = region.w * scaleX;
          const rh = region.h * scaleY;

          // 半透明の塗り
          ctx.fillStyle = color.replace("0.7", "0.15");
          ctx.fillRect(rx, ry, rw, rh);

          // 枠線
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(rx, ry, rw, rh);

          // リージョン名（矩形上部）
          ctx.font = `bold ${Math.max(12, 14 * scaleY)}px sans-serif`;
          ctx.fillStyle = color;
          const label = region.name;
          const labelY = ry - 4;
          if (labelY > 14) {
            ctx.fillText(label, rx + 2, labelY);
          } else {
            ctx.fillText(label, rx + 2, ry + 14 * scaleY);
          }

          // OCRテキスト（矩形内）
          if (region.text) {
            ctx.font = `bold ${Math.max(11, 13 * scaleY)}px monospace`;
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 3;
            const textY = ry + rh / 2 + 5 * scaleY;
            ctx.strokeText(region.text, rx + 4, textY);
            ctx.fillText(region.text, rx + 4, textY);
          }
        }

        // === 3. ポケモンアイコン枠 (マゼンタ) ===
        const pokemonIcons = lastResult.pokemon_icons ?? [];
        if (pokemonIcons.length > 0) {
          const pokemonMap = new Map(
            (lastPokemonResult?.pokemon ?? []).map((p) => [p.position, p]),
          );

          for (let i = 0; i < pokemonIcons.length; i++) {
            const icon = pokemonIcons[i];
            if (!icon) continue;
            const rx = icon.x * scaleX;
            const ry = icon.y * scaleY;
            const rw = icon.w * scaleX;
            const rh = icon.h * scaleY;

            // 半透明の塗り
            ctx.fillStyle = POKEMON_ICON_COLOR.replace("0.7", "0.1");
            ctx.fillRect(rx, ry, rw, rh);

            // 枠線
            ctx.strokeStyle = POKEMON_ICON_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(rx, ry, rw, rh);

            // ポケモン認識結果があれば名前を表示
            const pokemon = pokemonMap.get(i + 1); // position は 1-based
            if (pokemon?.name && pokemon.confidence > 0) {
              const nameLabel = `${pokemon.name} (${Math.round(pokemon.confidence * 100)}%)`;
              ctx.font = `bold ${Math.max(12, 14 * scaleY)}px sans-serif`;

              // 背景付きテキスト
              ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
              const metrics = ctx.measureText(nameLabel);
              const textH = Math.max(14, 16 * scaleY);
              ctx.fillRect(rx, ry + rh + 2, metrics.width + 8, textH + 4);

              ctx.fillStyle = POKEMON_ICON_COLOR;
              ctx.fillText(nameLabel, rx + 4, ry + rh + textH);
            } else {
              // 未認識: アイコン名のみ
              ctx.font = `bold ${Math.max(11, 13 * scaleY)}px sans-serif`;
              ctx.fillStyle = POKEMON_ICON_COLOR.replace("0.7", "0.5");
              const labelY = ry - 4;
              if (labelY > 14) {
                ctx.fillText(icon.name, rx + 2, labelY);
              } else {
                ctx.fillText(icon.name, rx + 2, ry + 13 * scaleY);
              }
            }
          }
        }
      }

      // === 4. シーン名バッジ (左上、最前面 — 常に表示) ===
      const sceneName = scenes[scene]?.display_name
        ?? SCENE_NAMES_JA[scene]
        ?? scene;
      const scaleY = overlay.height / 1080;
      const fontSize = Math.max(14, 16 * scaleY);
      ctx.font = `bold ${fontSize}px sans-serif`;
      const textMetrics = ctx.measureText(sceneName);
      const badgePadX = 10;
      const badgePadY = 6;
      const badgeX = 10;
      const badgeY = 10;
      const badgeW = textMetrics.width + badgePadX * 2;
      const badgeH = fontSize + badgePadY * 2;

      // 角丸背景
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(badgeX + r, badgeY);
      ctx.lineTo(badgeX + badgeW - r, badgeY);
      ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + r);
      ctx.lineTo(badgeX + badgeW, badgeY + badgeH - r);
      ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - r, badgeY + badgeH);
      ctx.lineTo(badgeX + r, badgeY + badgeH);
      ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - r);
      ctx.lineTo(badgeX, badgeY + r);
      ctx.quadraticCurveTo(badgeX, badgeY, badgeX + r, badgeY);
      ctx.closePath();
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fill();

      // テキスト
      ctx.fillStyle = "#fff";
      ctx.fillText(sceneName, badgeX + badgePadX, badgeY + badgePadY + fontSize * 0.85);
    }

    function scheduleRedraw() {
      dirty = true;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (dirty) drawOverlay();
        });
      }
    }

    // Store 変更時に rAF 経由で再描画（React レンダーを経由しない）
    const unsub = useConnectionStore.subscribe(scheduleRedraw);
    drawOverlay(); // 初回描画

    return () => {
      unsub();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [paused, currentScene, availableScenes, debugOverlay, canvasRef]);

  // シーン変更時にオーバーライドをクリア
  useEffect(() => {
    setSpriteOverrides({});
    setActiveSpritePosition(null);
  }, [currentScene]);

  // 表示用ポケモン一覧（オーバーライド反映）
  // チームシーン以外では lastPokemonResult を購読しない（不要な再レンダリング防止）
  const isTeamScene = currentScene === "team_select" || currentScene === "team_confirm";
  const lastPokemonResultForSprite = useConnectionStore(
    useCallback(
      (s: { lastPokemonResult: ReturnType<typeof useConnectionStore.getState>["lastPokemonResult"] }) =>
        isTeamScene ? s.lastPokemonResult : null,
      [isTeamScene],
    ),
  );
  const spriteEntries = useMemo(() => {
    if (!isTeamScene || !lastPokemonResultForSprite) return [];
    return lastPokemonResultForSprite.pokemon
      .filter((p) => p.x != null && p.y != null && p.w != null && p.h != null)
      .map((p) => {
        const override = spriteOverrides[p.position];
        return {
          position: p.position,
          pokemonId: override?.pokemon_id ?? p.pokemon_key ?? p.pokemon_id,
          name: override?.name ?? p.name ?? null,
          candidates: p.candidates ?? [],
          x: p.x!, y: p.y!, w: p.w!, h: p.h!,
        };
      })
      .filter((e) => e.pokemonId != null);
  }, [isTeamScene, lastPokemonResultForSprite, spriteOverrides]);

  const handleSpriteSelect = useCallback(
    (position: number, pokemonId: string, name: string) => {
      const oldSlot = useOpponentTeamStore.getState().slots[position - 1];
      useMatchLogStore.getState().addPokemonCorrection(
        position,
        oldSlot?.pokemonId ?? null,
        oldSlot?.name ?? null,
        oldSlot ? oldSlot.confidence : null,
        pokemonId,
        name,
        "candidate",
      );
      setSpriteOverrides((prev) => ({
        ...prev,
        [position]: { pokemon_id: pokemonId, name },
      }));
      manualSet(position, pokemonId, name);
      sendSetOpponentPokemon(position, pokemonId, name);
      setActiveSpritePosition(null);
    },
    [manualSet, sendSetOpponentPokemon],
  );

  return (
    <main className="video-area">
      <video ref={videoRef} autoPlay playsInline />
      <canvas ref={canvasRef} />
      {!paused && <canvas ref={overlayRef} className="debug-overlay" />}
      {!paused && spriteEntries.length > 0 && (
        <div className="sprite-overlay-container">
          {spriteEntries.map((entry) => {
            const spriteRefSize = Math.min(entry.h, 80);
            const leftPct = ((entry.x - spriteRefSize - 8) / 1920) * 100;
            const topPct = ((entry.y + (entry.h - spriteRefSize) / 2) / 1080) * 100;
            const widthPct = (spriteRefSize / 1920) * 100;
            const heightPct = (spriteRefSize / 1080) * 100;
            return (
              <div
                key={entry.position}
                className="sprite-overlay-item"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
                onClick={() =>
                  setActiveSpritePosition(
                    activeSpritePosition === entry.position ? null : entry.position,
                  )
                }
              >
                <img
                  className="sprite-overlay-img"
                  src={`/sprites/${entry.pokemonId}.png`}
                  alt={entry.name ?? ""}
                />
                {entry.name && (
                  <span className="sprite-overlay-name">{entry.name}</span>
                )}
                {activeSpritePosition === entry.position && (
                  <PokemonIconCandidateSelector
                    candidates={entry.candidates}
                    onSelect={(id, name) =>
                      handleSpriteSelect(entry.position, id, name)
                    }
                    onClose={() => setActiveSpritePosition(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {showBattleInfo && <BattleInfoOverlay currentScene={currentScene} />}
      {paused && pauseReason && (
        <PauseBanner reason={pauseReason} onResume={onResume} />
      )}
      <RegistrationOverlay />
    </main>
  );
});
