import { NextResponse } from "next/server";

/**
 * MLB API Proxy
 *
 * statsapi.mlb.com does not require auth, but we proxy it server-side to
 * avoid CORS issues and to bundle both seasons in one round-trip.
 *
 * Usage:
 *   fetch('/api/mlb?endpoint=all-seasons')
 *   Returns: { currentSeason: { season, hitters, pitchers, ageMap },
 *              priorSeason:   { season, hitters, pitchers, ageMap } }
 */

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

// ── Season helpers ────────────────────────────────────────────

/** MLB season is identified by a 4-digit year. Season runs ~April–October. */
function computeCurrentSeason(): number {
  const now = new Date();
  // Before March → prior calendar year is still the "current" season
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// ── Types ─────────────────────────────────────────────────────

type MlbStatSplit = {
  stat: Record<string, unknown>;
  player: { id: number; fullName: string };
  team: { abbreviation?: string; name?: string };
  position?: { abbreviation?: string; name?: string; type?: string };
};

// ── Internal fetch helpers ────────────────────────────────────

async function fetchStats(
  season: number,
  group: "hitting" | "pitching"
): Promise<MlbStatSplit[]> {
  // playerPool=All bypasses the default "qualified leaders" threshold so every
  // player who appeared in at least one game is included (not just stat leaders).
  // Without this parameter the API silently returns ~145 hitters / ~52 pitchers
  // instead of the full ~765 / ~870+ who played during the season.
  const url =
    `${MLB_BASE}/stats?stats=season&season=${season}&group=${group}` +
    `&gameType=R&limit=2000&playerPool=All`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`MLB API ${res.status} for ${group}/${season}`);
  const json = (await res.json()) as {
    stats?: Array<{ splits?: MlbStatSplit[] }>;
  };
  return json.stats?.[0]?.splits ?? [];
}

// ── Player ages ──────────────────────────────────────────────
// MLB people endpoint supports batched personIds for age lookup.
// NOTE: the people endpoint does NOT return roster/IL status — do not
// add &fields=…,status here, that field is silently ignored by the API.
async function fetchAges(
  playerIds: number[]
): Promise<Record<number, number>> {
  const ageMap: Record<number, number> = {};
  if (playerIds.length === 0) return ageMap;

  const batchSize = 250;
  for (let i = 0; i < playerIds.length; i += batchSize) {
    const batch = playerIds.slice(i, i + batchSize).join(",");
    try {
      const url = `${MLB_BASE}/people?personIds=${batch}&fields=people,id,currentAge`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        people?: Array<{ id: number; currentAge?: number }>;
      };
      for (const p of (json.people ?? [])) {
        if (p.id && p.currentAge) ageMap[p.id] = p.currentAge;
      }
    } catch {
      // silently skip — ages are supplemental
    }
  }
  return ageMap;
}

// ── IL status via 40-man rosters ─────────────────────────────
// The /people batch endpoint does NOT return IL status — status must be
// read from each team's 40-man roster (/teams/{id}/roster?rosterType=40Man).
// All 30 rosters are fetched in parallel (one call per team).
//
// Relevant status codes on the 40-man roster:
//   D10 → 10-Day IL    (~58 players league-wide)
//   D15 → 15-Day IL    (~66 players league-wide)
//   D60 → 60-Day IL   (~119 players league-wide)
//   D7  → 7-Day IL    (concussion IL, rare)
//   A   → Active — no badge
//   RM  → Minor leagues — no badge
//   RA  → Rehab assignment — no badge
//   NYR → Not yet reported — no badge

const MLB_TEAM_IDS = [
  108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
  118, 119, 120, 121, 133, 134, 135, 136, 137, 138,
  139, 140, 141, 142, 143, 144, 145, 146, 147, 158,
];

type RosterEntry = {
  person?: { id?: number };
  status?: { code?: string };
};

async function fetchMlbInjuries(season: number): Promise<Record<number, string>> {
  const injuryMap: Record<number, string> = {};

  const results = await Promise.allSettled(
    MLB_TEAM_IDS.map((teamId) =>
      fetch(
        `${MLB_BASE}/teams/${teamId}/roster?rosterType=40Man&season=${season}`,
        { next: { revalidate: 1800 } }
      )
        .then((r) => (r.ok ? (r.json() as Promise<{ roster?: RosterEntry[] }>) : { roster: [] }))
        .catch(() => ({ roster: [] as RosterEntry[] }))
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const entry of (result.value.roster ?? [])) {
      const id   = entry.person?.id;
      const code = entry.status?.code;
      if (!id || !code) continue;
      switch (code) {
        case "D7":  injuryMap[id] = "7-Day IL";  break;
        case "D10": injuryMap[id] = "10-Day IL"; break;
        case "D15": injuryMap[id] = "15-Day IL"; break;
        case "D60": injuryMap[id] = "60-Day IL"; break;
        // "A" Active, "RM" Minors, "RA" Rehab, "NYR" Not Yet Reported — no badge
      }
    }
  }

  return injuryMap;
}

async function fetchOneSeason(season: number, includeSupplemental: boolean) {
  const [hitters, pitchers] = await Promise.all([
    fetchStats(season, "hitting"),
    fetchStats(season, "pitching"),
  ]);

  let ageMap:    Record<number, number> = {};
  let injuryMap: Record<number, string> = {};

  if (includeSupplemental) {
    // Ages: batched people endpoint  |  IL status: 30 parallel 40-man roster calls
    // Run both in parallel — neither depends on the other.
    const allIds = [
      ...new Set([
        ...hitters.map((s) => s.player.id),
        ...pitchers.map((s) => s.player.id),
      ]),
    ];
    [ageMap, injuryMap] = await Promise.all([
      fetchAges(allIds),
      fetchMlbInjuries(season),
    ]);
  }

  return { season, hitters, pitchers, ageMap, injuryMap };
}

// ── Route handler ─────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");

  if (endpoint === "all-seasons") {
    try {
      const currentYear = computeCurrentSeason();
      const priorYear = currentYear - 1;
      const [currentSeason, priorSeason] = await Promise.all([
        fetchOneSeason(currentYear, true),   // fetch ages for current season only
        fetchOneSeason(priorYear, false),
      ]);
      return NextResponse.json({ currentSeason, priorSeason });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `Failed to fetch MLB seasons: ${message}` },
        { status: 502 }
      );
    }
  }

  return NextResponse.json(
    { error: "Invalid or missing endpoint. Use ?endpoint=all-seasons" },
    { status: 400 }
  );
}
