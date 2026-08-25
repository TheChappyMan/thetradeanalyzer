/**
 * MLB valuation engine — extracted from app/mlb/page.tsx so other pages
 * (e.g. /rankings) can rank players with the exact same math the trade
 * analyzer uses. Pure functions only; no React, no fetching.
 */

import type {
  HitterStatKey,
  PitcherStatKey,
  HitterWeights,
  PitcherWeights,
  CategoryConfig,
  MlbRoster,
  MlbRosterKey,
} from './mlb-types';

export type MlbPlayerStats = Partial<Record<HitterStatKey | PitcherStatKey, number>>;

export type MlbDbPlayer = {
  id: number;       // unique: mlbId*10 for hitters, mlbId*10+1 for pitchers
  mlbId: number;
  name: string;
  team: string;
  position: string; // C 1B 2B 3B SS OF DH  /  SP RP
  isPitcher: boolean;
  gamesPlayed: number;
  gamesStarted: number;
  age: number | null;
  isSuspectedCloser: boolean;
  stats: MlbPlayerStats;
};

// ── Helpers ────────────────────────────────────────────────────

export function asNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function parseRate(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || s === "-.--" || s === "-.---") return 0;
    return parseFloat(s.startsWith(".") ? "0" + s : s) || 0;
  }
  return 0;
}

export function parseIP(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parts = v.split(".");
    const full   = parseInt(parts[0], 10) || 0;
    const thirds = parseInt(parts[1] || "0", 10);
    return full + thirds / 3;
  }
  return 0;
}

export function normalizeHitterPosition(abbrev: string, posType: string): string {
  if (abbrev === "LF" || abbrev === "CF" || abbrev === "RF") return "OF";
  if (abbrev === "OF" || posType === "Outfield")              return "OF";
  if (abbrev === "C")                                          return "C";
  if (abbrev === "1B")                                         return "1B";
  if (abbrev === "2B")                                         return "2B";
  if (abbrev === "3B")                                         return "3B";
  if (abbrev === "SS")                                         return "SS";
  if (abbrev === "DH")                                         return "DH";
  if (abbrev === "P"  || posType === "Pitcher")                return "P"; // exclude
  return "";
}

export type MlbStatSplit = {
  stat: Record<string, unknown>;
  player: { id: number; fullName: string };
  team: { abbreviation?: string; name?: string };
  position?: { abbreviation?: string; name?: string; type?: string };
};

export function buildPlayerDatabase(args: {
  hitters: MlbStatSplit[];
  pitchers: MlbStatSplit[];
  ageMap: Record<number, number>;
}): MlbDbPlayer[] {
  const db: MlbDbPlayer[] = [];
  const seenH = new Set<number>();
  const seenP = new Set<number>();

  for (const split of args.hitters) {
    const mlbId = split.player.id;
    if (!mlbId || seenH.has(mlbId)) continue;
    seenH.add(mlbId);

    const abbrev  = split.position?.abbreviation ?? "";
    const posType = split.position?.type ?? "";
    const position = normalizeHitterPosition(abbrev, posType);
    if (!position || position === "P") continue;

    const s  = split.stat;
    const gp = asNumber(s.gamesPlayed);
    if (gp === 0) continue;

    db.push({
      id: mlbId * 10,
      mlbId,
      name: split.player.fullName,
      team: split.team.abbreviation ?? "",
      position,
      isPitcher: false,
      gamesPlayed: gp,
      gamesStarted: 0,
      age: args.ageMap[mlbId] ?? null,
      isSuspectedCloser: false,
      stats: {
        G:   gp,
        R:   asNumber(s.runs),
        HR:  asNumber(s.homeRuns),
        RBI: asNumber(s.rbi),
        SB:  asNumber(s.stolenBases),
        AVG: parseRate(s.avg),
        OBP: parseRate(s.obp),
        SLG: parseRate(s.slg),
        H:   asNumber(s.hits),
        "1B": asNumber(s.hits) - asNumber(s.doubles) - asNumber(s.triples) - asNumber(s.homeRuns),
        "2B": asNumber(s.doubles),
        "3B": asNumber(s.triples),
        BB:  asNumber(s.baseOnBalls),
        K:   asNumber(s.strikeOuts),
        XBH: asNumber(s.doubles) + asNumber(s.triples) + asNumber(s.homeRuns),
        TB:  asNumber(s.totalBases),
        CS:  asNumber(s.caughtStealing),
        AB:  asNumber(s.atBats),
        SF:  asNumber(s.sacFlies),
        SH:  asNumber(s.sacBunts),
        HBP: asNumber(s.hitByPitch),
        GIDP: asNumber(s.groundIntoDoublePlay),
        PA:  asNumber(s.plateAppearances),
        // Fielding totals — merged into hitting splits by /api/mlb
        PO:  asNumber(s.putOuts),
        A:   asNumber(s.assists),
        E:   asNumber(s.errors),
      },
    });
  }

  for (const split of args.pitchers) {
    const mlbId = split.player.id;
    if (!mlbId || seenP.has(mlbId)) continue;
    seenP.add(mlbId);

    const s   = split.stat;
    const gp  = asNumber(s.gamesPlayed);
    const gs  = asNumber(s.gamesStarted);
    if (gp === 0) continue;

    const position = gs / Math.max(gp, 1) >= 0.5 ? "SP" : "RP";
    const saves = asNumber(s.saves);
    const ip    = parseIP(s.inningsPitched);
    const hr9   = ip > 0 ? (asNumber(s.homeRuns) * 9) / ip : 0;
    const bf    = asNumber(s.battersFaced);
    const kPct  = bf > 0 ? asNumber(s.strikeOuts) / bf : 0;

    db.push({
      id: mlbId * 10 + 1,
      mlbId,
      name: split.player.fullName,
      team: split.team.abbreviation ?? "",
      position,
      isPitcher: true,
      gamesPlayed: gp,
      gamesStarted: gs,
      age: args.ageMap[mlbId] ?? null,
      isSuspectedCloser: position === "RP" && saves >= 10,
      stats: {
        W:    asNumber(s.wins),
        L:    asNumber(s.losses),
        SV:   saves,
        BS:   asNumber(s.blownSaves),
        HLD:  asNumber(s.holds),
        K:    asNumber(s.strikeOuts),
        ERA:  parseRate(s.era),
        WHIP: parseRate(s.whip),
        IP:   ip,
        OUTS: asNumber(s.outs),
        QS:   asNumber(s.qualityStarts),
        GS:   gs,
        CG:   asNumber(s.completeGames),
        NH:   asNumber(s.noHitters),     // injected by /api/mlb from game logs
        PG:   asNumber(s.perfectGames),  // injected by /api/mlb from game logs
        H:    asNumber(s.hits),
        ER:   asNumber(s.earnedRuns),
        HR:   asNumber(s.homeRuns),
        BB:   asNumber(s.baseOnBalls),
        HBP:  asNumber(s.hitBatsmen),
        BLK:  asNumber(s.balks),
        HR9:  hr9,
        "K/9":  parseRate(s.strikeoutsPer9Inn),
        "K/BB": parseRate(s.strikeoutWalkRatio),
        "K%":   kPct,
      },
    });
  }

  return db;
}

// ============================================================
// SEASON NORMALIZATION
// ============================================================

export const RATE_HITTER  = new Set<HitterStatKey>(["AVG", "OBP", "SLG"]);
export const RATE_PITCHER = new Set<PitcherStatKey>(["ERA", "WHIP", "HR9", "K/9", "K/BB", "K%"]);

export function normalizeHitterTo162(player: MlbDbPlayer): MlbDbPlayer {
  if (player.isPitcher || player.gamesPlayed === 0) return player;
  const gp = player.gamesPlayed;
  const stats: MlbPlayerStats = {};
  for (const [k, v] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (v === undefined) continue;
    (stats as Record<string, number>)[k] = RATE_HITTER.has(k as HitterStatKey)
      ? v
      : (v / gp) * 162;
  }
  return { ...player, gamesPlayed: 162, stats };
}

export function normalizeSpTo32(player: MlbDbPlayer): MlbDbPlayer {
  if (!player.isPitcher || player.position !== "SP") return player;
  const gs = Math.max(player.gamesStarted, player.gamesPlayed);
  if (gs === 0) return player;
  const stats: MlbPlayerStats = {};
  for (const [k, v] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (v === undefined) continue;
    (stats as Record<string, number>)[k] = RATE_PITCHER.has(k as PitcherStatKey)
      ? v
      : (v / gs) * 32;
  }
  return { ...player, gamesPlayed: 32, gamesStarted: 32, stats };
}

export function normalizeRpTo70(player: MlbDbPlayer): MlbDbPlayer {
  if (!player.isPitcher || player.position !== "RP") return player;
  const gp = player.gamesPlayed;
  if (gp === 0) return player;
  const stats: MlbPlayerStats = {};
  for (const [k, v] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (v === undefined) continue;
    (stats as Record<string, number>)[k] = RATE_PITCHER.has(k as PitcherStatKey)
      ? v
      : (v / gp) * 70;
  }
  return { ...player, gamesPlayed: 70, stats };
}


// ============================================================
// VALUATION – Points mode
// ============================================================

export function projectedSeasonValue(
  player: MlbDbPlayer,
  hitterWeights: HitterWeights,
  pitcherWeights: PitcherWeights,
  useRates: boolean
): number {
  if (player.isPitcher) {
    const isSP     = player.position === "SP";
    const gamesBase = Math.max(isSP ? player.gamesStarted : 0, player.gamesPlayed);
    if (gamesBase === 0) return 0;
    const projection = isSP ? 32 : 70;
    let total = 0;
    for (const [stat, weight] of Object.entries(pitcherWeights)) {
      if (!weight) continue;
      const value   = player.stats[stat as PitcherStatKey] ?? 0;
      const isRate  = RATE_PITCHER.has(stat as PitcherStatKey);
      if (!useRates) {
        total += value * weight;
      } else if (isRate) {
        total += value * weight;
      } else {
        total += (value / gamesBase) * projection * weight;
      }
    }
    return total;
  } else {
    const gp = player.gamesPlayed;
    if (gp === 0) return 0;
    const projection = 162;
    let total = 0;
    for (const [stat, weight] of Object.entries(hitterWeights)) {
      if (!weight) continue;
      const value  = player.stats[stat as HitterStatKey] ?? 0;
      const isRate = RATE_HITTER.has(stat as HitterStatKey);
      if (!useRates) {
        total += value * weight;
      } else if (isRate) {
        total += value * weight;
      } else {
        total += (value / gp) * projection * weight;
      }
    }
    return total;
  }
}

// ============================================================
// VALUATION – Z-score roto mode
// ============================================================

export type StatPoolStats  = { mean: number; stddev: number; avgVolume?: number };
export type MlbPoolStats   = {
  hitterStats:  Partial<Record<HitterStatKey,  StatPoolStats>>;
  pitcherStats: Partial<Record<PitcherStatKey, StatPoolStats>>;
  /** League-adjusted pool sizes — replacement level is rank N+1 */
  hitterN:  number;
  pitcherN: number;
  /** Median games played among pool members (thin-sample fallback threshold) */
  hitterMedianGp:  number;
  pitcherMedianGp: number;
};

export function _median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Volume-weighted pitcher rate stats — longer stints count more than short ones.
export const VOL_PITCHER_RATES = new Set<PitcherStatKey>(["ERA", "WHIP", "K/9", "K/BB", "K%"]);

// ── Below-replacement soft floor ─────────────────────────────
// A hard clamp at 0 makes every below-replacement player at a position
// price identically, so trading a good bench piece for a bad one reads
// as even. Instead, below-replacement values are compressed into a
// narrow positive band that preserves ordering: value approaches 0 as
// the deficit grows but never ties. Continuous at the replacement point
// (diff = 0 → BAND on both branches).
export const BELOW_REPL_BAND = 0.05;
export function softReplacementValue(diff: number): number {
  return diff >= 0 ? diff + BELOW_REPL_BAND : BELOW_REPL_BAND * Math.exp(diff / 2);
}

// A category with (near-)zero spread, or where almost nobody in the pool
// registers the stat, produces meaningless exploding z-scores. Skip it.
export const MIN_STAT_STDDEV   = 1e-6;
export const MIN_NONZERO_SHARE = 0.2;

/**
 * Mean/stddev over a sample, excluding null/undefined entries entirely
 * (a missing stat must not drag the mean toward zero — only real values,
 * including real zeros, belong in the distribution).
 */
export function _meanStddevFiltered(sample: Array<number | null | undefined>): {
  mean: number; stddev: number; count: number; nonZero: number;
} {
  const values = sample.filter(
    (v): v is number => typeof v === "number" && !Number.isNaN(v)
  );
  if (values.length === 0) return { mean: 0, stddev: 0, count: 0, nonZero: 0 };
  const mean     = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return {
    mean,
    stddev: Math.sqrt(variance),
    count: values.length,
    nonZero: values.filter((v) => v !== 0).length,
  };
}

/**
 * Pool stats for one category, or null (with a console warning) when the
 * category has no usable signal in the pool.
 */
export function _statPoolOrSkip(
  stat: string,
  sample: Array<number | null | undefined>,
  extra?: { avgVolume: number }
): StatPoolStats | null {
  const { mean, stddev, count, nonZero } = _meanStddevFiltered(sample);
  if (count === 0 || stddev < MIN_STAT_STDDEV || nonZero / count < MIN_NONZERO_SHARE) {
    console.warn(
      `[MLB pool] skipping category ${stat}: stddev=${stddev.toFixed(6)}, ` +
      `nonZero=${nonZero}/${count} — not enough signal in the pool for a meaningful z-score`
    );
    return null;
  }
  return extra ? { mean, stddev, ...extra } : { mean, stddev };
}

export function computeMlbPoolStats(
  playerDb: MlbDbPlayer[],
  teams: number,
  roster: MlbRoster,
  hitterStats: HitterStatKey[],
  pitcherStats: PitcherStatKey[],
  useRates: boolean
): MlbPoolStats {
  const hitters  = playerDb.filter((p) => !p.isPitcher && p.gamesPlayed > 0);
  const pitchers = playerDb.filter((p) =>  p.isPitcher && p.gamesPlayed > 0);

  const hitterSlots  = (["C", "1B", "2B", "3B", "SS", "CI", "MI", "IF", "OF", "LF", "CF", "RF", "UTIL"] as MlbRosterKey[])
    .reduce((s, k) => s + (roster[k] || 0), 0);
  const pitcherSlots = (["SP", "RP", "P"] as MlbRosterKey[])
    .reduce((s, k) => s + (roster[k] || 0), 0);

  const hitterN = Math.max(60, teams * hitterSlots);

  // Pitcher pool mirrors roster construction: starters and relievers are
  // drafted from different distributions (closers are rostered for saves
  // despite low IP). Selecting the pool purely by IP fills it with starters,
  // which collapses the SV distribution and explodes every closer's z-score.
  // P flex slots are split evenly between the two groups.
  const flexP = teams * (roster.P || 0);
  const spN = Math.max(20, teams * (roster.SP || 0) + Math.ceil(flexP / 2));
  const rpN = Math.max(10, teams * (roster.RP || 0) + Math.floor(flexP / 2));

  // DEBUG — verify pool sizes are league-adjusted, not full database
  console.log(
    "[MLB pool]",
    `hitters in DB: ${hitters.length}  →  pool hitterN: ${hitterN}  (${teams} teams × ${hitterSlots} slots, min 60)`,
    `| pitchers in DB: ${pitchers.length}  →  pool ${spN} SP + ${rpN} RP  (${teams} teams × ${pitcherSlots} slots)`,
    "| z-scores computed against top-N pool, not full DB"
  );

  // Sort by playing-time proxies
  const topHitters  = [...hitters]
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, hitterN);
  const byIp = (a: MlbDbPlayer, b: MlbDbPlayer) => (b.stats.IP || 0) - (a.stats.IP || 0);
  // Relievers are rostered for leverage (saves and holds), not innings —
  // selecting RPs by IP fills the pool with long relievers and leaves the
  // actual closers out, which shrinks the SV stddev and inflates closer z.
  const byLeverage = (a: MlbDbPlayer, b: MlbDbPlayer) =>
    ((b.stats.SV ?? 0) + (b.stats.HLD ?? 0)) - ((a.stats.SV ?? 0) + (a.stats.HLD ?? 0)) ||
    byIp(a, b);
  const topPitchers = [
    ...pitchers.filter((p) => p.position === "SP").sort(byIp).slice(0, spN),
    ...pitchers.filter((p) => p.position === "RP").sort(byLeverage).slice(0, rpN),
  ];

  const hitterPoolStats:  Partial<Record<HitterStatKey,  StatPoolStats>> = {};
  const pitcherPoolStats: Partial<Record<PitcherStatKey, StatPoolStats>> = {};

  for (const stat of hitterStats) {
    if (RATE_HITTER.has(stat)) {
      // AVG/OBP/SLG: volume-weighted by at-bats in both modes — a 1.000
      // average over 4 AB must not out-z a .330 average over 400 AB.
      const sample  = topHitters.map((p) => p.stats[stat]);
      const volumes = topHitters.map((p) => p.stats.AB ?? 0);
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
      const ps = _statPoolOrSkip(stat, sample, { avgVolume });
      if (ps) hitterPoolStats[stat] = ps;
      continue;
    }
    // null/undefined entries stay nullish so the pool excludes them
    const sample = topHitters.map((p) => {
      const raw = p.stats[stat];
      if (raw === null || raw === undefined) return raw;
      if (!useRates) return raw;
      return raw / (p.gamesPlayed || 1);
    });
    const ps = _statPoolOrSkip(stat, sample);
    if (ps) hitterPoolStats[stat] = ps;
  }

  for (const stat of pitcherStats) {
    if (VOL_PITCHER_RATES.has(stat)) {
      // ERA/WHIP: volume-weighted by IP in BOTH modes — a 45 IP reliever's
      // rate must not carry the same weight as a 190 IP starter's.
      const sample  = topPitchers.map((p) => p.stats[stat]);
      const volumes = topPitchers.map((p) => p.stats.IP ?? 0);
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
      const ps = _statPoolOrSkip(stat, sample, { avgVolume });
      if (ps) pitcherPoolStats[stat] = ps;
    } else if (RATE_PITCHER.has(stat) || !useRates) {
      // Rate stats compare raw values; totals mode compares raw totals
      const ps = _statPoolOrSkip(stat, topPitchers.map((p) => p.stats[stat]));
      if (ps) pitcherPoolStats[stat] = ps;
    } else {
      // Rates mode counting stats: per-game
      const sample = topPitchers.map((p) => {
        const raw = p.stats[stat];
        if (raw === null || raw === undefined) return raw;
        return raw / (p.gamesPlayed || 1);
      });
      const ps = _statPoolOrSkip(stat, sample);
      if (ps) pitcherPoolStats[stat] = ps;
    }
  }

  return {
    hitterStats:  hitterPoolStats,
    pitcherStats: pitcherPoolStats,
    hitterN,
    pitcherN: spN + rpN,
    hitterMedianGp:  _median(topHitters.map((p) => p.gamesPlayed)),
    pitcherMedianGp: _median(topPitchers.map((p) => p.gamesPlayed)),
  };
}

export function _hitterZ(
  player: MlbDbPlayer, stat: HitterStatKey,
  ps: StatPoolStats, useRates: boolean
): number {
  if (ps.stddev === 0) return 0;
  const raw = player.stats[stat] ?? 0;
  // AVG/OBP/SLG: volume-weighted by AB in both modes (mirrors ERA/WHIP by IP)
  if (RATE_HITTER.has(stat) && ps.avgVolume !== undefined && ps.avgVolume > 0) {
    const ab = player.stats.AB ?? 0;
    return (raw - ps.mean) * (ab / ps.avgVolume) / ps.stddev;
  }
  const value = (!useRates || RATE_HITTER.has(stat))
    ? raw
    : raw / (player.gamesPlayed || 1);
  return (value - ps.mean) / ps.stddev;
}

export function _pitcherZ(
  player: MlbDbPlayer, stat: PitcherStatKey,
  ps: StatPoolStats, useRates: boolean
): number {
  if (ps.stddev === 0) return 0;
  const raw = player.stats[stat] ?? 0;
  // ERA/WHIP: volume-weighted by IP in both modes — same pattern as the
  // NHL SV%/GAA handling. Low-IP arms move the number less.
  if (VOL_PITCHER_RATES.has(stat) && ps.avgVolume !== undefined && ps.avgVolume > 0) {
    const ip = player.stats.IP ?? 0;
    return (raw - ps.mean) * (ip / ps.avgVolume) / ps.stddev;
  }
  if (!useRates) return (raw - ps.mean) / ps.stddev;
  // Other rate stats or counting stats divided by games
  const value = RATE_PITCHER.has(stat) ? raw : raw / (player.gamesPlayed || 1);
  return (value - ps.mean) / ps.stddev;
}

export function mlbZScoreValue(
  player: MlbDbPlayer,
  hitterCategories:  Record<HitterStatKey,  CategoryConfig | null>,
  pitcherCategories: Record<PitcherStatKey, CategoryConfig | null>,
  poolStats:   MlbPoolStats,
  hitterStats: HitterStatKey[],
  pitcherStats: PitcherStatKey[],
  useRates: boolean
): number {
  if (player.gamesPlayed === 0) return 0;
  let total = 0;
  if (player.isPitcher) {
    for (const stat of pitcherStats) {
      const cfg = pitcherCategories[stat];
      const ps  = poolStats.pitcherStats[stat];
      if (!cfg || !ps) continue;
      const z = _pitcherZ(player, stat, ps, useRates);
      total += cfg.direction === "less" ? -z : z;
    }
  } else {
    for (const stat of hitterStats) {
      const cfg = hitterCategories[stat];
      const ps  = poolStats.hitterStats[stat];
      if (!cfg || !ps) continue;
      const z = _hitterZ(player, stat, ps, useRates);
      total += cfg.direction === "less" ? -z : z;
    }
  }
  return total;
}


/**
 * Positional replacement z-levels: the best player at each position outside
 * the number of starters the league must field there. CI/MI/IF/LF/CF/RF fold
 * into base positions; UTIL deepens every hitter position uniformly; P flex
 * splits SP/RP. DH-only players use the global hitter bar (rank hitterN+1).
 * `zOf` supplies the z-value per player so callers can inject the
 * thin-sample fallback (the analyzer does) or use raw entries.
 */
export function computeMlbReplacement(
  playerDb: MlbDbPlayer[],
  teams: number,
  roster: MlbRoster,
  hitterN: number,
  zOf: (p: MlbDbPlayer) => number
): { byPosition: Record<string, number>; required: Record<string, number> } {
  const slot = (k: MlbRosterKey) => roster[k] || 0;
  const HITTER_GROUPS = ['C', '1B', '2B', '3B', 'SS', 'OF'] as const;
  const utilPerPos = (teams * slot('UTIL')) / HITTER_GROUPS.length;
  const required: Record<string, number> = {
    C:    Math.round(teams * slot('C') + utilPerPos),
    '1B': Math.round(teams * (slot('1B') + slot('CI') / 2 + slot('IF') / 4) + utilPerPos),
    '2B': Math.round(teams * (slot('2B') + slot('MI') / 2 + slot('IF') / 4) + utilPerPos),
    '3B': Math.round(teams * (slot('3B') + slot('CI') / 2 + slot('IF') / 4) + utilPerPos),
    SS:   Math.round(teams * (slot('SS') + slot('MI') / 2 + slot('IF') / 4) + utilPerPos),
    OF:   Math.round(teams * (slot('OF') + slot('LF') + slot('CF') + slot('RF')) + utilPerPos),
    SP:   teams * slot('SP') + Math.ceil((teams * slot('P')) / 2),
    RP:   teams * slot('RP') + Math.floor((teams * slot('P')) / 2),
  };

  const zsByGroup: Record<string, number[]> = {};
  const allHitterZ: number[] = [];
  for (const p of playerDb) {
    if (p.gamesPlayed === 0) continue;
    const z = zOf(p);
    if (p.isPitcher) {
      (zsByGroup[p.position] ??= []).push(z);       // SP | RP
    } else {
      allHitterZ.push(z);
      if (p.position !== 'DH') (zsByGroup[p.position] ??= []).push(z);
    }
  }

  const byPosition: Record<string, number> = {};
  for (const [group, req] of Object.entries(required)) {
    const zs = (zsByGroup[group] ?? []).sort((a, b) => b - a);
    byPosition[group] = zs.length === 0 ? 0 : zs[Math.min(req, zs.length - 1)] ?? 0;
  }
  allHitterZ.sort((a, b) => b - a);
  byPosition.DH = allHitterZ[Math.min(hitterN, Math.max(0, allHitterZ.length - 1))] ?? 0;
  return { byPosition, required };
}
