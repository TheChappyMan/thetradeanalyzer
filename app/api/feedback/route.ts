/**
 * POST /api/feedback
 *
 * Accepts an accuracy rating (1-10) with optional comments from any visitor
 * (signed-in or anonymous). Rate-limited to prevent spam.
 *
 * Body: { sport: 'nhl' | 'nfl' | 'mlb', rating: number, comments?: string }
 * Returns: { success: true }  201
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit'

const VALID_SPORTS = new Set(['nhl', 'nfl', 'mlb'])
const MAX_COMMENT_LENGTH = 2000

export async function POST(request: Request) {
  // Signed-in users are identified by Clerk ID; anonymous by IP.
  const { userId } = await auth()
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limitKey = userId ? `feedback:user:${userId}` : `feedback:ip:${ip}`

  // 3 submissions per hour per user/IP
  if (!rateLimit(limitKey, 3, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: 'Too many submissions — please try again later' },
      { status: 429 }
    )
  }

  let body: { sport?: string; rating?: number; comments?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sport = (body.sport ?? '').toLowerCase()
  if (!VALID_SPORTS.has(sport)) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  const rating = body.rating
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 10) {
    return NextResponse.json(
      { error: 'Rating must be an integer between 1 and 10' },
      { status: 400 }
    )
  }

  const comments =
    typeof body.comments === 'string' && body.comments.trim()
      ? body.comments.trim().slice(0, MAX_COMMENT_LENGTH)
      : null

  const { error } = await supabase
    .from('feedback')
    .insert({ user_id: userId ?? null, sport, rating, comments })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true }, { status: 201 })
}
