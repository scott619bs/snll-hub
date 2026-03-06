import { createBrowserClient } from '@supabase/ssr'
import { createServerClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

export function createServerSupabaseClient(cookieStore) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

// Role definitions — add emails here to grant access
export const ROLES = {
  coaches: [
    'sjmyers81@gmail.com',
    'scottyinabox@gmail.com',
    // Add assistant coaches:
    // 'jimmysullivan@email.com',
    // 'patrickhale@email.com',
  ],
  parents: [
    // Parents get read-only access — add their emails here
    // or leave empty to allow any logged-in user read access
  ]
}

export function getRole(email) {
  if (!email) return null
  if (ROLES.coaches.includes(email.toLowerCase())) return 'coach'
  // If parents list is empty, any authenticated user is treated as parent
  if (ROLES.parents.length === 0) return 'parent'
  if (ROLES.parents.includes(email.toLowerCase())) return 'parent'
  return null // not authorized
}
