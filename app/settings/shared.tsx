"use client";

// Building blocks shared by the three sport tabs on the Settings page.

import React, { useState } from "react";
import StatHelp from "@/app/components/StatHelp";
import WeightInput from "@/app/components/WeightInput";
import type { CategoryConfig } from "@/lib/types";
import type { LeagueManager, SaveStatus } from "./useLeagueManager";

// ============================================================
// Save controls
// ============================================================

/** Status text + Save/Create button. Used in the page header and again at
 *  the bottom of each sport tab (via SaveRow). */
export function SaveControls({
  status, error, isNew, onSave,
}: {
  status: SaveStatus;
  error: string | null;
  isNew: boolean;
  onSave: () => void;
}) {
  return (
    <>
      {status === "saved" && (
        <span className="text-xs" style={{ color: "var(--color-success)" }}>✓ Saved!</span>
      )}
      {status === "error" && (
        <span className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</span>
      )}
      <button className="btn-accent" onClick={onSave} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : isNew ? "Create League" : "Save Settings"}
      </button>
    </>
  );
}

/** Save/Create button row — duplicated at the bottom of each sport tab so
 *  users don't have to scroll back up after editing long forms. */
export function SaveRow(props: React.ComponentProps<typeof SaveControls>) {
  return (
    <div className="flex items-center justify-end gap-3 mt-6">
      <SaveControls {...props} />
    </div>
  );
}

// ============================================================
// League selector bar
// ============================================================

/**
 * Delete button + inline confirmation for one saved league. The confirmation
 * states what happens to the league's trade history before anything is
 * deleted. Shown in the tier-2 league selector bar and (without a selector)
 * for the tier-1 single saved league.
 */
function DeleteLeagueControl({
  leagueName, sportLabel, deleting, onConfirm,
}: {
  leagueName: string;
  sportLabel: string;
  deleting: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        className="text-xs whitespace-nowrap disabled:opacity-50"
        style={{ color: "var(--color-danger)" }}
        disabled={deleting}
        onClick={() => setConfirming(true)}
      >
        Delete League
      </button>
    );
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-2 text-xs"
      style={{ borderColor: "var(--color-danger)", background: "var(--color-surface)" }}
    >
      <span style={{ color: "var(--color-text)" }}>
        Delete <span className="font-semibold">{leagueName || "this league"}</span>?
        Its saved settings are removed permanently. Trades you analyzed in it are
        kept in Trade History under “All {sportLabel} Leagues” (the league is
        marked as deleted in the league filter).
      </span>
      <div className="flex gap-2">
        <button
          className="rounded-lg border px-2 py-1 font-medium disabled:opacity-50"
          style={{ borderColor: "var(--color-danger)", color: "#fff", background: "var(--color-danger)" }}
          disabled={deleting}
          onClick={() => { setConfirming(false); onConfirm(); }}
        >
          {deleting ? "Deleting…" : "Delete League"}
        </button>
        <button
          className="rounded-lg border px-2 py-1"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** League selector (Tier 2) + Delete (any paid tier). */
export function LeagueSelectorBar<T extends { name: string }>({
  manager, isTier2,
}: {
  manager: LeagueManager<T>;
  isTier2: boolean;
}) {
  const { rows, selectedId, creating, deleting, label } = manager;
  if (!isTier2 && rows.length === 0) return null;

  // Tier 2 acts on the selected league; tier 1 on its single saved league.
  const targetId   = isTier2 ? selectedId : rows[0]?.id;
  const targetName =
    (isTier2 ? rows.find((l) => l.id === selectedId)?.name : rows[0]?.name) ?? "";

  return (
    <div
      className="flex flex-wrap items-center gap-3 mb-5 p-3 rounded-xl border"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <label className="text-sm shrink-0" style={{ color: "var(--color-muted)" }}>
        League:
      </label>
      {isTier2 ? (
        rows.length > 0 ? (
          <select
            className="form-input flex-1 max-w-xs"
            value={selectedId ?? ""}
            onChange={(e) => manager.selectLeague(e.target.value)}
          >
            {rows.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        ) : (
          <span className="text-sm italic" style={{ color: "var(--color-muted)" }}>
            No leagues yet
          </span>
        )
      ) : (
        <span className="text-sm" style={{ color: "var(--color-text)" }}>
          {rows[0]?.name || "My League"}
        </span>
      )}
      {isTier2 && (
        <button
          onClick={manager.createLeague}
          disabled={creating}
          className="link-primary text-xs disabled:opacity-50 whitespace-nowrap"
        >
          {creating ? "Creating…" : "+ New League"}
        </button>
      )}
      {targetId && (
        <DeleteLeagueControl
          leagueName={targetName}
          sportLabel={label}
          deleting={deleting}
          onConfirm={() => manager.deleteLeague(targetId)}
        />
      )}
    </div>
  );
}

// ============================================================
// League Settings card pieces
// ============================================================

const FIELD_LABEL = "text-sm block mb-1";
const muted = { color: "var(--color-muted)" };
const text  = { color: "var(--color-text)" };

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className={FIELD_LABEL} style={muted}>{children}</label>;
}

type LeagueBasics = {
  name: string;
  teams: number;
  leagueType: "redraft" | "keeper";
  keepersPerTeam: number;
};

/** Name, team count, league type and keeper count — identical in all sports. */
export function LeagueBasicsFields({
  league, onChange,
}: {
  league: LeagueBasics;
  onChange: (patch: Partial<LeagueBasics>) => void;
}) {
  return (
    <>
      <FieldLabel>League Name (optional)</FieldLabel>
      <input
        type="text"
        className="form-input mb-3"
        value={league.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />

      <FieldLabel>Number of Teams</FieldLabel>
      <input
        type="number" min={2}
        className="form-input mb-3"
        value={league.teams}
        onChange={(e) => onChange({ teams: parseInt(e.target.value || "12", 10) })}
      />

      <FieldLabel>League Type</FieldLabel>
      <select
        className="form-input mb-3"
        value={league.leagueType}
        onChange={(e) => onChange({ leagueType: e.target.value as "redraft" | "keeper" })}
      >
        <option value="redraft">Redraft</option>
        <option value="keeper">Keeper</option>
      </select>

      {league.leagueType === "keeper" && (
        <>
          <FieldLabel>Keepers per Team</FieldLabel>
          <input
            type="number" min={0}
            className="form-input mb-3"
            value={league.keepersPerTeam}
            onChange={(e) => onChange({ keepersPerTeam: parseInt(e.target.value || "0", 10) })}
          />
        </>
      )}
    </>
  );
}

/** Roster slot counts with a running total. */
export function RosterSlots<K extends string>({
  roster, onChange, hint, labelFor,
}: {
  roster: Record<K, number>;
  onChange: (pos: K, val: number) => void;
  /** Optional helper line under the heading. */
  hint?: string;
  labelFor?: (pos: K) => string;
}) {
  const total = (Object.values(roster) as number[]).reduce((a, b) => a + b, 0);
  return (
    <>
      <h3 className={`text-sm font-semibold mt-3 ${hint ? "mb-1" : "mb-2"}`} style={text}>
        Roster Slots
      </h3>
      {hint && <p className="text-xs mb-2" style={muted}>{hint}</p>}
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(roster) as K[]).map((pos) => (
          <label key={pos} className="text-xs flex items-center gap-2" style={text}>
            <span className="w-12">{labelFor ? labelFor(pos) : pos}</span>
            <input
              type="number" min={0}
              className="form-input p-1"
              value={roster[pos]}
              onChange={(e) => onChange(pos, parseInt(e.target.value || "0", 10))}
            />
          </label>
        ))}
      </div>
      <div className="text-xs mt-2" style={muted}>
        Total roster size:{" "}
        <span className="font-semibold" style={text}>{total}</span>
      </div>
    </>
  );
}

// ============================================================
// Scoring card pieces
// ============================================================

/** One "label + help + points value" row. */
export function WeightRow({
  label, help, value, onCommit,
  labelClassName = "text-sm w-16 flex items-center gap-1",
  inputClassName = "form-input p-1",
}: {
  label: string;
  help: string;
  value: number;
  onCommit: (n: number) => void;
  labelClassName?: string;
  inputClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className={labelClassName} style={text}>
        {label}
        <StatHelp text={help} />
      </label>
      <WeightInput className={inputClassName} value={value} onCommit={onCommit} />
    </div>
  );
}

/** Points-mode list: one WeightRow per stat. */
export function WeightList<K extends string>({
  stats, weights, descriptions, onCommit, labelWidth, labelFor,
}: {
  stats: readonly K[];
  weights: Record<K, number>;
  descriptions: Record<K, string>;
  onCommit: (stat: K, n: number) => void;
  /** Tailwind width class for the stat label, e.g. "w-16". */
  labelWidth: string;
  labelFor?: (stat: K) => string;
}) {
  return (
    <>
      {stats.map((stat) => (
        <WeightRow
          key={stat}
          label={labelFor ? labelFor(stat) : stat}
          help={descriptions[stat]}
          value={weights[stat]}
          onCommit={(n) => onCommit(stat, n)}
          labelClassName={`text-sm ${labelWidth} flex items-center gap-1`}
        />
      ))}
    </>
  );
}

const ON  = { background: "var(--color-primary)", color: "#fff" };
const OFF = { color: "var(--color-muted)" };

/** Categories-mode list: a checkbox per stat plus a +/− direction toggle
 *  ("−" = lower is better) for the ones that are switched on. */
export function CategoryList<K extends string>({
  title, stats, categories, descriptions, onChange, idPrefix, labelWidth, labelFor,
}: {
  title: string;
  stats: readonly K[];
  categories: Record<K, CategoryConfig | null>;
  descriptions: Record<K, string>;
  onChange: (stat: K, cfg: CategoryConfig | null) => void;
  /** Prefix for checkbox ids; must be unique per list on the page. */
  idPrefix: string;
  labelWidth: string;
  labelFor?: (stat: K) => string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2" style={text}>{title}</h3>
      <div className="space-y-1">
        {stats.map((stat) => {
          const cfg = categories[stat];
          const id  = `${idPrefix}-${stat}`;
          return (
            <div key={stat} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id={id}
                checked={cfg !== null}
                onChange={(e) => onChange(stat, e.target.checked ? { direction: "more" } : null)}
              />
              <label
                htmlFor={id}
                className={`${labelWidth} cursor-pointer flex items-center gap-1`}
                style={text}
              >
                {labelFor ? labelFor(stat) : stat}
                <StatHelp text={descriptions[stat]} />
              </label>
              {cfg && (
                <div
                  className="flex rounded-lg border overflow-hidden text-xs"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <button
                    style={cfg.direction === "more" ? ON : OFF}
                    className="px-1.5 py-0.5 transition-colors"
                    onClick={() => onChange(stat, { direction: "more" })}
                  >+</button>
                  <button
                    style={cfg.direction === "less" ? ON : OFF}
                    className="px-1.5 py-0.5 transition-colors"
                    onClick={() => onChange(stat, { direction: "less" })}
                  >−</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
