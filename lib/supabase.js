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

export const ROLES = {
  coaches: [
    'sjmyers81@gmail.com',
    'scottyinabox@gmail.com',
  ],
  parents: [
    // Add parent emails here when ready
  ]
}

export function getRole(email) {
  if (!email) return null
  const e = email.toLowerCase()
  if (ROLES.coaches.includes(e)) return 'coach'
  if (ROLES.parents.includes(e)) return 'parent'
  return null
}