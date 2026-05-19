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

// ── Player info (ages + IL status) ───────────────────────────
// MLB people endpoint supports batched personIds.
// status.code values: A (Active), D10 (10-Day IL), D15 (15-Day IL),
//   D60 (60-Day IL), DTD (Day-to-Day). Failures are silently ignored.
async function fetchPlayerInfo(
  playerIds: number[]
): Promise<{ ageMap: Record<number, number>; injuryMap: Record<number, string> }> {
  const ageMap:    Record<number, number> = {};
  const injuryMap: Record<number, string> = {};
  if (playerIds.length === 0) return { ageMap, injuryMap };

  const batchSize = 250;
  for (let i = 0; i < playerIds.length; i += batchSize) {
    const batch = playerIds.slice(i, i + batchSize).join(",");
    try {
      const url = `${MLB_BASE}/people?personIds=${batch}&fields=people,id,currentAge,status`;
      const res = await fetch(url, { next: { revalidate: 1800 } });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        people?: Array<{
          id: number;
          currentAge?: number;
          status?: { code?: string; description?: string };
        }>;
      };
      for (const p of (json.people ?? [])) {
        if (p.id && p.currentAge) ageMap[p.id] = p.currentAge;
        if (p.id && p.status?.code) {
          switch (p.status.code) {
            case "D10": injuryMap[p.id] = "10-Day IL"; break;
            case "D15": injuryMap[p.id] = "15-Day IL"; break;
            case "D60": injuryMap[p.id] = "60-Day IL"; break;
            case "DTD": injuryMap[p.id] = "DTD";       break;
            // "A" = Active, "BRV" = Bereavement, "PAT" = Paternity, etc — no badge
          }
        }
      }
    } catch {
      // silently skip — player info is supplemental
    }
  }
  return { ageMap, injuryMap };
}

async function fetchOneSeason(season: number, includeAges: boolean) {
  const [hitters, pitchers] = await Promise.all([
    fetchStats(season, "hitting"),
    fetchStats(season, "pitching"),
  ]);

  let ageMap:    Record<number, number> = {};
  let injuryMap: Record<number, string> = {};
  if (includeAges) {
    const allIds = [
      ...new Set([
        ...hitters.map((s) => s.player.id),
        ...pitchers.map((s) => s.player.id),
      ]),
    ];
    ({ ageMap, injuryMap } = await fetchPlayerInfo(allIds));
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
