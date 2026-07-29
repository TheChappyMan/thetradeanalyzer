import type {
  NflDbPlayer,
  NflPlayerPosition,
  NflScoringWeights,
  NflRoster,
} from './nfl-types'
import { NFL_YARD_BONUS_KEYS } from './nfl-types'

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
  let skillTotal =
    (s.passYds     ?? 0) * weights.passYds     +
    (s.passTDs     ?? 0) * weights.passTDs     +
    (s.passInt     ?? 0) * weights.passInt     +
    (s.pass2pt     ?? 0) * weights.pass2pt     +
    (s.rushYds     ?? 0) * weights.rushYds     +
    (s.rushTDs     ?? 0) * weights.rushTDs     +
    (s.rushAtt     ?? 0) * weights.rushAtt     +
    (s.rush2pt     ?? 0) * weights.rush2pt     +
    (s.rec         ?? 0) * weights.rec         +
    (s.recYds      ?? 0) * weights.recYds      +
    (s.recTDs      ?? 0) * weights.recTDs      +
    (s.rec2pt      ?? 0) * weights.rec2pt      +
    (s.fumblesLost ?? 0) * weights.fumblesLost

  // Yard bonuses: stats hold season counts of games hitting each threshold
  for (const key of NFL_YARD_BONUS_KEYS) {
    skillTotal += (s[key] ?? 0) * weights[key]
  }

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

  // ── Bench-aware effective counts (per team) ────────────────
  // Rostered bench players are not freely available, so replacement sits
  // below the bench, not just below the starters. Exactly 1 bench slot per
  // team is allocated to QB; ALL remaining bench slots distribute across
  // RB/WR/TE in proportion to each position's starter+flex count, so the
  // split self-adjusts to league format. K and DST receive no bench
  // allocation (kickers and defenses are rarely benched). IR slots are
  // excluded entirely — IR players are not acquirable replacements.
  const bench          = roster.BN ?? 0
  const qbBench        = Math.min(1, bench)
  const remainingBench = Math.max(0, bench - qbBench)
  const flex  = roster.FLEX ?? 0
  const rbSF  = (roster.RB ?? 0) + flex * 0.5
  const wrSF  = (roster.WR ?? 0) + flex * 0.4
  const teSF  = (roster.TE ?? 0) + flex * 0.1
  const sfTotal = rbSF + wrSF + teSF
  const benchFor = (sf: number) => (sfTotal > 0 ? remainingBench * (sf / sfTotal) : 0)

  const qbStarters = qbFormat === '2QB' ? 2 : 1
  const perTeam: Record<NflPlayerPosition, number> = {
    QB:  qbStarters + qbBench,
    RB:  rbSF + benchFor(rbSF),
    WR:  wrSF + benchFor(wrSF),
    TE:  teSF + benchFor(teSF),
    K:   roster.K ?? 0,
    DST: roster.DST ?? 0,
  }

  // Invariant: effective counts sum to the roster size excluding IR
  // (with QB slots counted at the format-derived starter count). The
  // proportional method satisfies this exactly; warn if it ever drifts.
  const effectiveSum = Object.values(perTeam).reduce((a, b) => a + b, 0)
  const rosterExclIr =
    qbStarters + (roster.RB ?? 0) + (roster.WR ?? 0) + (roster.TE ?? 0) +
    (roster.FLEX ?? 0) + (roster.K ?? 0) + (roster.DST ?? 0) + bench
  if (Math.abs(effectiveSum - rosterExclIr) > 1e-6) {
    console.warn(
      `[NFL replacement] effective counts (${effectiveSum.toFixed(4)}) do not sum to ` +
      `roster size excl. IR (${rosterExclIr}) — bench distribution is broken`
    )
  }

  const startableCount = Math.round(teams * perTeam[position])
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
