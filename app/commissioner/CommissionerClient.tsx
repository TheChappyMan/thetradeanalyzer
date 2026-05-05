"use client";

import { useState, useEffect, useCallback } from "react";
import type { CommissionerSeat } from "@/lib/commissioner";

// ── Types ──────────────────────────────────────────────────────────────────

type SeatRow = Omit<CommissionerSeat, "invite_token">;

type TradeRow = {
  id: string;
  user_id: string;
  created_at: string;
  trade_data: {
    sport?: string;
    leagueName?: string;
    sendPlayerNames?: string[];
    recvPlayerNames?: string[];
    sendPicks?: string;
    recvPicks?: string;
    sendValue?: number;
    recvValue?: number;
    score?: number;
    verdict?: string;
  } | null;
  memberEmail: string;
};

type Member = { userId: string; email: string };

type Props = {
  initialSeats:  SeatRow[];
  groupId:       string;
  groupExpiresAt: string;
  filledCount:   number;
};

// ── Seat Management Panel ──────────────────────────────────────────────────

export function SeatPanel({ initialSeats, groupId, filledCount }: Props) {
  const [seats,       setSeats]       = useState<SeatRow[]>(initialSeats);
  const [emailInput,  setEmailInput]  = useState("");
  const [addError,    setAddError]    = useState<string | null>(null);
  const [adding,      setAdding]      = useState(false);
  const [actionState, setActionState] = useState<Record<string, string>>({});

  const MAX_MANAGER_SEATS = 11;
  const currentFilled     = seats.filter((s) => s.status !== "removed").length;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/commissioner/invite", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAddError(json.error ?? "Failed to send invite");
      } else {
        setSeats((prev) => [json.data as SeatRow, ...prev]);
        setEmailInput("");
      }
    } catch {
      setAddError("Network error — please try again");
    }
    setAdding(false);
  }

  async function handleRemove(seatId: string) {
    setActionState((s) => ({ ...s, [seatId]: "removing" }));
    try {
      const res = await fetch(`/api/commissioner/seats/${seatId}`, { method: "DELETE" });
      if (res.ok) {
        setSeats((prev) =>
          prev.map((s) => (s.id === seatId ? { ...s, status: "removed" as const } : s))
        );
      } else {
        const json = await res.json();
        setActionState((s) => ({ ...s, [seatId]: json.error ?? "Error" }));
        return;
      }
    } catch {
      setActionState((s) => ({ ...s, [seatId]: "Network error" }));
      return;
    }
    setActionState((s) => { const n = { ...s }; delete n[seatId]; return n; });
  }

  async function handleResend(seatId: string) {
    setActionState((s) => ({ ...s, [seatId]: "sending" }));
    try {
      const res = await fetch(`/api/commissioner/seats/${seatId}/resend`, { method: "POST" });
      if (res.ok) {
        setActionState((s) => ({ ...s, [seatId]: "sent" }));
        setTimeout(() => setActionState((s) => { const n = { ...s }; delete n[seatId]; return n; }), 2500);
      } else {
        const json = await res.json();
        setActionState((s) => ({ ...s, [seatId]: json.error ?? "Error" }));
      }
    } catch {
      setActionState((s) => ({ ...s, [seatId]: "Network error" }));
    }
  }

  async function handleCancelInvite(seatId: string) {
    await handleRemove(seatId);
  }

  const activeSeats  = seats.filter((s) => s.status !== "removed");
  const canAddMore   = activeSeats.length < MAX_MANAGER_SEATS;

  return (
    <div className="border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-base">Seats</h2>
        <span className="text-xs text-gray-500 border rounded-full px-2.5 py-1">
          {filledCount + 1 /* commissioner */ + activeSeats.filter((s) => s.status === "active").length} / 12 filled
        </span>
      </div>

      {/* Commissioner seat (always filled) */}
      <div className="flex items-center justify-between py-2 border-b">
        <div>
          <span className="text-sm font-medium">You (Commissioner)</span>
          <span className="ml-2 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">Active</span>
        </div>
      </div>

      {/* Manager seats */}
      {activeSeats.map((seat) => {
        const state    = actionState[seat.id];
        const isActive  = seat.status === "active";
        const isPending = seat.status === "pending";
        return (
          <div key={seat.id} className="flex items-center justify-between py-2 border-b last:border-0">
            <div className="min-w-0">
              <span className="text-sm truncate">{seat.invited_email}</span>
              {isActive && (
                <>
                  <span className="ml-2 text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">Active</span>
                  {seat.joined_at && (
                    <span className="ml-2 text-xs text-gray-400">
                      Joined {new Date(seat.joined_at).toLocaleDateString()}
                    </span>
                  )}
                </>
              )}
              {isPending && (
                <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">Pending</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {state && (
                <span className={`text-xs ${state === "sent" ? "text-green-600" : "text-gray-500"}`}>
                  {state === "removing" ? "Removing…" : state === "sending" ? "Sending…" : state === "sent" ? "Sent!" : state}
                </span>
              )}
              {!state && isPending && (
                <>
                  <button
                    onClick={() => handleResend(seat.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Resend
                  </button>
                  <button
                    onClick={() => handleCancelInvite(seat.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Cancel
                  </button>
                </>
              )}
              {!state && isActive && (
                <button
                  onClick={() => handleRemove(seat.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}

      {activeSeats.length === 0 && (
        <p className="text-sm text-gray-400 italic py-3">No managers added yet.</p>
      )}

      {/* Add Manager form */}
      {canAddMore && (
        <form onSubmit={handleAdd} className="mt-4 flex gap-2">
          <input
            type="email"
            className="border rounded-xl px-3 py-1.5 text-sm flex-1 min-w-0"
            placeholder="manager@example.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={adding}
            className="text-sm bg-blue-600 text-white rounded-xl px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {adding ? "Adding…" : "Add Manager"}
          </button>
        </form>
      )}
      {!canAddMore && (
        <p className="mt-3 text-xs text-gray-400 italic">All 11 manager seats are filled.</p>
      )}
      {addError && <p className="mt-2 text-xs text-red-600">{addError}</p>}
    </div>
  );
}

// ── Trade History Panel ────────────────────────────────────────────────────

export function CommissionerTradeHistory() {
  const [trades,    setTrades]    = useState<TradeRow[]>([]);
  const [members,   setMembers]   = useState<Member[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const [filterMember,   setFilterMember]   = useState("all");
  const [filterSport,    setFilterSport]    = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo,   setFilterDateTo]   = useState("");

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filterMember   !== "all") params.set("memberId",  filterMember);
    if (filterSport    !== "all") params.set("sport",     filterSport);
    if (filterDateFrom)           params.set("dateFrom",  filterDateFrom);
    if (filterDateTo)             params.set("dateTo",    filterDateTo);

    try {
      const res  = await fetch(`/api/commissioner/trades?${params}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load trades"); setLoading(false); return; }
      setTrades(json.data ?? []);
      if (json.members) setMembers(json.members);
    } catch {
      setError("Network error — please try again");
    }
    setLoading(false);
  }, [filterMember, filterSport, filterDateFrom, filterDateTo]);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="border rounded-2xl p-5">
      <h2 className="font-semibold text-base mb-4">League-Wide Trade History</h2>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        {members.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 shrink-0">Member:</label>
            <select
              className="border rounded-xl px-2 py-1 text-xs"
              value={filterMember}
              onChange={(e) => setFilterMember(e.target.value)}
            >
              <option value="all">All Members</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.email}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 shrink-0">Sport:</label>
          <select
            className="border rounded-xl px-2 py-1 text-xs"
            value={filterSport}
            onChange={(e) => setFilterSport(e.target.value)}
          >
            <option value="all">All Sports</option>
            <option value="nhl">NHL</option>
            <option value="nfl">NFL</option>
            <option value="mlb">MLB</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 shrink-0">From:</label>
          <input
            type="date"
            className="border rounded-xl px-2 py-1 text-xs"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 shrink-0">To:</label>
          <input
            type="date"
            className="border rounded-xl px-2 py-1 text-xs"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
          />
        </div>

        <button
          onClick={fetchTrades}
          className="text-xs border rounded-xl px-3 py-1 hover:bg-gray-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Trade count */}
      {!loading && !error && (
        <p className="text-xs text-gray-400 mb-3">
          {trades.length} trade{trades.length !== 1 ? "s" : ""}
        </p>
      )}

      {loading && <p className="text-sm text-gray-400 italic">Loading trades…</p>}
      {error   && <p className="text-sm text-red-600">{error}</p>}

      {/* Trade rows */}
      {!loading && !error && trades.length === 0 && (
        <p className="text-sm text-gray-400 italic">No trades found for the selected filters.</p>
      )}

      <div className="space-y-2">
        {trades.map((row) => {
          const td         = row.trade_data;
          const isExp      = !!expanded[row.id];
          const score      = td?.score ?? 50;
          const scoreBg    =
            score >= 60 ? "bg-green-50 border-green-200" :
            score <= 40 ? "bg-red-50 border-red-200"   :
            "bg-gray-50 border-gray-200";

          const sendSummary = [
            ...(td?.sendPlayerNames ?? []),
            ...(td?.sendPicks ? td.sendPicks.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) : []),
          ].join(", ") || "—";

          const recvSummary = [
            ...(td?.recvPlayerNames ?? []),
            ...(td?.recvPicks ? td.recvPicks.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) : []),
          ].join(", ") || "—";

          const date    = new Date(row.created_at);
          const dateStr = date.toLocaleDateString();
          const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          return (
            <div key={row.id} className={`border rounded-xl text-xs ${scoreBg}`}>
              {/*
                Three-column grid:
                  col-1 (meta)    — fixed max-width, clips long emails/league names
                  col-2 (summary) — takes remaining space, truncates trade text
                  col-3 (score)   — auto-sized, never compressed
              */}
              <div
                className="grid items-center gap-x-3 px-3 py-2 cursor-pointer select-none overflow-hidden"
                style={{ gridTemplateColumns: "minmax(0,220px) minmax(0,1fr) auto" }}
                onClick={() => toggleExpanded(row.id)}
              >
                {/* Col 1 — date · member email · sport badge · league name */}
                <div className="min-w-0">
                  <div className="text-gray-400 whitespace-nowrap leading-tight">
                    {dateStr} {timeStr}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 min-w-0">
                    <span className="font-medium text-[10px] uppercase tracking-wide text-gray-600 truncate">
                      {row.memberEmail}
                    </span>
                    {td?.sport && (
                      <span className="shrink-0 text-[9px] uppercase bg-gray-100 text-gray-500 rounded px-1">
                        {td.sport}
                      </span>
                    )}
                  </div>
                  {td?.leagueName && (
                    <div className="text-gray-400 leading-tight truncate">{td.leagueName}</div>
                  )}
                </div>

                {/* Col 2 — trade summary (give → get), truncates with ellipsis */}
                <div className="min-w-0 text-gray-600 truncate hidden sm:block">
                  {sendSummary} → {recvSummary}
                </div>

                {/* Col 3 — score badge + chevron, always fully visible */}
                <div className="flex items-center gap-2 justify-end">
                  <span className="font-semibold whitespace-nowrap">{score.toFixed(1)} / 100</span>
                  <span className="text-gray-400 shrink-0">{isExp ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExp && (
                <div className="px-3 pb-3 border-t border-inherit pt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="font-semibold text-gray-700 mb-1">They Give</div>
                      {(td?.sendPlayerNames ?? []).length > 0 && (
                        <div className="mb-1">{(td?.sendPlayerNames ?? []).join(", ")}</div>
                      )}
                      {td?.sendPicks && (
                        <div className="text-gray-500">Picks: {td.sendPicks}</div>
                      )}
                      <div className="text-gray-600 mt-1">
                        Value: <span className="font-medium">{(td?.sendValue ?? 0).toFixed(1)}</span>
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-700 mb-1">They Get</div>
                      {(td?.recvPlayerNames ?? []).length > 0 && (
                        <div className="mb-1">{(td?.recvPlayerNames ?? []).join(", ")}</div>
                      )}
                      {td?.recvPicks && (
                        <div className="text-gray-500">Picks: {td.recvPicks}</div>
                      )}
                      <div className="text-gray-600 mt-1">
                        Value: <span className="font-medium">{(td?.recvValue ?? 0).toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                  {td?.verdict && (
                    <div className="text-gray-700 italic">{td.verdict}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
