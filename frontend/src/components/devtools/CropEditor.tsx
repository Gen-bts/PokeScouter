import { useCallback, useEffect, useRef, useState } from "react";
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
  type SessionMetadata,
  type FrameInfo,
  type RegionDef,
  type DetectionRegionDef,
  type PokemonIconDef,
  type SceneMeta,
  type SceneConfig,
} from "../../api/devtools";

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

type CropType = "regions" | "detection" | "pokemon_icons";
type InteractionMode = "draw" | "move" | "resize";
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

  // --- 微調整用 State ---
  const [selectedCropName, setSelectedCropName] = useState<string | null>(null);
  const [editRect, setEditRect] = useState<Rect | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("draw");
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [step, setStep] = useState(1);
  const [editReadOnce, setEditReadOnce] = useState(false);

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
  }, [scene, cropType]);

  // 現在のシーンのクロップ一覧
  const currentScene = sceneConfigs[scene];
  const currentRegions = currentScene?.regions || {};
  const currentDetection = currentScene?.detection || {};
  const rawPokemonIcons = currentScene?.pokemon_icons || {};
  const currentPokemonIcons = Object.fromEntries(
    Object.entries(rawPokemonIcons).filter(([k]) => !k.startsWith("_")),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentCrops: Record<string, any> =
    cropType === "regions"
      ? currentRegions
      : cropType === "detection"
        ? currentDetection
        : currentPokemonIcons;
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
    },
    [currentCrops, colors, drawnRect, selectedCropName, editRect],
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

  // キーボード: 矢印キーで選択クロップを移動
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedCropName || !editRect) return;
      const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!arrowKeys.includes(e.key)) return;
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
  }, [selectedCropName, editRect, step]);

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
        <div className="region-list">
          {Object.keys(currentCrops).length === 0 && (
            <p className="placeholder">クロップなし</p>
          )}
          {Object.entries(currentCrops).map(([name, r], i) => (
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
              <div className="region-details">
                <div className="region-name">{name}</div>
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
          ))}
        </div>
      </div>
    </div>
  );
}
