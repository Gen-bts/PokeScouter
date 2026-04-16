import { memo, useCallback, useEffect, useRef } from "react";
import {
  useMatchLogStore,
  type BattleEventLogEntry,
  type HpChangeLogEntry,
  type ItemAbilityLogEntry,
  type MatchLogEntry,
  type MatchTeamsLogEntry,
  type OcrResultLogEntry,
  type PokemonCorrectionLogEntry,
  type TeamSelectionOrderLogEntry,
  type TurnSummaryLogEntry,
} from "../stores/useMatchLogStore";
import { useConnectionStore } from "../stores/useConnectionStore";

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
}: {
  entry: MatchLogEntry & { kind: "team_selection" };
}) {
  // 直前の match_teams エントリから名前を引く
  const storeEntries = useMatchLogStore.getState().entries;
  const lastTeams = [...storeEntries]
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

const FULLWIDTH_DIGITS = ["", "１", "２", "３", "４", "５", "６"];

function TeamSelectionOrderEntry({
  entry,
}: {
  entry: TeamSelectionOrderLogEntry;
}) {
  const storeEntries = useMatchLogStore.getState().entries;
  const lastTeams = [...storeEntries]
    .reverse()
    .find((e): e is MatchTeamsLogEntry => e.kind === "match_teams");

  const ordered = Object.entries(entry.selectionOrder)
    .sort(([, a], [, b]) => a - b)
    .map(([posStr, orderNum]) => {
      const pos = Number(posStr);
      const p = lastTeams?.playerTeam.find((t) => t.position === pos);
      const name = p?.name || `#${pos}`;
      const num = FULLWIDTH_DIGITS[orderNum] ?? `${orderNum}`;
      return `${num}・${name}`;
    });

  return (
    <div className="match-log-entry match-log-selection">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-selection-label">選出順:</span>
      <span className="match-log-selection-names">{ordered.join(" ")}</span>
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
    case "type_effectiveness": {
      const eff = entry.details?.effectiveness as string;
      description = eff === "super_effective" ? "効果はバツグンだ！"
        : eff === "double_super_effective" ? "効果はちょうバツグンだ!!"
        : "効果はいまひとつだ…";
      break;
    }
    case "weather": {
      const weatherNames: Record<string, string> = { snow: "雪", sand: "砂あらし", sun: "日差し", rain: "雨" };
      const w = entry.details?.weather as string;
      const wa = entry.details?.action as string;
      description = wa === "start"
        ? `${weatherNames[w] ?? w}が発生した！`
        : `${weatherNames[w] ?? w}がおさまった！`;
      break;
    }
    case "field_effect": {
      const fe = entry.details?.effect as string;
      const fa = entry.details?.action as string;
      if (fe === "trick_room") {
        description = fa === "start"
          ? `${sideLabel}の${name}がトリックルームを発動！`
          : "トリックルームが終了した！";
      } else {
        description = entry.rawText;
      }
      break;
    }
    case "hazard_set":
      description = `${sideLabel}の場にステルスロックが撒かれた！`;
      break;
    case "hazard_damage":
      description = `${sideLabel}の${name}にステルスロックのダメージ！`;
      break;
    case "protect":
      description = (entry.details?.phase as string) === "blocked"
        ? `${sideLabel}の${name}は攻撃から身を守った！`
        : `${sideLabel}の${name}は守りの体勢に入った！`;
      break;
    case "status_condition": {
      const phase = entry.details?.phase as string;
      description = phase === "continuing"
        ? `${sideLabel}の${name}はぐうぐう眠っている…`
        : `${sideLabel}の${name}は眠ってしまった！`;
      break;
    }
    case "move_failed":
      description = (entry.details?.reason as string) === "missed"
        ? `${name}には当たらなかった！`
        : "しかしうまく決まらなかった！";
      break;
    case "forced_switch":
      description = `${sideLabel}の${name}は戦闘に引きずりだされた！`;
      break;
    case "mega_evolution":
      description = `${sideLabel}の${name}は${(entry.details?.mega_name as string) ?? "メガシンカ"}にメガシンカした！`;
      break;
    case "pokemon_recalled": {
      const method = entry.details?.method as string;
      if (method === "returning") {
        description = `${sideLabel}の${name}は戻っていった！`;
      } else if (method === "withdrew") {
        description = `${name}を引っこめた！`;
      } else {
        description = `${name} 戻れ！`;
      }
      break;
    }
    case "surrender":
      description = "降参が選ばれました";
      break;
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
  const hasActualHp =
    entry.fromCurrentHp != null &&
    entry.fromMaxHp != null &&
    entry.toCurrentHp != null &&
    entry.toMaxHp != null;

  return (
    <div className="match-log-entry match-log-hp-change">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-hp-name">{entry.pokemonName}</span>
      <span className="match-log-hp-values">
        {hasActualHp
          ? `${entry.fromCurrentHp}/${entry.fromMaxHp} → ${entry.toCurrentHp}/${entry.toMaxHp}`
          : `${entry.fromHp}% → ${entry.toHp}%`}
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

function PokemonCorrectionEntry({ entry }: { entry: PokemonCorrectionLogEntry }) {
  const original = entry.originalName ?? "（なし）";
  return (
    <div
      className="match-log-entry match-log-correction"
      title={`${entry.source === "candidate" ? "候補選択" : "手動入力"}: ${original} → ${entry.correctedName}`}
    >
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-event-text">
        修正 #{entry.position}: {original} → {entry.correctedName}
      </span>
    </div>
  );
}

/** インデックスベースの自己購読エントリ。entries[index] の参照が変わった時のみ再レンダリング。 */
function TurnSummaryEntry({ entry }: { entry: TurnSummaryLogEntry }) {
  const firstMover =
    entry.firstMover === "player"
      ? "player first"
      : entry.firstMover === "opponent"
        ? "opponent first"
        : "no order";
  const inference = entry.inferenceApplied
    ? "inference applied"
    : entry.inferenceNote ?? "no inference";

  return (
    <div className="match-log-entry match-log-turn-summary">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-event-text">
        Turn {entry.turnId}: {entry.status} / {firstMover} / {inference}
      </span>
    </div>
  );
}

const MemoizedLogEntry = memo(function MemoizedLogEntry({ index }: { index: number }) {
  const entry = useMatchLogStore((s) => s.entries[index]);
  const toggleErrorFlag = useMatchLogStore((s) => s.toggleErrorFlag);
  const sendErrorFlag = useConnectionStore((s) => s.sendErrorFlag);

  const handleFlag = useCallback(() => {
    if (!entry) return;
    const newFlagged = !entry.errorFlagged;
    toggleErrorFlag(entry.seq, entry.timestamp, entry.kind);
    sendErrorFlag(entry.seq, entry.kind, entry.timestamp, newFlagged);
  }, [entry, toggleErrorFlag, sendErrorFlag]);

  if (!entry) return null;

  let content: React.ReactNode;
  switch (entry.kind) {
    case "scene_change":
      content = <SceneChangeEntry entry={entry} />;
      break;
    case "match_teams":
      content = <MatchTeamsEntry entry={entry} />;
      break;
    case "team_selection":
      content = <TeamSelectionEntry entry={entry} />;
      break;
    case "team_selection_order":
      content = <TeamSelectionOrderEntry entry={entry} />;
      break;
    case "battle_result":
      content = <BattleResultEntry entry={entry} />;
      break;
    case "battle_event":
      content = <BattleEventEntry entry={entry} />;
      break;
    case "hp_change":
      content = <HpChangeEntry entry={entry} />;
      break;
    case "item_ability":
      content = <ItemAbilityEntry entry={entry} />;
      break;
    case "ocr_result":
      content = <OcrResultEntry entry={entry} />;
      break;
    case "pokemon_correction":
      content = <PokemonCorrectionEntry entry={entry} />;
      break;
    case "turn_summary":
      content = <TurnSummaryEntry entry={entry} />;
      break;
  }

  return (
    <div className={`match-log-entry-wrapper${entry.errorFlagged ? " match-log-flagged" : ""}`}>
      {content}
      <button
        className={`match-log-flag-btn${entry.errorFlagged ? " flagged" : ""}`}
        onClick={handleFlag}
        title={entry.errorFlagged ? "エラーフラグを解除" : "誤検出をマーク"}
      >
        {entry.errorFlagged ? "\u26A0" : "\u2691"}
      </button>
    </div>
  );
});

export const MatchLog = memo(function MatchLog() {
  // entries.length（プリミティブ数値）のみ購読。配列参照の変更では再レンダリングしない。
  const entryCount = useMatchLogStore((s) => s.entries.length);
  const clear = useMatchLogStore((s) => s.clear);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entryCount]);

  // entryCount 変更で再レンダリングされた時点でのスナップショット（key 取得用）
  const entries = useMatchLogStore.getState().entries;

  return (
    <div className="panel-section match-log">
      <div className="match-log-header">
        <h2>Match Log</h2>
        {entryCount > 0 && (
          <button className="btn-small btn-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <div className="match-log-list" ref={listRef}>
        {entryCount === 0 ? (
          <span className="placeholder">シーン遷移を待機中…</span>
        ) : (
          Array.from({ length: entryCount }, (_, i) => (
            <MemoizedLogEntry key={entries[i]?.seq ?? i} index={i} />
          ))
        )}
      </div>
    </div>
  );
});
