import { NextResponse } from 'next/server'

// TODO: implement GET (list leagues) and POST (create league)
// - Authenticate with auth() from @clerk/nextjs/server
// - Use supabase client from lib/supabase.ts
// - Filter all queries by user_id (Clerk user ID) — RLS is disabled, enforce manually

export async function GET() {
  return NextResponse.json({ message: 'leagues GET — not yet implemented' }, { status: 501 })
}

export async function POST() {
  return NextResponse.json({ message: 'leagues POST — not yet implemented' }, { status: 501 })
}
