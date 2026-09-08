import type { NflDbPlayer, NflPlayerPosition, NflRoster, NflScoringWeights } from './nfl-types'
import {
  projectedNflValue,
  valueAboveReplacement,
  rbScarcityMultiplier,
  teScarcityMultiplier,
  nflInjuryMultiplier,
} from './nfl-valuation'

// ============================================================
// NFL DRAFT MODE — RECOMMENDATION LAYER
// ============================================================
// Extracted from app/rankings/NflRankings.tsx so the verification harness
// (scripts/verify-nfl) exercises the exact code the UI runs — never a copy.
// Pure function: no React, no fetching.
//
// Design decisions this encodes (see git log for the debugging history):
// - Bars and scarcity ranks use the FULL pool, not the available pool:
//   per-available bars fall fastest at whichever position the board (and
//   the user) drafted most, inverting positional need, and
//   rank-1-of-available pins elite multipliers on leftover players.
// - QB tiers: starter slots open (dedicated + superflex) → full need
//   priority with the superflex value boost. Starters filled → QBs hard
//   suppressed from all badge tiers until the final 3 owned picks, and
//   only below a hard cap of starters + 1 insurance QB (superflex 3,
//   1QB 2) — at the cap, suppressed through the end of the draft.
// - K/DST: suppressed until the final two owned picks (or all skill needs
//   covered); in the final two picks, unfilled K/DST slots lead the list.

// A player at a position the roster already covers is only recommended when
// its value overwhelms the best need-filling option by this factor.
export const NFL_REC_OVERWHELM = 1.5

// Bye-stacking penalty on a candidate's REC SCORE (recommendation layer
// only — the valuation engine, VAR, rankings order, and trade values never
// see this). Soft by design: it breaks near-ties and demotes marginal picks
// but can never override a large VAR gap — the worst factor (0.85) flips at
// most a 1/0.85 ≈ 17.6% edge, so a candidate 20%+ clear of the alternatives
// stays on top regardless of bye. Counts only lineup-relevant roster players
// (K/DST are skipped on both sides). Tuning candidate.
export const BYE_STACK_PENALTY = {
  /** 2 same-bye players already on roster */ two: 0.95,
  /** 3+ same-bye players already on roster */ threePlus: 0.85,
} as const

export type NflDraftRecInput = {
  playerDb: NflDbPlayer[]
  taken: Record<number, 'league' | 'mine'>
  /** Full-pool replacement bars — the same map the rankings table uses. */
  replacementLevels: Map<NflPlayerPosition, number>
  weights: NflScoringWeights
  roster: NflRoster
  qbFormat: '1QB' | '2QB'
  teams: number
  useRates: boolean
  availabilityDiscountActive: boolean
  picksRemaining: number
  /** Optional: ids whose internal base VAR should be reported (harness). */
  probeIds?: number[]
}

/** Starter-urgency tier: 1 = empty dedicated starter slot, 2 = flex
 *  coverage open, 3 = below bench-inclusive target, null = fully covered. */
export type NflRecTier = 1 | 2 | 3 | null

export type NflDraftRecResult = {
  /** Ordered candidate ids for the badge tiers (green, 2× amber, 2× orange). */
  recIds: number[]
  diag: {
    qbSuppressed: boolean
    qbStartersOpen: boolean
    allowKDst: boolean
    needsByPos: Record<string, boolean>
    /** Starter-urgency tier per position (see NflRecTier). */
    tierByPos: Record<string, NflRecTier>
    /** True when remaining picks are all spoken for by unfilled starting
     *  slots + required K/DST — recs restricted to exactly those. */
    feasibilityGuard: boolean
    /** Internal base VAR for each requested probeId. */
    probeBaseVar: Record<number, number>
    /** My lineup-relevant players per bye week (no K/DST). */
    myByeCounts: Record<number, number>
  }
}

export function computeNflDraftRecs(input: NflDraftRecInput): NflDraftRecResult {
  const {
    playerDb, taken, replacementLevels, weights, roster, qbFormat,
    useRates, availabilityDiscountActive, picksRemaining, probeIds,
  } = input

  const available = playerDb.filter((p) => taken[p.id] === undefined)

  const projOf = new Map(playerDb.map((p) => [p.id, projectedNflValue(p, weights, useRates)]))
  const baseVar = (p: NflDbPlayer) =>
    valueAboveReplacement(projOf.get(p.id) ?? 0, replacementLevels.get(p.position) ?? 0)

  // RB/TE/QB scarcity multipliers by VAR rank across the FULL pool —
  // drafting the RB1 does not turn RB20 into an "elite" RB1.
  const scarcityRank = new Map<number, number>()
  for (const pos of ['RB', 'TE', 'QB'] as const) {
    playerDb
      .filter((p) => p.position === pos)
      .sort((a, b) => baseVar(b) - baseVar(a))
      .forEach((p, i) => scarcityRank.set(p.id, i + 1))
  }

  // In 2QB/Superflex the second QB slot counts as a dedicated QB slot
  // (superflex drafts fill it with a QB by value).
  const qbSlots = qbFormat === '2QB' ? Math.max(roster.QB ?? 1, 2) : (roster.QB ?? 1)
  const mine = playerDb.filter((p) => taken[p.id] === 'mine')
  const myQBs = mine.filter((p) => p.position === 'QB').length

  const qbStartersOpen = myQBs < qbSlots
  // Hard cap: starters + 1 insurance QB. At the cap, QB stays suppressed
  // through the end of the draft — the final-picks window must not
  // re-enable a 4th superflex QB.
  const qbCap = qbSlots + 1
  const finalPicksWindow = picksRemaining > 0 && picksRemaining <= 3 && myQBs < qbCap
  const qbSuppressed = !qbStartersOpen && !finalPicksWindow

  // Superflex/2QB: QBs are the scarcest superflex asset; mirror the RB/TE
  // market-calibration tiers so top QBs surface early. Turns off once the
  // starter slots are filled (a bench QB competes at face value).
  const qbSuperflexMultiplier = (rank: number): number =>
    rank <= 5 ? 1.40 : rank <= 10 ? 1.25 : rank <= 15 ? 1.10 : 1.0
  const adjVar = (p: NflDbPlayer) => {
    let v = baseVar(p) * nflInjuryMultiplier(p.injuryStatus, availabilityDiscountActive)
    const rank = scarcityRank.get(p.id)
    if (!rank) return v
    if (p.position === 'RB') v *= rbScarcityMultiplier(rank)
    else if (p.position === 'TE') v *= teScarcityMultiplier(rank)
    else if (p.position === 'QB' && qbFormat === '2QB' && qbStartersOpen) {
      v *= qbSuperflexMultiplier(rank)
    }
    return v
  }

  // Positional targets: starters + bench share, mirroring the engine's
  // bench-aware replacement (1 bench to QB, rest proportional RB/WR/TE).
  const bench = roster.BN ?? 0
  const qbBench = Math.min(1, bench)
  const remainingBench = Math.max(0, bench - qbBench)
  const flex = roster.FLEX ?? 0
  const rbSF = (roster.RB ?? 0) + flex * 0.5
  const wrSF = (roster.WR ?? 0) + flex * 0.4
  const teSF = (roster.TE ?? 0) + flex * 0.1
  const sfTotal = rbSF + wrSF + teSF
  const benchFor = (sf: number) => (sfTotal > 0 ? remainingBench * (sf / sfTotal) : 0)
  const target: Record<NflPlayerPosition, number> = {
    QB: qbSlots + qbBench,
    RB: rbSF + benchFor(rbSF),
    WR: wrSF + benchFor(wrSF),
    TE: teSF + benchFor(teSF),
    K: roster.K ?? 0,
    DST: roster.DST ?? 0,
  }
  const myCount: Record<string, number> = {}
  for (const p of mine) myCount[p.position] = (myCount[p.position] ?? 0) + 1

  // QB need is starters-only: once the dedicated (and superflex) slots are
  // filled, a QB is never a "need" — the hard suppression above governs
  // whether he can appear at all.
  const needs = (pos: NflPlayerPosition) =>
    pos === 'QB' ? qbStartersOpen : (myCount[pos] ?? 0) < target[pos] - 1e-9

  // K/DST suppression: never recommend until my final two owned picks,
  // unless every skill-position need is already fully covered.
  const skillNeedsRemain = (['QB', 'RB', 'WR', 'TE'] as const).some(needs)
  const allowKDst = picksRemaining > 0 && (picksRemaining <= 2 || !skillNeedsRemain)

  // Bye-stacking: count my lineup-relevant players (no K/DST) per bye week;
  // a candidate sharing a bye with 2+ of them takes a soft rec-score penalty.
  const myByeCounts: Record<number, number> = {}
  for (const p of mine) {
    if (p.position === 'K' || p.position === 'DST') continue
    if (p.byeWeek !== undefined) myByeCounts[p.byeWeek] = (myByeCounts[p.byeWeek] ?? 0) + 1
  }
  const byePenalty = (p: NflDbPlayer): number => {
    if (p.position === 'K' || p.position === 'DST') return 1
    const n = p.byeWeek !== undefined ? (myByeCounts[p.byeWeek] ?? 0) : 0
    return n >= 3 ? BYE_STACK_PENALTY.threePlus : n === 2 ? BYE_STACK_PENALTY.two : 1
  }

  // ── Starter-urgency tiers (recommendation layer only) ──────
  // 1 = EMPTY STARTER: fewer players than dedicated starting slots
  // 2 = OPEN FLEX: dedicated starters filled, flex coverage not
  // 3 = BENCH DEPTH: starters + flex covered, below bench-inclusive target
  // null = fully covered.
  // Recommendations come from the best (lowest) tier that has candidates:
  // an empty WR starting slot always outranks a 5th RB chasing bench
  // depth, no matter the VAR gap (the flat need flag let exactly that
  // happen — the "5th RB over 0 WR / 0 TE" live bug).
  const dedicated: Record<NflPlayerPosition, number> = {
    QB: qbSlots, RB: roster.RB ?? 0, WR: roster.WR ?? 0, TE: roster.TE ?? 0,
    K: roster.K ?? 0, DST: roster.DST ?? 0,
  }
  const startersFlexOf: Record<NflPlayerPosition, number> = {
    QB: qbSlots, RB: rbSF, WR: wrSF, TE: teSF, K: dedicated.K, DST: dedicated.DST,
  }
  const tierOf = (pos: NflPlayerPosition): NflRecTier => {
    const c = myCount[pos] ?? 0
    // QB need is starters-only (hard suppression governs the rest);
    // K/DST have no flex or bench share.
    if (pos === 'QB') return qbStartersOpen ? 1 : null
    if (pos === 'K' || pos === 'DST') return c < dedicated[pos] ? 1 : null
    if (c < dedicated[pos]) return 1
    if (c < startersFlexOf[pos] - 1e-9) return 2
    if (c < target[pos] - 1e-9) return 3
    return null
  }

  // ── Feasibility guard ──────────────────────────────────────
  // When my remaining owned picks are no more than the unfilled starting
  // slots (dedicated deficits + uncovered FLEX) plus required K/DST,
  // every pick is spoken for: recommend exclusively those slots. This
  // generalizes the K/DST final-two-picks logic.
  const posDeficit = (pos: NflPlayerPosition) => Math.max(0, dedicated[pos] - (myCount[pos] ?? 0))
  const skillSurplus = (['RB', 'WR', 'TE'] as const)
    .reduce((s, pos) => s + Math.max(0, (myCount[pos] ?? 0) - dedicated[pos]), 0)
  const flexUnfilled = Math.max(0, flex - skillSurplus)
  const requiredSlots =
    posDeficit('QB') + posDeficit('RB') + posDeficit('WR') + posDeficit('TE') +
    flexUnfilled + posDeficit('K') + posDeficit('DST')
  const feasibilityGuard = picksRemaining > 0 && requiredSlots > 0 && picksRemaining <= requiredSlots
  const guardAllows = (pos: NflPlayerPosition): boolean => {
    if (pos === 'QB' || pos === 'K' || pos === 'DST') return posDeficit(pos) > 0
    return posDeficit(pos) > 0 || flexUnfilled > 0
  }

  const candidates = available.filter((p) => {
    // Under the guard, required K/DST bypass their usual suppression —
    // those slots ARE what the remaining picks must fill.
    if (feasibilityGuard) return guardAllows(p.position)
    if (p.position === 'K' || p.position === 'DST') return allowKDst
    if (p.position === 'QB') return !qbSuppressed
    return true
  })
  const scored = candidates
    .map((p) => ({ p, value: adjVar(p) * byePenalty(p), need: needs(p.position), tier: tierOf(p.position) }))
    .sort((a, b) => b.value - a.value)

  // Best (lowest) tier among candidates. The OVERWHELM hatch may reach
  // exactly ONE tier past it (a 1.5× value edge lets a tier-2 candidate
  // interleave with tier 1) — it can never lift a tier-3 or fully-covered
  // position over a tier-1 need. Covered positions (no tier) appear only
  // via that hatch when the best tier is already 3.
  const tierRank = (t: NflRecTier): number => t ?? 4
  const bestTier = scored.length ? Math.min(...scored.map((s) => tierRank(s.tier))) : 4
  const bestTierTop = scored.find((s) => tierRank(s.tier) === bestTier)?.value ?? 0
  const effectiveTier = (s: (typeof scored)[number]): number => {
    const t = tierRank(s.tier)
    return t === bestTier + 1 && s.value >= bestTierTop * NFL_REC_OVERWHELM ? bestTier : t
  }
  let recs = scored
    .map((s) => ({ ...s, eTier: effectiveTier(s) }))
    .filter((s) => s.eTier < 4) // fully-covered positions only via the hatch
    .sort((a, b) => a.eTier - b.eTier || b.value - a.value)
    .slice(0, 5)

  // Final two owned picks: unfilled K/DST slots lead the recommendations
  // (raw VAR would keep burying them under leftover skill players).
  if (picksRemaining > 0 && picksRemaining <= 2) {
    const kdBest = (['K', 'DST'] as const)
      .filter(needs)
      .map((pos) => scored.find((s) => s.p.position === pos))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
      .map((s) => ({ ...s, eTier: 1 }))
    if (kdBest.length > 0) {
      const kdIds = new Set(kdBest.map((s) => s.p.id))
      const rest = recs.filter((r) => !kdIds.has(r.p.id))
      recs = [...kdBest, ...rest].slice(0, 5)
    }
  }

  const probeBaseVar: Record<number, number> = {}
  for (const id of probeIds ?? []) {
    const p = playerDb.find((x) => x.id === id)
    if (p) probeBaseVar[id] = baseVar(p)
  }

  return {
    recIds: recs.map((r) => r.p.id),
    diag: {
      qbSuppressed,
      qbStartersOpen,
      allowKDst,
      needsByPos: {
        QB: needs('QB'), RB: needs('RB'), WR: needs('WR'),
        TE: needs('TE'), K: needs('K'), DST: needs('DST'),
      },
      tierByPos: {
        QB: tierOf('QB'), RB: tierOf('RB'), WR: tierOf('WR'),
        TE: tierOf('TE'), K: tierOf('K'), DST: tierOf('DST'),
      },
      feasibilityGuard,
      probeBaseVar,
      myByeCounts,
    },
  }
}
