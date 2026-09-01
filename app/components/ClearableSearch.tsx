"use client";

/**
 * ClearableSearch — small search input with an "×" button that appears when
 * there's text and clears it on click. Used on the Rankings tabs.
 */
export default function ClearableSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative ml-auto w-full" style={{ maxWidth: "14rem" }}>
      <input
        type="text"
        className="form-input text-xs w-full"
        style={{ paddingTop: "0.25rem", paddingBottom: "0.25rem", paddingRight: "1.75rem" }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-xs leading-none transition-opacity hover:opacity-70"
          style={{ color: "var(--color-muted)", background: "var(--color-border)" }}
          onClick={() => onChange("")}
        >
          ×
        </button>
      )}
    </div>
  );
}
