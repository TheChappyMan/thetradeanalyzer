"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Numeric input for scoring weights that tolerates in-progress values like
 * "-", "-0." or ".5". A controlled <input type="number"> whose onChange
 * parses immediately re-renders the parsed result and eats the minus sign;
 * this keeps the raw string locally while focused and only syncs from the
 * prop when not editing. type="text" because iOS numeric/decimal keypads
 * have no minus key.
 */
export default function WeightInput({
  value,
  onCommit,
  className,
  style,
}: {
  value: number;
  onCommit: (n: number) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [text, setText] = useState<string>(Number.isFinite(value) ? String(value) : "");
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  return (
    <input
      type="text"
      className={className}
      style={style}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setText(Number.isFinite(value) ? String(value) : "");
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^-?\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        const n = parseFloat(raw);
        onCommit(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}
