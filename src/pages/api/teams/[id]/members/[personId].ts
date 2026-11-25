import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamLeadIds } from '@/lib/rbac'
import { createNotification } from '@/lib/notify'
import { assignOfficeHolder, getTeamLeadOfficeId } from '@/lib/offices'

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function canManage(user: any, teamId: string): Promise<boolean> {
  if (isAdmin(user)) return true
  if (!user?.person_id) return false
  const ids = await getTeamLeadIds(user.person_id)
  return ids.has(teamId)
}

// DELETE — remove member from team
export const DELETE: APIRoute = async ({ locals, params }) => {
  const { id: teamId, personId } = params
  if (!locals.user || !teamId || !personId) return json({ error: 'Bad request' }, 400)
  if (!(await canManage(locals.user, teamId))) return json({ error: 'Forbidden' }, 403)

  // If the actor is a team lead (not a full admin), check the chapter-level setting
  if (!isAdmin(locals.user)) {
    const { data: setting } = await supabaseAdmin
      .from('org_settings')
      .select('value')
      .eq('key', 'allow_teamlead_remove_member')
      .maybeSingle()
    const allowed = (setting as { value: string } | null)?.value ?? 'true'
    if (allowed !== 'true') {
      return json({ error: 'Team leads are not permitted to remove members on this chapter.' }, 403)
    }
  }

  const { data: membership } = await supabaseAdmin
    .from('person_teams').select('is_team_lead').eq('team_id', teamId).eq('person_id', personId).maybeSingle()
  if (membership?.is_team_lead)
    return json({ error: 'Cannot remove the team lead. Hand the lead over to another member first.' }, 409)

  const { error } = await supabaseAdmin
    .from('person_teams').delete().eq('team_id', teamId).eq('person_id', personId)
  if (error) return json({ error: error.message }, 500)

  await createNotification({
    recipientId: personId,
    type: 'team_member_removed',
    title: 'You have been removed from a team',
    body: 'A team lead has removed you from the team.',
    link: '/admin/teams',
  }).catch(() => {})

  return json({ ok: true }, 200)
}

// PATCH — hand the team lead office to this member (Admin / Chapter Leadership only)
export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const { id: teamId, personId } = params
  if (!locals.user || !teamId || !personId) return json({ error: 'Bad request' }, 400)
  if (!isAdmin(locals.user)) return json({ error: 'Only Admin or Chapter Leadership can change the team lead.' }, 403)

  let body: { is_team_lead?: boolean }
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  if (!body.is_team_lead) {
    return json({ error: 'A team always has one lead. Make another member lead to hand over.' }, 409)
  }

  const { data: membership } = await supabaseAdmin
    .from('person_teams').select('person_id').eq('team_id', teamId).eq('person_id', personId).maybeSingle()
  if (!membership) return json({ error: 'This person is not a member of the team.' }, 404)

  const officeId = await getTeamLeadOfficeId(teamId)
  if (!officeId) return json({ error: 'Team not found' }, 404)

  const result = await assignOfficeHolder({
    positionId: officeId,
    personId,
    termStart: new Date().toISOString().slice(0, 10),
    electedBy: 'board_appointment',
    actorId: locals.user.person_id,
  })
  if (!result.ok) return json({ error: result.error }, result.status)

  await createNotification({
    recipientId: personId,
    type: 'team_lead_assigned',
    title: 'You are now team lead',
    body: 'You have been made lead of your team.',
    link: `/admin/teams/${teamId}`,
  }).catch(() => {})

  return json({ ok: true, is_team_lead: true }, 200)
}
