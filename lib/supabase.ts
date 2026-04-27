import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
  )
}

/**
 * Server-side Supabase client using the service role key.
 *
 * Use only in API routes / Server Actions — never expose this client
 * to the browser. Row-level security is bypassed by the service role;
 * all access control is enforced in the API route handlers instead
 * (filtering by the Clerk user ID from auth()).
 */
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    // We handle auth via Clerk, not Supabase Auth
    persistSession: false,
    autoRefreshToken: false,
  },
})
