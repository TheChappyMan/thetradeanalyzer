// ============================================================
// NFL TYPES
// ============================================================

/** All roster slot positions including bench/IR */
export type NflPosition =
  | "QB" | "RB" | "WR" | "TE" | "K" | "DST"
  | "FLEX" | "BN" | "IR";

/** Only positions that map to actual players on the field */
export type NflPlayerPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

/** Slots per position in a roster */
export type NflRoster = Record<NflPosition, number>;

/** Per-stat scoring weights */
export type NflScoringWeights = {
  // ── Passing ──────────────────────────────────────────────
  passYds: number;       // per yard (e.g. 0.04 = 1pt/25yds)
  passTDs: number;       // per TD
  passInt: number;       // per INT (negative)

  // ── Rushing ──────────────────────────────────────────────
  rushYds: number;       // per yard (e.g. 0.1 = 1pt/10yds)
  rushTDs: number;       // per TD

  // ── Receiving ────────────────────────────────────────────
  rec: number;           // per reception (0 std / 0.5 half / 1 full PPR)
  recYds: number;        // per yard
  recTDs: number;        // per TD

  // ── Turnovers ────────────────────────────────────────────
  fumblesLost: number;   // per fumble lost (negative)

  // ── Kicker ───────────────────────────────────────────────
  fgMade0to39: number;
  fgMade40to49: number;
  fgMade50plus: number;
  fgMissed: number;      // per miss (negative)
  patMade: number;
  patMissed: number;     // per miss (negative)

  // ── Defense / Special Teams (counting stats) ─────────────
  sacks: number;
  ints: number;          // defensive interceptions
  fumbRec: number;       // fumble recoveries
  defTDs: number;        // defensive/ST touchdowns

  // ── DST: points-allowed step function ────────────────────
  ptsAllowed0: number;      // 0 pts allowed
  ptsAllowed1to6: number;
  ptsAllowed7to13: number;
  ptsAllowed14to20: number;
  ptsAllowed21to27: number;
  ptsAllowed28to34: number;
  ptsAllowed35plus: number;
};

/** Raw seasonal stats stored per player */
export type NflPlayerStats = {
  // Skill positions
  passYds?: number;
  passTDs?: number;
  passInt?: number;
  rushYds?: number;
  rushTDs?: number;
  rec?: number;
  recYds?: number;
  recTDs?: number;
  fumblesLost?: number;
  // Kicker
  fgMade0to39?: number;
  fgMade40to49?: number;
  fgMade50plus?: number;
  fgMissed?: number;
  patMade?: number;
  patMissed?: number;
  // DST
  sacks?: number;
  ints?: number;
  fumbRec?: number;
  defTDs?: number;
  ptsAllowed?: number;   // total points allowed for the season
  ydsAllowed?: number;   // total yards allowed for the season
};

/** A player entry in the NFL player database */
export type NflDbPlayer = {
  id: number;
  name: string;
  team: string;
  position: NflPlayerPosition;
  gamesPlayed: number;
  stats: NflPlayerStats;
};

/** Full NFL league configuration */
export type NflLeague = {
  name: string;
  teams: number;
  leagueType: "redraft" | "keeper";
  keepersPerTeam: number;
  qbFormat: "1QB" | "2QB";
  pprFormat: "standard" | "half" | "full";
  roster: NflRoster;
  scoringWeights: NflScoringWeights;
};

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_NFL_ROSTER: NflRoster = {
  QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 7, IR: 1,
};

/** Standard half-PPR 1QB 12-team scoring */
export const DEFAULT_NFL_SCORING_WEIGHTS: NflScoringWeights = {
  passYds:         0.04,  // 1 pt / 25 yds
  passTDs:         4,
  passInt:        -2,
  rushYds:         0.1,   // 1 pt / 10 yds
  rushTDs:         6,
  rec:             0.5,   // half PPR
  recYds:          0.1,   // 1 pt / 10 yds
  recTDs:          6,
  fumblesLost:    -2,
  fgMade0to39:     3,
  fgMade40to49:    4,
  fgMade50plus:    5,
  fgMissed:       -1,
  patMade:         1,
  patMissed:      -1,
  sacks:           1,
  ints:            2,
  fumbRec:         2,
  defTDs:          6,
  ptsAllowed0:     10,
  ptsAllowed1to6:   7,
  ptsAllowed7to13:  4,
  ptsAllowed14to20: 1,
  ptsAllowed21to27: 0,
  ptsAllowed28to34:-1,
  ptsAllowed35plus:-4,
};

export const DEFAULT_NFL_LEAGUE: NflLeague = {
  name: "",
  teams: 12,
  leagueType: "redraft",
  keepersPerTeam: 0,
  qbFormat: "1QB",
  pprFormat: "half",
  roster: DEFAULT_NFL_ROSTER,
  scoringWeights: DEFAULT_NFL_SCORING_WEIGHTS,
};
