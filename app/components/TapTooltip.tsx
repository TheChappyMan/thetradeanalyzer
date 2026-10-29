"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * TapTooltip — wraps any inline trigger (badge, icon, value) with a tooltip
 * that works on BOTH input kinds: hover on desktop mice, tap-to-toggle on
 * touch (tap opens, tapping the trigger again or anywhere else closes;
 * Escape and scrolling also close). Never relies on CSS :hover or the
 * native title attribute, which touch devices cannot reach.
 *
 * The tooltip renders position:fixed, is measured after opening, and is
 * clamped inside the viewport so triggers near a screen edge (or inside
 * scrollable table rows) cannot push it off-screen. Mechanics mirror
 * StatHelp, generalized to arbitrary trigger content.
 *
 * `expandTarget` grows the touch hit area to 44×44px (pointer-coarse
 * devices only, via the .tap-target utility) even when the visual trigger
 * is smaller. Leave it off inside dense tables where invisible overlapping
 * hit areas would steal taps from neighboring rows.
 */
export default function TapTooltip({
  tip,
  children,
  expandTarget = false,
  className = "",
}: {
  tip: string;
  children: React.ReactNode;
  expandTarget?: boolean;
  className?: string;
}) {
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
    const trigger = rootRef.current;
    const tipEl = tipRef.current;
    if (!trigger || !tipEl) return;
    const b = trigger.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
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

  return (
    <span
      ref={rootRef}
      role="button"
      tabIndex={0}
      aria-label={tip}
      aria-expanded={open}
      className={`relative inline-flex align-middle cursor-pointer select-none ${expandTarget ? "tap-target" : ""} ${className}`}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setOpen(false);
      }}
      onPointerDown={(e) => {
        lastPointerType.current = e.pointerType;
      }}
      onClick={(e) => {
        // Never let the tap bubble into row-level handlers (draft rows,
        // checkbox cells) — opening an explanation must not act on the row.
        e.stopPropagation();
        e.preventDefault();
        if (lastPointerType.current === "mouse") setOpen(true);
        else setOpen((o) => !o);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
    >
      {children}
      {open && (
        <span
          ref={tipRef}
          className="pointer-events-none fixed z-50 max-w-[16rem] w-max rounded-lg border p-2 text-[11px] font-normal normal-case tracking-normal leading-snug text-left shadow-lg whitespace-normal"
          style={{
            left: pos ? `${pos.left}px` : 0,
            top: pos ? `${pos.top}px` : 0,
            visibility: pos ? "visible" : "hidden",
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
          }}
        >
          {tip}
        </span>
      )}
    </span>
  );
}
