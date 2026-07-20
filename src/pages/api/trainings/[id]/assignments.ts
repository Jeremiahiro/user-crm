/**
 * POST   /api/trainings/:id/assignments  — assign training to scope (admin/lead)
 * DELETE /api/trainings/:id/assignments  — remove assignment by ?assignment_id=<uuid>
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamLeadIds } from '@/lib/rbac'
import { notifyMultiple } from '@/lib/notify'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const AssignSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all'), deadline: z.string().optional().nullable() }),
  z.object({ scope: z.literal('team'), team_id: z.string().uuid(), deadline: z.string().optional().nullable() }),
  z.object({ scope: z.literal('person'), person_id: z.string().uuid(), deadline: z.string().optional().nullable() }),
])

async function canAssign(user: any, scope: string, teamId?: string | null): Promise<boolean> {
  if (isAdmin(user)) return true
  const leadIds = await getTeamLeadIds(user.person_id)
  if (leadIds.size === 0) return false
  if (scope === 'all') return false // only admins can assign to all
  if (scope === 'team') return teamId ? leadIds.has(teamId) : false
  return true // person scope — verified further below
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const trainingId = params.id ?? ''
  const { data: training } = await supabaseAdmin.from('trainings').select('id, title, requires_document').eq('id', trainingId).single()
  if (!training) return json({ error: 'Training not found' }, 404)

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = AssignSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  const teamId = 'team_id' in parsed.data ? parsed.data.team_id : null
  if (!(await canAssign(locals.user, parsed.data.scope, teamId))) return json({ error: 'Forbidden' }, 403)

  // For person scope: team leads must verify the person is on their team
  if (parsed.data.scope === 'person' && !isAdmin(locals.user)) {
    const leadIds = await getTeamLeadIds(locals.user.person_id)
    const { data: membership } = await supabaseAdmin
      .from('person_teams').select('team_id')
      .eq('person_id', (parsed.data as any).person_id)
      .in('team_id', [...leadIds])
      .limit(1)
    if (!membership || membership.length === 0) return json({ error: 'You can only assign trainings to members on your team' }, 403)
  }

  const row: Record<string, unknown> = {
    training_id: trainingId,
    scope: parsed.data.scope,
    deadline: parsed.data.deadline ?? null,
    assigned_by: locals.user.person_id,
  }
  if ('team_id' in parsed.data) row.team_id = parsed.data.team_id
  if ('person_id' in parsed.data) row.person_id = (parsed.data as any).person_id

  const { data, error } = await supabaseAdmin.from('training_assignments').insert(row).select().single()
  if (error) return json({ error: error.message }, 500)

  // Notify assigned people
  let recipientIds: string[] = []
  if (parsed.data.scope === 'all') {
    const { data: people } = await supabaseAdmin.from('people').select('id').in('status', ['active', 'approved'])
    recipientIds = (people ?? []).map((p: { id: string }) => p.id)
  } else if (parsed.data.scope === 'team') {
    const { data: members } = await supabaseAdmin.from('person_teams').select('person_id').eq('team_id', teamId!)
    recipientIds = (members ?? []).map((m: { person_id: string }) => m.person_id)
  } else {
    recipientIds = [(parsed.data as any).person_id]
  }
  recipientIds = recipientIds.filter(id => id !== locals.user.person_id)

  if (recipientIds.length > 0) {
    const deadline = parsed.data.deadline ? ` (due ${parsed.data.deadline})` : ''
    await notifyMultiple(recipientIds, {
      type: 'training_assigned',
      title: 'New training assigned',
      body: `You have been assigned: "${(training as any).title}"${deadline}`,
      link: `/admin/trainings/${trainingId}`,
    })
  }

  return json({ data }, 201)
}

export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Forbidden' }, 403)

  const assignmentId = url.searchParams.get('assignment_id')
  if (!assignmentId) return json({ error: 'assignment_id query param required' }, 400)

  const { error } = await supabaseAdmin.from('training_assignments').delete().eq('id', assignmentId).eq('training_id', params.id ?? '')
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
