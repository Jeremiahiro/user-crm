/**
 * POST /api/teams/:id/members
 *
 * Adds a person to a team directly (bypasses join request flow).
 * Only admins and team leads of this team may do this.
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamLeadIds } from '@/lib/rbac'
import { createNotification } from '@/lib/notify'
import { writeAuditLog } from '@/lib/audit'

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function canManage(user: any, teamId: string): Promise<boolean> {
  if (isAdmin(user)) return true
  if (!user?.person_id) return false
  const ids = await getTeamLeadIds(user.person_id)
  return ids.has(teamId)
}

const AddMemberSchema = z.object({
  personId: z.string().uuid(),
})

export const POST: APIRoute = async ({ locals, params, request }) => {
  const { id: teamId } = params
  if (!locals.user || !teamId) return json({ error: 'Bad request' }, 400)
  if (!(await canManage(locals.user, teamId))) return json({ error: 'Forbidden' }, 403)

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = AddMemberSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Invalid person ID' }, 422)

  const { personId } = parsed.data

  // Guard: already a member?
  const { data: existing } = await supabaseAdmin
    .from('person_teams')
    .select('person_id')
    .eq('team_id', teamId)
    .eq('person_id', personId)
    .maybeSingle()

  if (existing) return json({ error: 'This person is already a member of the team.' }, 409)

  // Fetch team name for the notification message
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('name')
    .eq('id', teamId)
    .single()

  const { error } = await supabaseAdmin
    .from('person_teams')
    .insert({
      team_id: teamId,
      person_id: personId,
      is_team_lead: false,
      joined_at: new Date().toISOString(),
    })

  if (error) {
    console.error('[POST /api/teams/members]', error)
    return json({ error: error.message }, 500)
  }

  // Notify the newly added person
  await createNotification({
    recipientId: personId,
    type: 'team_join_approved',
    title: `You've been added to ${team?.name ?? 'a team'}`,
    body: `${locals.user.name} added you to the team.`,
    link: `/admin/teams/${teamId}`,
  }).catch(() => {})

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'person_teams',
    targetId: personId,
    afterValue: { team_id: teamId, person_id: personId, added_by: locals.user.person_id },
  })

  return json({ ok: true }, 201)
}
