import { NextResponse } from "next/server";

/**
 * NHL API Proxy
 *
 * The NHL's stats API blocks browser requests via CORS. This route proxies
 * the four endpoints we need from the server side, where CORS doesn't apply.
 *
 * Usage from the client:
 *   fetch('/api/nhl?endpoint=skater-summary&season=20252026')
 *   fetch('/api/nhl?endpoint=skater-realtime&season=20252026')
 *   fetch('/api/nhl?endpoint=skater-faceoffs&season=20252026')
 *   fetch('/api/nhl?endpoint=goalie-summary&season=20252026')
 */

const NHL_STATS_BASE = "https://api.nhle.com/stats/rest/en";

const ENDPOINT_MAP: Record<string, string> = {
  "skater-summary": "skater/summary",
  "skater-realtime": "skater/realtime",
  "skater-faceoffs": "skater/faceoffwins",
  "goalie-summary": "goalie/summary",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const season = searchParams.get("season");

  if (!endpoint || !ENDPOINT_MAP[endpoint]) {
    return NextResponse.json(
      { error: "Invalid or missing endpoint parameter" },
      { status: 400 }
    );
  }

  if (!season || !/^\d{8}$/.test(season)) {
    return NextResponse.json(
      { error: "Invalid or missing season parameter (expected 8-digit format like 20252026)" },
      { status: 400 }
    );
  }

  const path = ENDPOINT_MAP[endpoint];
  const url = `${NHL_STATS_BASE}/${path}?limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`;

  try {
    const res = await fetch(url, {
      // Cache on Vercel's CDN for 1 hour — NHL stats don't update mid-game
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `NHL API returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch from NHL API: ${message}` },
      { status: 502 }
    );
  }
}
