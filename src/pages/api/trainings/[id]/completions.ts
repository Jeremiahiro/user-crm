/**
 * GET /api/trainings/:id/completions
 * Completion report for a training — admin and team leads only.
 * Returns all assigned people with their completion status.
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamLeadIds } from '@/lib/rbac'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const admin = isAdmin(locals.user)
  const leadTeamIds = admin ? null : await getTeamLeadIds(locals.user.person_id)
  if (!admin && (!leadTeamIds || leadTeamIds.size === 0)) return json({ error: 'Forbidden' }, 403)

  const trainingId = params.id ?? ''

  // Get all assignments for this training
  const { data: assignments } = await supabaseAdmin
    .from('training_assignments')
    .select('id, scope, team_id, person_id, deadline')
    .eq('training_id', trainingId)

  if (!assignments || assignments.length === 0) return json({ data: [] })

  // Resolve all assigned person IDs
  const personSet = new Set<string>()
  const deadlineMap = new Map<string, string | null>()

  for (const a of assignments as any[]) {
    if (a.scope === 'person' && a.person_id) {
      personSet.add(a.person_id)
      if (!deadlineMap.has(a.person_id)) deadlineMap.set(a.person_id, a.deadline)
    } else if (a.scope === 'team' && a.team_id) {
      const { data: members } = await supabaseAdmin.from('person_teams').select('person_id').eq('team_id', a.team_id)
      for (const m of (members ?? []) as { person_id: string }[]) {
        personSet.add(m.person_id)
        if (!deadlineMap.has(m.person_id)) deadlineMap.set(m.person_id, a.deadline)
      }
    } else if (a.scope === 'all') {
      const { data: allPeople } = await supabaseAdmin.from('people').select('id').eq('status', 'active')
      for (const p of (allPeople ?? []) as { id: string }[]) {
        personSet.add(p.id)
        if (!deadlineMap.has(p.id)) deadlineMap.set(p.id, a.deadline)
      }
    }
  }

  // If team lead: filter to only their team members
  let finalIds = [...personSet]
  if (!admin && leadTeamIds) {
    const { data: teamMembers } = await supabaseAdmin
      .from('person_teams').select('person_id').in('team_id', [...leadTeamIds])
    const leadMemberIds = new Set((teamMembers ?? []).map((r: any) => r.person_id))
    finalIds = finalIds.filter(id => leadMemberIds.has(id))
  }

  if (finalIds.length === 0) return json({ data: [] })

  // Fetch people details
  const { data: people } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email, person_teams(is_team_lead, teams(name))')
    .in('id', finalIds)
    .order('full_name')

  // Fetch completions
  const { data: completions } = await supabaseAdmin
    .from('training_completions')
    .select('person_id, method, completed_at, document_id, documents(title, status)')
    .eq('training_id', trainingId)
    .in('person_id', finalIds)

  const completionMap = new Map<string, any>()
  for (const c of (completions ?? []) as any[]) completionMap.set(c.person_id, c)

  const today = new Date()

  const rows = (people ?? []).map((p: any) => {
    const completion = completionMap.get(p.id) ?? null
    const deadline = deadlineMap.get(p.id) ?? null
    const deadlineDate = deadline ? new Date(deadline) : null
    const daysOverdue = deadlineDate && !completion ? Math.floor((today.getTime() - deadlineDate.getTime()) / 86400000) : null

    return {
      person_id: p.id,
      full_name: p.full_name,
      email: p.email,
      teams: p.person_teams?.map((t: any) => t.teams?.name).filter(Boolean) ?? [],
      deadline,
      status: completion ? 'complete' : deadlineDate && today > deadlineDate ? 'overdue' : 'pending',
      days_overdue: daysOverdue && daysOverdue > 0 ? daysOverdue : null,
      completion,
    }
  })

  return json({ data: rows })
}
