import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listSessions,
  listFrames,
  frameUrl,
  getRegions,
  getScenes,
  upsertRegion,
  deleteRegion,
  upsertDetectionRegion,
  deleteDetectionRegion,
  upsertPokemonIcon,
  deletePokemonIcon,
  createRegionGroup,
  deleteRegionGroup,
  upsertGroupTemplate,
  deleteGroupTemplate,
  upsertGroupSlot,
  deleteGroupSlot,
  runPokemonTest,
  type SessionMetadata,
  type FrameInfo,
  type RegionDef,
  type DetectionRegionDef,
  type PokemonIconDef,
  type SceneMeta,
  type SceneConfig,
  type RegionGroup,
  type RegionGroupTemplateEntry,
  type PokemonTestResult,
} from "../../api/devtools";
import { PokemonIconCandidateSelector } from "./PokemonIconCandidateSelector";

interface Props {
  initialSessionId?: string;
  initialFrame?: FrameInfo;
}

interface DrawingRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CropType = "regions" | "detection" | "pokemon_icons" | "region_groups";
type InteractionMode = "draw" | "move" | "resize";
type GroupEditMode = "template" | "slots" | "preview";
type ResizeHandle = "nw" | "ne" | "sw" | "se";

const HANDLE_SIZE = 10;
const HANDLE_HIT = 16;

const REGION_COLORS = [
  "#e94560",
  "#4ecca3",
  "#f0c040",
  "#60a0f0",
  "#c060f0",
  "#f09060",
  "#60f0c0",
  "#f060a0",
];

const DETECTION_COLORS = [
  "#ff6b6b",
  "#ffd93d",
  "#6bcb77",
  "#4d96ff",
];

const POKEMON_ICON_COLORS = [
  "#ff9f43",
  "#feca57",
  "#ee5a24",
  "#f8b739",
  "#e17055",
  "#fdcb6e",
];

const SLOT_COLORS = [
  "#e94560",
  "#4ecca3",
  "#4d96ff",
  "#f0c040",
  "#c060f0",
  "#f09060",
];

function clampRect(r: Rect): Rect {
  const w = Math.max(5, Math.min(r.w, 1920));
  const h = Math.max(5, Math.min(r.h, 1080));
  const x = Math.max(0, Math.min(r.x, 1920 - w));
  const y = Math.max(0, Math.min(r.y, 1080 - h));
  return { x, y, w, h };
}

function hitTestHandle(
  mx: number,
  my: number,
  rect: Rect,
): ResizeHandle | null {
  const corners: { handle: ResizeHandle; cx: number; cy: number }[] = [
    { handle: "nw", cx: rect.x, cy: rect.y },
    { handle: "ne", cx: rect.x + rect.w, cy: rect.y },
    { handle: "sw", cx: rect.x, cy: rect.y + rect.h },
    { handle: "se", cx: rect.x + rect.w, cy: rect.y + rect.h },
  ];
  for (const c of corners) {
    if (Math.abs(mx - c.cx) <= HANDLE_HIT && Math.abs(my - c.cy) <= HANDLE_HIT) {
      return c.handle;
    }
  }
  return null;
}

function hitTestRect(mx: number, my: number, rect: Rect): boolean {
  return (
    mx >= rect.x && mx <= rect.x + rect.w &&
    my >= rect.y && my <= rect.y + rect.h
  );
}

function cursorForHandle(handle: ResizeHandle): string {
  switch (handle) {
    case "nw": return "nwse-resize";
    case "se": return "nwse-resize";
    case "ne": return "nesw-resize";
    case "sw": return "nesw-resize";
  }
}

export function CropEditor({ initialSessionId, initialFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSession, setSelectedSession] = useState(
    initialSessionId || "",
  );
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<FrameInfo | null>(
    initialFrame || null,
  );

  // シーン（動的）
  const [scenesMap, setScenesMap] = useState<Record<string, SceneMeta>>({});
  const [sceneConfigs, setSceneConfigs] = useState<
    Record<string, SceneConfig>
  >({});
  const [scene, setScene] = useState("");
  const [cropType, setCropType] = useState<CropType>("regions");

  const [drawing, setDrawing] = useState<DrawingRect | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // 新規リージョン入力
  const [newName, setNewName] = useState("");
  const [newEngine, setNewEngine] = useState("paddle");
  // 検出クロップ用
  const [newMethod, setNewMethod] = useState("template");
  const [newTemplate, setNewTemplate] = useState("");
  const [newThreshold, setNewThreshold] = useState(0.8);
  const [newExpectedText, setNewExpectedText] = useState("");
  const [newExcludedText, setNewExcludedText] = useState("");
  // read_once フラグ
  const [newReadOnce, setNewReadOnce] = useState(false);

  const [drawnRect, setDrawnRect] = useState<Rect | null>(null);

  // --- グループモード State ---
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupEditMode, setGroupEditMode] = useState<GroupEditMode>("template");
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [newSubType, setNewSubType] = useState<"region" | "pokemon_icon">("region");
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);
  const [newSlotName, setNewSlotName] = useState("");

  // --- 微調整用 State ---
  const [selectedCropName, setSelectedCropName] = useState<string | null>(null);
  const [editRect, setEditRect] = useState<Rect | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("draw");
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [step, setStep] = useState(1);
  const [editReadOnce, setEditReadOnce] = useState(false);

  // --- ポケモン検出プレビュー State ---
  const [pokemonTestResults, setPokemonTestResults] = useState<
    Record<string, PokemonTestResult>
  >({});
  const [testingCrops, setTestingCrops] = useState<Set<string>>(new Set());
  const [pokemonOverrides, setPokemonOverrides] = useState<
    Record<string, { pokemon_id: string; name: string }>
  >({});
  const [activeCandidateSelector, setActiveCandidateSelector] = useState<
    string | null
  >(null);
  const spriteImagesRef = useRef<Record<string, HTMLImageElement>>({});

  // 初期ロード
  useEffect(() => {
    listSessions().then(setSessions);
    loadRegions();
  }, []);

  const loadRegions = useCallback(async () => {
    const [regionsData, scenesData] = await Promise.all([
      getRegions(),
      getScenes(),
    ]);
    setScenesMap(scenesData);
    setSceneConfigs(regionsData.scenes || {});
    // 初期シーン選択
    const keys = Object.keys(scenesData);
    if (keys.length > 0 && !scene && keys[0]) {
      setScene(keys[0]);
    }
  }, [scene]);

  // セッション変更時
  useEffect(() => {
    if (!selectedSession) {
      setFrames([]);
      setSelectedFrame(null);
      return;
    }
    listFrames(selectedSession).then((list) => {
      setFrames(list);
      if (!selectedFrame && list.length > 0 && list[0]) {
        setSelectedFrame(list[0]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession]);

  // シーン・cropType 変更時に選択をクリア
  useEffect(() => {
    setSelectedCropName(null);
    setEditRect(null);
    setInteractionMode("draw");
    setSelectedGroup(null);
    setGroupEditMode("template");
    setEditingSlotIndex(null);
    setSelectedTemplateName(null);
  }, [scene, cropType]);

  // フレーム・シーン変更時にポケモンテスト結果をクリア
  useEffect(() => {
    setPokemonTestResults({});
    setPokemonOverrides({});
    setActiveCandidateSelector(null);
  }, [selectedFrame, scene]);

  // 現在のシーンのクロップ一覧
  const currentScene = sceneConfigs[scene];
  const currentRegions = currentScene?.regions || {};
  const currentDetection = currentScene?.detection || {};
  const rawPokemonIcons = currentScene?.pokemon_icons || {};
  const currentPokemonIcons = Object.fromEntries(
    Object.entries(rawPokemonIcons).filter(([k]) => !k.startsWith("_")),
  );
  const currentGroups = currentScene?.region_groups || {};
  const currentGroup: RegionGroup | null =
    selectedGroup && currentGroups[selectedGroup] ? currentGroups[selectedGroup]! : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentCrops: Record<string, any> =
    cropType === "regions"
      ? currentRegions
      : cropType === "detection"
        ? currentDetection
        : cropType === "pokemon_icons"
          ? currentPokemonIcons
          : {};
  const colors =
    cropType === "regions"
      ? REGION_COLORS
      : cropType === "detection"
        ? DETECTION_COLORS
        : POKEMON_ICON_COLORS;

  // 画像とリージョンの描画
  const redraw = useCallback(
    (drawingRect?: DrawingRect | null) => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, 1920, 1080);
      ctx.drawImage(img, 0, 0, 1920, 1080);

      // 既存クロップを描画
      const names = Object.keys(currentCrops);
      names.forEach((name, i) => {
        const r = currentCrops[name];
        if (!r) return;
        const isSelected = name === selectedCropName;
        const drawR = isSelected && editRect ? editRect : r;
        const color = colors[i % colors.length] ?? "#ffffff";

        if (isSelected) {
          // 選択中: 太い白破線 + 色付き塗りつぶし
          ctx.setLineDash([8, 4]);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3;
          ctx.strokeRect(drawR.x, drawR.y, drawR.w, drawR.h);
          ctx.setLineDash([]);

          // 内側に色枠
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.strokeRect(drawR.x + 3, drawR.y + 3, drawR.w - 6, drawR.h - 6);

          ctx.fillStyle = color;
          ctx.globalAlpha = 0.25;
          ctx.fillRect(drawR.x, drawR.y, drawR.w, drawR.h);
          ctx.globalAlpha = 1;

          // リサイズハンドル (四隅)
          const hs = HANDLE_SIZE;
          ctx.fillStyle = "#ffffff";
          const corners: [number, number][] = [
            [drawR.x - hs / 2, drawR.y - hs / 2],
            [drawR.x + drawR.w - hs / 2, drawR.y - hs / 2],
            [drawR.x - hs / 2, drawR.y + drawR.h - hs / 2],
            [drawR.x + drawR.w - hs / 2, drawR.y + drawR.h - hs / 2],
          ];
          for (const [cx, cy] of corners) {
            ctx.fillRect(cx, cy, hs, hs);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(cx, cy, hs, hs);
          }

          // ラベル
          ctx.font = "bold 16px sans-serif";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(name, drawR.x + 4, drawR.y - 8);

          // サイズ表示
          ctx.font = "14px monospace";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(
            `${drawR.x},${drawR.y} ${drawR.w}x${drawR.h}`,
            drawR.x + 4,
            drawR.y + drawR.h + 18,
          );
        } else {
          // 通常描画
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(drawR.x, drawR.y, drawR.w, drawR.h);

          ctx.fillStyle = color;
          ctx.globalAlpha = 0.15;
          ctx.fillRect(drawR.x, drawR.y, drawR.w, drawR.h);
          ctx.globalAlpha = 1;

          ctx.font = "16px sans-serif";
          ctx.fillStyle = color;
          ctx.fillText(name, drawR.x + 4, drawR.y - 4);
        }

        // ポケモンスプライトをクロップ左側に描画
        if (cropType === "pokemon_icons") {
          const override = pokemonOverrides[name];
          const testResult = pokemonTestResults[name];
          const pid = override
            ? override.pokemon_id
            : testResult?.result?.pokemon_id ?? null;
          if (pid) {
            const spriteImg = spriteImagesRef.current[pid];
            if (spriteImg) {
              const spriteSize = Math.min(drawR.h, 80);
              const sx = drawR.x - spriteSize - 8;
              const sy = drawR.y + (drawR.h - spriteSize) / 2;
              // 白背景
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(sx - 2, sy - 2, spriteSize + 4, spriteSize + 4);
              ctx.strokeStyle = "#cccccc";
              ctx.lineWidth = 1;
              ctx.strokeRect(sx - 2, sy - 2, spriteSize + 4, spriteSize + 4);
              ctx.drawImage(spriteImg, sx, sy, spriteSize, spriteSize);
            }
          }
        }
      });

      // 描画中の矩形
      if (drawingRect) {
        const x = Math.min(drawingRect.startX, drawingRect.endX);
        const y = Math.min(drawingRect.startY, drawingRect.endY);
        const w = Math.abs(drawingRect.endX - drawingRect.startX);
        const h = Math.abs(drawingRect.endY - drawingRect.startY);

        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        ctx.font = "14px monospace";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`${w} x ${h}`, x + 4, y + h + 18);
      }

      // 確定済み未保存の矩形
      if (drawnRect && !drawingRect) {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = 2;
        ctx.strokeRect(drawnRect.x, drawnRect.y, drawnRect.w, drawnRect.h);
        ctx.setLineDash([]);

        ctx.font = "14px monospace";
        ctx.fillStyle = "#00ff00";
        ctx.fillText(
          `${drawnRect.w} x ${drawnRect.h}`,
          drawnRect.x + 4,
          drawnRect.y + drawnRect.h + 18,
        );
      }

      // --- グループモード描画 ---
      if (cropType === "region_groups" && currentGroup) {
        const template = currentGroup.template;
        const slots = currentGroup.slots;
        const templateEntries = Object.entries(template);

        if (groupEditMode === "template" && slots.length > 0) {
          const anchor = slots[0]!;
          // アンカー位置にクロスヘア
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(anchor.x - 20, anchor.y);
          ctx.lineTo(anchor.x + 20, anchor.y);
          ctx.moveTo(anchor.x, anchor.y - 20);
          ctx.lineTo(anchor.x, anchor.y + 20);
          ctx.stroke();

          // テンプレートサブリージョンを描画
          templateEntries.forEach(([subName, sub], i) => {
            const absX = anchor.x + sub.dx;
            const absY = anchor.y + sub.dy;
            const isSelected = subName === selectedTemplateName;
            const drawX = isSelected && editRect ? editRect.x : absX;
            const drawY = isSelected && editRect ? editRect.y : absY;
            const drawW = isSelected && editRect ? editRect.w : sub.w;
            const drawH = isSelected && editRect ? editRect.h : sub.h;
            const color = REGION_COLORS[i % REGION_COLORS.length] ?? "#ffffff";

            if (isSelected) {
              ctx.setLineDash([8, 4]);
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 3;
              ctx.strokeRect(drawX, drawY, drawW, drawH);
              ctx.setLineDash([]);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.strokeRect(drawX + 3, drawY + 3, drawW - 6, drawH - 6);
              ctx.fillStyle = color;
              ctx.globalAlpha = 0.25;
              ctx.fillRect(drawX, drawY, drawW, drawH);
              ctx.globalAlpha = 1;
              // リサイズハンドル
              const hs = HANDLE_SIZE;
              ctx.fillStyle = "#ffffff";
              for (const [cx, cy] of [
                [drawX - hs / 2, drawY - hs / 2],
                [drawX + drawW - hs / 2, drawY - hs / 2],
                [drawX - hs / 2, drawY + drawH - hs / 2],
                [drawX + drawW - hs / 2, drawY + drawH - hs / 2],
              ] as [number, number][]) {
                ctx.fillRect(cx, cy, hs, hs);
              }
            } else {
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.strokeRect(drawX, drawY, drawW, drawH);
              ctx.fillStyle = color;
              ctx.globalAlpha = 0.15;
              ctx.fillRect(drawX, drawY, drawW, drawH);
              ctx.globalAlpha = 1;
            }

            ctx.font = "14px sans-serif";
            ctx.fillStyle = color;
            ctx.fillText(subName, drawX + 4, drawY - 4);
          });
        } else if (groupEditMode === "slots") {
          // 各スロットにアンカーマーカー + テンプレートゴースト
          slots.forEach((slot, si) => {
            const slotColor = SLOT_COLORS[si % SLOT_COLORS.length] ?? "#ffffff";
            const isSelected = si === editingSlotIndex;

            // アンカーマーカー
            const ax = isSelected && editRect ? editRect.x : slot.x;
            const ay = isSelected && editRect ? editRect.y : slot.y;
            ctx.fillStyle = slotColor;
            ctx.fillRect(ax - 6, ay - 6, 12, 12);
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = isSelected ? 3 : 1;
            ctx.strokeRect(ax - 6, ay - 6, 12, 12);

            // ラベル
            ctx.font = "bold 14px sans-serif";
            ctx.fillStyle = slotColor;
            ctx.fillText(slot.name, ax + 10, ay - 4);

            // テンプレートゴースト
            ctx.globalAlpha = isSelected ? 0.3 : 0.12;
            for (const [, sub] of templateEntries) {
              const rx = ax + sub.dx;
              const ry = ay + sub.dy;
              ctx.strokeStyle = slotColor;
              ctx.lineWidth = 1;
              ctx.strokeRect(rx, ry, sub.w, sub.h);
              ctx.fillStyle = slotColor;
              ctx.fillRect(rx, ry, sub.w, sub.h);
            }
            ctx.globalAlpha = 1;
          });
        } else if (groupEditMode === "preview") {
          // 全展開リージョンを色分け表示
          slots.forEach((slot, si) => {
            const slotColor = SLOT_COLORS[si % SLOT_COLORS.length] ?? "#ffffff";
            for (const [subName, sub] of templateEntries) {
              const rx = slot.x + sub.dx;
              const ry = slot.y + sub.dy;
              ctx.strokeStyle = slotColor;
              ctx.lineWidth = 2;
              ctx.strokeRect(rx, ry, sub.w, sub.h);
              ctx.fillStyle = slotColor;
              ctx.globalAlpha = 0.15;
              ctx.fillRect(rx, ry, sub.w, sub.h);
              ctx.globalAlpha = 1;

              ctx.font = "12px sans-serif";
              ctx.fillStyle = slotColor;
              ctx.fillText(`${slot.name}${subName}`, rx + 2, ry - 2);
            }
          });
        }
      }
    },
    [currentCrops, colors, drawnRect, selectedCropName, editRect,
     cropType, currentGroup, groupEditMode, selectedTemplateName, editingSlotIndex,
     pokemonTestResults, pokemonOverrides],
  );

  // 画像ロード時に再描画
  useEffect(() => {
    if (!selectedFrame || !selectedSession) return;

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      redraw();
    };
    img.src = frameUrl(selectedSession, selectedFrame.filename);
  }, [selectedFrame, selectedSession, redraw]);

  // マウスイベント (canvas 座標 → 1920x1080)
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = 1920 / rect.width;
      const scaleY = 1080 / rect.height;
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasCoords(e);

      // --- グループモード ---
      if (cropType === "region_groups" && currentGroup) {
        if (groupEditMode === "template" && currentGroup.slots.length > 0) {
          const anchor = currentGroup.slots[0]!;
          // 選択中テンプレートの操作
          if (selectedTemplateName && editRect) {
            const handle = hitTestHandle(x, y, editRect);
            if (handle) {
              setInteractionMode("resize");
              setResizeHandle(handle);
              return;
            }
            if (hitTestRect(x, y, editRect)) {
              setInteractionMode("move");
              setDragOffset({ dx: x - editRect.x, dy: y - editRect.y });
              return;
            }
            setSelectedTemplateName(null);
            setEditRect(null);
          }
          // テンプレートサブリージョンをクリックで選択
          for (const [subName, sub] of Object.entries(currentGroup.template)) {
            const rect = { x: anchor.x + sub.dx, y: anchor.y + sub.dy, w: sub.w, h: sub.h };
            if (hitTestRect(x, y, rect)) {
              setSelectedTemplateName(subName);
              setEditRect(rect);
              setDrawnRect(null);
              return;
            }
          }
          // 通常の描画（新規テンプレートサブリージョン）
          setDrawing({ startX: x, startY: y, endX: x, endY: y });
          setIsDrawing(true);
          setDrawnRect(null);
          return;
        }
        if (groupEditMode === "slots") {
          if (editingSlotIndex != null && editRect) {
            // 既に選択中のスロット → 移動
            if (hitTestRect(x, y, { x: editRect.x - 20, y: editRect.y - 20, w: 40, h: 40 })) {
              setInteractionMode("move");
              setDragOffset({ dx: x - editRect.x, dy: y - editRect.y });
              return;
            }
            // 選択解除
            setEditingSlotIndex(null);
            setEditRect(null);
          }
          // スロットアンカーをクリックで選択
          for (let i = 0; i < currentGroup.slots.length; i++) {
            const slot = currentGroup.slots[i]!;
            if (Math.abs(x - slot.x) < 20 && Math.abs(y - slot.y) < 20) {
              setEditingSlotIndex(i);
              setEditRect({ x: slot.x, y: slot.y, w: 0, h: 0 });
              return;
            }
          }
          return;
        }
        return; // preview mode: no interaction
      }

      // 選択中クロップがある場合: ハンドル or 移動 or 選択解除
      if (selectedCropName && editRect) {
        const handle = hitTestHandle(x, y, editRect);
        if (handle) {
          setInteractionMode("resize");
          setResizeHandle(handle);
          return;
        }
        if (hitTestRect(x, y, editRect)) {
          setInteractionMode("move");
          setDragOffset({ dx: x - editRect.x, dy: y - editRect.y });
          return;
        }
        // クロップ外クリック → 選択解除、描画モードへ
        setSelectedCropName(null);
        setEditRect(null);
        setInteractionMode("draw");
      }

      // 通常の描画
      setDrawing({ startX: x, startY: y, endX: x, endY: y });
      setIsDrawing(true);
      setDrawnRect(null);
    },
    [getCanvasCoords, selectedCropName, editRect],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasCoords(e);
      const canvas = canvasRef.current;

      // --- グループスロット移動 ---
      if (cropType === "region_groups" && groupEditMode === "slots"
          && interactionMode === "move" && editRect && dragOffset) {
        setEditRect({ x: x - dragOffset.dx, y: y - dragOffset.dy, w: 0, h: 0 });
        redraw();
        return;
      }

      // --- move モード ---
      if (interactionMode === "move" && editRect && dragOffset) {
        const updated = clampRect({
          ...editRect,
          x: x - dragOffset.dx,
          y: y - dragOffset.dy,
        });
        setEditRect(updated);
        redraw();
        return;
      }

      // --- resize モード ---
      if (interactionMode === "resize" && editRect && resizeHandle) {
        let newRect: Rect;
        switch (resizeHandle) {
          case "nw": {
            const right = editRect.x + editRect.w;
            const bottom = editRect.y + editRect.h;
            newRect = { x, y, w: right - x, h: bottom - y };
            break;
          }
          case "ne": {
            const bottom = editRect.y + editRect.h;
            newRect = { x: editRect.x, y, w: x - editRect.x, h: bottom - y };
            break;
          }
          case "sw": {
            const right = editRect.x + editRect.w;
            newRect = { x, y: editRect.y, w: right - x, h: y - editRect.y };
            break;
          }
          case "se":
            newRect = { x: editRect.x, y: editRect.y, w: x - editRect.x, h: y - editRect.y };
            break;
        }
        setEditRect(clampRect(newRect));
        redraw();
        return;
      }

      // --- 描画モード ---
      if (isDrawing && drawing) {
        const updated = { ...drawing, endX: x, endY: y };
        setDrawing(updated);
        redraw(updated);
        return;
      }

      // --- ホバー時カーソル更新 ---
      if (canvas && selectedCropName && editRect) {
        const handle = hitTestHandle(x, y, editRect);
        if (handle) {
          canvas.style.cursor = cursorForHandle(handle);
        } else if (hitTestRect(x, y, editRect)) {
          canvas.style.cursor = "move";
        } else {
          canvas.style.cursor = "crosshair";
        }
      } else if (canvas) {
        canvas.style.cursor = "crosshair";
      }
    },
    [
      getCanvasCoords, interactionMode, editRect, dragOffset,
      resizeHandle, isDrawing, drawing, selectedCropName, redraw,
    ],
  );

  const handleMouseUp = useCallback(() => {
    // グループスロット移動完了
    if (cropType === "region_groups" && groupEditMode === "slots"
        && interactionMode === "move" && editingSlotIndex != null && editRect && selectedGroup) {
      const slot = currentGroup?.slots[editingSlotIndex];
      if (slot) {
        upsertGroupSlot(scene, selectedGroup, {
          name: slot.name,
          x: Math.round(editRect.x),
          y: Math.round(editRect.y),
        }).then((updated) => setSceneConfigs(updated.scenes || {}));
      }
      setInteractionMode("draw");
      setDragOffset(null);
      return;
    }

    // move / resize 完了
    if (interactionMode === "move" || interactionMode === "resize") {
      setInteractionMode("draw");
      setDragOffset(null);
      setResizeHandle(null);
      return;
    }

    // 描画完了
    if (!isDrawing || !drawing) return;
    setIsDrawing(false);

    const x = Math.min(drawing.startX, drawing.endX);
    const y = Math.min(drawing.startY, drawing.endY);
    const w = Math.abs(drawing.endX - drawing.startX);
    const h = Math.abs(drawing.endY - drawing.startY);

    if (w > 5 && h > 5) {
      setDrawnRect({ x, y, w, h });
      // 新規描画時は選択を解除
      setSelectedCropName(null);
      setEditRect(null);
    }

    setDrawing(null);
    redraw();
  }, [isDrawing, drawing, redraw, interactionMode]);

  // キーボード: 矢印キーで選択クロップ/スロット/テンプレートを移動
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!arrowKeys.includes(e.key)) return;

      // グループモード: テンプレートサブリージョン移動
      if (cropType === "region_groups" && groupEditMode === "template" && selectedTemplateName && editRect) {
        e.preventDefault();
        let { x, y } = editRect;
        switch (e.key) {
          case "ArrowUp": y -= step; break;
          case "ArrowDown": y += step; break;
          case "ArrowLeft": x -= step; break;
          case "ArrowRight": x += step; break;
        }
        setEditRect({ x, y, w: editRect.w, h: editRect.h });
        return;
      }

      // グループモード: スロットアンカー移動
      if (cropType === "region_groups" && groupEditMode === "slots" && editingSlotIndex != null && editRect) {
        e.preventDefault();
        let { x, y } = editRect;
        switch (e.key) {
          case "ArrowUp": y -= step; break;
          case "ArrowDown": y += step; break;
          case "ArrowLeft": x -= step; break;
          case "ArrowRight": x += step; break;
        }
        setEditRect({ x, y, w: 0, h: 0 });
        return;
      }

      // 通常モード
      if (!selectedCropName || !editRect) return;
      e.preventDefault();
      let { x, y } = editRect;
      switch (e.key) {
        case "ArrowUp": y -= step; break;
        case "ArrowDown": y += step; break;
        case "ArrowLeft": x -= step; break;
        case "ArrowRight": x += step; break;
      }
      setEditRect(clampRect({ x, y, w: editRect.w, h: editRect.h }));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCropName, editRect, step, cropType, groupEditMode, selectedTemplateName, editingSlotIndex]);

  // editRect 変更時に再描画
  useEffect(() => {
    redraw();
  }, [editRect, redraw]);

  // リージョン保存（新規）
  const handleSave = useCallback(async () => {
    if (!drawnRect || !newName.trim() || !scene) return;

    if (cropType === "regions") {
      const updated = await upsertRegion(scene, newName.trim(), {
        ...drawnRect,
        engine: newEngine,
        ...(newReadOnce ? { read_once: true } : {}),
      });
      setSceneConfigs(updated.scenes || {});
    } else if (cropType === "detection") {
      const params: Record<string, unknown> = {};
      if (newMethod === "template") {
        if (newTemplate) params.template = newTemplate;
        params.threshold = newThreshold;
      } else if (newMethod === "ocr") {
        params.engine = newEngine;
        if (newExpectedText) {
          const texts = newExpectedText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          params.expected_text = texts.length === 1 ? texts[0] : texts;
        }
        if (newExcludedText) {
          const texts = newExcludedText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          params.excluded_text = texts.length === 1 ? texts[0] : texts;
        }
      }
      const updated = await upsertDetectionRegion(scene, newName.trim(), {
        ...drawnRect,
        method: newMethod,
        ...params,
      });
      setSceneConfigs(updated.scenes || {});
    } else {
      const updated = await upsertPokemonIcon(scene, newName.trim(), {
        ...drawnRect,
        ...(newReadOnce ? { read_once: true } : {}),
      });
      setSceneConfigs(updated.scenes || {});
    }
    setDrawnRect(null);
    setNewName("");
    setNewReadOnce(false);
  }, [
    drawnRect,
    newName,
    newEngine,
    newReadOnce,
    newMethod,
    newTemplate,
    newThreshold,
    newExpectedText,
    newExcludedText,
    scene,
    cropType,
  ]);

  // 微調整保存
  const handleSaveEdit = useCallback(async () => {
    if (!editRect || !selectedCropName || !scene) return;
    const existing = currentCrops[selectedCropName];
    if (!existing) return;

    if (cropType === "regions") {
      const regionDef = existing as RegionDef;
      const updated = await upsertRegion(scene, selectedCropName, {
        ...editRect,
        engine: regionDef.engine,
        ...(editReadOnce ? { read_once: true } : {}),
      });
      setSceneConfigs(updated.scenes || {});
    } else if (cropType === "detection") {
      const detDef = existing as DetectionRegionDef;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { x: _x, y: _y, w: _w, h: _h, ...rest } = detDef;
      const updated = await upsertDetectionRegion(scene, selectedCropName, {
        ...editRect,
        ...rest,
      });
      setSceneConfigs(updated.scenes || {});
    } else {
      const updated = await upsertPokemonIcon(scene, selectedCropName, {
        ...editRect,
        ...(editReadOnce ? { read_once: true } : {}),
      });
      setSceneConfigs(updated.scenes || {});
    }
    setSelectedCropName(null);
    setEditRect(null);
  }, [editRect, selectedCropName, scene, cropType, currentCrops, editReadOnce]);

  // クロップ削除
  const handleDeleteCrop = useCallback(
    async (name: string) => {
      if (!scene) return;
      const updated =
        cropType === "regions"
          ? await deleteRegion(scene, name)
          : cropType === "detection"
            ? await deleteDetectionRegion(scene, name)
            : await deletePokemonIcon(scene, name);
      setSceneConfigs(updated.scenes || {});
      if (selectedCropName === name) {
        setSelectedCropName(null);
        setEditRect(null);
      }
    },
    [scene, cropType, selectedCropName],
  );

  // サイドバーでクロップ選択
  const handleSelectCrop = useCallback(
    (name: string) => {
      if (selectedCropName === name) {
        // 再クリックで選択解除
        setSelectedCropName(null);
        setEditRect(null);
      } else {
        const r = currentCrops[name];
        if (!r) return;
        setSelectedCropName(name);
        setEditRect({ x: r.x, y: r.y, w: r.w, h: r.h });
        if (cropType === "regions" || cropType === "pokemon_icons") {
          setEditReadOnce(!!(r as RegionDef).read_once);
        }
        setDrawnRect(null); // 新規描画をクリア
      }
    },
    [selectedCropName, currentCrops],
  );

  // editRect の個別フィールド更新
  const updateEditField = useCallback(
    (field: keyof Rect, value: number) => {
      if (!editRect) return;
      setEditRect(clampRect({ ...editRect, [field]: value }));
    },
    [editRect],
  );

  // --- グループ操作ハンドラ ---
  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim() || !scene) return;
    const updated = await createRegionGroup(scene, newGroupName.trim());
    setSceneConfigs(updated.scenes || {});
    setSelectedGroup(newGroupName.trim());
    setNewGroupName("");
  }, [newGroupName, scene]);

  const handleDeleteGroup = useCallback(async () => {
    if (!selectedGroup || !scene) return;
    const updated = await deleteRegionGroup(scene, selectedGroup);
    setSceneConfigs(updated.scenes || {});
    setSelectedGroup(null);
  }, [selectedGroup, scene]);

  const handleSaveTemplate = useCallback(async () => {
    if (!drawnRect || !newSubName.trim() || !selectedGroup || !scene) return;
    const anchor = currentGroup?.slots[0];
    if (!anchor) return;
    const entry: RegionGroupTemplateEntry = {
      dx: drawnRect.x - anchor.x,
      dy: drawnRect.y - anchor.y,
      w: drawnRect.w,
      h: drawnRect.h,
      type: newSubType,
      ...(newSubType === "region" ? { engine: newEngine } : {}),
      ...(newReadOnce ? { read_once: true } : {}),
    };
    const updated = await upsertGroupTemplate(scene, selectedGroup, newSubName.trim(), entry);
    setSceneConfigs(updated.scenes || {});
    setDrawnRect(null);
    setNewSubName("");
    setNewReadOnce(false);
  }, [drawnRect, newSubName, newSubType, newEngine, newReadOnce, selectedGroup, scene, currentGroup]);

  const handleSaveTemplateEdit = useCallback(async () => {
    if (!selectedTemplateName || !editRect || !selectedGroup || !scene || !currentGroup) return;
    const anchor = currentGroup.slots[0];
    if (!anchor) return;
    const existing = currentGroup.template[selectedTemplateName];
    if (!existing) return;
    const entry: RegionGroupTemplateEntry = {
      dx: editRect.x - anchor.x,
      dy: editRect.y - anchor.y,
      w: editRect.w,
      h: editRect.h,
      type: existing.type,
      ...(existing.type === "region" ? { engine: existing.engine } : {}),
      ...(editReadOnce ? { read_once: true } : {}),
    };
    const updated = await upsertGroupTemplate(scene, selectedGroup, selectedTemplateName, entry);
    setSceneConfigs(updated.scenes || {});
    setSelectedTemplateName(null);
    setEditRect(null);
  }, [selectedTemplateName, editRect, selectedGroup, scene, currentGroup, editReadOnce]);

  const handleDeleteTemplate = useCallback(async (subName: string) => {
    if (!selectedGroup || !scene) return;
    const updated = await deleteGroupTemplate(scene, selectedGroup, subName);
    setSceneConfigs(updated.scenes || {});
    if (selectedTemplateName === subName) {
      setSelectedTemplateName(null);
      setEditRect(null);
    }
  }, [selectedGroup, scene, selectedTemplateName]);

  const handleSaveSlotEdit = useCallback(async () => {
    if (editingSlotIndex == null || !editRect || !selectedGroup || !scene || !currentGroup) return;
    const slot = currentGroup.slots[editingSlotIndex];
    if (!slot) return;
    const updated = await upsertGroupSlot(scene, selectedGroup, {
      name: slot.name,
      x: Math.round(editRect.x),
      y: Math.round(editRect.y),
    });
    setSceneConfigs(updated.scenes || {});
    setEditingSlotIndex(null);
    setEditRect(null);
  }, [editingSlotIndex, editRect, selectedGroup, scene, currentGroup]);

  const handleAddSlot = useCallback(async () => {
    if (!newSlotName.trim() || !selectedGroup || !scene) return;
    const updated = await upsertGroupSlot(scene, selectedGroup, {
      name: newSlotName.trim(),
      x: 100,
      y: 100,
    });
    setSceneConfigs(updated.scenes || {});
    setNewSlotName("");
  }, [newSlotName, selectedGroup, scene]);

  const handleDeleteSlot = useCallback(async (slotName: string) => {
    if (!selectedGroup || !scene) return;
    const updated = await deleteGroupSlot(scene, selectedGroup, slotName);
    setSceneConfigs(updated.scenes || {});
    if (editingSlotIndex != null && currentGroup?.slots[editingSlotIndex]?.name === slotName) {
      setEditingSlotIndex(null);
      setEditRect(null);
    }
  }, [selectedGroup, scene, editingSlotIndex, currentGroup]);

  const sceneKeys = Object.keys(scenesMap);

  // 編集中かどうか（editRect が保存値と異なるか）
  const hasChanges = (() => {
    if (!selectedCropName || !editRect) return false;
    const saved = currentCrops[selectedCropName];
    if (!saved) return false;
    const coordChanged =
      saved.x !== editRect.x ||
      saved.y !== editRect.y ||
      saved.w !== editRect.w ||
      saved.h !== editRect.h;
    if (cropType === "regions" || cropType === "pokemon_icons") {
      return coordChanged || !!(saved as RegionDef).read_once !== editReadOnce;
    }
    return coordChanged;
  })();

  // --- ポケモン検出テスト ---
  const getDisplayedPokemon = useCallback(
    (
      cropName: string,
    ): {
      pokemonId: string | null;
      name: string | null;
      confidence: number | null;
    } => {
      const override = pokemonOverrides[cropName];
      if (override) {
        return { pokemonId: override.pokemon_id, name: override.name, confidence: null };
      }
      const result = pokemonTestResults[cropName];
      if (result?.result) {
        const top = result.candidates.find(
          (c) => c.pokemon_id === result.result!.pokemon_id,
        );
        return {
          pokemonId: result.result.pokemon_id,
          name: top?.name ?? null,
          confidence: result.result.confidence,
        };
      }
      return { pokemonId: null, name: null, confidence: null };
    },
    [pokemonOverrides, pokemonTestResults],
  );

  const runSinglePokemonTest = useCallback(
    async (cropName: string) => {
      if (!selectedSession || !selectedFrame) return;
      const crop = currentPokemonIcons[cropName];
      if (!crop) return;

      setTestingCrops((prev) => new Set(prev).add(cropName));
      try {
        const result = await runPokemonTest(selectedSession, selectedFrame.filename, {
          x: crop.x,
          y: crop.y,
          w: crop.w,
          h: crop.h,
        });
        setPokemonTestResults((prev) => ({ ...prev, [cropName]: result }));
      } catch (err) {
        console.error(`Pokemon test failed for ${cropName}:`, err);
      } finally {
        setTestingCrops((prev) => {
          const next = new Set(prev);
          next.delete(cropName);
          return next;
        });
      }
    },
    [selectedSession, selectedFrame, currentPokemonIcons],
  );

  const runAllPokemonTests = useCallback(async () => {
    const names = Object.keys(currentPokemonIcons);
    if (names.length === 0 || !selectedSession || !selectedFrame) return;
    setPokemonTestResults({});
    setPokemonOverrides({});
    await Promise.all(names.map((n) => runSinglePokemonTest(n)));
  }, [currentPokemonIcons, selectedSession, selectedFrame, runSinglePokemonTest]);

  // スプライト画像プリロード（Canvas描画用）
  const displayedPokemonMap = useMemo(() => {
    if (cropType !== "pokemon_icons") return {};
    const map: Record<string, { pokemonId: string | null; name: string | null }> = {};
    for (const name of Object.keys(currentPokemonIcons)) {
      const d = getDisplayedPokemon(name);
      map[name] = d;
    }
    return map;
  }, [cropType, currentPokemonIcons, getDisplayedPokemon]);

  useEffect(() => {
    if (cropType !== "pokemon_icons") return;
    let needsRedraw = false;
    for (const d of Object.values(displayedPokemonMap)) {
      if (d.pokemonId && !spriteImagesRef.current[d.pokemonId]) {
        const id = d.pokemonId;
        const img = new Image();
        img.onload = () => {
          spriteImagesRef.current[id] = img;
          redraw();
        };
        img.src = `/sprites/${id}.png`;
        needsRedraw = true;
      }
    }
    if (!needsRedraw) redraw();
  }, [cropType, displayedPokemonMap, redraw]);

  return (
    <div className="devtools-panel crop-editor-layout">
      <div className="crop-editor-main">
        <h2>クロップ編集</h2>

        <div className="crop-editor-toolbar">
          <div>
            <label htmlFor="crop-session">セッション</label>
            <select
              id="crop-session"
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
            >
              <option value="">-- 選択 --</option>
              {sessions
                .filter((s) => s.status === "completed")
                .map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.session_id} ({s.frame_count}フレーム)
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="crop-frame">フレーム</label>
            <select
              id="crop-frame"
              value={selectedFrame?.filename || ""}
              onChange={(e) => {
                const f = frames.find((fr) => fr.filename === e.target.value);
                if (f) setSelectedFrame(f);
              }}
            >
              {frames.map((f) => (
                <option key={f.filename} value={f.filename}>
                  #{f.index}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="crop-scene">シーン</label>
            <div className="scene-selector-row">
              <select
                id="crop-scene"
                value={scene}
                onChange={(e) => setScene(e.target.value)}
              >
                {sceneKeys.map((key) => (
                  <option key={key} value={key}>
                    {scenesMap[key]?.display_name || key}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label>クロップ種別</label>
            <div className="crop-type-toggle">
              <button
                className={cropType === "regions" ? "active" : ""}
                onClick={() => setCropType("regions")}
              >
                読取クロップ
              </button>
              <button
                className={cropType === "detection" ? "active" : ""}
                onClick={() => setCropType("detection")}
              >
                検出クロップ
              </button>
              <button
                className={cropType === "pokemon_icons" ? "active" : ""}
                onClick={() => setCropType("pokemon_icons")}
              >
                ポケモン画像
              </button>
              <button
                className={cropType === "region_groups" ? "active" : ""}
                onClick={() => setCropType("region_groups")}
              >
                グループ
              </button>
            </div>
          </div>
        </div>

        <div className="crop-editor-canvas-container">
          <canvas
            ref={canvasRef}
            width={1920}
            height={1080}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>
      </div>

      <div className="crop-editor-sidebar">
        {/* === グループモード === */}
        {cropType === "region_groups" && (
          <>
            {/* グループ選択 */}
            <div className="group-selector">
              <h3>リージョングループ</h3>
              <select
                value={selectedGroup || ""}
                onChange={(e) => {
                  setSelectedGroup(e.target.value || null);
                  setGroupEditMode("template");
                  setSelectedTemplateName(null);
                  setEditingSlotIndex(null);
                  setEditRect(null);
                  setDrawnRect(null);
                }}
              >
                <option value="">-- 選択 --</option>
                {Object.keys(currentGroups).map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <div className="group-actions">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="新規グループ名"
                />
                <button className="btn-save" onClick={handleCreateGroup} disabled={!newGroupName.trim()}>
                  作成
                </button>
                {selectedGroup && (
                  <button className="btn-delete" onClick={handleDeleteGroup} title="グループ削除">
                    ×
                  </button>
                )}
              </div>
            </div>

            {selectedGroup && currentGroup && (
              <>
                {/* サブモード切替 */}
                <div className="group-mode-toggle">
                  <button
                    className={groupEditMode === "template" ? "active" : ""}
                    onClick={() => { setGroupEditMode("template"); setEditingSlotIndex(null); setEditRect(null); }}
                  >
                    テンプレート
                  </button>
                  <button
                    className={groupEditMode === "slots" ? "active" : ""}
                    onClick={() => { setGroupEditMode("slots"); setSelectedTemplateName(null); setEditRect(null); setDrawnRect(null); }}
                  >
                    スロット
                  </button>
                  <button
                    className={groupEditMode === "preview" ? "active" : ""}
                    onClick={() => { setGroupEditMode("preview"); setSelectedTemplateName(null); setEditingSlotIndex(null); setEditRect(null); }}
                  >
                    プレビュー
                  </button>
                </div>

                {/* テンプレート編集モード */}
                {groupEditMode === "template" && (
                  <>
                    {/* 選択中テンプレートの微調整 */}
                    {selectedTemplateName && editRect && currentGroup.slots.length > 0 && (
                      <div className="edit-region-form">
                        <h3>テンプレート微調整: {selectedTemplateName}</h3>
                        <div className="step-size-selector">
                          <span>ステップ:</span>
                          {[1, 5, 10].map((s) => (
                            <button key={s} className={step === s ? "active" : ""} onClick={() => setStep(s)}>
                              {s}px
                            </button>
                          ))}
                        </div>
                        {(["x", "y", "w", "h"] as const).map((field) => (
                          <div className="coord-adjust-row" key={field}>
                            <label>{field === "x" ? "dx" : field === "y" ? "dy" : field.toUpperCase()}</label>
                            <button onClick={() => updateEditField(field, editRect[field] - step)}>-</button>
                            <input
                              type="number"
                              value={field === "x" || field === "y"
                                ? editRect[field] - currentGroup.slots[0]![field === "x" ? "x" : "y"]
                                : editRect[field]}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                if (field === "x" || field === "y") {
                                  const anchorVal = currentGroup.slots[0]![field === "x" ? "x" : "y"];
                                  updateEditField(field, val + anchorVal);
                                } else {
                                  updateEditField(field, val);
                                }
                              }}
                            />
                            <button onClick={() => updateEditField(field, editRect[field] + step)}>+</button>
                          </div>
                        ))}
                        <label className="read-once-label">
                          <input type="checkbox" checked={editReadOnce} onChange={(e) => setEditReadOnce(e.target.checked)} />
                          1度のみ読取
                        </label>
                        <div className="edit-actions">
                          <button className="btn-save" onClick={handleSaveTemplateEdit}>保存</button>
                          <button className="btn-cancel" onClick={() => { setSelectedTemplateName(null); setEditRect(null); }}>閉じる</button>
                        </div>
                      </div>
                    )}

                    {/* 新規テンプレート保存フォーム */}
                    {drawnRect && !selectedTemplateName && currentGroup.slots.length > 0 && (
                      <div className="new-region-form">
                        <h3>新規テンプレートサブリージョン</h3>
                        <div className="region-coords">
                          dx:{drawnRect.x - currentGroup.slots[0]!.x} dy:{drawnRect.y - currentGroup.slots[0]!.y} w:{drawnRect.w} h:{drawnRect.h}
                        </div>
                        <label>名前</label>
                        <input
                          type="text"
                          value={newSubName}
                          onChange={(e) => setNewSubName(e.target.value)}
                          placeholder="例: 名前"
                        />
                        <label>タイプ</label>
                        <select value={newSubType} onChange={(e) => setNewSubType(e.target.value as "region" | "pokemon_icon")}>
                          <option value="region">OCR読取 (region)</option>
                          <option value="pokemon_icon">画像認識 (pokemon_icon)</option>
                        </select>
                        {newSubType === "region" && (
                          <>
                            <label>エンジン</label>
                            <select value={newEngine} onChange={(e) => setNewEngine(e.target.value)}>
                              <option value="paddle">PaddleOCR</option>
                              <option value="manga">MangaOCR</option>
                              <option value="glm">GLM OCR</option>
                            </select>
                          </>
                        )}
                        <label className="read-once-label">
                          <input type="checkbox" checked={newReadOnce} onChange={(e) => setNewReadOnce(e.target.checked)} />
                          1度のみ読取
                        </label>
                        <button className="btn-save" onClick={handleSaveTemplate} disabled={!newSubName.trim()}>
                          保存
                        </button>
                      </div>
                    )}

                    {currentGroup.slots.length === 0 && (
                      <p className="placeholder">先にスロットモードでスロットを1つ以上追加してください</p>
                    )}

                    {/* テンプレートサブリージョン一覧 */}
                    <h3>テンプレート一覧</h3>
                    <div className="region-list">
                      {Object.keys(currentGroup.template).length === 0 && (
                        <p className="placeholder">テンプレートなし</p>
                      )}
                      {Object.entries(currentGroup.template).map(([subName, sub], i) => (
                        <div
                          className={`region-item ${selectedTemplateName === subName ? "region-item-selected" : ""}`}
                          key={subName}
                          onClick={() => {
                            if (currentGroup.slots.length === 0) return;
                            const anchor = currentGroup.slots[0]!;
                            if (selectedTemplateName === subName) {
                              setSelectedTemplateName(null);
                              setEditRect(null);
                            } else {
                              setSelectedTemplateName(subName);
                              setEditRect({ x: anchor.x + sub.dx, y: anchor.y + sub.dy, w: sub.w, h: sub.h });
                              setEditReadOnce(!!sub.read_once);
                              setDrawnRect(null);
                            }
                          }}
                        >
                          <div className="region-color" style={{ background: REGION_COLORS[i % REGION_COLORS.length] }} />
                          <div className="region-details">
                            <div className="region-name">{subName}</div>
                            <div className="region-coords">
                              dx:{sub.dx} dy:{sub.dy} {sub.w}x{sub.h} | {sub.type}
                              {sub.type === "region" ? ` | ${sub.engine ?? "paddle"}` : ""}
                              {sub.read_once ? " | 1回" : ""}
                            </div>
                          </div>
                          <button
                            className="btn-delete"
                            onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(subName); }}
                            title="削除"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* スロット配置モード */}
                {groupEditMode === "slots" && (
                  <>
                    {editingSlotIndex != null && editRect && (
                      <div className="edit-region-form">
                        <h3>スロット移動: {currentGroup.slots[editingSlotIndex]?.name}</h3>
                        <div className="step-size-selector">
                          <span>ステップ:</span>
                          {[1, 5, 10].map((s) => (
                            <button key={s} className={step === s ? "active" : ""} onClick={() => setStep(s)}>
                              {s}px
                            </button>
                          ))}
                        </div>
                        <div className="coord-adjust-row">
                          <label>X</label>
                          <button onClick={() => setEditRect({ ...editRect, x: editRect.x - step })}>-</button>
                          <input type="number" value={Math.round(editRect.x)} onChange={(e) => setEditRect({ ...editRect, x: Number(e.target.value) })} />
                          <button onClick={() => setEditRect({ ...editRect, x: editRect.x + step })}>+</button>
                        </div>
                        <div className="coord-adjust-row">
                          <label>Y</label>
                          <button onClick={() => setEditRect({ ...editRect, y: editRect.y - step })}>-</button>
                          <input type="number" value={Math.round(editRect.y)} onChange={(e) => setEditRect({ ...editRect, y: Number(e.target.value) })} />
                          <button onClick={() => setEditRect({ ...editRect, y: editRect.y + step })}>+</button>
                        </div>
                        <div className="edit-hint">
                          Canvas上でドラッグ移動・矢印キーで微調整できます。
                        </div>
                        <div className="edit-actions">
                          <button className="btn-save" onClick={handleSaveSlotEdit}>保存</button>
                          <button className="btn-cancel" onClick={() => { setEditingSlotIndex(null); setEditRect(null); }}>閉じる</button>
                        </div>
                      </div>
                    )}

                    <h3>スロット一覧 ({currentGroup.slots.length})</h3>
                    <div className="slot-add-form">
                      <input
                        type="text"
                        value={newSlotName}
                        onChange={(e) => setNewSlotName(e.target.value)}
                        placeholder="スロット名 (例: ポケモン２)"
                      />
                      <button className="btn-save" onClick={handleAddSlot} disabled={!newSlotName.trim()}>
                        追加
                      </button>
                    </div>
                    <div className="region-list">
                      {currentGroup.slots.map((slot, i) => (
                        <div
                          className={`region-item ${editingSlotIndex === i ? "region-item-selected" : ""}`}
                          key={slot.name}
                          onClick={() => {
                            if (editingSlotIndex === i) {
                              setEditingSlotIndex(null);
                              setEditRect(null);
                            } else {
                              setEditingSlotIndex(i);
                              setEditRect({ x: slot.x, y: slot.y, w: 0, h: 0 });
                            }
                          }}
                        >
                          <div className="region-color" style={{ background: SLOT_COLORS[i % SLOT_COLORS.length] }} />
                          <div className="region-details">
                            <div className="region-name">{slot.name}</div>
                            <div className="region-coords">x:{slot.x} y:{slot.y}</div>
                          </div>
                          <button
                            className="btn-delete"
                            onClick={(e) => { e.stopPropagation(); handleDeleteSlot(slot.name); }}
                            title="削除"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* プレビューモード */}
                {groupEditMode === "preview" && (
                  <>
                    <h3>展開プレビュー ({currentGroup.slots.length * Object.keys(currentGroup.template).length} リージョン)</h3>
                    <div className="region-list">
                      {currentGroup.slots.map((slot, si) => (
                        <div key={slot.name}>
                          <div className="slot-preview-header" style={{ color: SLOT_COLORS[si % SLOT_COLORS.length] }}>
                            {slot.name} ({slot.x}, {slot.y})
                          </div>
                          {Object.entries(currentGroup.template).map(([subName, sub]) => (
                            <div className="region-item" key={`${slot.name}${subName}`}>
                              <div className="region-color" style={{ background: SLOT_COLORS[si % SLOT_COLORS.length] }} />
                              <div className="region-details">
                                <div className="region-name">{slot.name}{subName}</div>
                                <div className="region-coords">
                                  {slot.x + sub.dx},{slot.y + sub.dy} {sub.w}x{sub.h}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* === 通常モード（regions / detection / pokemon_icons） === */}
        {cropType !== "region_groups" && <>
        {/* --- 微調整フォーム --- */}
        {selectedCropName && editRect && (
          <div className="edit-region-form">
            <h3>位置微調整: {selectedCropName}</h3>

            <div className="step-size-selector">
              <span>ステップ:</span>
              {[1, 5, 10].map((s) => (
                <button
                  key={s}
                  className={step === s ? "active" : ""}
                  onClick={() => setStep(s)}
                >
                  {s}px
                </button>
              ))}
            </div>

            {(["x", "y", "w", "h"] as const).map((field) => (
              <div className="coord-adjust-row" key={field}>
                <label>{field.toUpperCase()}</label>
                <button
                  onClick={() => updateEditField(field, editRect[field] - step)}
                >
                  -
                </button>
                <input
                  type="number"
                  value={editRect[field]}
                  onChange={(e) => updateEditField(field, Number(e.target.value))}
                  min={0}
                  max={field === "x" || field === "w" ? 1920 : 1080}
                />
                <button
                  onClick={() => updateEditField(field, editRect[field] + step)}
                >
                  +
                </button>
              </div>
            ))}

            {(cropType === "regions" || cropType === "pokemon_icons") && (
              <label className="read-once-label">
                <input
                  type="checkbox"
                  checked={editReadOnce}
                  onChange={(e) => setEditReadOnce(e.target.checked)}
                />
                1度のみ読取
              </label>
            )}

            <div className="edit-hint">
              Canvas上でドラッグ移動・四隅ハンドルでリサイズ可能。矢印キーでも移動できます。
            </div>

            <div className="edit-actions">
              <button
                className="btn-save"
                onClick={handleSaveEdit}
                disabled={!hasChanges}
              >
                保存
              </button>
              <button
                className="btn-reset"
                onClick={() => {
                  const saved = currentCrops[selectedCropName];
                  if (saved) {
                    setEditRect({ x: saved.x, y: saved.y, w: saved.w, h: saved.h });
                    if (cropType === "regions" || cropType === "pokemon_icons") {
                      setEditReadOnce(!!(saved as RegionDef).read_once);
                    }
                  }
                }}
                disabled={!hasChanges}
              >
                リセット
              </button>
              <button
                className="btn-cancel"
                onClick={() => {
                  setSelectedCropName(null);
                  setEditRect(null);
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        )}

        {/* --- 新規クロップフォーム --- */}
        {drawnRect && !selectedCropName && (
          <div className="new-region-form">
            <h3>
              {cropType === "regions"
                ? "新規読取クロップ"
                : cropType === "detection"
                  ? "新規検出クロップ"
                  : "新規ポケモンアイコン"}
            </h3>
            <div className="region-coords">
              x:{drawnRect.x} y:{drawnRect.y} w:{drawnRect.w} h:{drawnRect.h}
            </div>
            <label htmlFor="region-name">名前</label>
            <input
              type="text"
              id="region-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例: 相手HP"
            />

            {cropType === "regions" ? (
              <>
                <label htmlFor="region-engine">エンジン</label>
                <select
                  id="region-engine"
                  value={newEngine}
                  onChange={(e) => setNewEngine(e.target.value)}
                >
                  <option value="paddle">PaddleOCR</option>
                  <option value="manga">MangaOCR</option>
                  <option value="glm">GLM OCR</option>
                </select>
                <label className="read-once-label">
                  <input
                    type="checkbox"
                    checked={newReadOnce}
                    onChange={(e) => setNewReadOnce(e.target.checked)}
                  />
                  1度のみ読取
                </label>
              </>
            ) : cropType === "detection" ? (
              <>
                <label htmlFor="detection-method">検出方法</label>
                <select
                  id="detection-method"
                  value={newMethod}
                  onChange={(e) => setNewMethod(e.target.value)}
                >
                  <option value="template">テンプレートマッチング</option>
                  <option value="ocr">OCR</option>
                </select>

                {newMethod === "template" ? (
                  <>
                    <label htmlFor="detection-template">テンプレート画像</label>
                    <input
                      type="text"
                      id="detection-template"
                      value={newTemplate}
                      onChange={(e) => setNewTemplate(e.target.value)}
                      placeholder="例: battle_indicator.png"
                    />
                    <label htmlFor="detection-threshold">
                      閾値: {newThreshold}
                    </label>
                    <input
                      type="range"
                      id="detection-threshold"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={newThreshold}
                      onChange={(e) =>
                        setNewThreshold(Number(e.target.value))
                      }
                    />
                  </>
                ) : (
                  <>
                    <label htmlFor="detection-engine">エンジン</label>
                    <select
                      id="detection-engine"
                      value={newEngine}
                      onChange={(e) => setNewEngine(e.target.value)}
                    >
                      <option value="paddle">PaddleOCR</option>
                      <option value="manga">MangaOCR</option>
                      <option value="glm">GLM OCR</option>
                    </select>
                    <label htmlFor="detection-expected">
                      期待テキスト (1行に1つ、いずれかに一致で検出)
                    </label>
                    <textarea
                      id="detection-expected"
                      value={newExpectedText}
                      onChange={(e) => setNewExpectedText(e.target.value)}
                      placeholder={"たたかう\nタタカウ"}
                      rows={3}
                    />
                    <label htmlFor="detection-excluded">
                      除外テキスト (1行に1つ、いずれかが存在すると不検出)
                    </label>
                    <textarea
                      id="detection-excluded"
                      value={newExcludedText}
                      onChange={(e) => setNewExcludedText(e.target.value)}
                      placeholder={"シングル\nダブル"}
                      rows={3}
                    />
                  </>
                )}
              </>
            ) : cropType === "pokemon_icons" ? (
              <label className="read-once-label">
                <input
                  type="checkbox"
                  checked={newReadOnce}
                  onChange={(e) => setNewReadOnce(e.target.checked)}
                />
                1度のみ読取
              </label>
            ) : null}

            <button
              className="btn-save"
              onClick={handleSave}
              disabled={!newName.trim()}
            >
              保存
            </button>
          </div>
        )}

        <h3>
          {cropType === "regions"
            ? "読取クロップ一覧"
            : cropType === "detection"
              ? "検出クロップ一覧"
              : "ポケモンアイコン一覧"}
          {scene && ` (${scenesMap[scene]?.display_name || scene})`}
        </h3>

        {cropType === "pokemon_icons" &&
          selectedSession &&
          selectedFrame &&
          Object.keys(currentPokemonIcons).length > 0 && (
            <button
              className="btn-test-all"
              onClick={runAllPokemonTests}
              disabled={testingCrops.size > 0}
            >
              {testingCrops.size > 0 ? "テスト中..." : "全アイコンをテスト"}
            </button>
          )}

        <div className="region-list">
          {Object.keys(currentCrops).length === 0 && (
            <p className="placeholder">クロップなし</p>
          )}
          {Object.entries(currentCrops).map(([name, r], i) => {
            const displayed =
              cropType === "pokemon_icons"
                ? getDisplayedPokemon(name)
                : null;
            const isTesting = testingCrops.has(name);

            return (
              <div
                className={`region-item ${selectedCropName === name ? "region-item-selected" : ""}`}
                key={name}
                onClick={() => handleSelectCrop(name)}
              >
                <div
                  className="region-color"
                  style={{
                    background: colors[i % colors.length],
                  }}
                />

                {/* ポケモンスプライト（pokemon_icons モード） */}
                {cropType === "pokemon_icons" && (
                  <div
                    className={`region-pokemon-sprite${displayed?.pokemonId ? " has-result" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (displayed?.pokemonId || pokemonTestResults[name]) {
                        setActiveCandidateSelector(
                          activeCandidateSelector === name ? null : name,
                        );
                      }
                    }}
                    title={
                      displayed?.pokemonId
                        ? `${displayed.name ?? "?"} ${displayed.confidence != null ? `(${(displayed.confidence * 100).toFixed(0)}%)` : "(手動)"}`
                        : isTesting
                          ? "テスト中..."
                          : "未テスト"
                    }
                  >
                    {isTesting ? (
                      <div className="region-pokemon-loading">...</div>
                    ) : displayed?.pokemonId ? (
                      <img
                        src={`/sprites/${displayed.pokemonId}.png`}
                        alt={displayed.name ?? ""}
                        width={32}
                        height={32}
                        className="region-pokemon-img"
                      />
                    ) : pokemonTestResults[name] ? (
                      <div className="region-pokemon-unknown">?</div>
                    ) : (
                      <div className="region-pokemon-empty" />
                    )}

                    {/* 候補セレクタ */}
                    {activeCandidateSelector === name && (
                      <PokemonIconCandidateSelector
                        candidates={pokemonTestResults[name]?.candidates ?? []}
                        onSelect={(pokemonId, pokemonName) => {
                          setPokemonOverrides((prev) => ({
                            ...prev,
                            [name]: { pokemon_id: pokemonId, name: pokemonName },
                          }));
                          setActiveCandidateSelector(null);
                        }}
                        onClose={() => setActiveCandidateSelector(null)}
                      />
                    )}
                  </div>
                )}

                <div className="region-details">
                  <div className="region-name">
                    {name}
                    {cropType === "pokemon_icons" && displayed?.name && (
                      <span className="region-pokemon-name-tag">
                        {" "}
                        {displayed.name}
                        {displayed.confidence != null && (
                          <span className="region-pokemon-confidence">
                            {" "}
                            {(displayed.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="region-coords">
                    {r.x},{r.y} {r.w}x{r.h}
                    {cropType === "regions"
                      ? ` | ${(r as RegionDef).engine}${(r as RegionDef).read_once ? " | 1回" : ""}`
                      : cropType === "detection"
                        ? ` | ${(r as DetectionRegionDef).method}`
                        : cropType === "pokemon_icons" && (r as PokemonIconDef).read_once
                          ? " | 1回"
                          : ""}
                  </div>
                  {cropType === "detection" &&
                    (r as DetectionRegionDef).method === "ocr" &&
                    (r as Record<string, unknown>).expected_text != null && (
                      <div className="region-expected-text">
                        {Array.isArray(
                          (r as Record<string, unknown>).expected_text,
                        )
                          ? (
                              (r as Record<string, unknown>)
                                .expected_text as string[]
                            ).join(" | ")
                          : String(
                              (r as Record<string, unknown>).expected_text,
                            )}
                      </div>
                    )}
                  {cropType === "detection" &&
                    (r as DetectionRegionDef).method === "ocr" &&
                    (r as Record<string, unknown>).excluded_text != null && (
                      <div className="region-expected-text" style={{ color: "#e94560" }}>
                        {"! "}
                        {Array.isArray(
                          (r as Record<string, unknown>).excluded_text,
                        )
                          ? (
                              (r as Record<string, unknown>)
                                .excluded_text as string[]
                            ).join(" | ")
                          : String(
                              (r as Record<string, unknown>).excluded_text,
                            )}
                      </div>
                    )}
                </div>
                <button
                  className="btn-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCrop(name);
                  }}
                  title="削除"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        </>}
      </div>
    </div>
  );
}
