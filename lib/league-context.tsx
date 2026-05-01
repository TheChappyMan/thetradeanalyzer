"use client";

import React, { createContext, useContext, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type LeagueContextValue = {
  /** The currently selected league UUID per sport, e.g. { nhl: "uuid-…", nfl: null } */
  selectedLeagueId: Record<string, string | null>;
  /** Update the selected league for one sport. Pass null to deselect. */
  setSelectedLeague: (sport: string, leagueId: string | null) => void;
};

// ── Context ────────────────────────────────────────────────────────────────

const LeagueContext = createContext<LeagueContextValue>({
  selectedLeagueId: {},
  setSelectedLeague: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const [selectedLeagueId, setSelectedLeagueId] = useState<
    Record<string, string | null>
  >({});

  function setSelectedLeague(sport: string, leagueId: string | null) {
    setSelectedLeagueId((prev) => ({ ...prev, [sport]: leagueId }));
  }

  return (
    <LeagueContext.Provider value={{ selectedLeagueId, setSelectedLeague }}>
      {children}
    </LeagueContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useLeagueContext(): LeagueContextValue {
  return useContext(LeagueContext);
}
