import type {
  NflDbPlayer,
  NflPlayerPosition,
  NflScoringWeights,
  NflRoster,
} from './nfl-types'

// ============================================================
// PROJECTED SEASON VALUE
// ============================================================

/**
 * Project full-season (17-game) fantasy value for a player using their
 * per-game rates and the provided scoring weights.
 *
 * DST points-allowed scoring uses a step function: the player's average
 * points allowed per game determines which bracket fires each week.
 */
export function projectedNflValue(
  player: NflDbPlayer,
  weights: NflScoringWeights
): number {
  const gp = player.gamesPlayed
  if (gp === 0) return 0
  const s = player.stats

  if (player.position === 'K') {
    const perGame =
      ((s.fgMade0to39  ?? 0) / gp) * weights.fgMade0to39  +
      ((s.fgMade40to49 ?? 0) / gp) * weights.fgMade40to49 +
      ((s.fgMade50plus ?? 0) / gp) * weights.fgMade50plus +
      ((s.fgMissed     ?? 0) / gp) * weights.fgMissed     +
      ((s.patMade      ?? 0) / gp) * weights.patMade      +
      ((s.patMissed    ?? 0) / gp) * weights.patMissed
    return perGame * 17
  }

  if (player.position === 'DST') {
    const countingPerGame =
      ((s.sacks   ?? 0) / gp) * weights.sacks  +
      ((s.ints    ?? 0) / gp) * weights.ints   +
      ((s.fumbRec ?? 0) / gp) * weights.fumbRec +
      ((s.defTDs  ?? 0) / gp) * weights.defTDs

    // Points-allowed step function applied per game
    const avgPtsAllowed = (s.ptsAllowed ?? 0) / gp
    const ptsAllowedPtsPerGame = dstPtsAllowedScore(avgPtsAllowed, weights)

    return (countingPerGame + ptsAllowedPtsPerGame) * 17
  }

  // ── Skill positions (QB / RB / WR / TE) ───────────────────
  const perGame =
    ((s.passYds     ?? 0) / gp) * weights.passYds     +
    ((s.passTDs     ?? 0) / gp) * weights.passTDs     +
    ((s.passInt     ?? 0) / gp) * weights.passInt     +
    ((s.rushYds     ?? 0) / gp) * weights.rushYds     +
    ((s.rushTDs     ?? 0) / gp) * weights.rushTDs     +
    ((s.rec         ?? 0) / gp) * weights.rec         +
    ((s.recYds      ?? 0) / gp) * weights.recYds      +
    ((s.recTDs      ?? 0) / gp) * weights.recTDs      +
    ((s.fumblesLost ?? 0) / gp) * weights.fumblesLost

  return perGame * 17
}

/**
 * Given an average points-allowed per game, return the fantasy points
 * the DST earns for points allowed in a typical week.
 */
function dstPtsAllowedScore(
  avgPtsAllowed: number,
  weights: NflScoringWeights
): number {
  if (avgPtsAllowed === 0)  return weights.ptsAllowed0
  if (avgPtsAllowed <= 6)   return weights.ptsAllowed1to6
  if (avgPtsAllowed <= 13)  return weights.ptsAllowed7to13
  if (avgPtsAllowed <= 20)  return weights.ptsAllowed14to20
  if (avgPtsAllowed <= 27)  return weights.ptsAllowed21to27
  if (avgPtsAllowed <= 34)  return weights.ptsAllowed28to34
  return weights.ptsAllowed35plus
}

// ============================================================
// REPLACEMENT LEVEL
// ============================================================

/**
 * The projected value of the last startable player at a given position.
 *
 * For QB: startable count = teams × 1 (1QB) or teams × 2 (2QB).
 * For K / DST: startable count = teams × roster slots.
 * For RB / WR / TE: dedicated slots + estimated share of FLEX slots.
 *   - RB  ≈ 50 % of FLEX
 *   - WR  ≈ 40 % of FLEX
 *   - TE  ≈ 10 % of FLEX
 */
export function replacementLevelValue(
  position: NflPlayerPosition,
  allPlayers: NflDbPlayer[],
  weights: NflScoringWeights,
  roster: NflRoster,
  teams: number,
  qbFormat: '1QB' | '2QB'
): number {
  const values = allPlayers
    .filter(p => p.position === position)
    .map(p => projectedNflValue(p, weights))
    .sort((a, b) => b - a)

  if (values.length === 0) return 0

  let startableCount: number

  switch (position) {
    case 'QB':
      startableCount = teams * (qbFormat === '2QB' ? 2 : 1)
      break
    case 'K':
      startableCount = teams * (roster.K ?? 0)
      break
    case 'DST':
      startableCount = teams * (roster.DST ?? 0)
      break
    case 'RB':
    case 'WR':
    case 'TE': {
      const dedicated = teams * (roster[position] ?? 0)
      const flexTotal = teams * (roster.FLEX ?? 0)
      const flexShare = position === 'RB' ? 0.5 : position === 'WR' ? 0.4 : 0.1
      startableCount  = Math.round(dedicated + flexTotal * flexShare)
      break
    }
    default:
      startableCount = teams
  }

  const idx = Math.min(startableCount, values.length - 1)
  return values[idx] ?? 0
}

// ============================================================
// VALUE ABOVE REPLACEMENT
// ============================================================

/**
 * The trade-relevant value of a player: how much they produce above
 * the freely-available replacement at their position.
 * Always >= 0; a below-replacement player contributes 0 VAR.
 */
export function valueAboveReplacement(
  projectedValue: number,
  replacementLevel: number
): number {
  return Math.max(0, projectedValue - replacementLevel)
}
