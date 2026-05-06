import { createClient } from '@supabase/supabase-js'

// ── Environment variables ─────────────────────────────────────────────────────

const supabaseUrl            = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseAnonKey        = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
  )
}

// ── Service role client ───────────────────────────────────────────────────────

/**
 * Server-side Supabase client using the service role key.
 *
 * Use only in API routes / Server Actions — never expose this client
 * to the browser.  The service role carries BYPASSRLS, so RLS policies
 * never execute for queries made through this client.  All access control
 * is enforced explicitly in the API route handlers (filtering by the Clerk
 * user ID obtained from auth()).
 *
 * Use this for operations that legitimately need to bypass RLS:
 *   • Commissioner seat management (reading another user's rows)
 *   • Invite acceptance (writing to a seat the user doesn't own yet)
 *   • Any admin / webhook operation
 */
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

// ── User-scoped client factory ────────────────────────────────────────────────

/**
 * Creates a per-request Supabase client scoped to a specific Clerk user.
 *
 * Pass the Clerk JWT obtained from:
 *   const { getToken } = await auth()
 *   const token = await getToken({ template: 'supabase' })
 *
 * This client uses the anon key + the Clerk JWT as the Authorization header.
 * Supabase validates the JWT against the configured Clerk JWKS, populates
 * auth.uid() with the Clerk user ID ("sub" claim), and enforces all RLS
 * policies normally.
 *
 * Use this for user-facing reads and writes where RLS should be the
 * enforcement layer (leagues, trades).  The explicit .eq('user_id', userId)
 * guards in each route remain as a defence-in-depth fallback.
 *
 * Requires SUPABASE_ANON_KEY to be set.
 * Requires the Clerk "Supabase" JWT template to be configured in the
 * Clerk dashboard (Clerk → JWT Templates → Supabase).
 */
export function supabaseForUser(clerkToken: string) {
  if (!supabaseAnonKey) {
    throw new Error(
      'Missing SUPABASE_ANON_KEY environment variable. ' +
      'Add it to .env.local (and Vercel environment variables) to use ' +
      'user-scoped RLS queries.'
    )
  }
  return createClient(supabaseUrl!, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
