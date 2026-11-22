import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { dbErrorMessage, requireAdmin } from '@/lib/http'
import { CreateMemberSchema } from '@/lib/people'
import { isAdmin } from '@/lib/rbac'

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const status = url.searchParams.get('status')
  const teamId = url.searchParams.get('team_id')
  const search = url.searchParams.get('q')

  let query = supabaseAdmin
    .from('people')
    .select('id, full_name, preferred_name, first_name, email, phone, status, person_types, profile_photo_url, date_joined, is_archived, person_teams(team_id, is_team_lead, teams(name))')
    .eq('is_archived', false)
    .order('full_name')

  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
    if (statuses.length === 1) {
      query = query.eq('status', statuses[0])
    } else if (statuses.length > 1) {
      query = query.in('status', statuses)
    }
  }
  if (search) query = query.or(`full_name.ilike.%${search}%,preferred_name.ilike.%${search}%`)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/members] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch members' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Client-side filter by team (Supabase embedded filter on join is complex)
  const filtered = teamId
    ? (data ?? []).filter((p) => {
        const pt = p.person_teams as { team_id: string }[]
        return pt?.some((t) => t.team_id === teamId)
      })
    : (data ?? [])

  return new Response(JSON.stringify({ data: filtered }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user || !isAdmin(locals.user)) return requireAdmin(locals.user)!

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = CreateMemberSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: member, error } = await supabaseAdmin
    .from('people')
    .insert({ ...parsed.data, source: parsed.data.source ?? 'manual' })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/members] DB error:', error)
    const isDupe = error.code === '23505'
    return new Response(
      JSON.stringify({
        error: isDupe
          ? 'A member with this email already exists.'
          : dbErrorMessage('Failed to create member.', error),
      }),
      { status: isDupe ? 409 : 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'people',
    targetId: member.id as string,
    afterValue: member as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: member }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
