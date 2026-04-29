import { NextResponse } from 'next/server'
import type { NflDbPlayer, NflPlayerPosition } from '@/lib/nfl-types'

// ── GET /api/nfl ────────────────────────────────────────────────────────────
// Returns NFL player stats for the 2024 season.
// Tries the ESPN Fantasy public API first; falls back to curated static data
// if the request fails or returns fewer than 100 skill-position players.
//
// Response: { data: NflDbPlayer[], source: 'espn' | 'fallback' }

export async function GET() {
  const espnResult = await tryEspn()
  if (espnResult && espnResult.length >= 100) {
    return NextResponse.json({ data: espnResult, source: 'espn' })
  }
  return NextResponse.json({ data: STATIC_PLAYERS, source: 'fallback' })
}

// ── ESPN fetch ───────────────────────────────────────────────────────────────

const ESPN_URL =
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2024/segments/0/leagues/0?view=kona_player_info'

// ESPN defaultPositionId → our NflPlayerPosition
const ESPN_POSITION_MAP: Record<number, NflPlayerPosition> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST',
}

// ESPN proTeamId → team abbreviation (2024 season)
const ESPN_TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL',
  7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC',
  13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO',
  19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX',
  33: 'BAL', 34: 'HOU',
}

// ESPN stat IDs used for parsing
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

async function tryEspn(): Promise<NflDbPlayer[] | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(ESPN_URL, {
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

        // Use full-season 2024 stats (statSplitTypeId === 0)
        const seasonStats = (p.stats ?? []).find(
          s => s.seasonId === 2024 && s.statSplitTypeId === 0
        )
        if (!seasonStats?.stats) continue

        const st = seasonStats.stats
        const id = p.id ?? ++uid

        // Estimate gamesPlayed from rush attempts or receptions as a proxy
        // (ESPN doesn't expose gamesPlayed directly in this view)
        const gp = 17 // default; refine below per position
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

// ── Static fallback data (2024 NFL season — curated) ────────────────────────
// Covers 22 QBs, 40 RBs, 50 WRs, 20 TEs, 10 Ks, 10 DST = 152 players.
// Stats represent realistic 2024 regular-season totals.

const STATIC_PLAYERS: NflDbPlayer[] = [
  // ── QBs ──────────────────────────────────────────────────────────────────
  { id:1001, name:'Lamar Jackson',      team:'BAL', position:'QB', gamesPlayed:16, stats:{ passYds:4172, passTDs:41, passInt:4,  rushYds:921, rushTDs:4 } },
  { id:1002, name:'Josh Allen',         team:'BUF', position:'QB', gamesPlayed:17, stats:{ passYds:3731, passTDs:28, passInt:6,  rushYds:531, rushTDs:12 } },
  { id:1003, name:'Jalen Hurts',        team:'PHI', position:'QB', gamesPlayed:16, stats:{ passYds:3903, passTDs:37, passInt:6,  rushYds:729, rushTDs:14 } },
  { id:1004, name:'Baker Mayfield',     team:'TB',  position:'QB', gamesPlayed:17, stats:{ passYds:4317, passTDs:41, passInt:8,  rushYds:74,  rushTDs:2  } },
  { id:1005, name:'Joe Burrow',         team:'CIN', position:'QB', gamesPlayed:16, stats:{ passYds:4641, passTDs:43, passInt:11, rushYds:89,  rushTDs:1  } },
  { id:1006, name:'Patrick Mahomes',    team:'KC',  position:'QB', gamesPlayed:17, stats:{ passYds:4183, passTDs:26, passInt:11, rushYds:391, rushTDs:4  } },
  { id:1007, name:'C.J. Stroud',        team:'HOU', position:'QB', gamesPlayed:16, stats:{ passYds:3971, passTDs:23, passInt:12, rushYds:145, rushTDs:1  } },
  { id:1008, name:'Jayden Daniels',     team:'WAS', position:'QB', gamesPlayed:17, stats:{ passYds:3568, passTDs:25, passInt:9,  rushYds:891, rushTDs:6  } },
  { id:1009, name:'Sam Darnold',        team:'MIN', position:'QB', gamesPlayed:14, stats:{ passYds:3885, passTDs:35, passInt:12, rushYds:121, rushTDs:1  } },
  { id:1010, name:'Brock Purdy',        team:'SF',  position:'QB', gamesPlayed:16, stats:{ passYds:3864, passTDs:20, passInt:12, rushYds:145, rushTDs:1  } },
  { id:1011, name:'Jordan Love',        team:'GB',  position:'QB', gamesPlayed:15, stats:{ passYds:3697, passTDs:25, passInt:11, rushYds:178, rushTDs:2  } },
  { id:1012, name:'Caleb Williams',     team:'CHI', position:'QB', gamesPlayed:17, stats:{ passYds:3541, passTDs:20, passInt:6,  rushYds:246, rushTDs:4  } },
  { id:1013, name:'Geno Smith',         team:'SEA', position:'QB', gamesPlayed:17, stats:{ passYds:3972, passTDs:20, passInt:9,  rushYds:278, rushTDs:2  } },
  { id:1014, name:'Matthew Stafford',   team:'LAR', position:'QB', gamesPlayed:17, stats:{ passYds:3762, passTDs:20, passInt:8,  rushYds:21,  rushTDs:1  } },
  { id:1015, name:'Kyler Murray',       team:'ARI', position:'QB', gamesPlayed:16, stats:{ passYds:2994, passTDs:20, passInt:5,  rushYds:512, rushTDs:4  } },
  { id:1016, name:'Dak Prescott',       team:'DAL', position:'QB', gamesPlayed:11, stats:{ passYds:2612, passTDs:15, passInt:8,  rushYds:112, rushTDs:2  } },
  { id:1017, name:'Anthony Richardson', team:'IND', position:'QB', gamesPlayed:10, stats:{ passYds:1814, passTDs:10, passInt:5,  rushYds:429, rushTDs:4  } },
  { id:1018, name:'Tua Tagovailoa',     team:'MIA', position:'QB', gamesPlayed:8,  stats:{ passYds:1922, passTDs:11, passInt:5,  rushYds:45,  rushTDs:0  } },
  { id:1019, name:'Trevor Lawrence',    team:'JAX', position:'QB', gamesPlayed:11, stats:{ passYds:2045, passTDs:13, passInt:8,  rushYds:134, rushTDs:1  } },
  { id:1020, name:'Justin Fields',      team:'PIT', position:'QB', gamesPlayed:6,  stats:{ passYds:1106, passTDs:5,  passInt:1,  rushYds:323, rushTDs:2  } },
  { id:1021, name:'Bryce Young',        team:'CAR', position:'QB', gamesPlayed:13, stats:{ passYds:2145, passTDs:9,  passInt:10, rushYds:178, rushTDs:1  } },
  { id:1022, name:'Derek Carr',         team:'NO',  position:'QB', gamesPlayed:6,  stats:{ passYds:1025, passTDs:5,  passInt:4,  rushYds:12,  rushTDs:0  } },

  // ── RBs ──────────────────────────────────────────────────────────────────
  { id:2001, name:'Saquon Barkley',     team:'PHI', position:'RB', gamesPlayed:17, stats:{ rushYds:2005, rushTDs:13, rec:40, recYds:278,  recTDs:2 } },
  { id:2002, name:'Derrick Henry',      team:'BAL', position:'RB', gamesPlayed:17, stats:{ rushYds:1921, rushTDs:16, rec:19, recYds:197,  recTDs:1 } },
  { id:2003, name:'Jahmyr Gibbs',       team:'DET', position:'RB', gamesPlayed:16, stats:{ rushYds:1182, rushTDs:10, rec:52, recYds:475,  recTDs:3 } },
  { id:2004, name:'Josh Jacobs',        team:'GB',  position:'RB', gamesPlayed:17, stats:{ rushYds:1329, rushTDs:8,  rec:52, recYds:356,  recTDs:3 } },
  { id:2005, name:'James Cook',         team:'BUF', position:'RB', gamesPlayed:16, stats:{ rushYds:1009, rushTDs:16, rec:34, recYds:246,  recTDs:1 } },
  { id:2006, name:'Joe Mixon',          team:'HOU', position:'RB', gamesPlayed:16, stats:{ rushYds:1158, rushTDs:13, rec:47, recYds:369,  recTDs:0 } },
  { id:2007, name:'Kyren Williams',     team:'LAR', position:'RB', gamesPlayed:14, stats:{ rushYds:1144, rushTDs:12, rec:43, recYds:291,  recTDs:1 } },
  { id:2008, name:'De\'Von Achane',     team:'MIA', position:'RB', gamesPlayed:13, stats:{ rushYds:906,  rushTDs:5,  rec:55, recYds:542,  recTDs:4 } },
  { id:2009, name:'Alvin Kamara',       team:'NO',  position:'RB', gamesPlayed:16, stats:{ rushYds:740,  rushTDs:7,  rec:70, recYds:490,  recTDs:4 } },
  { id:2010, name:'Bijan Robinson',     team:'ATL', position:'RB', gamesPlayed:16, stats:{ rushYds:925,  rushTDs:7,  rec:51, recYds:452,  recTDs:3 } },
  { id:2011, name:'Breece Hall',        team:'NYJ', position:'RB', gamesPlayed:13, stats:{ rushYds:870,  rushTDs:4,  rec:59, recYds:497,  recTDs:2 } },
  { id:2012, name:'Aaron Jones',        team:'MIN', position:'RB', gamesPlayed:17, stats:{ rushYds:991,  rushTDs:4,  rec:56, recYds:450,  recTDs:2 } },
  { id:2013, name:'Jonathan Taylor',    team:'IND', position:'RB', gamesPlayed:17, stats:{ rushYds:1147, rushTDs:11, rec:38, recYds:289,  recTDs:1 } },
  { id:2014, name:'Brian Robinson Jr',  team:'WAS', position:'RB', gamesPlayed:17, stats:{ rushYds:1040, rushTDs:8,  rec:28, recYds:174,  recTDs:1 } },
  { id:2015, name:'Tony Pollard',       team:'TEN', position:'RB', gamesPlayed:17, stats:{ rushYds:1064, rushTDs:7,  rec:36, recYds:218,  recTDs:0 } },
  { id:2016, name:'Najee Harris',       team:'PIT', position:'RB', gamesPlayed:17, stats:{ rushYds:1004, rushTDs:8,  rec:39, recYds:248,  recTDs:0 } },
  { id:2017, name:'Chuba Hubbard',      team:'CAR', position:'RB', gamesPlayed:17, stats:{ rushYds:1124, rushTDs:6,  rec:50, recYds:391,  recTDs:1 } },
  { id:2018, name:'Rhamondre Stevenson',team:'NE',  position:'RB', gamesPlayed:17, stats:{ rushYds:889,  rushTDs:5,  rec:33, recYds:211,  recTDs:1 } },
  { id:2019, name:'Zach Charbonnet',    team:'SEA', position:'RB', gamesPlayed:17, stats:{ rushYds:841,  rushTDs:9,  rec:22, recYds:145,  recTDs:1 } },
  { id:2020, name:'Travis Etienne',     team:'JAX', position:'RB', gamesPlayed:12, stats:{ rushYds:760,  rushTDs:5,  rec:38, recYds:295,  recTDs:1 } },
  { id:2021, name:'Rico Dowdle',        team:'DAL', position:'RB', gamesPlayed:16, stats:{ rushYds:1079, rushTDs:5,  rec:26, recYds:155,  recTDs:1 } },
  { id:2022, name:'Rachaad White',      team:'TB',  position:'RB', gamesPlayed:17, stats:{ rushYds:812,  rushTDs:5,  rec:54, recYds:364,  recTDs:3 } },
  { id:2023, name:'D\'Andre Swift',     team:'CHI', position:'RB', gamesPlayed:17, stats:{ rushYds:784,  rushTDs:5,  rec:48, recYds:374,  recTDs:1 } },
  { id:2024, name:'Javonte Williams',   team:'DEN', position:'RB', gamesPlayed:17, stats:{ rushYds:784,  rushTDs:4,  rec:42, recYds:295,  recTDs:0 } },
  { id:2025, name:'Isiah Pacheco',      team:'KC',  position:'RB', gamesPlayed:10, stats:{ rushYds:578,  rushTDs:6,  rec:22, recYds:151,  recTDs:0 } },
  { id:2026, name:'Nick Chubb',         team:'CLE', position:'RB', gamesPlayed:10, stats:{ rushYds:695,  rushTDs:5,  rec:13, recYds:89,   recTDs:0 } },
  { id:2027, name:'Christian McCaffrey',team:'SF',  position:'RB', gamesPlayed:6,  stats:{ rushYds:364,  rushTDs:3,  rec:30, recYds:210,  recTDs:2 } },
  { id:2028, name:'Kareem Hunt',        team:'KC',  position:'RB', gamesPlayed:14, stats:{ rushYds:612,  rushTDs:6,  rec:26, recYds:178,  recTDs:1 } },
  { id:2029, name:'David Montgomery',   team:'DET', position:'RB', gamesPlayed:14, stats:{ rushYds:775,  rushTDs:6,  rec:17, recYds:125,  recTDs:0 } },
  { id:2030, name:'Jaylen Warren',      team:'PIT', position:'RB', gamesPlayed:14, stats:{ rushYds:545,  rushTDs:4,  rec:35, recYds:249,  recTDs:1 } },
  { id:2031, name:'J.K. Dobbins',       team:'LAC', position:'RB', gamesPlayed:7,  stats:{ rushYds:417,  rushTDs:6,  rec:9,  recYds:65,   recTDs:0 } },
  { id:2032, name:'Tank Bigsby',        team:'JAX', position:'RB', gamesPlayed:15, stats:{ rushYds:612,  rushTDs:5,  rec:14, recYds:98,   recTDs:0 } },
  { id:2033, name:'Gus Edwards',        team:'LAC', position:'RB', gamesPlayed:14, stats:{ rushYds:554,  rushTDs:6,  rec:6,  recYds:42,   recTDs:0 } },
  { id:2034, name:'Jerome Ford',        team:'CLE', position:'RB', gamesPlayed:14, stats:{ rushYds:634,  rushTDs:3,  rec:30, recYds:228,  recTDs:2 } },
  { id:2035, name:'Devin Singletary',   team:'NYG', position:'RB', gamesPlayed:14, stats:{ rushYds:589,  rushTDs:3,  rec:21, recYds:148,  recTDs:0 } },
  { id:2036, name:'Alexander Mattison', team:'LV',  position:'RB', gamesPlayed:17, stats:{ rushYds:716,  rushTDs:3,  rec:38, recYds:225,  recTDs:1 } },
  { id:2037, name:'Dameon Pierce',      team:'HOU', position:'RB', gamesPlayed:15, stats:{ rushYds:576,  rushTDs:4,  rec:21, recYds:142,  recTDs:0 } },
  { id:2038, name:'Antonio Gibson',     team:'NE',  position:'RB', gamesPlayed:14, stats:{ rushYds:498,  rushTDs:2,  rec:32, recYds:212,  recTDs:1 } },
  { id:2039, name:'Tyler Allgeier',     team:'ATL', position:'RB', gamesPlayed:16, stats:{ rushYds:512,  rushTDs:3,  rec:15, recYds:89,   recTDs:0 } },
  { id:2040, name:'Miles Sanders',      team:'CAR', position:'RB', gamesPlayed:14, stats:{ rushYds:478,  rushTDs:2,  rec:18, recYds:126,  recTDs:0 } },

  // ── WRs ──────────────────────────────────────────────────────────────────
  { id:3001, name:'Ja\'Marr Chase',      team:'CIN', position:'WR', gamesPlayed:17, stats:{ rec:127, recYds:1708, recTDs:17 } },
  { id:3002, name:'Justin Jefferson',    team:'MIN', position:'WR', gamesPlayed:17, stats:{ rec:120, recYds:1533, recTDs:10 } },
  { id:3003, name:'CeeDee Lamb',         team:'DAL', position:'WR', gamesPlayed:16, stats:{ rec:101, recYds:1194, recTDs:11 } },
  { id:3004, name:'Drake London',        team:'ATL', position:'WR', gamesPlayed:17, stats:{ rec:101, recYds:1271, recTDs:12 } },
  { id:3005, name:'Amon-Ra St. Brown',   team:'DET', position:'WR', gamesPlayed:17, stats:{ rec:111, recYds:1176, recTDs:12 } },
  { id:3006, name:'Brian Thomas Jr',     team:'JAX', position:'WR', gamesPlayed:17, stats:{ rec:87,  recYds:1282, recTDs:10 } },
  { id:3007, name:'Terry McLaurin',      team:'WAS', position:'WR', gamesPlayed:17, stats:{ rec:84,  recYds:1022, recTDs:13 } },
  { id:3008, name:'Jaxon Smith-Njigba',  team:'SEA', position:'WR', gamesPlayed:17, stats:{ rec:100, recYds:1130, recTDs:7  } },
  { id:3009, name:'Puka Nacua',          team:'LAR', position:'WR', gamesPlayed:17, stats:{ rec:98,  recYds:1056, recTDs:5  } },
  { id:3010, name:'Garrett Wilson',      team:'NYJ', position:'WR', gamesPlayed:17, stats:{ rec:88,  recYds:1106, recTDs:7  } },
  { id:3011, name:'Malik Nabers',        team:'NYG', position:'WR', gamesPlayed:14, stats:{ rec:88,  recYds:1026, recTDs:8  } },
  { id:3012, name:'DK Metcalf',          team:'SEA', position:'WR', gamesPlayed:17, stats:{ rec:74,  recYds:991,  recTDs:9  } },
  { id:3013, name:'Ladd McConkey',       team:'LAC', position:'WR', gamesPlayed:16, stats:{ rec:82,  recYds:1026, recTDs:7  } },
  { id:3014, name:'Zay Flowers',         team:'BAL', position:'WR', gamesPlayed:17, stats:{ rec:91,  recYds:1013, recTDs:8  } },
  { id:3015, name:'Tyreek Hill',         team:'MIA', position:'WR', gamesPlayed:17, stats:{ rec:85,  recYds:1048, recTDs:4  } },
  { id:3016, name:'DeVonta Smith',       team:'PHI', position:'WR', gamesPlayed:17, stats:{ rec:81,  recYds:1072, recTDs:6  } },
  { id:3017, name:'Keenan Allen',        team:'CHI', position:'WR', gamesPlayed:17, stats:{ rec:102, recYds:1029, recTDs:6  } },
  { id:3018, name:'Calvin Ridley',       team:'TEN', position:'WR', gamesPlayed:17, stats:{ rec:92,  recYds:1033, recTDs:3  } },
  { id:3019, name:'Michael Pittman Jr',  team:'IND', position:'WR', gamesPlayed:17, stats:{ rec:87,  recYds:1018, recTDs:3  } },
  { id:3020, name:'Marvin Harrison Jr',  team:'ARI', position:'WR', gamesPlayed:16, stats:{ rec:68,  recYds:965,  recTDs:8  } },
  { id:3021, name:'Tee Higgins',         team:'CIN', position:'WR', gamesPlayed:12, stats:{ rec:73,  recYds:911,  recTDs:8  } },
  { id:3022, name:'Jayden Reed',         team:'GB',  position:'WR', gamesPlayed:17, stats:{ rec:75,  recYds:889,  recTDs:6  } },
  { id:3023, name:'Courtland Sutton',    team:'DEN', position:'WR', gamesPlayed:17, stats:{ rec:73,  recYds:893,  recTDs:4  } },
  { id:3024, name:'Josh Downs',          team:'IND', position:'WR', gamesPlayed:17, stats:{ rec:81,  recYds:979,  recTDs:4  } },
  { id:3025, name:'George Pickens',      team:'PIT', position:'WR', gamesPlayed:16, stats:{ rec:59,  recYds:900,  recTDs:5  } },
  { id:3026, name:'Rome Odunze',         team:'CHI', position:'WR', gamesPlayed:17, stats:{ rec:74,  recYds:891,  recTDs:6  } },
  { id:3027, name:'Davante Adams',       team:'LV',  position:'WR', gamesPlayed:14, stats:{ rec:67,  recYds:890,  recTDs:6  } },
  { id:3028, name:'Xavier Worthy',       team:'KC',  position:'WR', gamesPlayed:16, stats:{ rec:59,  recYds:638,  recTDs:8  } },
  { id:3029, name:'Jaylen Waddle',       team:'MIA', position:'WR', gamesPlayed:14, stats:{ rec:65,  recYds:919,  recTDs:4  } },
  { id:3030, name:'Cooper Kupp',         team:'LAR', position:'WR', gamesPlayed:14, stats:{ rec:67,  recYds:710,  recTDs:5  } },
  { id:3031, name:'Wan\'Dale Robinson',  team:'NYG', position:'WR', gamesPlayed:17, stats:{ rec:76,  recYds:772,  recTDs:3  } },
  { id:3032, name:'Demario Douglas',     team:'NE',  position:'WR', gamesPlayed:17, stats:{ rec:89,  recYds:839,  recTDs:1  } },
  { id:3033, name:'Amari Cooper',        team:'BUF', position:'WR', gamesPlayed:14, stats:{ rec:57,  recYds:713,  recTDs:3  } },
  { id:3034, name:'Tyler Lockett',       team:'SEA', position:'WR', gamesPlayed:14, stats:{ rec:62,  recYds:729,  recTDs:7  } },
  { id:3035, name:'Darius Slayton',      team:'NYG', position:'WR', gamesPlayed:15, stats:{ rec:55,  recYds:711,  recTDs:5  } },
  { id:3036, name:'Quentin Johnston',    team:'LAC', position:'WR', gamesPlayed:15, stats:{ rec:53,  recYds:775,  recTDs:2  } },
  { id:3037, name:'Christian Kirk',      team:'JAX', position:'WR', gamesPlayed:15, stats:{ rec:58,  recYds:697,  recTDs:2  } },
  { id:3038, name:'Dontayvion Wicks',    team:'GB',  position:'WR', gamesPlayed:14, stats:{ rec:43,  recYds:567,  recTDs:6  } },
  { id:3039, name:'Adam Thielen',        team:'CAR', position:'WR', gamesPlayed:14, stats:{ rec:56,  recYds:570,  recTDs:4  } },
  { id:3040, name:'Cedric Tillman',      team:'CLE', position:'WR', gamesPlayed:16, stats:{ rec:55,  recYds:681,  recTDs:5  } },
  { id:3041, name:'Rashee Rice',         team:'KC',  position:'WR', gamesPlayed:6,  stats:{ rec:35,  recYds:445,  recTDs:3  } },
  { id:3042, name:'Hollywood Brown',     team:'KC',  position:'WR', gamesPlayed:14, stats:{ rec:50,  recYds:571,  recTDs:4  } },
  { id:3043, name:'Deebo Samuel',        team:'SF',  position:'WR', gamesPlayed:12, stats:{ rec:52,  recYds:670,  recTDs:4,  rushYds:187, rushTDs:1 } },
  { id:3044, name:'Diontae Johnson',     team:'BAL', position:'WR', gamesPlayed:13, stats:{ rec:51,  recYds:545,  recTDs:0  } },
  { id:3045, name:'Noah Brown',          team:'NO',  position:'WR', gamesPlayed:13, stats:{ rec:52,  recYds:654,  recTDs:2  } },
  { id:3046, name:'Rashid Shaheed',      team:'NO',  position:'WR', gamesPlayed:10, stats:{ rec:40,  recYds:621,  recTDs:4  } },
  { id:3047, name:'Tank Dell',           team:'HOU', position:'WR', gamesPlayed:7,  stats:{ rec:37,  recYds:504,  recTDs:6  } },
  { id:3048, name:'Stefon Diggs',        team:'HOU', position:'WR', gamesPlayed:7,  stats:{ rec:35,  recYds:385,  recTDs:2  } },
  { id:3049, name:'Chris Olave',         team:'NO',  position:'WR', gamesPlayed:9,  stats:{ rec:51,  recYds:677,  recTDs:4  } },
  { id:3050, name:'Roman Wilson',        team:'PIT', position:'WR', gamesPlayed:11, stats:{ rec:28,  recYds:445,  recTDs:1  } },

  // ── TEs ──────────────────────────────────────────────────────────────────
  { id:4001, name:'Brock Bowers',        team:'LV',  position:'TE', gamesPlayed:17, stats:{ rec:112, recYds:1194, recTDs:5  } },
  { id:4002, name:'Trey McBride',        team:'ARI', position:'TE', gamesPlayed:17, stats:{ rec:111, recYds:1146, recTDs:5  } },
  { id:4003, name:'Sam LaPorta',         team:'DET', position:'TE', gamesPlayed:17, stats:{ rec:78,  recYds:857,  recTDs:7  } },
  { id:4004, name:'Travis Kelce',        team:'KC',  position:'TE', gamesPlayed:17, stats:{ rec:97,  recYds:823,  recTDs:3  } },
  { id:4005, name:'Jonnu Smith',         team:'MIA', position:'TE', gamesPlayed:17, stats:{ rec:79,  recYds:884,  recTDs:7  } },
  { id:4006, name:'David Njoku',         team:'CLE', position:'TE', gamesPlayed:16, stats:{ rec:73,  recYds:845,  recTDs:10 } },
  { id:4007, name:'Cole Kmet',           team:'CHI', position:'TE', gamesPlayed:17, stats:{ rec:75,  recYds:719,  recTDs:6  } },
  { id:4008, name:'Jake Ferguson',       team:'DAL', position:'TE', gamesPlayed:17, stats:{ rec:72,  recYds:752,  recTDs:4  } },
  { id:4009, name:'Kyle Pitts',          team:'ATL', position:'TE', gamesPlayed:16, stats:{ rec:69,  recYds:721,  recTDs:2  } },
  { id:4010, name:'Mark Andrews',        team:'BAL', position:'TE', gamesPlayed:14, stats:{ rec:62,  recYds:675,  recTDs:7  } },
  { id:4011, name:'Evan Engram',         team:'JAX', position:'TE', gamesPlayed:14, stats:{ rec:57,  recYds:614,  recTDs:4  } },
  { id:4012, name:'Cade Otton',          team:'TB',  position:'TE', gamesPlayed:17, stats:{ rec:58,  recYds:588,  recTDs:3  } },
  { id:4013, name:'Pat Freiermuth',      team:'PIT', position:'TE', gamesPlayed:17, stats:{ rec:57,  recYds:522,  recTDs:5  } },
  { id:4014, name:'T.J. Hockenson',      team:'MIN', position:'TE', gamesPlayed:9,  stats:{ rec:45,  recYds:501,  recTDs:4  } },
  { id:4015, name:'Tucker Kraft',        team:'GB',  position:'TE', gamesPlayed:16, stats:{ rec:39,  recYds:429,  recTDs:5  } },
  { id:4016, name:'Isaiah Likely',       team:'BAL', position:'TE', gamesPlayed:14, stats:{ rec:43,  recYds:477,  recTDs:5  } },
  { id:4017, name:'Dawson Knox',         team:'BUF', position:'TE', gamesPlayed:17, stats:{ rec:51,  recYds:511,  recTDs:4  } },
  { id:4018, name:'Hunter Henry',        team:'NE',  position:'TE', gamesPlayed:17, stats:{ rec:43,  recYds:452,  recTDs:4  } },
  { id:4019, name:'Dalton Kincaid',      team:'BUF', position:'TE', gamesPlayed:10, stats:{ rec:38,  recYds:350,  recTDs:2  } },
  { id:4020, name:'Taysom Hill',         team:'NO',  position:'TE', gamesPlayed:13, stats:{ rec:7,   recYds:58,   recTDs:3, rushYds:219, rushTDs:5 } },

  // ── Ks ───────────────────────────────────────────────────────────────────
  { id:5001, name:'Brandon Aubrey',  team:'DAL', position:'K', gamesPlayed:17, stats:{ fgMade0to39:25, fgMade40to49:8, fgMade50plus:8, fgMissed:2, patMade:45, patMissed:0 } },
  { id:5002, name:'Jake Elliott',    team:'PHI', position:'K', gamesPlayed:17, stats:{ fgMade0to39:30, fgMade40to49:6, fgMade50plus:6, fgMissed:1, patMade:58, patMissed:0 } },
  { id:5003, name:'Evan McPherson',  team:'CIN', position:'K', gamesPlayed:17, stats:{ fgMade0to39:18, fgMade40to49:8, fgMade50plus:7, fgMissed:3, patMade:45, patMissed:0 } },
  { id:5004, name:'Harrison Butker', team:'KC',  position:'K', gamesPlayed:17, stats:{ fgMade0to39:24, fgMade40to49:7, fgMade50plus:3, fgMissed:2, patMade:60, patMissed:0 } },
  { id:5005, name:'Chris Boswell',   team:'PIT', position:'K', gamesPlayed:17, stats:{ fgMade0to39:26, fgMade40to49:6, fgMade50plus:4, fgMissed:3, patMade:44, patMissed:1 } },
  { id:5006, name:'Justin Tucker',   team:'BAL', position:'K', gamesPlayed:15, stats:{ fgMade0to39:20, fgMade40to49:7, fgMade50plus:5, fgMissed:4, patMade:49, patMissed:1 } },
  { id:5007, name:'Tyler Bass',      team:'BUF', position:'K', gamesPlayed:16, stats:{ fgMade0to39:22, fgMade40to49:7, fgMade50plus:5, fgMissed:2, patMade:53, patMissed:1 } },
  { id:5008, name:'Cameron Dicker',  team:'LAC', position:'K', gamesPlayed:17, stats:{ fgMade0to39:22, fgMade40to49:6, fgMade50plus:4, fgMissed:3, patMade:44, patMissed:2 } },
  { id:5009, name:'Jason Sanders',   team:'MIA', position:'K', gamesPlayed:16, stats:{ fgMade0to39:18, fgMade40to49:7, fgMade50plus:5, fgMissed:4, patMade:40, patMissed:0 } },
  { id:5010, name:'Greg Zuerlein',   team:'NYJ', position:'K', gamesPlayed:17, stats:{ fgMade0to39:20, fgMade40to49:6, fgMade50plus:3, fgMissed:5, patMade:36, patMissed:1 } },

  // ── DST ──────────────────────────────────────────────────────────────────
  // ptsAllowed = total regular-season points allowed
  { id:6001, name:'Pittsburgh Steelers', team:'PIT', position:'DST', gamesPlayed:17, stats:{ sacks:55, ints:18, fumbRec:10, defTDs:4, ptsAllowed:239, ydsAllowed:4612 } },
  { id:6002, name:'Green Bay Packers',   team:'GB',  position:'DST', gamesPlayed:17, stats:{ sacks:41, ints:16, fumbRec:9,  defTDs:5, ptsAllowed:245, ydsAllowed:4891 } },
  { id:6003, name:'Buffalo Bills',       team:'BUF', position:'DST', gamesPlayed:17, stats:{ sacks:60, ints:15, fumbRec:11, defTDs:4, ptsAllowed:246, ydsAllowed:4778 } },
  { id:6004, name:'Kansas City Chiefs',  team:'KC',  position:'DST', gamesPlayed:17, stats:{ sacks:42, ints:15, fumbRec:13, defTDs:4, ptsAllowed:259, ydsAllowed:5021 } },
  { id:6005, name:'Minnesota Vikings',   team:'MIN', position:'DST', gamesPlayed:17, stats:{ sacks:52, ints:13, fumbRec:8,  defTDs:4, ptsAllowed:262, ydsAllowed:4934 } },
  { id:6006, name:'Baltimore Ravens',    team:'BAL', position:'DST', gamesPlayed:17, stats:{ sacks:38, ints:11, fumbRec:12, defTDs:3, ptsAllowed:281, ydsAllowed:5103 } },
  { id:6007, name:'San Francisco 49ers', team:'SF',  position:'DST', gamesPlayed:17, stats:{ sacks:48, ints:14, fumbRec:10, defTDs:3, ptsAllowed:289, ydsAllowed:5067 } },
  { id:6008, name:'Dallas Cowboys',      team:'DAL', position:'DST', gamesPlayed:17, stats:{ sacks:43, ints:12, fumbRec:9,  defTDs:3, ptsAllowed:295, ydsAllowed:5212 } },
  { id:6009, name:'Detroit Lions',       team:'DET', position:'DST', gamesPlayed:17, stats:{ sacks:36, ints:11, fumbRec:8,  defTDs:2, ptsAllowed:310, ydsAllowed:5489 } },
  { id:6010, name:'Cleveland Browns',    team:'CLE', position:'DST', gamesPlayed:17, stats:{ sacks:42, ints:9,  fumbRec:11, defTDs:2, ptsAllowed:325, ydsAllowed:5634 } },
]
