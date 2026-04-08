import { useCallback, useState } from "react";
import { RecordingPanel } from "./devtools/RecordingPanel";
import { FrameViewer } from "./devtools/FrameViewer";
import { CropEditor } from "./devtools/CropEditor";
import { SceneManager } from "./devtools/SceneManager";
import { OfflineBenchmark } from "./devtools/OfflineBenchmark";
import type { FrameInfo } from "../api/devtools";

type SubTab = "recording" | "viewer" | "crop" | "scenes" | "benchmark";

interface Props {
  captureFrame: (quality: number) => Promise<Blob | null>;
}

export function DevToolsView({ captureFrame }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("recording");

  // ビューアからクロップ編集に遷移
  const [cropSessionId, setCropSessionId] = useState<string | undefined>();
  const [cropFrame, setCropFrame] = useState<FrameInfo | undefined>();

  const handleOpenInCropEditor = useCallback(
    (sessionId: string, frame: FrameInfo) => {
      setCropSessionId(sessionId);
      setCropFrame(frame);
      setSubTab("crop");
    },
    [],
  );

  return (
    <div className="devtools-view">
      <div className="sub-tab-bar">
        <button
          className={subTab === "recording" ? "active" : undefined}
          onClick={() => setSubTab("recording")}
        >
          録画
        </button>
        <button
          className={subTab === "viewer" ? "active" : undefined}
          onClick={() => setSubTab("viewer")}
        >
          ビューア
        </button>
        <button
          className={subTab === "crop" ? "active" : undefined}
          onClick={() => setSubTab("crop")}
        >
          クロップ編集
        </button>
        <button
          className={subTab === "scenes" ? "active" : undefined}
          onClick={() => setSubTab("scenes")}
        >
          シーン管理
        </button>
        <button
          className={subTab === "benchmark" ? "active" : undefined}
          onClick={() => setSubTab("benchmark")}
        >
          ベンチマーク
        </button>
      </div>

      <div className="devtools-content">
        {subTab === "recording" && (
          <RecordingPanel captureFrame={captureFrame} />
        )}
        {subTab === "viewer" && (
          <FrameViewer onOpenInCropEditor={handleOpenInCropEditor} />
        )}
        {subTab === "crop" && (
          <CropEditor
            initialSessionId={cropSessionId}
            initialFrame={cropFrame}
          />
        )}
        {subTab === "scenes" && <SceneManager />}
        {subTab === "benchmark" && <OfflineBenchmark />}
      </div>
    </div>
  );
}
