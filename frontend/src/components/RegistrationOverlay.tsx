import { useEffect, useState } from "react";
import { useMyPartyStore } from "../stores/useMyPartyStore";

const MESSAGES: Record<string, string> = {
  detecting_screen1: "パーティ画面を表示してください",
  reading_screen1: "読み取り中...",
  detecting_screen2: "画面2へスクロールしてください",
  reading_screen2: "読み取り中...",
};

export function RegistrationOverlay() {
  const phase = useMyPartyStore((s) => s.registrationState);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (phase === "done") {
      setShowDone(true);
      const timer = setTimeout(() => setShowDone(false), 1000);
      return () => clearTimeout(timer);
    }
    setShowDone(false);
  }, [phase]);

  const active = phase !== "idle" && phase !== "done";
  if (!active && !showDone) return null;

  const colorGroup = showDone
    ? "done"
    : phase.includes("screen1")
      ? "screen1"
      : "screen2";
  const isDetecting = phase.startsWith("detecting_");
  const isReading = phase.startsWith("reading_");
  const step = phase.includes("screen1") ? "1/2" : "2/2";

  return (
    <div
      className={[
        "registration-overlay",
        `registration-overlay--${phase}`,
        `registration-overlay--color-${colorGroup}`,
        isDetecting ? "registration-overlay--detecting" : "",
        showDone ? "registration-overlay--fade-out" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="registration-overlay__banner">
        {!showDone && (
          <>
            <span className="registration-overlay__step">{step}</span>
            <span
              className={`registration-overlay__message${
                phase === "detecting_screen2"
                  ? " registration-overlay__message--urgent"
                  : ""
              }`}
            >
              {MESSAGES[phase] ?? phase}
              {phase === "detecting_screen2" && (
                <span className="registration-overlay__arrow">▼</span>
              )}
            </span>
            {isReading && <span className="registration-overlay__spinner" />}
          </>
        )}
        {showDone && (
          <span className="registration-overlay__message registration-overlay__message--done">
            ✓ 登録完了
          </span>
        )}
      </div>
    </div>
  );
}
