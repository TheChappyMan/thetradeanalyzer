import Link from "next/link";

/**
 * Custom 404 page — rendered by Next.js for any unmatched route.
 */
export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
      <h1
        className="text-6xl font-bold mb-6 tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        404
      </h1>

      <p
        className="text-base max-w-md mb-8 leading-relaxed"
        style={{ color: "var(--color-muted)" }}
      >
        You&apos;ve found a page that doesn&apos;t exist, just like the Easter Bunny.
        But&hellip; you are on a page, so I guess it does exist. Does that mean the
        Easter Bunny does exist? Tired of my philosophical debate? Get back to
        analyzing trades.
      </p>

      <Link href="/" className="btn-accent">
        Start Analyzing
      </Link>
    </div>
  );
}
