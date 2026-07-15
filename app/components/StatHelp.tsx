"use client";

/**
 * StatHelp — a small "?" badge that reveals a hover tooltip explaining a stat.
 * Renders nothing when no description is provided, so callers can pass a
 * lookup directly without guarding.
 */
export default function StatHelp({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <span className="relative inline-flex group align-middle">
      <span
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border text-[9px] font-semibold cursor-help select-none leading-none"
        style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        aria-label={text}
        role="img"
      >
        ?
      </span>
      <span
        className="pointer-events-none absolute z-50 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 rounded-lg border p-2 text-[11px] font-normal normal-case leading-snug text-left shadow-lg"
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
