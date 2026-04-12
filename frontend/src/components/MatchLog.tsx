import { memo, useEffect, useRef } from "react";
import {
  useMatchLogStore,
  type BattleEventLogEntry,
  type HpChangeLogEntry,
  type ItemAbilityLogEntry,
  type MatchLogEntry,
  type MatchTeamsLogEntry,
  type OcrResultLogEntry,
} from "../stores/useMatchLogStore";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("ja-JP", { hour12: false });
}

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

function SceneChangeEntry({ entry }: { entry: MatchLogEntry & { kind: "scene_change" } }) {
  return (
    <div className="match-log-entry">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-scene">{SCENE_NAMES_JA[entry.scene] ?? entry.scene}</span>
      <span className="match-log-confidence">
        {(entry.confidence * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function MatchTeamsEntry({ entry }: { entry: MatchTeamsLogEntry }) {
  const playerNames = entry.playerTeam
    .map((p) => p.name || "?")
    .join(", ");
  const opponentNames = entry.opponentTeam
    .map((p) => p.name || "?")
    .join(", ");
  return (
    <div className="match-log-entry match-log-teams">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <div className="match-log-teams-detail">
        <div className="match-log-team-row">
          <span className="match-log-team-label">味方</span>
          <span className="match-log-team-names">{playerNames}</span>
        </div>
        <div className="match-log-team-row">
          <span className="match-log-team-label">相手</span>
          <span className="match-log-team-names">{opponentNames}</span>
        </div>
      </div>
    </div>
  );
}

function TeamSelectionEntry({
  entry,
  entries,
}: {
  entry: MatchLogEntry & { kind: "team_selection" };
  entries: MatchLogEntry[];
}) {
  // 直前の match_teams エントリから名前を引く
  const lastTeams = [...entries]
    .reverse()
    .find((e): e is MatchTeamsLogEntry => e.kind === "match_teams");

  const names = entry.selectedPositions.map((pos) => {
    const p = lastTeams?.playerTeam.find((t) => t.position === pos);
    return p?.name || `#${pos}`;
  });

  return (
    <div className="match-log-entry match-log-selection">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-selection-label">選出:</span>
      <span className="match-log-selection-names">{names.join(", ")}</span>
    </div>
  );
}

function OcrResultEntry({ entry }: { entry: OcrResultLogEntry }) {
  return (
    <div className="match-log-entry match-log-ocr">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-scene">{SCENE_NAMES_JA[entry.scene] ?? entry.scene}</span>
      <div className="match-log-ocr-regions">
        {entry.regions.map((r, i) => (
          <div key={i} className="match-log-ocr-region">
            <span className="match-log-ocr-name">{r.name}</span>
            <span className="match-log-ocr-text">{r.text || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STAT_LABEL: Record<string, string> = {
  atk: "こうげき",
  def: "ぼうぎょ",
  spa: "とくこう",
  spd: "とくぼう",
  spe: "すばやさ",
  accuracy: "命中率",
  evasion: "回避率",
};

function BattleEventEntry({ entry }: { entry: BattleEventLogEntry }) {
  const sideLabel = entry.side === "opponent" ? "相手" : "自分";
  const isUnrecognized = entry.eventType === "unrecognized";
  const sideCls = isUnrecognized
    ? "match-log-event-unrecognized"
    : entry.side === "opponent" ? "match-log-event-opponent" : "match-log-event-player";

  let description: string;
  const name = entry.pokemonName ?? "???";

  switch (entry.eventType) {
    case "pokemon_fainted":
      description = `${sideLabel}の ${name} は たおれた！`;
      break;
    case "opponent_sent_out": {
      const trainer = (entry.details?.trainer_name as string) ?? "相手";
      description = `${trainer}が ${name} を繰り出した！`;
      break;
    }
    case "player_sent_out":
      description = `ゆけっ! ${name}!`;
      break;
    case "move_used":
      description = entry.side === "opponent"
        ? `相手の ${name} の ${entry.moveName ?? "???"}!`
        : `${name} の ${entry.moveName ?? "???"}!`;
      break;
    case "stat_change": {
      const stat = STAT_LABEL[entry.details?.stat as string] ?? (entry.details?.stat as string) ?? "?";
      const stages = entry.details?.stages as number;
      const direction = stages > 0 ? "上がった" : "下がった";
      const magnitude = Math.abs(stages) >= 2 ? "ぐーんと " : "";
      description = `${sideLabel}の ${name} の ${stat}が ${magnitude}${direction}！`;
      break;
    }
    case "unrecognized":
      description = `[未認識] ${entry.rawText}`;
      break;
    default:
      description = entry.rawText;
  }

  return (
    <div
      className={`match-log-entry match-log-battle-event ${sideCls}`}
      title={entry.rawText ? `OCR: ${entry.rawText}` : undefined}
    >
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-event-text">{description}</span>
    </div>
  );
}

function HpChangeEntry({ entry }: { entry: HpChangeLogEntry }) {
  return (
    <div className="match-log-entry match-log-hp-change">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-hp-name">{entry.pokemonName}</span>
      <span className="match-log-hp-values">
        {entry.fromHp}% → {entry.toHp}%
      </span>
    </div>
  );
}

function ItemAbilityEntry({ entry }: { entry: ItemAbilityLogEntry }) {
  const label = entry.detectionType === "item" ? "もちもの" : "とくせい";
  return (
    <div
      className="match-log-entry match-log-item-ability"
      title={entry.rawText ? `OCR: ${entry.rawText}` : undefined}
    >
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-event-text">
        {entry.pokemonName} の{label}: {entry.traitName}
      </span>
    </div>
  );
}

function BattleResultEntry({ entry }: { entry: MatchLogEntry & { kind: "battle_result" } }) {
  const cls =
    entry.result === "win"
      ? "match-log-result-win"
      : entry.result === "lose"
        ? "match-log-result-lose"
        : "";
  const label =
    entry.result === "win" ? "WIN" : entry.result === "lose" ? "LOSE" : "???";
  return (
    <div className={`match-log-entry match-log-result ${cls}`}>
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-result-label">{label}</span>
    </div>
  );
}

export const MatchLog = memo(function MatchLog() {
  const entries = useMatchLogStore((s) => s.entries);
  const clear = useMatchLogStore((s) => s.clear);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="panel-section match-log">
      <div className="match-log-header">
        <h2>Match Log</h2>
        {entries.length > 0 && (
          <button className="btn-small btn-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <div className="match-log-list" ref={listRef}>
        {entries.length === 0 ? (
          <span className="placeholder">シーン遷移を待機中…</span>
        ) : (
          entries.map((e, i) => {
            switch (e.kind) {
              case "scene_change":
                return <SceneChangeEntry key={i} entry={e} />;
              case "match_teams":
                return <MatchTeamsEntry key={i} entry={e} />;
              case "team_selection":
                return (
                  <TeamSelectionEntry key={i} entry={e} entries={entries} />
                );
              case "battle_result":
                return <BattleResultEntry key={i} entry={e} />;
              case "battle_event":
                return <BattleEventEntry key={i} entry={e} />;
              case "hp_change":
                return <HpChangeEntry key={i} entry={e} />;
              case "item_ability":
                return <ItemAbilityEntry key={i} entry={e} />;
              case "ocr_result":
                return <OcrResultEntry key={i} entry={e} />;
            }
          })
        )}
      </div>
    </div>
  );
});
