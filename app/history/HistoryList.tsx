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
      <p className="text-sm italic" style={{ color: "var(--color-muted)" }}>
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

  // Semantic verdict tint — uses brand component classes
  const rowClass =
    entry.score >= 60
      ? "verdict-fair"
      : entry.score <= 40
      ? "verdict-danger"
      : "verdict-neutral";

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
    <div className={`border rounded-xl text-xs ${rowClass}`}>
      {/* ── Collapsed row ────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0" style={{ color: "var(--color-muted)" }}>
            {dateStr} {timeStr}
          </span>
          {entry.leagueName && (
            <span
              className="shrink-0 font-medium"
              style={{ color: "var(--color-text)" }}
            >
              {entry.leagueName}
            </span>
          )}
          <span
            className="truncate hidden sm:block"
            style={{ color: "var(--color-muted)" }}
          >
            {sendSummary} → {recvSummary}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="font-semibold" style={{ color: "var(--color-text)" }}>
            {entry.score.toFixed(1)} / 100
          </span>
          {onDelete && entry.dbId && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-1 transition-colors disabled:opacity-40"
              style={{ color: "var(--color-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-danger)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-muted)")}
              title="Delete trade"
            >
              ✕
            </button>
          )}
          <span style={{ color: "var(--color-muted)" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* ── Expanded detail ──────────────────────────────────── */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-inherit pt-2 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div
                className="font-semibold mb-1"
                style={{ color: "var(--color-text)" }}
              >
                You Gave
              </div>
              {entry.sendPlayerNames.length > 0 && (
                <div style={{ color: "var(--color-text)" }}>
                  {entry.sendPlayerNames.join(", ")}
                </div>
              )}
              {entry.sendPicks && (
                <div className="mt-0.5" style={{ color: "var(--color-muted)" }}>
                  Picks: {entry.sendPicks}
                </div>
              )}
              <div className="mt-1" style={{ color: "var(--color-muted)" }}>
                Value:{" "}
                <span className="font-medium" style={{ color: "var(--color-text)" }}>
                  {entry.sendValue.toFixed(1)}
                </span>
              </div>
            </div>
            <div>
              <div
                className="font-semibold mb-1"
                style={{ color: "var(--color-text)" }}
              >
                You Got
              </div>
              {entry.recvPlayerNames.length > 0 && (
                <div style={{ color: "var(--color-text)" }}>
                  {entry.recvPlayerNames.join(", ")}
                </div>
              )}
              {entry.recvPicks && (
                <div className="mt-0.5" style={{ color: "var(--color-muted)" }}>
                  Picks: {entry.recvPicks}
                </div>
              )}
              <div className="mt-1" style={{ color: "var(--color-muted)" }}>
                Value:{" "}
                <span className="font-medium" style={{ color: "var(--color-text)" }}>
                  {entry.recvValue.toFixed(1)}
                </span>
              </div>
            </div>
          </div>
          <div
            className="italic"
            style={{ color: "var(--color-text)" }}
          >
            {entry.verdict}
          </div>
        </div>
      )}
    </div>
  );
}
