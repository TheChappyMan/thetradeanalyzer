"use client";

// Settings page shell: page header, tabs, and one league manager per sport.
// Each sport's form lives in its own file ({Nhl,Nfl,Mlb}SettingsTab.tsx);
// the pieces they share are in shared.tsx; saving/creating/deleting leagues
// is in useLeagueManager.ts.

import React, { useState } from "react";
import { saveLeagueSettings, saveNflLeagueSettings, saveMlbLeagueSettings } from "./actions";
import { DEFAULT_LEAGUE } from "@/lib/types";
import type { League, LeagueRow } from "@/lib/types";
import { DEFAULT_NFL_LEAGUE, type NflLeague } from "@/lib/nfl-types";
import { DEFAULT_MLB_LEAGUE, type MlbLeague } from "@/lib/mlb-types";
import { useLeagueManager } from "./useLeagueManager";
import { LeagueSelectorBar, SaveControls, SaveRow } from "./shared";
import NhlSettingsTab, { mergeLeague } from "./NhlSettingsTab";
import NflSettingsTab, { mergeNflLeague } from "./NflSettingsTab";
import MlbSettingsTab, { mergeMlbLeague } from "./MlbSettingsTab";
import SubscriptionTab from "./SubscriptionTab";

type Props = {
  initialLeague:    League    | null;
  initialNflLeague: NflLeague | null;
  initialMlbLeague: MlbLeague | null;
  tier:             string;
  allNhlLeagues:    LeagueRow[];
  allNflLeagues:    LeagueRow[];
  allMlbLeagues:    LeagueRow[];
  /** Rendered inside the Manage Subscription tab (paid users only). */
  referralSection?: React.ReactNode;
};

type Tab = "nhl" | "nfl" | "mlb" | "subscription";

export default function SettingsForm({
  initialLeague,
  initialNflLeague,
  initialMlbLeague,
  tier,
  allNhlLeagues,
  allNflLeagues,
  allMlbLeagues,
  referralSection,
}: Props) {
  const isTier2 = tier === "tier2" || tier === "tier3";
  const isPaid  = tier === "tier1" || tier === "tier2" || tier === "tier3";

  // Free users only have access to the Manage Subscription tab
  const [activeTab, setActiveTab] = useState<Tab>(isPaid ? "nhl" : "subscription");

  // One manager per sport, all kept here (not inside the tabs) so unsaved
  // edits survive switching between sport tabs.
  const nhl = useLeagueManager<League>({
    sport: "nhl", initial: initialLeague, initialRows: allNhlLeagues,
    defaults: DEFAULT_LEAGUE, merge: mergeLeague, saveAction: saveLeagueSettings, isTier2,
  });
  const nfl = useLeagueManager<NflLeague>({
    sport: "nfl", initial: initialNflLeague, initialRows: allNflLeagues,
    defaults: DEFAULT_NFL_LEAGUE, merge: mergeNflLeague, saveAction: saveNflLeagueSettings, isTier2,
  });
  const mlb = useLeagueManager<MlbLeague>({
    sport: "mlb", initial: initialMlbLeague, initialRows: allMlbLeagues,
    defaults: DEFAULT_MLB_LEAGUE, merge: mergeMlbLeague, saveAction: saveMlbLeagueSettings, isTier2,
  });

  const active =
    activeTab === "nhl" ? nhl : activeTab === "nfl" ? nfl : activeTab === "mlb" ? mlb : null;

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: "var(--color-text)" }}
          >
            Settings
          </h1>
          <a href="/" className="link-primary text-xs">
            ← Back to Dashboard
          </a>
        </div>

        {active && (
          <div className="flex items-center gap-3">
            <SaveControls
              status={active.status} error={active.error}
              isNew={active.isNew} onSave={active.save}
            />
          </div>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div
        className="flex gap-1 mb-6 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        {isPaid && (["nhl", "nfl", "mlb"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? "tab-btn-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.toUpperCase()}
          </button>
        ))}
        <button
          className={`tab-btn ${activeTab === "subscription" ? "tab-btn-active" : ""}`}
          onClick={() => setActiveTab("subscription")}
        >
          Manage Subscription
        </button>
      </div>

      {activeTab === "subscription" && (
        <SubscriptionTab tier={tier} isPaid={isPaid} referralSection={referralSection} />
      )}

      {activeTab === "nhl" && (
        <>
          <LeagueSelectorBar manager={nhl} isTier2={isTier2} />
          <NhlSettingsTab league={nhl.league} setLeague={nhl.setLeague} />
          <SaveRow status={nhl.status} error={nhl.error} isNew={nhl.isNew} onSave={nhl.save} />
        </>
      )}

      {activeTab === "nfl" && (
        <>
          <LeagueSelectorBar manager={nfl} isTier2={isTier2} />
          <NflSettingsTab league={nfl.league} setLeague={nfl.setLeague} selectedId={nfl.selectedId} />
          <SaveRow status={nfl.status} error={nfl.error} isNew={nfl.isNew} onSave={nfl.save} />
        </>
      )}

      {activeTab === "mlb" && (
        <>
          <LeagueSelectorBar manager={mlb} isTier2={isTier2} />
          <MlbSettingsTab league={mlb.league} setLeague={mlb.setLeague} />
          <SaveRow status={mlb.status} error={mlb.error} isNew={mlb.isNew} onSave={mlb.save} />
        </>
      )}
    </div>
  );
}
