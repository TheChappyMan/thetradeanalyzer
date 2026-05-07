"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUser, SignInButton, SignUpButton } from "@clerk/nextjs";
import { SPORTS_CONFIG } from "@/lib/sports-config";
import { useLeagueContext } from "@/lib/league-context";

// ── Types ──────────────────────────────────────────────────────────────────

type LeagueRow = { id: string; name: string; sport: string };

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const { setSelectedLeague } = useLeagueContext();

  const tier           = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro          = tier === "tier1" || tier === "tier2" || tier === "tier3";
  const isTier2        = tier === "tier2" || tier === "tier3";
  const isCommissioner = tier === "tier3";
  const isSignedIn     = !!user;

  const [leaguesBySport, setLeaguesBySport] = useState<Record<string, LeagueRow[]>>({});
  const [leaguesLoading, setLeaguesLoading] = useState(false);

  // Fetch all leagues for Tier 2 users once Clerk resolves
  useEffect(() => {
    if (!isTier2 || !isSignedIn || !isLoaded) return;
    setLeaguesLoading(true);
    Promise.all(
      SPORTS_CONFIG.map((s) =>
        fetch(`/api/leagues?sport=${s.key}`)
          .then((r) => (r.ok ? r.json() : { data: [] }))
          .then((json) => ({ sport: s.key, leagues: (json.data ?? []) as LeagueRow[] }))
          .catch(() => ({ sport: s.key, leagues: [] as LeagueRow[] }))
      )
    ).then((results) => {
      const map: Record<string, LeagueRow[]> = {};
      results.forEach(({ sport, leagues }) => { map[sport] = leagues; });
      setLeaguesBySport(map);
      setLeaguesLoading(false);
    });
  }, [isTier2, isSignedIn, isLoaded]);

  if (!isLoaded) return <div className="p-6 max-w-6xl mx-auto" />;

  function handleLeagueClick(sport: string, leagueId: string, path: string) {
    setSelectedLeague(sport, leagueId);
    router.push(path);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1
        className="text-2xl font-semibold mb-6 tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        Welcome to thetradeanalyzer
      </h1>

      {isTier2 ? (
        /* ── Tier 2 dashboard ──────────────────────────────────── */
        <div className="space-y-8">

          {/* Sport sections */}
          {SPORTS_CONFIG.map((sport) => {
            const leagues = leaguesBySport[sport.key] ?? [];
            return (
              <div key={sport.key}>
                <div className="flex items-center justify-between mb-3">
                  <h2
                    className="text-lg font-semibold tracking-tight"
                    style={{ color: "var(--color-text)" }}
                  >
                    {sport.label} Leagues
                  </h2>
                  <Link href="/settings" className="link-primary text-xs whitespace-nowrap">
                    + Create New League
                  </Link>
                </div>

                {leaguesLoading ? (
                  <div
                    className="text-sm italic"
                    style={{ color: "var(--color-muted)" }}
                  >
                    Loading leagues…
                  </div>
                ) : leagues.length === 0 ? (
                  <div
                    className="card text-sm italic"
                    style={{ color: "var(--color-muted)" }}
                  >
                    No {sport.label} leagues yet.{" "}
                    <Link href="/settings" className="link-primary">
                      Create one in Settings
                    </Link>
                    .
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {leagues.map((league) => (
                      <button
                        key={league.id}
                        onClick={() => handleLeagueClick(sport.key, league.id, sport.path)}
                        className="text-left card-interactive"
                      >
                        <h3
                          className="font-medium text-sm"
                          style={{ color: "var(--color-text)" }}
                        >
                          {league.name}
                        </h3>
                        <p
                          className="text-xs mt-1"
                          style={{ color: "var(--color-muted)" }}
                        >
                          {sport.label} League
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Coming soon */}
          <div
            className="card opacity-60 cursor-not-allowed select-none"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-medium" style={{ color: "var(--color-text)" }}>
                More Sports
              </h2>
              <span className="badge-muted">Coming Soon</span>
            </div>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              NBA, MLB, and more coming soon.
            </p>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DashCard
              href="/history"
              title="Trade History"
              description="Review trades across all your leagues."
            />
            <DashCard
              href="/settings"
              title="Settings"
              description="Configure scoring weights and roster settings."
            />
            {isCommissioner && (
              <DashCard
                href="/commissioner"
                title="Commissioner Dashboard"
                description="Manage seats and view league-wide trade history for your group."
              />
            )}
          </div>
        </div>

      ) : isPro ? (
        /* ── Tier 1 dashboard ──────────────────────────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <DashCard
            href="/nhl"
            title="NHL League"
            description="Analyze NHL trades using your league's scoring settings."
          />
          <DashCard
            href="/nfl"
            title="NFL League"
            description="Analyze NFL trades using your league's scoring settings."
          />
          <DashCard
            href="/mlb"
            title="MLB League"
            description="Analyze MLB trades using your league's scoring settings."
          />
          <DashCard
            href="/history"
            title="Trade History"
            description="Review and compare trades you've analyzed."
          />
        </div>

      ) : (
        /* ── Free dashboard ─────────────────────────────────────── */
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <DashCard
              href="/nhl"
              title="NHL Trade Analyzer"
              description="Analyze NHL trades using your league's scoring settings."
            />
            <DashCard
              href="/nfl"
              title="NFL Trade Analyzer"
              description="Analyze NFL trades using your league's scoring settings."
            />
            <DashCard
              href="/mlb"
              title="MLB Trade Analyzer"
              description="Analyze MLB trades using your league's scoring settings."
            />
          </div>

          <div className="upgrade-banner mb-4">
            <span>💡 Upgrade to Pro to save your settings and track trade history</span>
          </div>

          {!isSignedIn && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <SignInButton mode="modal">
                <button className="btn-secondary">Sign In</button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="btn-accent">Sign Up Free</button>
              </SignUpButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── DashCard ───────────────────────────────────────────────────────────────

type DashCardProps = {
  href: string;
  title: string;
  description: string;
  comingSoon?: boolean;
};

function DashCard({ href, title, description, comingSoon }: DashCardProps) {
  if (comingSoon) {
    return (
      <div className="card opacity-60 cursor-not-allowed select-none">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-medium" style={{ color: "var(--color-text)" }}>
            {title}
          </h2>
          <span className="badge-muted">Coming Soon</span>
        </div>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {description}
        </p>
      </div>
    );
  }
  return (
    <Link href={href} className="card-interactive group">
      <h2
        className="font-medium mb-1 transition-colors"
        style={{ color: "var(--color-primary)" }}
      >
        {title}
      </h2>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        {description}
      </p>
    </Link>
  );
}
