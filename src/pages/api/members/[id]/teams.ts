import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

const AssignSchema = z.object({
  team_id: z.string().uuid(),
  is_team_lead: z.boolean().default(false),
})

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = AssignSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const personId = params.id ?? ''
  const { team_id, is_team_lead } = parsed.data

  // Verify person exists
  const { data: person } = await supabaseAdmin.from('people').select('id').eq('id', personId).single()
  if (!person) {
    return new Response(JSON.stringify({ error: 'Member not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verify team exists
  const { data: team } = await supabaseAdmin.from('teams').select('id, name').eq('id', team_id).single()
  if (!team) {
    return new Response(JSON.stringify({ error: 'Team not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('person_teams')
    .upsert(
      { person_id: personId, team_id, is_team_lead, joined_at: new Date().toISOString() },
      { onConflict: 'person_id,team_id' },
    )
    .select()
    .single()

  if (error) {
    console.error('[POST /api/members/:id/teams] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to assign team' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'person_teams',
    targetId: personId,
    afterValue: { team_id, is_team_lead },
  })

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = params.id ?? ''
  const teamId = url.searchParams.get('team_id')
  if (!teamId) {
    return new Response(JSON.stringify({ error: 'team_id query parameter is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error } = await supabaseAdmin
    .from('person_teams')
    .delete()
    .eq('person_id', personId)
    .eq('team_id', teamId)

  if (error) {
    console.error('[DELETE /api/members/:id/teams] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to remove from team' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'person_teams',
    targetId: personId,
    beforeValue: { team_id: teamId },
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
