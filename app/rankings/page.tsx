"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import NhlRankings from "./NhlRankings";
import NflRankings from "./NflRankings";
import MlbRankings from "./MlbRankings";

// ============================================================
// RANKINGS — one page, sport tabs (same tab style as Settings)
// ============================================================
// Available to ALL signed-in users (free and paid). Each tab ranks every
// player under the user's league settings and highlights the stats where
// a player beats the draftable-pool average at his position.

type Tab = "nhl" | "nfl" | "mlb";

function RankingsContent() {
  const { user, isLoaded: clerkLoaded } = useUser();
  const searchParams = useSearchParams();
  const initialTab = ((): Tab => {
    const t = searchParams.get("tab");
    return t === "nfl" || t === "mlb" ? t : "nhl";
  })();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  if (!clerkLoaded) {
    return <div className="p-6 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div>;
  }
  if (!user) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center">
        <h1 className="text-2xl font-semibold mb-3" style={{ color: "var(--color-text)" }}>
          League Rankings
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
          Sign in (free) to see every player ranked under your league&apos;s scoring
          settings, with the stats where they beat the draftable-pool average highlighted.
        </p>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Use the <span className="font-semibold">Sign In</span> button in the navigation bar, then come back to this page.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4" style={{ color: "var(--color-text)" }}>
        Rankings
      </h1>

      {/* ── Tabs (same style as Settings) ─────────────────── */}
      <div
        className="flex gap-1 mb-6 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        {(["nhl", "nfl", "mlb"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? "tab-btn-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {activeTab === "nhl" && <NhlRankings />}
      {activeTab === "nfl" && <NflRankings />}
      {activeTab === "mlb" && <MlbRankings />}
    </div>
  );
}

export default function RankingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div>}>
      <RankingsContent />
    </Suspense>
  );
}
