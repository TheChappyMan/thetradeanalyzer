"use client";

import { useState } from "react";
import type { LeagueRow } from "@/lib/types";

export type SportKey   = "nhl" | "nfl" | "mlb";
export type SaveStatus = "idle" | "saving" | "saved" | "error";

type SaveAction<T> = (
  league: T
) => Promise<{ success: boolean; error?: string; id?: string }>;

type Options<T> = {
  sport: SportKey;
  /** Settings of the league shown first (null = nothing saved yet). */
  initial: T | null;
  /** Saved league rows for this sport (tier 1: at most one). */
  initialRows: LeagueRow[];
  defaults: T;
  /** Fills fields missing from older saved settings with defaults. */
  merge: (saved: T) => T;
  /** Tier-1 server action (upserts the single league for this sport). */
  saveAction: SaveAction<T>;
  isTier2: boolean;
};

/**
 * All state and server calls for one sport's saved leagues on the Settings
 * page: the form values, the list of saved leagues, which one is selected,
 * and create / switch / save / delete. The Settings shell calls this once
 * per sport so unsaved edits survive switching between sport tabs.
 */
export function useLeagueManager<T extends { name: string }>({
  sport, initial, initialRows, defaults, merge, saveAction, isTier2,
}: Options<T>) {
  const label       = sport.toUpperCase();
  const defaultName = `My ${label} League`;

  const [league, setLeague]         = useState<T>(() => (initial ? merge(initial) : defaults));
  const [rows, setRows]             = useState<LeagueRow[]>(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null);
  const [creating, setCreating]     = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [isNew, setIsNew]           = useState(initial === null);
  const [status, setStatus]         = useState<SaveStatus>("idle");
  const [error, setError]           = useState<string | null>(null);

  // ── Tier 2: switch league ─────────────────────────────────
  function selectLeague(id: string) {
    setSelectedId(id);
    const row = rows.find((r) => r.id === id);
    setLeague(row?.settings ? merge(row.settings as T) : defaults);
  }

  // ── Tier 2: create new league ─────────────────────────────
  async function createLeague() {
    setCreating(true);
    const res = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport, name: "New League", settings: defaults }),
    });
    if (res.ok) {
      const json = await res.json();
      const newRow = json.data as LeagueRow;
      setRows((prev) => [newRow, ...prev]);
      setSelectedId(newRow.id);
      setLeague(defaults);
      setIsNew(false);
    }
    setCreating(false);
  }

  // ── Delete league (any paid tier) ─────────────────────────
  // Deleting frees the tier-1 slot (the save cap counts rows). Trade
  // history is kept: trades.league_id is ON DELETE SET NULL server-side and
  // every trade carries its own league-name snapshot, so past analyses stay
  // in Trade History (the league shows as "(deleted)" in its filter).
  async function deleteLeague(id: string) {
    setDeleting(true);
    let ok = false;
    try {
      const res = await fetch("/api/leagues", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      ok = res.ok;
      // Clear any in-progress Draft Mode state saved for this league so no
      // orphaned draft survives in localStorage (NHL/NFL only — MLB has no
      // Draft Mode).
      if (ok && sport !== "mlb") {
        try { localStorage.removeItem(`fta-draft-${sport}-${id}`); } catch {}
      }
    } catch {
      ok = false;
    } finally {
      setDeleting(false);
    }
    if (!ok) return;

    const remaining = rows.filter((l) => l.id !== id);
    setRows(remaining);
    const next = remaining[0] ?? null;
    setSelectedId(next?.id ?? null);
    setLeague(next?.settings ? merge(next.settings as T) : defaults);
    setIsNew(!next);
  }

  // ── Save ──────────────────────────────────────────────────
  async function save() {
    setStatus("saving");
    setError(null);
    const name = league.name || defaultName;

    if (isTier2 && selectedId) {
      // Update the specific league row via PUT
      const res = await fetch("/api/leagues", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedId, name, settings: league }),
      });
      if (res.ok) {
        setIsNew(false);
        setStatus("saved");
        // Sync name in local league list
        setRows((prev) => prev.map((l) => (l.id === selectedId ? { ...l, name } : l)));
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("error");
        setError("Save failed");
      }
      return;
    }

    // Tier 1: server action upsert
    const result = await saveAction(league);
    if (result.success) {
      // Keep the local row in sync so the Delete control shows the saved
      // name — and reappears right after a delete + re-create.
      if (result.id) {
        const row = { id: result.id, sport, name, settings: league } as LeagueRow;
        setRows([row]);
        setSelectedId(result.id);
      }
      setIsNew(false);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } else {
      setStatus("error");
      setError(result.error ?? "Unknown error");
    }
  }

  return {
    sport, label,
    league, setLeague,
    rows, selectedId,
    creating, deleting, isNew, status, error,
    selectLeague, createLeague, deleteLeague, save,
  };
}

export type LeagueManager<T extends { name: string }> = ReturnType<typeof useLeagueManager<T>>;
