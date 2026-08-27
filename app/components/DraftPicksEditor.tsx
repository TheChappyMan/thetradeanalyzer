"use client";

// Draft Picks editor card, shared by the NHL and NFL league settings
// sections. Generates a full pick list from teams/slot/order, then lets the
// user add or remove individual picks freely (picks get traded). The result
// is stored on the league object (League.draftPicks / NflLeague.draftPicks)
// and consumed by Rankings Draft Mode.

import { useState } from "react";
import {
  draftRounds,
  generateDraftPicks,
  parseDraftPick,
  type DraftPicksConfig,
} from "@/lib/draft";

export default function DraftPicksEditor({ value, defaultTeams, roster, onChange }: {
  value: DraftPicksConfig | undefined;
  defaultTeams: number;
  roster: Record<string, number>;
  onChange: (cfg: DraftPicksConfig) => void;
}) {
  const cfg: DraftPicksConfig =
    value ?? { teams: defaultTeams, slot: 1, format: "snake", picks: [] };
  const [newPick, setNewPick] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);

  const update = (patch: Partial<DraftPicksConfig>) => onChange({ ...cfg, ...patch });

  const generate = () => {
    const teams = Math.max(2, cfg.teams);
    const slot = Math.min(Math.max(1, cfg.slot), teams);
    update({
      teams,
      slot,
      picks: generateDraftPicks(teams, slot, cfg.format, draftRounds(roster)),
    });
  };

  const addPick = () => {
    const parsed = parseDraftPick(newPick, cfg.teams);
    if (!parsed) {
      setPickError(`Use round.slot with a slot between 1 and ${cfg.teams} (e.g. 3.05)`);
      return;
    }
    setPickError(null);
    setNewPick("");
    if (cfg.picks.some((p) => parseDraftPick(p, cfg.teams)?.overall === parsed.overall)) return;
    const picks = [...cfg.picks, parsed.raw].sort((a, b) =>
      (parseDraftPick(a, cfg.teams)?.overall ?? 0) - (parseDraftPick(b, cfg.teams)?.overall ?? 0)
    );
    update({ picks });
  };

  const removePick = (pick: string) =>
    update({ picks: cfg.picks.filter((p) => p !== pick) });

  return (
    <div className="card mt-4">
      <h2 className="font-medium mb-1" style={{ color: "var(--color-text)" }}>
        Draft Picks
      </h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
        Draft Mode on the Rankings page uses this list to place your next-pick marker.
        Generate your picks from your draft slot, then add or remove individual picks
        as they get traded. Picks use <span className="font-mono">round.slot</span> format
        (e.g. 1.09 is the ninth pick of round one).
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="text-sm block mb-1" style={{ color: "var(--color-muted)" }}>
            Teams
          </label>
          <input
            type="number" min={2} max={32}
            className="form-input w-20"
            value={cfg.teams}
            onChange={(e) => update({ teams: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
        <div>
          <label className="text-sm block mb-1" style={{ color: "var(--color-muted)" }}>
            Your slot
          </label>
          <input
            type="number" min={1} max={cfg.teams}
            className="form-input w-20"
            value={cfg.slot}
            onChange={(e) => update({ slot: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
        <div>
          <label className="text-sm block mb-1" style={{ color: "var(--color-muted)" }}>
            Order
          </label>
          <select
            className="form-input"
            value={cfg.format}
            onChange={(e) => update({ format: e.target.value as "snake" | "linear" })}
          >
            <option value="snake">Snake</option>
            <option value="linear">Linear</option>
          </select>
        </div>
        <button onClick={generate} className="btn-secondary">
          Generate pick list
        </button>
      </div>

      {cfg.picks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {cfg.picks.map((pick) => (
            <span
              key={pick}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-mono"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
            >
              {pick}
              <button
                onClick={() => removePick(pick)}
                className="leading-none"
                style={{ color: "var(--color-muted)" }}
                aria-label={`Remove pick ${pick}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          className="form-input w-28 font-mono"
          placeholder="e.g. 3.05"
          value={newPick}
          onChange={(e) => { setNewPick(e.target.value); setPickError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") addPick(); }}
        />
        <button onClick={addPick} className="link-primary text-sm font-medium">
          + Add pick
        </button>
      </div>
      {pickError && (
        <p className="text-xs mt-1" style={{ color: "var(--color-danger)" }}>{pickError}</p>
      )}
      <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>
        Remember to save your settings below: the pick list is stored with this league.
      </p>
    </div>
  );
}
