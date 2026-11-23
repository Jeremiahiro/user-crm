import type { SessionUser } from '@/types/domain'
import { canManageCmp, isAdmin } from '@/lib/access'

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function requireUser(user: SessionUser | null | undefined): Response | null {
  if (!user) return json({ error: 'Unauthorised' }, 401)
  return null
}

export function requireAdmin(user: SessionUser | null | undefined): Response | null {
  const missing = requireUser(user)
  if (missing) return missing
  if (!isAdmin(user)) return json({ error: 'Forbidden' }, 403)
  return null
}

/** CMP sessions, attendance, mentees, and mentor notes. */
export function requireCmpStaff(user: SessionUser | null | undefined): Response | null {
  const missing = requireUser(user)
  if (missing) return missing
  if (!canManageCmp(user)) return json({ error: 'Forbidden' }, 403)
  return null
}

/**
 * Turn a Supabase/PostgREST error into a sentence the UI can show.
 * The database message (missing column, check constraint) is included
 * because the generic fallback hides the actual failure.
 */
export function dbErrorMessage(
  fallback: string,
  error: { message?: string } | null | undefined,
): string {
  const detail = error?.message?.replace(/\s+/g, ' ').trim()
  if (!detail) return fallback
  return `${fallback} ${detail}`
}
