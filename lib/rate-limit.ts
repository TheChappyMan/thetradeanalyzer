/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * LIMITATION: state lives per server instance. On serverless (Vercel) each
 * warm lambda has its own map, so the effective limit is per-instance, not
 * global. That still blunts abuse from a single client hammering one warm
 * instance. For a hard global limit, back this with Redis or a DB table.
 */

type Window = { timestamps: number[] }

const windows = new Map<string, Window>()

// Periodically drop empty windows so the map doesn't grow unbounded.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastCleanup = Date.now()

/**
 * Returns true if the action identified by `key` is allowed, and records it.
 * Allows at most `limit` calls per `windowMs` sliding window.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()

  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = now
    for (const [k, w] of windows) {
      if (w.timestamps.every((t) => now - t > windowMs)) windows.delete(k)
    }
  }

  const w = windows.get(key) ?? { timestamps: [] }
  w.timestamps = w.timestamps.filter((t) => now - t < windowMs)

  if (w.timestamps.length >= limit) {
    windows.set(key, w)
    return false
  }

  w.timestamps.push(now)
  windows.set(key, w)
  return true
}
