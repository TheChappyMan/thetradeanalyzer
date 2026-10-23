"use client";

import { useEffect, useRef, useState } from "react";

/**
 * StatHelp — a small "?" badge that reveals a tooltip explaining a stat.
 * Shows on hover (desktop) and toggles on tap (mobile, where hover never
 * fires); an outside tap or Escape closes it. Renders nothing when no
 * description is provided, so callers can pass a lookup directly without
 * guarding.
 */
export default function StatHelp({ text }: { text: string | undefined }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

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
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!text) return null;
  return (
    <span ref={rootRef} className="relative inline-flex group align-middle">
      <button
        type="button"
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border text-[9px] font-semibold cursor-help select-none leading-none"
        style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        aria-label={text}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>
      <span
        className={`pointer-events-none absolute z-50 ${open ? "block" : "hidden"} group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 rounded-lg border p-2 text-[11px] font-normal normal-case leading-snug text-left shadow-lg`}
        style={{
          background: "var(--color-surface)",
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
        }}
      >
        {text}
      </span>
    </span>
  );
}
