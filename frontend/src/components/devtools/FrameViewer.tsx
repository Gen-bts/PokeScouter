import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSessions,
  listFrames,
  frameUrl,
  runOcrTest,
  runPokemonTest,
  type SessionMetadata,
  type FrameInfo,
  type CropRect,
  type OcrTestResult,
  type PokemonTestResult,
} from "../../api/devtools";

type TestMode = "off" | "ocr" | "pokemon";

interface Props {
  onOpenInCropEditor?: (sessionId: string, frame: FrameInfo) => void;
}

export function FrameViewer({ onOpenInCropEditor }: Props) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSession, setSelectedSession] = useState("");
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<FrameInfo | null>(null);
  const [sliderIndex, setSliderIndex] = useState(0);

  // テストモード状態
  const [testMode, setTestMode] = useState<TestMode>("off");
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragEndRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedRect, setSelectedRect] = useState<CropRect | null>(null);
  const [ocrTestResult, setOcrTestResult] = useState<OcrTestResult | null>(null);
  const [pokemonTestResult, setPokemonTestResult] = useState<PokemonTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    listSessions().then(setSessions);
  }, []);

  // セッション選択時にフレーム一覧取得
  const handleSessionChange = useCallback(async (sessionId: string) => {
    setSelectedSession(sessionId);
    setSelectedFrame(null);
    setSliderIndex(0);
    if (!sessionId) {
      setFrames([]);
      return;
    }
    const list = await listFrames(sessionId);
    setFrames(list);
    if (list.length > 0) {
      setSelectedFrame(list[0] ?? null);
    }
  }, []);

  // スライダー変更
  const handleSliderChange = useCallback(
    (index: number) => {
      setSliderIndex(index);
      if (frames[index]) {
        setSelectedFrame(frames[index]);
      }
    },
    [frames],
  );

  // フレーム変更時にテスト結果リセット
  useEffect(() => {
    setSelectedRect(null);
    setOcrTestResult(null);
    setPokemonTestResult(null);
    setTestLoading(false);
  }, [selectedFrame]);

  // モード変更時にテスト結果リセット
  useEffect(() => {
    setSelectedRect(null);
    setOcrTestResult(null);
    setPokemonTestResult(null);
    setTestLoading(false);
  }, [testMode]);

  // フレーム画像読み込み → Canvas に描画
  const currentUrl = selectedFrame && selectedSession
    ? frameUrl(selectedSession, selectedFrame.filename)
    : null;

  useEffect(() => {
    if (!currentUrl) {
      loadedImgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      loadedImgRef.current = img;
      drawCanvas();
    };
    img.src = currentUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  // Canvas 描画
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = loadedImgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.parentElement?.clientWidth ?? img.naturalWidth;
    const scale = displayW / img.naturalWidth;
    const displayH = img.naturalHeight * scale;

    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;
    ctx.scale(dpr, dpr);

    ctx.drawImage(img, 0, 0, displayW, displayH);

    const modeColor = testMode === "ocr" ? "#22d3ee" : "#fb923c";

    // ドラッグ中の矩形
    if (isDragging && dragStartRef.current && dragEndRef.current) {
      const sx = Math.min(dragStartRef.current.x, dragEndRef.current.x) * scale;
      const sy = Math.min(dragStartRef.current.y, dragEndRef.current.y) * scale;
      const sw = Math.abs(dragEndRef.current.x - dragStartRef.current.x) * scale;
      const sh = Math.abs(dragEndRef.current.y - dragStartRef.current.y) * scale;

      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = modeColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1.0;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);

      const w = Math.abs(dragEndRef.current.x - dragStartRef.current.x);
      const h = Math.abs(dragEndRef.current.y - dragStartRef.current.y);
      ctx.font = `${Math.max(10, 11 * scale)}px monospace`;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      const sizeText = `${w} x ${h}`;
      const stm = ctx.measureText(sizeText);
      ctx.fillRect(sx, sy + sh + 2, stm.width + 8, 16 * scale);
      ctx.fillStyle = modeColor;
      ctx.fillText(sizeText, sx + 4, sy + sh + 14 * scale);
    } else if (selectedRect) {
      // 確定矩形
      const sx = selectedRect.x * scale;
      const sy = selectedRect.y * scale;
      const sw = selectedRect.w * scale;
      const sh = selectedRect.h * scale;

      ctx.strokeStyle = modeColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1.0;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.fillStyle = modeColor;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.globalAlpha = 1.0;

      if (testLoading) {
        ctx.font = `bold ${Math.max(12, 14 * scale)}px monospace`;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        const loadText = "認識中...";
        const ltm = ctx.measureText(loadText);
        const lx = sx + (sw - ltm.width) / 2;
        const ly = sy + sh / 2;
        ctx.fillRect(lx - 4, ly - 12 * scale, ltm.width + 8, 16 * scale);
        ctx.fillStyle = modeColor;
        ctx.fillText(loadText, lx, ly);
      }
    }
  }, [testMode, isDragging, selectedRect, testLoading]);

  // 状態変化時に再描画
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // 画像座標への変換
  const getImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const img = loadedImgRef.current;
      if (!canvas || !img) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      return {
        x: Math.max(0, Math.min(img.naturalWidth, Math.round((e.clientX - rect.left) * scaleX))),
        y: Math.max(0, Math.min(img.naturalHeight, Math.round((e.clientY - rect.top) * scaleY))),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (testMode === "off") return;
      const coords = getImageCoords(e);
      dragStartRef.current = coords;
      dragEndRef.current = coords;
      setIsDragging(true);
      setSelectedRect(null);
      setOcrTestResult(null);
      setPokemonTestResult(null);
    },
    [testMode, getImageCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging || testMode === "off") return;
      dragEndRef.current = getImageCoords(e);
      drawCanvas();
    },
    [isDragging, testMode, getImageCoords, drawCanvas],
  );

  const handleMouseUp = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging || testMode === "off") return;
      setIsDragging(false);

      const end = getImageCoords(e);
      const start = dragStartRef.current;
      if (!start) return;

      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);

      if (w < 5 || h < 5) return;

      const rect: CropRect = { x, y, w, h };
      setSelectedRect(rect);

      if (!selectedFrame || !selectedSession) return;

      setTestLoading(true);
      try {
        if (testMode === "ocr") {
          const result = await runOcrTest(selectedSession, selectedFrame.filename, rect);
          setOcrTestResult(result);
        } else {
          const result = await runPokemonTest(selectedSession, selectedFrame.filename, rect);
          setPokemonTestResult(result);
        }
      } catch (err) {
        console.error("Test failed:", err);
      } finally {
        setTestLoading(false);
      }
    },
    [isDragging, testMode, getImageCoords, selectedSession, selectedFrame],
  );

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;
  };

  return (
    <div className="devtools-panel">
      <h2>フレームビューア</h2>

      <label htmlFor="session-select">セッション</label>
      <select
        id="session-select"
        value={selectedSession}
        onChange={(e) => handleSessionChange(e.target.value)}
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

      {selectedFrame && selectedSession && (
        <>
          {/* テストモード切替 */}
          <div className="test-mode-toolbar">
            <span>テスト:</span>
            <button
              className={testMode === "ocr" ? "active ocr" : ""}
              onClick={() => setTestMode(testMode === "ocr" ? "off" : "ocr")}
            >
              文字 (OCR)
            </button>
            <button
              className={testMode === "pokemon" ? "active pokemon" : ""}
              onClick={() => setTestMode(testMode === "pokemon" ? "off" : "pokemon")}
            >
              ポケモン認識
            </button>
            {testMode !== "off" && (
              <span className="test-mode-hint">
                ドラッグで範囲を選択
              </span>
            )}
          </div>

          <div className="frame-and-results">
            <div className="frame-display">
              <canvas
                ref={canvasRef}
                className="frame-viewer-canvas"
                style={{ cursor: testMode !== "off" ? "crosshair" : "default" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                  if (isDragging) {
                    setIsDragging(false);
                  }
                }}
              />
              <div className="frame-info">
                <span>
                  #{selectedFrame.index} / {formatTime(selectedFrame.timestamp_ms)}
                </span>
                {onOpenInCropEditor && (
                  <button
                    onClick={() =>
                      onOpenInCropEditor(selectedSession, selectedFrame)
                    }
                  >
                    クロップ編集で開く
                  </button>
                )}
              </div>
            </div>

            <div className="test-results-sidebar">
              {/* OCR テスト結果 */}
              {testMode === "ocr" && ocrTestResult && (
                <div className="test-results">
                  <h4>OCR テスト結果</h4>
                  <table className="test-results-table">
                    <thead>
                      <tr>
                        <th>エンジン</th>
                        <th>テキスト</th>
                        <th>信頼度</th>
                        <th>時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(ocrTestResult.engines).map(([engine, r]) => (
                        <tr key={engine}>
                          <td>{engine}</td>
                          <td className="test-result-text">{r.text || "(empty)"}</td>
                          <td>{(r.confidence * 100).toFixed(1)}%</td>
                          <td>{r.elapsed_ms.toFixed(1)}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="test-result-coords">
                    x={ocrTestResult.crop.x} y={ocrTestResult.crop.y} w={ocrTestResult.crop.w} h={ocrTestResult.crop.h}
                  </div>
                </div>
              )}

              {/* ポケモン認識テスト結果 */}
              {testMode === "pokemon" && pokemonTestResult && (
                <div className="test-results">
                  <h4>ポケモン認識テスト結果</h4>

                  {/* クロップ画像 vs テンプレート画像 */}
                  <div className="test-result-images">
                    <div>
                      <div className="test-result-image-label">クロップ画像</div>
                      <img src={`data:image/jpeg;base64,${pokemonTestResult.crop_b64}`} alt="crop" />
                    </div>
                    {pokemonTestResult.template_b64 && (
                      <div>
                        <div className="test-result-image-label">テンプレート (Best)</div>
                        <img src={`data:image/jpeg;base64,${pokemonTestResult.template_b64}`} alt="template" />
                      </div>
                    )}
                  </div>

                  {/* Top-K 候補テーブル */}
                  {pokemonTestResult.candidates.length > 0 ? (
                    <table className="test-results-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>名前</th>
                          <th>信頼度</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pokemonTestResult.candidates.map((c, i) => (
                          <tr
                            key={i}
                            className={c.confidence >= pokemonTestResult.threshold ? "match-above-threshold" : ""}
                          >
                            <td>{c.pokemon_id}</td>
                            <td>{c.name}</td>
                            <td>{(c.confidence * 100).toFixed(1)}%</td>
                            <td>{c.confidence >= pokemonTestResult.threshold ? "\u2713" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="test-result-pokemon no-match">候補なし</div>
                  )}

                  <div className="test-result-coords">
                    閾値: {(pokemonTestResult.threshold * 100).toFixed(0)}% |
                    時間: {pokemonTestResult.elapsed_ms.toFixed(1)}ms |
                    x={pokemonTestResult.crop.x} y={pokemonTestResult.crop.y} w={pokemonTestResult.crop.w} h={pokemonTestResult.crop.h}
                  </div>
                </div>
              )}

              {/* ローディング表示 */}
              {testLoading && !ocrTestResult && !pokemonTestResult && (
                <div className="test-results">
                  <span className="test-loading">認識中...</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {frames.length > 1 && (
        <div className="timeline-slider">
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={sliderIndex}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
          />
          <span>
            {sliderIndex + 1} / {frames.length}
          </span>
        </div>
      )}

    </div>
  );
}
