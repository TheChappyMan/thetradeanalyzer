"use client";

/**
 * NflInjuryBadge — availability status pill (Questionable / Out / IR / PUP /
 * Suspended / NA). Single shared implementation used by the NFL trade
 * analyzer player cards and the NFL Rankings / Draft Mode rows.
 *
 * `mult` + `discountActive` only affect the tooltip: pass the applied
 * availability multiplier where the surface discounts values (trade cards),
 * or mult=1 / discountActive=false where it doesn't (Rankings).
 */
export default function NflInjuryBadge({ status, mult, discountActive }: {
  status: string | undefined;
  mult: number;
  discountActive: boolean;
}) {
  if (!status) return null;
  const isAmber  = status === "Questionable";
  const isOrange = status === "Doubtful" || status === "Out";
  const isRed    = status === "IR" || status === "PUP";
  const isDark   = status === "Sus" || status === "NA";
  const { border, text, bg } =
    isAmber  ? { border: "border-amber-400",  text: "text-amber-700",  bg: "bg-amber-50"  } :
    isOrange ? { border: "border-orange-400", text: "text-orange-700", bg: "bg-orange-50" } :
    isRed    ? { border: "border-red-400",    text: "text-red-700",    bg: "bg-red-50"    } :
    isDark   ? { border: "border-red-700",    text: "text-red-900",    bg: "bg-red-100"   } :
               { border: "border-gray-300",   text: "text-gray-600",   bg: ""             };
  const label = status === "Sus" ? "Suspended" : status;
  const showDiscount = discountActive && mult < 1.0;
  return (
    <span
      className={`border rounded-full px-1.5 py-0.5 text-[10px] font-medium ${border} ${text} ${bg}`}
      title={showDiscount
        ? `Value discounted ×${mult.toFixed(2)} for availability`
        : "No value discount applied (keeper league, or projections already reflect the absence)"}
    >
      {label}
    </span>
  );
}
