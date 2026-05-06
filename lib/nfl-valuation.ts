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
 * Project full-season (17-game) fantasy value for a player.
 *
 * useRates=true  (Avg mode): divides raw stats by gamesPlayed then × 17.
 * useRates=false (Total mode): uses raw season totals directly.
 *
 * DST points-allowed scoring always uses per-game average for bracket
 * lookup, regardless of mode.
 */
export function projectedNflValue(
  player: NflDbPlayer,
  weights: NflScoringWeights,
  useRates: boolean = true
): number {
  const gp = player.gamesPlayed
  if (gp === 0) return 0
  const s = player.stats

  if (player.position === 'K') {
    const total =
      (s.fgMade0to39  ?? 0) * weights.fgMade0to39  +
      (s.fgMade40to49 ?? 0) * weights.fgMade40to49 +
      (s.fgMade50plus ?? 0) * weights.fgMade50plus +
      (s.fgMissed     ?? 0) * weights.fgMissed     +
      (s.patMade      ?? 0) * weights.patMade      +
      (s.patMissed    ?? 0) * weights.patMissed
    return useRates ? (total / gp) * 17 : total
  }

  if (player.position === 'DST') {
    const countingTotal =
      (s.sacks   ?? 0) * weights.sacks  +
      (s.ints    ?? 0) * weights.ints   +
      (s.fumbRec ?? 0) * weights.fumbRec +
      (s.defTDs  ?? 0) * weights.defTDs

    // Points-allowed step function: always uses per-game average for bracket lookup
    const avgPtsAllowed = (s.ptsAllowed ?? 0) / gp
    const ptsAllowedPerGame = dstPtsAllowedScore(avgPtsAllowed, weights)

    return useRates
      ? (countingTotal / gp + ptsAllowedPerGame) * 17
      : countingTotal + ptsAllowedPerGame * gp
  }

  // ── Skill positions (QB / RB / WR / TE) ───────────────────
  const skillTotal =
    (s.passYds     ?? 0) * weights.passYds     +
    (s.passTDs     ?? 0) * weights.passTDs     +
    (s.passInt     ?? 0) * weights.passInt     +
    (s.rushYds     ?? 0) * weights.rushYds     +
    (s.rushTDs     ?? 0) * weights.rushTDs     +
    (s.rec         ?? 0) * weights.rec         +
    (s.recYds      ?? 0) * weights.recYds      +
    (s.recTDs      ?? 0) * weights.recTDs      +
    (s.fumblesLost ?? 0) * weights.fumblesLost

  return useRates ? (skillTotal / gp) * 17 : skillTotal
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
  qbFormat: '1QB' | '2QB',
  useRates: boolean = true
): number {
  const values = allPlayers
    .filter(p => p.position === position)
    .map(p => projectedNflValue(p, weights, useRates))
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

// ============================================================
// RB POSITIONAL SCARCITY
// ============================================================

/**
 * Running backs have a steep value cliff: elite RBs are
 * disproportionately scarce relative to every other position.
 * This multiplier amplifies the gap between the top of the RB
 * pool and the rest.  Applied after base VAR, before the
 * fairness comparison.  Keeper multiplier stacks on top.
 *
 * @param rbRank  1-based rank of this RB among all RBs, sorted
 *                by descending base VAR.
 */
export function rbScarcityMultiplier(rbRank: number): number {
  if (rbRank <= 5)  return 1.30
  if (rbRank <= 10) return 1.20
  if (rbRank <= 15) return 1.10
  if (rbRank <= 24) return 1.00
  return 0.90
}

/**
 * UI tier label for RB player cards.
 * Returns null for ranks 16+ (no badge shown).
 */
export function rbScarcityTier(rbRank: number): 'elite' | 'scarce' | null {
  if (rbRank <= 5)  return 'elite'
  if (rbRank <= 15) return 'scarce'
  return null
}

// ============================================================
// TE POSITIONAL SCARCITY
// ============================================================

/**
 * Tight end scarcity is as severe as RB, possibly worse.  Most
 * leagues start only one TE, so the gap between a top-3 TE and
 * TE12 is enormous.  An elite TE functions like a cheat code.
 * Applied after base VAR, before the fairness comparison.
 * Keeper multiplier stacks on top.
 *
 * @param teRank  1-based rank of this TE among all TEs, sorted
 *                by descending base VAR.
 */
export function teScarcityMultiplier(teRank: number): number {
  if (teRank <= 3)  return 1.40
  if (teRank <= 6)  return 1.25
  if (teRank <= 12) return 1.10
  if (teRank <= 20) return 1.00
  return 0.85
}

/**
 * UI tier label for TE player cards.
 * Returns null for ranks 13+ (no badge shown).
 */
export function teScarcityTier(teRank: number): 'elite' | 'scarce' | null {
  if (teRank <= 3)  return 'elite'
  if (teRank <= 12) return 'scarce'
  return null
}
