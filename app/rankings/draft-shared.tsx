"use client";

// ============================================================
// DRAFT MODE — shared building blocks (NHL + NFL Rankings tabs)
// ============================================================
// One implementation of the pieces that are identical across sports:
// per-league persisted checkbox state, the toggle row and instructions
// panel, recommendation badge styling, and the next-pick marker math.
// Sport-specific recommendation engines stay in each tab's component.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { generateDraftPicks, parseDraftPick, type DraftPicksConfig } from "@/lib/draft";

export type TakenMap = Record<number, "league" | "mine">;
export type RecTier = 1 | 2 | 3;

// Fixed brand hexes per the design spec; every color also carries a text
// badge for colorblind accessibility. Amber and orange always use dark text.
export const REC_STYLES: Record<RecTier, { row: string; badgeBg: string; badgeText: string; label: string }> = {
  1: { row: "rgba(45, 134, 89, 0.16)",  badgeBg: "#2D8659", badgeText: "#FFFFFF", label: "Top pick" },
  2: { row: "rgba(233, 180, 76, 0.16)", badgeBg: "#E9B44C", badgeText: "#1A1A1A", label: "2nd option" },
  3: { row: "rgba(212, 132, 59, 0.16)", badgeBg: "#D4843B", badgeText: "#1A1A1A", label: "3rd option" },
};

// A player at a position the roster already covers is only recommended when
// its value overwhelms the best need-filling option by this factor.
export const OVERWHELM = 1.5;

/** Assign recommendation tiers to an ordered top-5 list: 1 / 2,2 / 3,3. */
export function recTiersFor(ids: number[]): Map<number, RecTier> {
  const tiers = new Map<number, RecTier>();
  ids.slice(0, 5).forEach((id, i) => tiers.set(id, i === 0 ? 1 : i <= 2 ? 2 : 3));
  return tiers;
}

// ── Per-league persisted draft state ──────────────────────────
// Checkbox state is stored per saved league so it survives refreshes;
// writes happen inside the state updaters so a league switch can never
// clobber another league's stored draft.
export function useDraftState(sport: "nhl" | "nfl", leagueId: string | null) {
  const [draftOn, setDraftOnState] = useState(false);
  const [taken, setTaken] = useState<TakenMap>({});
  const [hideDrafted, setHideDrafted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const draftKey = `fta-draft-${sport}-${leagueId ?? "default"}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      const store = raw ? (JSON.parse(raw) as { on?: boolean; taken?: TakenMap }) : null;
      setTaken(store?.taken ?? {});
      setDraftOnState(!!store?.on);
    } catch {
      setTaken({});
      setDraftOnState(false);
    }
  }, [draftKey]);

  const persist = (on: boolean, takenMap: TakenMap) => {
    try { localStorage.setItem(draftKey, JSON.stringify({ on, taken: takenMap })); } catch {}
  };
  const setDraftOn = (on: boolean) => {
    setDraftOnState(on);
    persist(on, taken);
  };
  const mutateTaken = (updater: (prev: TakenMap) => TakenMap) =>
    setTaken((prev) => {
      const next = updater(prev);
      persist(draftOn, next);
      return next;
    });
  const setPlayerTaken = (id: number, kind: "league" | "mine", checked: boolean) =>
    mutateTaken((prev) => {
      const next = { ...prev };
      if (checked) next[id] = kind;           // checking one side unchecks the other
      else if (next[id] === kind) delete next[id];
      return next;
    });
  const resetTaken = () => mutateTaken(() => ({}));

  const takenCount = Object.keys(taken).length;
  const mineCount = Object.values(taken).filter((k) => k === "mine").length;

  return {
    draftOn, setDraftOn, taken, setPlayerTaken, resetTaken,
    hideDrafted, setHideDrafted, confirmReset, setConfirmReset,
    takenCount, mineCount,
  };
}

// ── Next-pick math ────────────────────────────────────────────
// Picks that happen before my next owned pick = overall − 1 − players
// already checked; the marker sits after that many available players.
export type NextPickInfo = {
  label: string;
  availableBefore: number;
  configured: boolean;
  /** How many of my owned picks are still in the future. */
  picksRemaining: number;
};

export function computeNextPick(
  cfg: DraftPicksConfig | undefined,
  fallbackTeams: number,
  fallbackRounds: number,
  takenCount: number
): NextPickInfo | null {
  const configured = !!cfg?.picks?.length;
  const teams = (configured ? cfg.teams : fallbackTeams) || fallbackTeams;
  const pickStrs = configured
    ? cfg.picks
    : generateDraftPicks(fallbackTeams, 1, "snake", fallbackRounds); // placeholder until configured
  const parsed = pickStrs
    .map((s) => parseDraftPick(s, teams))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.overall - b.overall);
  const future = parsed.filter((pk) => pk.overall > takenCount);
  const next = future[0];
  if (!next) return null;
  return {
    label: next.raw,
    availableBefore: Math.max(0, next.overall - 1 - takenCount),
    configured,
    picksRemaining: future.length,
  };
}

/**
 * Index in the visible row list before which the marker renders: after
 * `availableBefore` unchecked rows. Returns rows.length when the marker
 * belongs at the end of the list.
 */
export function computeMarkerIndex(takenFlags: boolean[], availableBefore: number): number {
  let availableSeen = 0;
  for (let i = 0; i < takenFlags.length; i++) {
    if (!takenFlags[i]) {
      if (availableSeen === availableBefore) return i;
      availableSeen++;
    }
  }
  return takenFlags.length;
}

// ── Shared UI pieces ──────────────────────────────────────────

export function DraftToggleRow({ isPro, checked, onChange, proDescription }: {
  isPro: boolean;
  checked: boolean;
  onChange: (on: boolean) => void;
  proDescription: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
      <label
        className={`flex items-center gap-2 text-sm font-medium ${isPro ? "cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
        style={{ color: "var(--color-text)" }}
      >
        <input
          type="checkbox"
          disabled={!isPro}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        Turn on Draft Mode
        {!isPro && <span aria-hidden>🔒</span>}
      </label>
      <span className="text-xs" style={{ color: "var(--color-muted)" }}>
        {isPro ? (
          proDescription
        ) : (
          <>
            Draft Mode is a paid feature:{" "}
            <a href="https://thetradeanalyzer.com/pricing/" className="link-primary">
              upgrade to unlock it
            </a>.
          </>
        )}
      </span>
    </div>
  );
}

export function DraftPanel({
  unconfiguredWarning, hideDrafted, setHideDrafted,
  takenCount, mineCount, confirmReset, setConfirmReset, onReset,
}: {
  unconfiguredWarning: boolean;
  hideDrafted: boolean;
  setHideDrafted: (v: boolean) => void;
  takenCount: number;
  mineCount: number;
  confirmReset: boolean;
  setConfirmReset: (v: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3 mb-3 text-xs"
      style={{ borderColor: "var(--color-primary)", background: "var(--color-surface)", color: "var(--color-muted)" }}
    >
      <p className="font-semibold mb-1" style={{ color: "var(--color-text)" }}>
        How Draft Mode works
      </p>
      <ul className="list-disc ml-4 space-y-0.5">
        <li>Check <span className="font-semibold">League</span> when another manager drafts a player.</li>
        <li>Check <span className="font-semibold">Mine</span> when you draft a player.</li>
        <li>Keepers get checked the same way before the draft starts.</li>
        <li>The colored highlights show your recommended picks: green is the top pick, amber and orange are ranked fallbacks likely to still be available later.</li>
      </ul>
      {unconfiguredWarning && (
        <p className="mt-2" style={{ color: "#D4843B" }}>
          No draft picks configured for this league: using slot 1 (snake) as a placeholder.
          Set your picks under Draft Picks in <Link href="/settings" className="link-primary">Settings</Link>.
        </p>
      )}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pt-2 border-t"
        style={{ borderColor: "var(--color-border)" }}
      >
        <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: "var(--color-text)" }}>
          <input
            type="checkbox"
            checked={hideDrafted}
            onChange={(e) => setHideDrafted(e.target.checked)}
          />
          Hide drafted players
        </label>
        <span>{takenCount} drafted · {mineCount} mine</span>
        {confirmReset ? (
          <span className="flex items-center gap-2">
            Clear all checkboxes?
            <button
              className="rounded-lg px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-danger)", color: "#fff" }}
              onClick={() => { onReset(); setConfirmReset(false); }}
            >
              Yes, Reset
            </button>
            <button
              className="rounded-lg border px-2.5 py-1 text-xs font-medium"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors"
            style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
            onClick={() => setConfirmReset(true)}
          >
            Reset Draft
          </button>
        )}
      </div>
    </div>
  );
}

export function MarkerRow({ colCount, label }: { colCount: number; label: string }) {
  return (
    <tr>
      <td colSpan={colCount} className="px-2 py-1">
        <div
          className="flex items-center gap-2 text-xs font-semibold whitespace-nowrap"
          style={{ color: "var(--color-primary)" }}
        >
          <span className="flex-1 border-t-2" style={{ borderColor: "var(--color-primary)" }} />
          Your next pick: {label}
          <span className="flex-1 border-t-2" style={{ borderColor: "var(--color-primary)" }} />
        </div>
      </td>
    </tr>
  );
}

export function RecBadge({ tier }: { tier: RecTier }) {
  const s = REC_STYLES[tier];
  return (
    <span
      className="ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold align-middle whitespace-nowrap"
      style={{ background: s.badgeBg, color: s.badgeText }}
    >
      {s.label}
    </span>
  );
}

/** The two checkbox cells (League / Mine) for one player row. */
export function DraftCells({ id, name, taken, setPlayerTaken }: {
  id: number;
  name: string;
  taken: TakenMap;
  setPlayerTaken: (id: number, kind: "league" | "mine", checked: boolean) => void;
}) {
  return (
    <>
      <td className="px-2 py-1 text-center">
        <input
          type="checkbox"
          checked={taken[id] === "league"}
          onChange={(e) => setPlayerTaken(id, "league", e.target.checked)}
          aria-label={`${name} drafted by another team`}
        />
      </td>
      <td className="px-2 py-1 text-center">
        <input
          type="checkbox"
          checked={taken[id] === "mine"}
          onChange={(e) => setPlayerTaken(id, "mine", e.target.checked)}
          aria-label={`${name} on my roster`}
        />
      </td>
    </>
  );
}
