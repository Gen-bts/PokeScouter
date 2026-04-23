import { useRef } from "react";
import Draggable from "react-draggable";
import { useSettingsStore } from "../stores/useSettingsStore";
import { TypeChartMatrix } from "./reference/TypeChartMatrix";
import { CoverageView } from "./reference/CoverageView";
import { SpeedTierPanel } from "./reference/SpeedTierPanel";
import { LearnsetBrowser } from "./reference/LearnsetBrowser";

type Tab = "type-chart" | "coverage" | "speed-tier" | "learnset";

const TAB_LABELS: Record<Tab, string> = {
  "type-chart": "型相性",
  coverage: "技範囲",
  "speed-tier": "速度帯",
  learnset: "わざ検索",
};

const TAB_ORDER: Tab[] = ["type-chart", "coverage", "speed-tier", "learnset"];

export function ReferenceOverlay() {
  const nodeRef = useRef<HTMLDivElement>(null);
  const pos = useSettingsStore((s) => s.referenceOverlayPosition);
  const setPos = useSettingsStore((s) => s.setReferenceOverlayPosition);
  const tab = useSettingsStore((s) => s.referenceOverlayTab);
  const setTab = useSettingsStore((s) => s.setReferenceOverlayTab);
  const toggle = useSettingsStore((s) => s.toggleReferenceOverlay);

  return (
    <Draggable
      nodeRef={nodeRef}
      position={pos}
      handle=".reference-overlay__header"
      onStop={(_e, data) => setPos({ x: data.x, y: data.y })}
    >
      <div ref={nodeRef} className="reference-overlay">
        <div className="reference-overlay__header">
          <span className="reference-overlay__title">参考</span>
          <div className="reference-overlay__tabs">
            {TAB_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                className={`ref-tab ${tab === t ? "ref-tab--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="reference-overlay__close"
            onClick={toggle}
            aria-label="閉じる"
            title="閉じる"
          >
            ×
          </button>
        </div>
        <div className="reference-overlay__body">
          {tab === "type-chart" && <TypeChartMatrix />}
          {tab === "coverage" && <CoverageView />}
          {tab === "speed-tier" && <SpeedTierPanel />}
          {tab === "learnset" && <LearnsetBrowser />}
        </div>
      </div>
    </Draggable>
  );
}
