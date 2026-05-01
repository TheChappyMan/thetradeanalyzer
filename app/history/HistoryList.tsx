"use client";

import { useState } from "react";

export type HistoryEntry = {
  id: string;
  savedAt: string;
  leagueName: string;
  /** Supabase row UUID — present for Tier 2 delete; absent for Tier 1 read-only view */
  dbId?: string;
  /** Sport tag added when saving from Tier 2 pages */
  sport?: string;
  /** League UUID tag added when saving from Tier 2 pages */
  leagueId?: string;
  sendPlayerNames: string[];
  recvPlayerNames: string[];
  sendPicks: string;
  recvPicks: string;
  sendValue: number;
  recvValue: number;
  score: number;
  verdict: string;
};

type Props = {
  entries: HistoryEntry[];
  /** When provided a delete button is shown on each row (Tier 2 only). */
  onDelete?: (dbId: string) => void;
};

export default function HistoryList({ entries, onDelete }: Props) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        No trades saved yet. Use the analyzer to evaluate a trade — it will be
        saved automatically.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <HistoryRow
          key={entry.dbId ?? entry.id}
          entry={entry}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function HistoryRow({
  entry,
  onDelete,
}: {
  entry: HistoryEntry;
  onDelete?: (dbId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const date = new Date(entry.savedAt);
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const scoreBg =
    entry.score >= 60
      ? "bg-green-50 border-green-200"
      : entry.score <= 40
      ? "bg-red-50 border-red-200"
      : "bg-gray-50 border-gray-200";

  const sendSummary =
    [
      ...entry.sendPlayerNames,
      ...(entry.sendPicks
        ? entry.sendPicks.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
        : []),
    ].join(", ") || "—";

  const recvSummary =
    [
      ...entry.recvPlayerNames,
      ...(entry.recvPicks
        ? entry.recvPicks.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
        : []),
    ].join(", ") || "—";

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!entry.dbId || !onDelete) return;
    setDeleting(true);
    onDelete(entry.dbId);
  }

  return (
    <div className={`border rounded-xl text-xs ${scoreBg}`}>
      {/* ── Collapsed row ────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-gray-400 shrink-0">
            {dateStr} {timeStr}
          </span>
          {entry.leagueName && (
            <span className="text-gray-500 shrink-0 font-medium">
              {entry.leagueName}
            </span>
          )}
          <span className="text-gray-600 truncate hidden sm:block">
            {sendSummary} → {recvSummary}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="font-semibold">{entry.score.toFixed(1)} / 100</span>
          {onDelete && entry.dbId && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40 px-1"
              title="Delete trade"
            >
              ✕
            </button>
          )}
          <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* ── Expanded detail ──────────────────────────────────── */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-inherit pt-2 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-semibold text-gray-700 mb-1">You Gave</div>
              {entry.sendPlayerNames.length > 0 && (
                <div className="mb-1">{entry.sendPlayerNames.join(", ")}</div>
              )}
              {entry.sendPicks && (
                <div className="text-gray-500">Picks: {entry.sendPicks}</div>
              )}
              <div className="text-gray-600 mt-1">
                Value: <span className="font-medium">{entry.sendValue.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-1">You Got</div>
              {entry.recvPlayerNames.length > 0 && (
                <div className="mb-1">{entry.recvPlayerNames.join(", ")}</div>
              )}
              {entry.recvPicks && (
                <div className="text-gray-500">Picks: {entry.recvPicks}</div>
              )}
              <div className="text-gray-600 mt-1">
                Value: <span className="font-medium">{entry.recvValue.toFixed(1)}</span>
              </div>
            </div>
          </div>
          <div className="text-gray-700 italic">{entry.verdict}</div>
        </div>
      )}
    </div>
  );
}
