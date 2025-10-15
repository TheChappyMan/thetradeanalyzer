"use client";
import React, { useMemo, useState } from "react";

type RosterKey = 'F' | 'W' | 'C' | 'LW' | 'RW' | 'D' | 'U' | 'G' | 'B' | 'IR' | 'IRp';
type Roster = Record<RosterKey, number>;

type League = {
  teams: number;
  draftType: 'snake' | 'linear';
  seasonStats: 'current' | 'last';
  roster: Roster;
  weights: Record<string, number>;
};

const ROSTER_KEYS: RosterKey[] = ['F','W','C','LW','RW','D','U','G','B','IR','IRp'];

const [league, setLeague] = useState<League>({
  teams: 12,
  draftType: 'snake',
  seasonStats: 'current',
  roster: { F:2, W:2, C:2, LW:2, RW:2, D:4, U:2, G:2, B:4, IR:1, IRp:0 },
  weights: {},
});

/**
 * Fantasy Trade Analyzer – Full Layout
 * - Restored players, picks, league scoring, and roster input sections
 * - Integrated fairness scoring (τ=0.65, fixed)
 */

function tanh(x: number) {
  const e1 = Math.exp(x);
  const e2 = Math.exp(-x);
  return (e1 - e2) / (e1 + e2);
}

function fairnessScore(give: number, get: number): number {
  const TAU = 0.65;
  const total = give + get;
  if (total === 0) return 50;
  const pctDiff = (get - give) / total;
  const raw = 50 + 50 * tanh(pctDiff / TAU);
  return Math.max(0, Math.min(100, raw));
}

function fairnessDescription(score: number): string {
  if (score <= 10.4) return "You're getting robbed.";
  if (score <= 20.4) return "Not quite a robbery, but you're giving a lot away.";
  if (score <= 30.4) return "It's close, but you lose value.";
  if (score <= 40.4) return "You lose, but only by a bit.";
  if (score <= 60.4) return "This is in the realm of fairness.";
  if (score <= 70.4) return "You win this trade.";
  if (score <= 80.4) return "Big win for you.";
  if (score <= 90.4) return "They shouldn't accept this trade, but if they do, good for you.";
  return "We won't tell, but if they accept this, it's probably collusion.";
}

export default function TradeAnalyzer() {
  // League settings
  const [league, setLeague] = useState({
    teams: 12,
    draftType: "snake",
    seasonStats: "current",
    roster: { F: 2, W: 2, C: 2, LW: 2, RW: 2, D: 4, U: 2, G: 2, B: 4, IR: 1, IRp: 0 },
    weights: {},
  });

  // Player & pick inputs
  const [sendPlayers, setSendPlayers] = useState("");
  const [recvPlayers, setRecvPlayers] = useState("");
  const [sendPicks, setSendPicks] = useState("");
  const [recvPicks, setRecvPicks] = useState("");

  // Placeholder numeric values for now (mocked player valuations)
  const [sendValue, setSendValue] = useState(50);
  const [recvValue, setRecvValue] = useState(50);

  const score = useMemo(() => fairnessScore(sendValue, recvValue), [sendValue, recvValue]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Fantasy Trade Analyzer (NHL – Full Prototype)</h1>

      {/* League + Scoring Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="border rounded-2xl p-4">
          <h2 className="font-medium mb-2">League Settings</h2>
          <label className="text-sm">Number of Teams</label>
          <input
            type="number"
            min={2}
            className="border rounded-xl p-2 w-full mb-2"
            value={league.teams}
            onChange={(e) => setLeague({ ...league, teams: parseInt(e.target.value || "12", 10) })}
          />
          <label className="text-sm">Draft Type</label>
          <select
            className="border rounded-xl p-2 w-full mb-3"
            value={league.draftType}
            onChange={(e) => setLeague({ ...league, draftType: e.target.value })}
          >
            <option value="snake">Snake</option>
            <option value="linear">Linear</option>
          </select>

		<h3 className="text-sm font-semibold mt-2 mb-2">Roster Slots</h3>
		<div className="grid grid-cols-2 gap-2">
		  {ROSTER_KEYS.map((pos) => (
			<label key={pos} className="text-xs flex items-center gap-2">
			  <span className="w-8">{pos}</span>
			  <input
				type="number"
				min={0}
				className="border rounded-xl p-1 w-full"
				value={league.roster[pos]}
				onChange={(e) =>
				  setLeague({
					...league,
					roster: { ...league.roster, [pos]: parseInt(e.target.value || '0', 10) },
				  })
				}
			  />
			</label>
		  ))}
		</div>

        <div className="border rounded-2xl p-4">
          <h2 className="font-medium mb-2">Scoring Weights</h2>
          <div className="grid grid-cols-2 gap-x-4">
            {["G","A","P","+/-","PIM","PPG","PPA","PPP","SOG","W","SO","FW","FL","HIT","BLK"].map((stat) => (
              <div key={stat} className="flex items-center justify-between gap-2 mb-1">
                <label className="text-sm w-16">{stat}</label>
                <input type="number" step="0.1" className="border rounded-xl p-1 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trade Inputs */}
      <div className="border rounded-2xl p-4 mb-6">
        <h2 className="font-medium mb-3">Trade Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold mb-1">You Give</h3>
            <textarea
              className="border rounded-xl p-2 w-full h-20 mb-2"
              placeholder="Players (comma or line separated)"
              value={sendPlayers}
              onChange={(e) => setSendPlayers(e.target.value)}
            />
            <textarea
              className="border rounded-xl p-2 w-full h-20"
              placeholder="Picks (e.g., 1.01, 2.02)"
              value={sendPicks}
              onChange={(e) => setSendPicks(e.target.value)}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-1">You Get</h3>
            <textarea
              className="border rounded-xl p-2 w-full h-20 mb-2"
              placeholder="Players (comma or line separated)"
              value={recvPlayers}
              onChange={(e) => setRecvPlayers(e.target.value)}
            />
            <textarea
              className="border rounded-xl p-2 w-full h-20"
              placeholder="Picks (e.g., 1.01, 2.02)"
              value={recvPicks}
              onChange={(e) => setRecvPicks(e.target.value)}
            />
          </div>
        </div>
      </div>

		{/* Fairness Output */}
		<div className="border rounded-2xl p-4">
		  <h2 className="font-medium mb-3">Fairness Result</h2>

		  {/* Add trade value inputs here */}
		  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
			<div>
			  <label className="text-sm">You Give Value</label>
			  <input
				type="number"
				className="border rounded-xl p-2 w-full mb-2"
				value={sendValue}
				onChange={(e) => setSendValue(parseFloat(e.target.value || '0'))}
			  />
			</div>
			<div>
			  <label className="text-sm">You Get Value</label>
			  <input
				type="number"
				className="border rounded-xl p-2 w-full mb-2"
				value={recvValue}
				onChange={(e) => setRecvValue(parseFloat(e.target.value || '0'))}
			  />
			</div>
		  </div>

		  <div className="text-2xl font-semibold">{score.toFixed(1)} / 100</div>
		  <div className="mt-2 text-sm text-gray-700">{fairnessDescription(score)}</div>
		</div>

      {/* Fairness Output */}
      <div className="border rounded-2xl p-4">
        <h2 className="font-medium mb-3">Fairness Result</h2>
        <div className="text-2xl font-semibold">{score.toFixed(1)} / 100</div>
        <div className="mt-2 text-sm text-gray-700">{fairnessDescription(score)}</div>
      </div>
    </div>
  );
}
