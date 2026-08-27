/**
 * Draft-pick helpers shared by the Settings pick-list builder and the
 * Rankings Draft Mode. Picks use the same round.slot format ("1.09")
 * as the analyzer's pick valuation, where slot is the position within
 * the round (snake order is baked into the generated slot numbers).
 */

import type { Roster } from './types'

export type DraftFormat = 'snake' | 'linear'

/** Draft-pick configuration saved inside the NHL league settings. */
export type DraftPicksConfig = {
  teams: number
  slot: number
  format: DraftFormat
  /** Owned picks in round.slot format, e.g. ["1.09", "2.04"]. */
  picks: string[]
}

/** Number of draft rounds a league needs: every non-IR roster spot. */
export function draftRounds(roster: Roster): number {
  const { IR, IRplus, ...draftable } = roster
  void IR; void IRplus
  return Object.values(draftable).reduce((a, b) => a + (b || 0), 0)
}

/** Generate the full pick list for one team (before any pick trades). */
export function generateDraftPicks(
  teams: number,
  slot: number,
  format: DraftFormat,
  rounds: number
): string[] {
  const picks: string[] = []
  for (let r = 1; r <= rounds; r++) {
    const pos = format === 'linear' || r % 2 === 1 ? slot : teams + 1 - slot
    picks.push(`${r}.${String(pos).padStart(2, '0')}`)
  }
  return picks
}

export type ParsedDraftPick = { raw: string; round: number; slot: number; overall: number }

/** Parse "round.slot" into overall pick number; null if invalid for the league size. */
export function parseDraftPick(raw: string, teams: number): ParsedDraftPick | null {
  const m = raw.trim().match(/^(\d+)\.(\d+)$/)
  if (!m) return null
  const round = parseInt(m[1], 10)
  const slot = parseInt(m[2], 10)
  if (round < 1 || slot < 1 || slot > teams) return null
  return { raw: raw.trim(), round, slot, overall: (round - 1) * teams + slot }
}
