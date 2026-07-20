import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  pillar_id: z.string().uuid().optional().nullable(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('*, pillars(name), person_teams(person_id, is_team_lead, people(id, full_name, email, status, profile_photo_url))')
    .eq('id', params.id ?? '')
    .single()

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpdateTeamSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin.from('teams').select('*').eq('id', params.id ?? '').single()

  const { data: team, error } = await supabaseAdmin
    .from('teams')
    .update(parsed.data)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !team) {
    console.error('[PUT /api/teams/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update team' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'teams',
    targetId: team.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: team as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: team }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = isAdmin(locals.user)
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const teamId = params.id ?? ''
  const permanent = url.searchParams.get('permanent') === 'true'

  // Block if members are still assigned
  const { count: memberCount } = await supabaseAdmin
    .from('person_teams')
    .select('*', { count: 'exact', head: true })
    .eq('team_id', teamId)

  if ((memberCount ?? 0) > 0) {
    return new Response(
      JSON.stringify({ error: 'This team has members assigned. Reassign them before archiving or deleting.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin.from('teams').select('*').eq('id', teamId).single()

  if (permanent) {
    // Hard delete
    const { error } = await supabaseAdmin.from('teams').delete().eq('id', teamId)
    if (error) {
      console.error('[DELETE /api/teams/:id?permanent=true] DB error:', error)
      return new Response(JSON.stringify({ error: 'Failed to delete team' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
    await writeAuditLog({
      actorId: locals.user.person_id,
      action: 'delete',
      targetTable: 'teams',
      targetId: teamId,
      beforeValue: before as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Soft archive
  const { data: team, error } = await supabaseAdmin
    .from('teams')
    .update({ is_active: false })
    .eq('id', teamId)
    .select()
    .single()

  if (error || !team) {
    console.error('[DELETE /api/teams/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to archive team' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'archive',
    targetTable: 'teams',
    targetId: team.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: team as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: team }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
