"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * StatHelp — a small "?" badge that reveals a tooltip explaining a stat.
 * Shows on hover (desktop) and toggles on tap (mobile); an outside tap,
 * scrolling, or Escape closes it. The tooltip renders position:fixed and is
 * measured after opening so it can be clamped inside the viewport — badges
 * near a screen edge would otherwise push it off-screen on mobile. Renders
 * nothing when no description is provided, so callers can pass a lookup
 * directly without guarding.
 */
export default function StatHelp({ text }: { text: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Touch taps fire synthetic mouse events, so hover handling is gated to
  // real mice and the click toggle to non-mouse pointers.
  const lastPointerType = useRef("");

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const badge = rootRef.current;
    const tip = tipRef.current;
    if (!badge || !tip) return;
    const b = badge.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const margin = 8;
    let left = b.left + b.width / 2 - t.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - t.width));
    let top = b.top - t.height - 6;
    if (top < margin) top = b.bottom + 6;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  if (!text) return null;
  return (
    <span
      ref={rootRef}
      className="relative inline-flex align-middle"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setOpen(false);
      }}
    >
      <button
        type="button"
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border text-[9px] font-semibold cursor-help select-none leading-none"
        style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        aria-label={text}
        aria-expanded={open}
        onPointerDown={(e) => {
          lastPointerType.current = e.pointerType;
        }}
        onClick={(e) => {
          e.preventDefault();
          if (lastPointerType.current === "mouse") setOpen(true);
          else setOpen((o) => !o);
        }}
      >
        ?
      </button>
      {open && (
        <span
          ref={tipRef}
          className="pointer-events-none fixed z-50 w-52 rounded-lg border p-2 text-[11px] font-normal normal-case leading-snug text-left shadow-lg"
          style={{
            left: pos ? `${pos.left}px` : 0,
            top: pos ? `${pos.top}px` : 0,
            visibility: pos ? "visible" : "hidden",
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
