"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLeagueContext } from "@/lib/league-context";
import { useUser } from "@clerk/nextjs";
import {
  DEFAULT_NFL_LEAGUE,
  type NflLeague,
  type NflDbPlayer,
  type NflPlayerPosition,
  type NflPlayerStats,
  type NflRoster,
} from "@/lib/nfl-types";
import {
  projectedNflValue,
  replacementLevelValue,
  valueAboveReplacement,
} from "@/lib/nfl-valuation";

// ============================================================
// NFL LEAGUE RANKINGS
// ============================================================
// Available to ALL signed-in users (free and paid). Ranks every player by
// projected points under the user's own league settings (paid users load
// their saved league; free users get the standard defaults), and highlights
// the stats where a player beats the average of the DRAFTABLE pool — the
// top (teams × roster spots) players — at his position.

type DataMode  = "thisTotal" | "thisAvg" | "lastTotal" | "lastAvg";
type DbStatus  = "loading" | "ready" | "error";
type LeagueRow = { id: string; name: string; sport: string; settings: unknown };

const LS_NFL_DATA_MODE = "fta-nfl-data-mode"; // shared with the analyzer

const NFL_POSITIONS: NflPlayerPosition[] = ["QB", "RB", "WR", "TE", "K", "DST"];

// Stat columns shown per position. `perGame: true` displays total/GP
// (used for DST points allowed, which is unreadable as a season total).
type StatColumn = { key: keyof NflPlayerStats; label: string; perGame?: boolean };

const POSITION_COLUMNS: Record<NflPlayerPosition, StatColumn[]> = {
  QB: [
    { key: "passYds", label: "Pass Yds" }, { key: "passTDs", label: "Pass TD" },
    { key: "passInt", label: "INT" }, { key: "rushYds", label: "Rush Yds" },
    { key: "rushTDs", label: "Rush TD" },
  ],
  RB: [
    { key: "rushAtt", label: "Att" }, { key: "rushYds", label: "Rush Yds" },
    { key: "rushTDs", label: "Rush TD" }, { key: "rec", label: "Rec" },
    { key: "recYds", label: "Rec Yds" }, { key: "recTDs", label: "Rec TD" },
    { key: "fumblesLost", label: "Fum" },
  ],
  WR: [
    { key: "rec", label: "Rec" }, { key: "recYds", label: "Rec Yds" },
    { key: "recTDs", label: "Rec TD" }, { key: "rushYds", label: "Rush Yds" },
    { key: "rushTDs", label: "Rush TD" },
  ],
  TE: [
    { key: "rec", label: "Rec" }, { key: "recYds", label: "Rec Yds" },
    { key: "recTDs", label: "Rec TD" },
  ],
  K: [
    { key: "fgMade0to39", label: "FG 0–39" }, { key: "fgMade40to49", label: "FG 40–49" },
    { key: "fgMade50plus", label: "FG 50+" }, { key: "fgMissed", label: "FG Miss" },
    { key: "patMade", label: "PAT" },
  ],
  DST: [
    { key: "sacks", label: "Sacks" }, { key: "ints", label: "INT" },
    { key: "fumbRec", label: "Fum Rec" }, { key: "defTDs", label: "TD" },
    { key: "ptsAllowed", label: "PA/G", perGame: true },
  ],
};

// Stats where LOWER is better — highlight when below the pool average
const NEGATIVE_STATS = new Set<keyof NflPlayerStats>([
  "passInt", "fumblesLost", "fgMissed", "patMissed", "ptsAllowed",
]);

// ── Season normalization (same as the analyzer) ─────────────
function normalizePlayerTo17(player: NflDbPlayer): NflDbPlayer {
  if (player.gamesPlayed === 0) return player;
  const gp = player.gamesPlayed;
  const stats: NflDbPlayer["stats"] = {};
  for (const [key, val] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (val !== undefined) {
      (stats as Record<string, number>)[key] = (val / gp) * 17;
    }
  }
  return { ...player, gamesPlayed: 17, stats };
}

export default function NflRankings() {
  const { user, isLoaded: clerkLoaded } = useUser();
  const tier    = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro   = tier === "tier1" || tier === "tier2" || tier === "tier3";
  const { selectedLeagueId: ctxLeagueIds } = useLeagueContext();

  // ── League settings ───────────────────────────────────────
  // Every premium user gets a league selector; the initial selection
  // follows the league chosen on the dashboard (league context).
  const [league, setLeague] = useState<NflLeague>(DEFAULT_NFL_LEAGUE);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  useEffect(() => {
    if (!clerkLoaded || !isPro) return;
    let cancelled = false;
    fetch("/api/leagues?sport=nfl")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: LeagueRow[] } | null) => {
        if (cancelled) return;
        const rows = json?.data ?? [];
        setLeagues(rows);
        const ctxId = ctxLeagueIds["nfl"];
        setActiveLeagueId(rows.find((r) => r.id === ctxId)?.id ?? rows[0]?.id ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clerkLoaded, isPro]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeLeagueId) return;
    const row = leagues.find((r) => r.id === activeLeagueId);
    if (row?.settings) applySettings(row.settings as NflLeague);
  }, [activeLeagueId, leagues]);

  function applySettings(settings: NflLeague) {
    setLeague({
      ...DEFAULT_NFL_LEAGUE,
      ...settings,
      roster:         { ...DEFAULT_NFL_LEAGUE.roster,         ...settings.roster },
      scoringWeights: { ...DEFAULT_NFL_LEAGUE.scoringWeights, ...settings.scoringWeights },
    });
  }

  // ── Player data (live via /api/nfl) ───────────────────────
  const [currentSeasonDb, setCurrentSeasonDb] = useState<NflDbPlayer[]>([]);
  const [priorSeasonDb,   setPriorSeasonDb]   = useState<NflDbPlayer[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState("");
  const [priorSeasonId,   setPriorSeasonId]   = useState("");
  const [dbStatus, setDbStatus] = useState<DbStatus>("loading");
  const [dataMode, setDataMode] = useState<DataMode>(() => {
    try { return (localStorage.getItem(LS_NFL_DATA_MODE) as DataMode) || "thisTotal"; }
    catch { return "thisTotal"; }
  });

  useEffect(() => {
    type SeasonPayload = { seasonId: string; players: NflDbPlayer[]; hasData: boolean };
    let cancelled = false;
    fetch("/api/nfl?endpoint=all-seasons")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { currentSeason: SeasonPayload; priorSeason: SeasonPayload }) => {
        if (cancelled) return;
        setCurrentSeasonDb(json.currentSeason.players);
        setPriorSeasonDb(json.priorSeason.players);
        setCurrentSeasonId(json.currentSeason.seasonId);
        setPriorSeasonId(json.priorSeason.seasonId);
        if (!json.currentSeason.hasData) {
          setDataMode((prev) =>
            prev === "thisTotal" || prev === "thisAvg" ? "lastTotal" : prev);
        }
        setDbStatus("ready");
      })
      .catch(() => { if (!cancelled) setDbStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  const playerDb = useMemo(() => {
    const base = (dataMode === "thisTotal" || dataMode === "thisAvg")
      ? currentSeasonDb : priorSeasonDb;
    return (dataMode === "thisAvg" || dataMode === "lastAvg")
      ? base.map(normalizePlayerTo17) : base;
  }, [dataMode, currentSeasonDb, priorSeasonDb]);

  const useRates = dataMode === "thisAvg" || dataMode === "lastAvg";

  // ── Rankings ──────────────────────────────────────────────
  const replacementLevels = useMemo(() => {
    const map = new Map<NflPlayerPosition, number>();
    if (playerDb.length === 0) return map;
    for (const pos of NFL_POSITIONS) {
      map.set(pos, replacementLevelValue(
        pos, playerDb, league.scoringWeights,
        league.roster as NflRoster, league.teams, league.qbFormat, useRates,
      ));
    }
    return map;
  }, [playerDb, league.scoringWeights, league.roster, league.teams, league.qbFormat, useRates]);

  type RankedPlayer = { p: NflDbPlayer; proj: number; var_: number; rank: number };

  const ranked: RankedPlayer[] = useMemo(() => {
    return playerDb
      .map((p) => {
        const proj = projectedNflValue(p, league.scoringWeights, useRates);
        const repl = replacementLevels.get(p.position) ?? 0;
        return { p, proj, var_: valueAboveReplacement(proj, repl), rank: 0 };
      })
      .sort((a, b) => b.proj - a.proj)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [playerDb, league.scoringWeights, replacementLevels, useRates]);

  // ── Draftable pool + per-position stat averages ───────────
  // Draftable = top (teams × roster spots excl. IR) players by projection.
  const draftableN = useMemo(() => {
    const r = league.roster;
    const spots = (r.QB ?? 0) + (r.RB ?? 0) + (r.WR ?? 0) + (r.TE ?? 0) +
                  (r.FLEX ?? 0) + (r.K ?? 0) + (r.DST ?? 0) + (r.BN ?? 0);
    return league.teams * spots;
  }, [league.roster, league.teams]);

  const poolAverages = useMemo(() => {
    const draftable = ranked.slice(0, draftableN);
    const byPos = new Map<NflPlayerPosition, Record<string, number>>();
    for (const pos of NFL_POSITIONS) {
      const members = draftable.filter((r) => r.p.position === pos);
      if (members.length === 0) continue;
      const avg: Record<string, number> = {};
      for (const col of POSITION_COLUMNS[pos]) {
        const values = members.map((m) => {
          const raw = m.p.stats[col.key] ?? 0;
          return col.perGame ? raw / Math.max(1, m.p.gamesPlayed) : raw;
        });
        avg[col.key as string] = values.reduce((a, b) => a + b, 0) / values.length;
      }
      byPos.set(pos, avg);
    }
    return byPos;
  }, [ranked, draftableN]);

  // ── Filters ───────────────────────────────────────────────
  const [posFilter, setPosFilter] = useState<NflPlayerPosition | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let rows = ranked;
    if (posFilter !== "ALL") rows = rows.filter((r) => r.p.position === posFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q));
    return rows;
  }, [ranked, posFilter, search]);

  const activeSeason = (dataMode === "thisTotal" || dataMode === "thisAvg")
    ? currentSeasonId : priorSeasonId;

  const columns = posFilter === "ALL" ? [] : POSITION_COLUMNS[posFilter];
  const avgForPos = posFilter === "ALL" ? undefined : poolAverages.get(posFilter);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
        <div />
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-muted)" }}>
          {dbStatus === "ready" && <span>{playerDb.length} players · Season {activeSeason}</span>}
          <select
            className="form-input text-xs"
            style={{ paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
            value={dataMode}
            onChange={(e) => {
              const m = e.target.value as DataMode;
              setDataMode(m);
              try { localStorage.setItem(LS_NFL_DATA_MODE, m); } catch {}
            }}
          >
            <option value="thisTotal">This Year – Total</option>
            <option value="thisAvg">This Year – Per-Game Proj.</option>
            <option value="lastTotal">Last Year – Total</option>
            <option value="lastAvg">Last Year – Per-Game Proj.</option>
          </select>
        </div>
      </div>

      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
        Ranked by projected points under {isPro ? "your saved league settings" : "standard league settings"}
        {" "}({league.teams} teams, {league.qbFormat}, {league.pprFormat === "standard" ? "non-PPR" : league.pprFormat === "half" ? "half-PPR" : "full PPR"}).
        {" "}The draftable pool is the top {draftableN} players (teams × roster spots).
        {" "}<span
          className="px-1 rounded"
          style={{ background: "var(--color-success-subtle)", color: "var(--color-success)" }}
        >Highlighted</span> stats beat the draftable-pool average at that position.
        {!isPro && <> Set up your own scoring in the <Link href="/nfl" className="link-primary">analyzer</Link> with a Pro plan.</>}
      </p>

      {/* Tier 2/3: league selector */}
      {isPro && leagues.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>League:</span>
          <select
            className="form-input text-xs max-w-xs"
            style={{ paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
            value={activeLeagueId ?? ""}
            onChange={(e) => setActiveLeagueId(e.target.value)}
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(["ALL", ...NFL_POSITIONS] as const).map((pos) => (
          <button
            key={pos}
            className="px-2.5 py-1 rounded-full border text-xs font-medium transition-colors"
            style={posFilter === pos
              ? { background: "var(--color-primary)", color: "#fff", borderColor: "var(--color-primary)" }
              : { color: "var(--color-muted)", borderColor: "var(--color-border)" }}
            onClick={() => setPosFilter(pos as NflPlayerPosition | "ALL")}
          >
            {pos}
          </button>
        ))}
        <input
          type="text"
          className="form-input text-xs ml-auto"
          style={{ maxWidth: "14rem", paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {dbStatus === "loading" && (
        <div className="text-sm" style={{ color: "var(--color-muted)" }}>Loading NFL data…</div>
      )}
      {dbStatus === "error" && (
        <div className="text-sm" style={{ color: "var(--color-danger)" }}>NFL API unavailable — please refresh</div>
      )}

      {dbStatus === "ready" && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs" style={{ color: "var(--color-text)" }}>
            <thead>
              <tr
                className="text-left"
                style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
              >
                <th className="px-2 py-1.5 font-medium">Rank</th>
                <th className="px-2 py-1.5 font-medium">Player</th>
                {posFilter === "ALL" && <th className="px-2 py-1.5 font-medium">Pos</th>}
                <th className="px-2 py-1.5 font-medium">Team</th>
                <th className="px-2 py-1.5 font-medium text-right">GP</th>
                <th className="px-2 py-1.5 font-medium text-right">Proj Pts</th>
                <th className="px-2 py-1.5 font-medium text-right">VAR</th>
                {columns.map((c) => (
                  <th key={c.key as string} className="px-2 py-1.5 font-medium text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const undraftable = r.rank > draftableN;
                return (
                  <tr
                    key={r.p.id}
                    className="border-t"
                    style={{
                      borderColor: "var(--color-border)",
                      opacity: undraftable ? 0.55 : 1,
                    }}
                  >
                    <td className="px-2 py-1" style={{ color: "var(--color-muted)" }}>{r.rank}</td>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">{r.p.name}</td>
                    {posFilter === "ALL" && <td className="px-2 py-1">{r.p.position}</td>}
                    <td className="px-2 py-1" style={{ color: "var(--color-muted)" }}>{r.p.team}</td>
                    <td className="px-2 py-1 text-right" style={{ color: "var(--color-muted)" }}>{r.p.gamesPlayed}</td>
                    <td className="px-2 py-1 text-right font-semibold">{r.proj.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{r.var_.toFixed(1)}</td>
                    {columns.map((c) => {
                      const raw = r.p.stats[c.key] ?? 0;
                      const value = c.perGame ? raw / Math.max(1, r.p.gamesPlayed) : raw;
                      const avg = avgForPos?.[c.key as string];
                      const better = avg !== undefined && (
                        NEGATIVE_STATS.has(c.key) ? value < avg : value > avg
                      );
                      return (
                        <td
                          key={c.key as string}
                          className="px-2 py-1 text-right"
                          style={better
                            ? { background: "var(--color-success-subtle)", color: "var(--color-success)", fontWeight: 600 }
                            : undefined}
                          title={avg !== undefined ? `Draftable-pool avg: ${avg.toFixed(1)}` : undefined}
                        >
                          {c.perGame ? value.toFixed(1) : Math.round(value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>
        Dimmed rows fall outside the draftable pool for your league size. Pick a position
        tab to see per-stat comparisons; hover a highlighted cell for the pool average.
      </p>
    </div>
  );
}
