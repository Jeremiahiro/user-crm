import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'
import { assignOfficeHolder, getTeamLeadOfficeId } from '@/lib/offices'

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

  // is_team_lead is derived from the team's lead office, so never written here
  const { error } = await supabaseAdmin
    .from('person_teams')
    .upsert(
      { person_id: personId, team_id, joined_at: new Date().toISOString() },
      { onConflict: 'person_id,team_id', ignoreDuplicates: true },
    )

  if (error) {
    console.error('[POST /api/members/:id/teams] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to assign team' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (is_team_lead) {
    const officeId = await getTeamLeadOfficeId(team_id)
    const result = officeId
      ? await assignOfficeHolder({
        positionId: officeId,
        personId,
        termStart: new Date().toISOString().slice(0, 10),
        electedBy: 'board_appointment',
        actorId: locals.user.person_id,
      })
      : { ok: false as const, status: 404, error: 'Team not found' }
    if (!result.ok && result.status !== 409) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const { data } = await supabaseAdmin
    .from('person_teams')
    .select()
    .eq('person_id', personId)
    .eq('team_id', team_id)
    .single()

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

  const { data: membership } = await supabaseAdmin
    .from('person_teams')
    .select('is_team_lead')
    .eq('person_id', personId)
    .eq('team_id', teamId)
    .maybeSingle()

  if (membership?.is_team_lead) {
    return new Response(JSON.stringify({ error: 'This person leads the team. Hand the lead over before removing them.' }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
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
