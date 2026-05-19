import { NextResponse } from 'next/server'
import type { NflDbPlayer, NflPlayerPosition } from '@/lib/nfl-types'
import nflPlayersJson from '@/lib/nfl-players.json'

// ── GET /api/nfl ────────────────────────────────────────────────────────────
// Supports two modes:
//
//   ?endpoint=all-seasons  (preferred)
//     Returns both current (2025) and prior (2024) season data in one call.
//     Response: {
//       currentSeason: { seasonId: "2025", players: NflDbPlayer[], source: 'espn'|'fallback' },
//       priorSeason:   { seasonId: "2024", players: NflDbPlayer[], source: 'espn'|'fallback' },
//     }
//
//   (no params)  — legacy, current season only
//     Response: { data: NflDbPlayer[], source: 'espn' | 'fallback' }

const CURRENT_NFL_YEAR = 2025
const PRIOR_NFL_YEAR   = 2024

// Static fallback datasets — generated from Sleeper API (scripts/fetch-nfl-players.mjs)
const STATIC_PLAYERS_2025 = nflPlayersJson.currentSeason.players as NflDbPlayer[]
const STATIC_PLAYERS_2024 = nflPlayersJson.priorSeason.players   as NflDbPlayer[]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const endpoint = searchParams.get('endpoint')

  if (endpoint === 'all-seasons') {
    const [currentResult, priorResult] = await Promise.all([
      getPlayersForSeason(CURRENT_NFL_YEAR),
      getPlayersForSeason(PRIOR_NFL_YEAR),
    ])
    return NextResponse.json({
      currentSeason: { seasonId: String(CURRENT_NFL_YEAR), ...currentResult },
      priorSeason:   { seasonId: String(PRIOR_NFL_YEAR),   ...priorResult  },
    })
  }

  // Legacy: return current season only
  const result = await getPlayersForSeason(CURRENT_NFL_YEAR)
  return NextResponse.json({ data: result.players, source: result.source })
}

// ── Season loader ────────────────────────────────────────────────────────────

async function getPlayersForSeason(
  year: number
): Promise<{ players: NflDbPlayer[]; source: 'espn' | 'fallback' }> {
  const espnResult = await tryEspnForSeason(year)
  if (espnResult && espnResult.length >= 100) {
    return { players: espnResult, source: 'espn' }
  }
  return {
    players: year === CURRENT_NFL_YEAR ? STATIC_PLAYERS_2025 : STATIC_PLAYERS_2024,
    source: 'fallback',
  }
}

// ── ESPN fetch (parameterized by season year) ────────────────────────────────

const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl'

// ESPN defaultPositionId → our NflPlayerPosition
const ESPN_POSITION_MAP: Record<number, NflPlayerPosition> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST',
}

// ESPN proTeamId → team abbreviation
const ESPN_TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL',
  7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC',
  13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO',
  19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX',
  33: 'BAL', 34: 'HOU',
}

// ESPN stat IDs
const S = {
  passYds:     '3',
  passTDs:     '4',
  passInt:     '20',
  rushYds:     '25',
  rushTDs:     '26',
  rec:         '53',
  recYds:      '58',
  recTDs:      '59',
  fumblesLost: '68',
  fgMade0to39: '74',
  fgMade40to49:'77',
  fgMade50plus:'80',
  fgMissed:    '72',
  patMade:     '85',
  patMissed:   '86',
  sacks:       '99',
  defInt:      '100',
  fumbRec:     '101',
  defTDs:      '91',
  ptsAllowed:  '127',
} as const

type EspnStats = Record<string, number>

function getStat(stats: EspnStats, key: string): number {
  return typeof stats[key] === 'number' ? stats[key] : 0
}

async function tryEspnForSeason(year: number): Promise<NflDbPlayer[] | null> {
  try {
    const url = `${ESPN_BASE}/seasons/${year}/segments/0/leagues/0?view=kona_player_info`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(url, {
      headers: {
        'X-Fantasy-Filter': JSON.stringify({
          players: {
            limit: 1000,
            sortPercOwned: { sortAsc: false, sortPriority: 1 },
            filterSlotIds: { value: [0, 1, 2, 3, 4, 5, 6, 16, 20, 21, 23] },
          },
        }),
        'Accept': 'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) return null
    const json = await res.json() as { players?: unknown[] }
    if (!Array.isArray(json.players) || json.players.length === 0) return null

    const players: NflDbPlayer[] = []
    let uid = 9000

    for (const raw of json.players) {
      try {
        const entry = raw as {
          playerPoolEntry?: {
            player?: {
              id?: number
              fullName?: string
              proTeamId?: number
              defaultPositionId?: number
              stats?: Array<{
                seasonId?: number
                statSplitTypeId?: number
                stats?: EspnStats
              }>
            }
          }
        }

        const p = entry.playerPoolEntry?.player
        if (!p) continue

        const pos = ESPN_POSITION_MAP[p.defaultPositionId ?? -1]
        if (!pos) continue

        // Full-season stats (statSplitTypeId === 0) for the requested year
        const seasonStats = (p.stats ?? []).find(
          s => s.seasonId === year && s.statSplitTypeId === 0
        )
        if (!seasonStats?.stats) continue

        const st = seasonStats.stats
        const id = p.id ?? ++uid

        const gp = 17
        const estimatedGp = pos === 'QB'
          ? Math.min(17, Math.max(1, Math.round(getStat(st, S.passYds) / 250)))
          : pos === 'RB'
          ? Math.min(17, Math.max(1, Math.round(getStat(st, S.rushYds) / 65)))
          : pos === 'WR' || pos === 'TE'
          ? Math.min(17, Math.max(1, Math.round(getStat(st, S.recYds) / 55)))
          : gp

        players.push({
          id,
          name: p.fullName ?? `Player ${id}`,
          team: ESPN_TEAM_MAP[p.proTeamId ?? -1] ?? 'FA',
          position: pos,
          gamesPlayed: Math.max(1, estimatedGp),
          stats: {
            passYds:      getStat(st, S.passYds),
            passTDs:      getStat(st, S.passTDs),
            passInt:      getStat(st, S.passInt),
            rushYds:      getStat(st, S.rushYds),
            rushTDs:      getStat(st, S.rushTDs),
            rec:          getStat(st, S.rec),
            recYds:       getStat(st, S.recYds),
            recTDs:       getStat(st, S.recTDs),
            fumblesLost:  getStat(st, S.fumblesLost),
            fgMade0to39:  getStat(st, S.fgMade0to39),
            fgMade40to49: getStat(st, S.fgMade40to49),
            fgMade50plus: getStat(st, S.fgMade50plus),
            fgMissed:     getStat(st, S.fgMissed),
            patMade:      getStat(st, S.patMade),
            patMissed:    getStat(st, S.patMissed),
            sacks:        getStat(st, S.sacks),
            ints:         getStat(st, S.defInt),
            fumbRec:      getStat(st, S.fumbRec),
            defTDs:       getStat(st, S.defTDs),
            ptsAllowed:   getStat(st, S.ptsAllowed),
          },
        })
      } catch {
        // skip malformed player entries
      }
    }

    return players
  } catch {
    return null
  }
}

