"use client";

import { useEffect, useState } from "react";
import { SPORTS_CONFIG } from "@/lib/sports-config";
import HistoryList from "./HistoryList";
import type { HistoryEntry } from "./HistoryList";

// ── Types ──────────────────────────────────────────────────────────────────

type LeagueRow = { id: string; name: string; sport: string };

type ApiTradeRow = {
  id: string;
  trade_data: Partial<HistoryEntry> | null;
  created_at: string;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function HistoryClientPage() {
  const [activeSport, setActiveSport] = useState(SPORTS_CONFIG[0].key);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [filterLeagueId, setFilterLeagueId] = useState<string>("all");
  const [allEntries, setAllEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/trades").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/leagues").then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([tradesJson, leaguesJson]) => {
        const rows = (tradesJson.data ?? []) as ApiTradeRow[];
        const mapped: HistoryEntry[] = rows.map((row) => {
          const td = row.trade_data;
          return {
            id:              td?.id              ?? row.created_at,
            dbId:            row.id,
            savedAt:         row.created_at,
            sport:           td?.sport,
            leagueId:        td?.leagueId,
            leagueName:      td?.leagueName      ?? "",
            sendPlayerNames: td?.sendPlayerNames ?? [],
            recvPlayerNames: td?.recvPlayerNames ?? [],
            sendPicks:       td?.sendPicks       ?? "",
            recvPicks:       td?.recvPicks       ?? "",
            sendValue:       td?.sendValue       ?? 0,
            recvValue:       td?.recvValue       ?? 0,
            score:           td?.score           ?? 50,
            verdict:         td?.verdict         ?? "",
          };
        });
        setAllEntries(mapped);
        setCount(mapped.length);
        setLeagues((leaguesJson.data ?? []) as LeagueRow[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Filtering ──────────────────────────────────────────────────────────

  const sportLeagues = leagues.filter((l) => l.sport === activeSport);
  const sportLabel = SPORTS_CONFIG.find((s) => s.key === activeSport)?.label ?? activeSport.toUpperCase();

  const filtered = allEntries.filter((e) => {
    // Legacy trades (no sport tag) show everywhere
    if (e.sport && e.sport !== activeSport) return false;
    if (filterLeagueId !== "all" && e.leagueId !== filterLeagueId) return false;
    return true;
  });

  // ── Delete ─────────────────────────────────────────────────────────────

  async function handleDelete(dbId: string) {
    await fetch("/api/trades", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: dbId }),
    }).catch(() => {});
    setAllEntries((prev) => {
      const next = prev.filter((e) => e.dbId !== dbId);
      setCount(next.length);
      return next;
    });
  }

  // ── Sport tab switch resets league filter ──────────────────────────────

  function handleSportChange(key: string) {
    setActiveSport(key);
    setFilterLeagueId("all");
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Sport tabs */}
      <div
        className="flex gap-1 mb-4 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        {SPORTS_CONFIG.map((s) => (
          <button
            key={s.key}
            className={`tab-btn ${activeSport === s.key ? "tab-btn-active" : ""}`}
            onClick={() => handleSportChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* League filter */}
      {sportLeagues.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <label
            className="text-sm shrink-0"
            style={{ color: "var(--color-muted)" }}
          >
            League:
          </label>
          <select
            className="form-input"
            style={{ width: "auto" }}
            value={filterLeagueId}
            onChange={(e) => setFilterLeagueId(e.target.value)}
          >
            <option value="all">All {sportLabel} Leagues</option>
            {sportLeagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-xs ml-1" style={{ color: "var(--color-muted)" }}>
            {filtered.length} trade{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-sm italic" style={{ color: "var(--color-muted)" }}>
          Loading…
        </p>
      ) : (
        <>
          {sportLeagues.length === 0 && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {filtered.length} trade{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <HistoryList entries={filtered} onDelete={handleDelete} />
        </>
      )}
    </div>
  );
}
