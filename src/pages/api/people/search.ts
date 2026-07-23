/**
 * GET /api/people/search?q=<string>&exclude_team=<teamId>
 *
 * Searches active/approved people by name or email.
 * Minimum query length: 3 characters.
 * Optionally excludes people already on a given team.
 * Returns up to 10 results ordered by name.
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamLeadIds } from '@/lib/rbac'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  // Only admins and team leads may search members
  const admin = isAdmin(locals.user)
  if (!admin) {
    const leadTeamIds = await getTeamLeadIds(locals.user.person_id)
    if (leadTeamIds.size === 0) return json({ error: 'Forbidden' }, 403)
  }

  const q = url.searchParams.get('q')?.trim() ?? ''
  const excludeTeam = url.searchParams.get('exclude_team') ?? ''

  if (q.length < 3) return json({ data: [] })

  // Resolve IDs already on the team so we can exclude them
  let excludeIds: string[] = []
  if (excludeTeam) {
    const { data: members } = await supabaseAdmin
      .from('person_teams')
      .select('person_id')
      .eq('team_id', excludeTeam)
    excludeIds = ((members ?? []) as { person_id: string }[]).map(m => m.person_id)
  }

  let query = supabaseAdmin
    .from('people')
    .select('id, full_name, email, status, profile_photo_url')
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .eq('status', 'active')
    .order('full_name')
    .limit(10)

  if (excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/people/search]', error)
    return json({ error: error.message }, 500)
  }

  return json({ data: data ?? [] })
}
