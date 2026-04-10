interface Props {
  reason: "manual" | "auto";
  onResume: () => void;
}

export function PauseBanner({ reason, onResume }: Props) {
  return (
    <div className="pause-banner" onClick={onResume}>
      <div className="pause-banner__content">
        <span className="pause-banner__message">
          {reason === "auto"
            ? "シーン未検出のため自動停止しました"
            : "検出を一時停止中"}
        </span>
        <span className="pause-banner__hint">クリックで再開</span>
      </div>
    </div>
  );
}
