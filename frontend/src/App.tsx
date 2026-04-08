import { useEffect, useState } from "react";
import { useVideoCapture } from "./hooks/useVideoCapture";
import { useSettingsStore } from "./stores/useSettingsStore";
import { BattleView } from "./components/BattleView";
import { DevToolsView } from "./components/DevToolsView";
import "./App.css";

type Tab = "battle" | "devtools";

export default function App() {
  const { videoRef, canvasRef, devices, audioDevices, startCapture, captureFrame, setVolume, setMuted } =
    useVideoCapture();

  const [activeTab, setActiveTab] = useState<Tab>("battle");
  const selectedDeviceId = useSettingsStore((s) => s.selectedDeviceId);
  const selectedAudioDeviceId = useSettingsStore((s) => s.selectedAudioDeviceId);

  // 保存済みデバイスが列挙リストにあれば自動でキャプチャ開始
  useEffect(() => {
    if (
      selectedDeviceId &&
      devices.length > 0 &&
      devices.some((d) => d.deviceId === selectedDeviceId)
    ) {
      startCapture(selectedDeviceId, selectedAudioDeviceId || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  return (
    <div className="app-root">
      <nav className="tab-bar">
        <button
          className={activeTab === "battle" ? "active" : undefined}
          onClick={() => setActiveTab("battle")}
        >
          バトル
        </button>
        <button
          className={activeTab === "devtools" ? "active" : undefined}
          onClick={() => setActiveTab("devtools")}
        >
          Dev Tools
        </button>
      </nav>

      <div className="layout">
        <div style={{ display: activeTab === "battle" ? "contents" : "none" }}>
          <BattleView
            videoRef={videoRef}
            canvasRef={canvasRef}
            devices={devices}
            audioDevices={audioDevices}
            startCapture={startCapture}
            captureFrame={captureFrame}
            setVideoVolume={setVolume}
            setVideoMuted={setMuted}
          />
        </div>
        <div style={{ display: activeTab === "devtools" ? "contents" : "none" }}>
          <DevToolsView captureFrame={captureFrame} />
        </div>
      </div>
    </div>
  );
}
