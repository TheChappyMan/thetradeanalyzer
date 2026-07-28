"use client";

import { useEffect, useState } from "react";
import StatHelp from "@/app/components/StatHelp";
import {
  NFL_YARD_BONUS_THRESHOLDS,
  nflYardBonusKey,
  type NflScoringWeights,
  type NflYardBonusCategory,
  type NflYardBonusThreshold,
} from "@/lib/nfl-types";

const CATEGORY_NOUN: Record<NflYardBonusCategory, string> = {
  pass: "passing",
  rush: "rushing",
  rec: "receiving",
};

type Props = {
  category: NflYardBonusCategory;
  weights: NflScoringWeights;
  onChange: (key: keyof NflScoringWeights, val: number) => void;
  /** Changes when a different league's settings load, re-deriving the dropdowns. */
  resetKey?: string | null;
};

/**
 * Two configurable yard-bonus slots for one category (pass/rush/rec).
 * Each slot is a threshold dropdown (100–300 yds, steps of 50) plus a
 * points input. The points live in the scoring weights under the key
 * for the selected threshold (e.g. bonusRecYd150); the dropdown just
 * chooses which key the input edits. Changing the dropdown moves any
 * points already entered to the new threshold's key.
 */
export default function NflYardBonusRows({ category, weights, onChange, resetKey }: Props) {
  const [thresholds, setThresholds] = useState<[NflYardBonusThreshold, NflYardBonusThreshold]>(
    [100, 150]
  );

  // Surface saved bonuses: when weights hold points at thresholds the
  // dropdowns don't currently show, re-derive the two slots. Guarded so
  // typing into a visible slot never reorders the rows.
  const bonusSignature = NFL_YARD_BONUS_THRESHOLDS
    .map((t) => weights[nflYardBonusKey(category, t)] ?? 0)
    .join(",");
  useEffect(() => {
    const active = NFL_YARD_BONUS_THRESHOLDS.filter(
      (t) => (weights[nflYardBonusKey(category, t)] ?? 0) !== 0
    );
    const covered = active.every((t) => thresholds.includes(t));
    if (!covered) {
      const first = active[0] ?? 100;
      const second = active[1] ?? (first === 100 ? 150 : 100);
      setThresholds([first, second]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonusSignature, resetKey]);

  const moveThreshold = (slot: 0 | 1, next: NflYardBonusThreshold) => {
    const prev = thresholds[slot];
    if (next === prev) return;
    const prevKey = nflYardBonusKey(category, prev);
    const pts = weights[prevKey] ?? 0;
    if (pts !== 0) {
      onChange(prevKey, 0);
      onChange(nflYardBonusKey(category, next), pts);
    }
    setThresholds((t) => (slot === 0 ? [next, t[1]] : [t[0], next]));
  };

  return (
    <>
      {([0, 1] as const).map((slot) => {
        const thr = thresholds[slot];
        const key = nflYardBonusKey(category, thr);
        return (
          <div key={slot} className="flex items-center justify-between gap-2">
            <label
              className="text-xs flex-1 flex items-center gap-1"
              style={{ color: "var(--color-text)" }}
            >
              Yards Bonus {slot + 1}
              <StatHelp
                text={`Bonus points per game with ${thr}+ ${CATEGORY_NOUN[category]} yards. Pick the yardage threshold, then set the points. Leave at 0 if your league doesn't use this bonus.`}
              />
            </label>
            <select
              className="form-input text-sm"
              style={{ padding: "0.25rem" }}
              value={thr}
              onChange={(e) =>
                moveThreshold(slot, parseInt(e.target.value, 10) as NflYardBonusThreshold)
              }
            >
              {NFL_YARD_BONUS_THRESHOLDS.map((t) => (
                <option key={t} value={t}>{t}+</option>
              ))}
            </select>
            <input
              type="number"
              step="0.5"
              className="form-input w-20 text-sm"
              style={{ padding: "0.25rem" }}
              value={weights[key]}
              onChange={(e) => onChange(key, parseFloat(e.target.value || "0"))}
            />
          </div>
        );
      })}
    </>
  );
}
